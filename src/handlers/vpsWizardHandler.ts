import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  EmbedBuilder,
  GuildMember,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  TextChannel,
} from "discord.js";
import { CENTRAL_OS_CATALOG, getAvailableOsList, getDefaultOs, getOsById } from "../config/osCatalog";
import { getTicketCreatedMetadata } from "../services/ticketDatabase";
import { provisionVpsOrder } from "../services/provisioningService";
import { IncusProvider } from "../providers/incusProvider";
import { logBotError } from "../services/loggerService";

type VirtualizationMode = "standard" | "nested";

function ticketFromId(customId: string): string {
  return customId.split(":")[2] || "";
}

function virtualizationFromId(customId: string): VirtualizationMode {
  return customId.split(":")[2] === "nested" ? "nested" : "standard";
}

export async function showOsSelectionScreen(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  ticketId: string,
): Promise<void> {
  const metadata = (await getTicketCreatedMetadata(ticketId)) || {};
  const planName = String(metadata.planName || "STANDARD");
  const defaultOs = getDefaultOs();

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`vps:os_select:${ticketId}`)
    .setPlaceholder("Choose an Operating System...")
    .addOptions(
      CENTRAL_OS_CATALOG.map((os) => ({
        label: os.displayName.slice(0, 100),
        description: `${os.availability === "available" ? "Available" : "Unavailable"} • ${os.description}`.slice(0, 100),
        value: os.id,
        default: os.id === defaultOs.id,
        emoji: os.availability === "available" ? "🐧" : "🔒",
      })),
    );

  const embed = new EmbedBuilder()
    .setTitle("🦈 Shark Byte VPS • Step 1/3 — Operating System")
    .setColor(0x00a8ff)
    .setDescription(
      `Select the operating system for your **${planName}** VPS.\n\n` +
      `⭐ **Recommended:** Ubuntu 24.04 LTS\n` +
      `🔒 Options shown as unavailable cannot currently be provisioned on this node.`,
    )
    .setFooter({ text: "Shark Byte • VPS Provisioning Wizard" });

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);

  if (interaction.isButton()) {
    await interaction.update({ content: "", embeds: [embed], components: [row] });
  } else if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ content: "", embeds: [embed], components: [row] });
  } else {
    await interaction.reply({ embeds: [embed], components: [row], flags: 64 });
  }
}

export async function handleOsSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
  const ticketId = ticketFromId(interaction.customId);
  const osId = interaction.values[0];
  const os = getOsById(osId);

  if (!ticketId || !os || os.availability !== "available" || !os.incusAlias) {
    await interaction.reply({
      content: "❌ That operating system is currently unavailable.",
      flags: 64,
    });
    return;
  }

  await showVirtualizationSelectionScreen(interaction, ticketId, osId);
}

async function showVirtualizationSelectionScreen(
  interaction: StringSelectMenuInteraction | ButtonInteraction,
  ticketId: string,
  osId: string,
): Promise<void> {
  const metadata = (await getTicketCreatedMetadata(ticketId)) || {};
  const os = getOsById(osId);
  if (!os) throw new Error("Selected OS was not found.");

  const nestedHostAvailable = await new IncusProvider().isNestedVirtualizationSupported();

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`vps:virt_select:${ticketId}:${osId}`)
    .setPlaceholder("Choose virtualization...")
    .addOptions([
      {
        label: "Standard VPS",
        description: "Normal Incus container. Nested virtualization disabled.",
        value: "standard",
        emoji: "🖥️",
      },
      {
        label: "Nested VPS",
        description: nestedHostAvailable
          ? "Nested containers + /dev/kvm capability will be verified."
          : "Currently unavailable because host KVM is unavailable.",
        value: "nested",
        emoji: "⚡",
      },
    ]);

  const embed = new EmbedBuilder()
    .setTitle("🦈 Shark Byte VPS • Step 2/3 — Virtualization")
    .setColor(0x00a8ff)
    .setDescription(
      `**OS:** ${os.displayName}\n\n` +
      `🖥️ **Standard VPS**\nNormal Incus container with nested virtualization disabled.\n\n` +
      `⚡ **Nested VPS**\nEnables Incus nesting and attempts to expose \`/dev/kvm\`. The provisioning engine will verify that KVM is actually usable before activating the VPS.\n\n` +
      `${nestedHostAvailable ? "Choose your virtualization mode below." : "Nested VPS is currently unavailable on this node. Standard VPS remains available."}`,
    )
    .setFooter({ text: "Shark Byte • VPS Provisioning Wizard" });

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
  await interaction.update({ embeds: [embed], components: [row] });
}

export async function handleVirtualizationSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
  const parts = interaction.customId.split(":");
  const ticketId = parts[2];
  const osId = parts[3];
  const mode = interaction.values[0] as VirtualizationMode;

  if (!ticketId || !osId || !["standard", "nested"].includes(mode)) {
    await interaction.reply({ content: "❌ Invalid VPS wizard selection.", flags: 64 });
    return;
  }

  const os = getOsById(osId);
  if (!os || os.availability !== "available" || !os.incusAlias) {
    await interaction.reply({ content: "❌ Selected OS is unavailable.", flags: 64 });
    return;
  }

  if (mode === "nested" && !(await new IncusProvider().isNestedVirtualizationSupported())) {
    await interaction.reply({
      content: "❌ Nested virtualization is currently unavailable on this node.",
      flags: 64,
    });
    return;
  }

  await showConfirmationScreen(interaction, ticketId, osId, mode);
}

async function showConfirmationScreen(
  interaction: StringSelectMenuInteraction | ButtonInteraction,
  ticketId: string,
  osId: string,
  virtualizationMode: VirtualizationMode,
): Promise<void> {
  const metadata = (await getTicketCreatedMetadata(ticketId)) || {};
  const os = getOsById(osId);
  if (!os) throw new Error("Selected OS was not found.");

  const planName = String(metadata.planName || "STANDARD");
  const ramGb = Number(metadata.ramGb || 2);
  const vcpu = Number(metadata.vcpu || 1);
  const storageGb = Number(metadata.storageGb || 20);
  const priceInr = Number(metadata.priceInr || 199);
  const priceUsd = Number(metadata.priceUsd || 2.5);
  const host = process.env.PUBLIC_SSH_HOST?.trim() || "ssh.mysticservers.com";

  const embed = new EmbedBuilder()
    .setTitle("🦈 Shark Byte VPS • Step 3/3 — Confirm")
    .setColor(0x00a8ff)
    .setDescription(
      `Review everything before provisioning:\n\n` +
      `**Plan:** ${planName}\n` +
      `**OS:** ${os.displayName}\n` +
      `**Virtualization:** ${virtualizationMode === "nested" ? "⚡ Nested" : "🖥️ Standard"}\n` +
      `**CPU:** ${vcpu} vCPU\n` +
      `**RAM:** ${ramGb} GB\n` +
      `**Storage:** ${storageGb} GB (plan allocation; current dir backend does not enforce a per-container disk quota)\n` +
      `**Billing:** ₹${priceInr} / $${priceUsd} per month\n` +
      `**SSH:** ${host}:<assigned port>\n\n` +
      `⚠️ Provisioning begins only after you click **Confirm Provision**.`,
    )
    .setFooter({ text: "Shark Byte • Explicit confirmation required" })
    .setTimestamp();

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`vps:os_back:${ticketId}`)
      .setLabel("← Change OS")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`vps:virt_back:${ticketId}:${osId}`)
      .setLabel("← Change Virtualization")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`vps:provision_start:${ticketId}:${osId}:${virtualizationMode}`)
      .setLabel("Confirm Provision")
      .setStyle(ButtonStyle.Success),
  );

  await interaction.update({ embeds: [embed], components: [row] });
}

export async function handleVirtualizationBack(interaction: ButtonInteraction): Promise<void> {
  const parts = interaction.customId.split(":");
  await showVirtualizationSelectionScreen(interaction, parts[2], parts[3]);
}

export async function handleConfirmProvision(interaction: ButtonInteraction): Promise<void> {
  const parts = interaction.customId.split(":");
  const ticketId = parts[2];
  const osId = parts[3];
  const virtualizationMode = (parts[4] || "standard") as VirtualizationMode;

  const os = getOsById(osId);
  if (!ticketId || !os || os.availability !== "available" || !["standard", "nested"].includes(virtualizationMode)) {
    await interaction.reply({ content: "❌ Invalid provisioning request.", flags: 64 });
    return;
  }

  await interaction.deferUpdate();

  const initialEmbed = new EmbedBuilder()
    .setTitle("⏳ Shark Byte VPS Provisioning")
    .setColor(0x3498db)
    .setDescription(
      `**OS:** ${os.displayName}\n` +
      `**Virtualization:** ${virtualizationMode === "nested" ? "⚡ Nested" : "🖥️ Standard"}\n\n` +
      `🟡 **ALLOCATING** — Preparing VPS resources...`,
    );

  await interaction.editReply({ embeds: [initialEmbed], components: [] }).catch(() => {});

  const metadata = (await getTicketCreatedMetadata(ticketId)) || {};
  const channel = interaction.channel as TextChannel;
  const ownerMatch = channel?.topic?.match(/ticket-owner:(\d+)/);
  let targetMember = interaction.member as GuildMember;

  if (ownerMatch && interaction.guild) {
    targetMember = await interaction.guild.members.fetch(ownerMatch[1]).catch(() => targetMember);
  }

  try {
    await provisionVpsOrder(
      interaction.guild!,
      ticketId,
      targetMember,
      { ...metadata, osId, virtualizationMode },
      async (stepText) => {
        const embed = new EmbedBuilder()
          .setTitle("⏳ Shark Byte VPS Provisioning")
          .setColor(0x3498db)
          .setDescription(
            `**OS:** ${os.displayName}\n` +
            `**Virtualization:** ${virtualizationMode === "nested" ? "⚡ Nested" : "🖥️ Standard"}\n\n` +
            `🟡 ${stepText}`,
          );
        await interaction.editReply({ embeds: [embed] }).catch(() => {});
      },
    );

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("🟢 VPS Provisioning Complete")
          .setColor(0x2ecc71)
          .setDescription("Your VPS is active. The full SSH credentials card has been posted in this ticket.")
          .setTimestamp(),
      ],
      components: [],
    }).catch(() => {});
  } catch (error: any) {
    console.error("[Discord] VPS provisioning request failed:", error);
    await logBotError({
      client: interaction.client,
      guild: interaction.guild!,
      error,
      title: "VPS Provisioning Execution Error",
      context: "handleConfirmProvision",
      userTag: interaction.user.tag,
      userId: interaction.user.id,
      channelId: interaction.channelId || undefined,
    }).catch(() => {});

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("❌ VPS Provisioning Failed")
          .setColor(0xe74c3c)
          .setDescription(`The VPS could not be provisioned.\n\n\`${String(error?.message || "Unknown error").slice(0, 3500)}\``)
          .setTimestamp(),
      ],
      components: [],
    }).catch(() => {});
  }
}
