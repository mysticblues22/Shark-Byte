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

import {
  CENTRAL_OS_CATALOG,
  getOsById,
} from "../config/osCatalog";

import {
  getTicketCreatedMetadata,
} from "../services/ticketDatabase";

import {
  provisionVpsOrder,
} from "../services/provisioningService";

import {
  IncusProvider,
} from "../providers/incusProvider";

import {
  logBotError,
} from "../services/loggerService";

type VirtualizationMode =
  "standard" | "nested";

type WizardInteraction =
  | ButtonInteraction
  | StringSelectMenuInteraction;

function ticketFromId(
  customId: string,
): string {
  return customId.split(":")[2] || "";
}

function safeMode(
  value: string | undefined,
): VirtualizationMode | null {
  if (
    value === "standard" ||
    value === "nested"
  ) {
    return value;
  }

  return null;
}

/**
 * Acknowledge an existing wizard interaction.
 *
 * Wizard navigation uses deferUpdate() because those interactions
 * originate from the ephemeral wizard message itself.
 */
async function acknowledgeUpdate(
  interaction: WizardInteraction,
): Promise<void> {
  if (
    interaction.replied ||
    interaction.deferred
  ) {
    return;
  }

  await interaction.deferUpdate();
}

/**
 * Open the VPS wizard as a NEW ephemeral reply.
 *
 * This is intentionally separate from acknowledgeUpdate().
 *
 * The original payment/order message containing "Claim VPS" must remain
 * untouched.
 */
async function acknowledgeNewWizard(
  interaction: ButtonInteraction,
): Promise<void> {
  if (
    interaction.replied ||
    interaction.deferred
  ) {
    return;
  }

  await interaction.deferReply({
    flags: 64,
  });
}

async function editAcknowledged(
  interaction: WizardInteraction,
  payload: Parameters<
    ButtonInteraction["editReply"]
  >[0],
): Promise<void> {
  if (
    !interaction.replied &&
    !interaction.deferred
  ) {
    await interaction.deferUpdate();
  }

  await interaction.editReply(
    payload,
  );
}

async function showWizardError(
  interaction: WizardInteraction,
  message: string,
): Promise<void> {
  const embed =
    new EmbedBuilder()
      .setTitle(
        "❌ Shark Byte VPS Wizard",
      )
      .setColor(0xe74c3c)
      .setDescription(message)
      .setFooter({
        text:
          "Shark Byte • VPS Provisioning Wizard",
      })
      .setTimestamp();

  try {
    if (
      interaction.deferred ||
      interaction.replied
    ) {
      await interaction.editReply({
        content: "",
        embeds: [embed],
        components: [],
      });
    } else {
      await interaction.reply({
        embeds: [embed],
        components: [],
        flags: 64,
      });
    }
  } catch (error) {
    console.error(
      "[Discord] Failed to display VPS wizard error:",
      error,
    );
  }
}

/**
 * Render Step 1.
 *
 * openNewWizard=true:
 *   Opens a NEW ephemeral response. Used by Claim VPS.
 *
 * openNewWizard=false:
 *   Updates the existing ephemeral wizard. Used by Change OS.
 */
export async function showOsSelectionScreen(
  interaction: WizardInteraction,
  ticketId: string,
  openNewWizard = false,
): Promise<void> {
  try {
    if (openNewWizard) {
      if (!interaction.isButton()) {
        throw new Error(
          "A new VPS wizard can only be opened from a button interaction.",
        );
      }

      await acknowledgeNewWizard(
        interaction,
      );
    } else {
      await acknowledgeUpdate(
        interaction,
      );
    }

    const metadata =
      (await getTicketCreatedMetadata(
        ticketId,
      )) || {};

    const planName =
      String(
        metadata.planName ||
        "STANDARD",
      );

    /*
     * IMPORTANT:
     *
     * Do NOT mark the recommended OS as Discord's default selection.
     *
     * Ubuntu 24.04 is recommended, but the customer must explicitly
     * choose an OS before proceeding.
     */
    const menu =
      new StringSelectMenuBuilder()
        .setCustomId(
          `vps:os_select:${ticketId}`,
        )
        .setPlaceholder(
          "Choose an Operating System...",
        )
        .addOptions(
          CENTRAL_OS_CATALOG.map(
            (os) => ({
              label:
                os.displayName.slice(
                  0,
                  100,
                ),

              description:
                `${os.availability === "available" ? "Available" : "Unavailable"} • ${os.description}`.slice(
                  0,
                  100,
                ),

              value: os.id,

              /*
               * Deliberately omitted:
               * default: ...
               */

              emoji:
                os.availability ===
                "available"
                  ? "🐧"
                  : "🔒",
            }),
          ),
        );

    const embed =
      new EmbedBuilder()
        .setTitle(
          "🦈 Shark Byte VPS • Step 1/3 — Operating System",
        )
        .setColor(0x00a8ff)
        .setDescription(
          `Select the operating system for your **${planName}** VPS.\n\n` +
          `⭐ **Recommended:** Ubuntu 24.04 LTS\n` +
          `🔒 Options shown as unavailable cannot currently be provisioned on this node.\n\n` +
          `**You must explicitly select an operating system to continue.**`,
        )
        .setFooter({
          text:
            "Shark Byte • VPS Provisioning Wizard",
        });

    const row =
      new ActionRowBuilder<
        StringSelectMenuBuilder
      >().addComponents(menu);

    await interaction.editReply({
      content: "",
      embeds: [embed],
      components: [row],
    });
  } catch (error: any) {
    console.error(
      "[Discord] VPS OS wizard error:",
      error,
    );

    await logBotError({
      client:
        interaction.client,
      guild:
        interaction.guild ||
        undefined,
      error,
      title:
        "VPS OS Selection Error",
      context:
        "showOsSelectionScreen",
      userTag:
        interaction.user.tag,
      userId:
        interaction.user.id,
      channelId:
        interaction.channelId ||
        undefined,
    }).catch(() => {});

    await showWizardError(
      interaction,
      `Could not open the VPS operating system selector.\n\n\`${String(error?.message || "Unknown error").slice(0, 1500)}\``,
    );
  }
}

export async function handleOsSelectMenu(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  await acknowledgeUpdate(
    interaction,
  );

  try {
    const ticketId =
      ticketFromId(
        interaction.customId,
      );

    const osId =
      interaction.values[0];

    const os =
      getOsById(osId);

    if (
      !ticketId ||
      !os ||
      os.availability !==
        "available" ||
      !os.incusAlias
    ) {
      await showWizardError(
        interaction,
        "That operating system is currently unavailable on this Incus node.",
      );

      return;
    }

    await showVirtualizationSelectionScreen(
      interaction,
      ticketId,
      osId,
    );
  } catch (error: any) {
    console.error(
      "[Discord] VPS OS selection handling error:",
      error,
    );

    await logBotError({
      client:
        interaction.client,
      guild:
        interaction.guild ||
        undefined,
      error,
      title:
        "VPS OS Selection Handling Error",
      context:
        "handleOsSelectMenu",
      userTag:
        interaction.user.tag,
      userId:
        interaction.user.id,
      channelId:
        interaction.channelId ||
        undefined,
    }).catch(() => {});

    await showWizardError(
      interaction,
      `Could not process that operating system selection.\n\n\`${String(error?.message || "Unknown error").slice(0, 1500)}\``,
    );
  }
}

async function showVirtualizationSelectionScreen(
  interaction: WizardInteraction,
  ticketId: string,
  osId: string,
): Promise<void> {
  await acknowledgeUpdate(
    interaction,
  );

  try {
    const metadata =
      (await getTicketCreatedMetadata(
        ticketId,
      )) || {};

    const os =
      getOsById(osId);

    if (
      !os ||
      os.availability !==
        "available" ||
      !os.incusAlias
    ) {
      await showWizardError(
        interaction,
        "The selected operating system is no longer available.",
      );

      return;
    }

    const nestedHostAvailable =
      await new IncusProvider()
        .isNestedVirtualizationSupported();

    const menu =
      new StringSelectMenuBuilder()
        .setCustomId(
          `vps:virt_select:${ticketId}:${osId}`,
        )
        .setPlaceholder(
          "Choose virtualization...",
        )
        .addOptions([
          {
            label:
              "Standard VPS",
            description:
              "Normal Incus container. Nested virtualization disabled.",
            value:
              "standard",
            emoji:
              "🖥️",
          },
          {
            label:
              "Nested VPS",
            description:
              nestedHostAvailable
                ? "Enables nesting and verifies /dev/kvm before activation."
                : "Currently unavailable on this node.",
            value:
              "nested",
            emoji:
              "⚡",
          },
        ]);

    const embed =
      new EmbedBuilder()
        .setTitle(
          "🦈 Shark Byte VPS • Step 2/3 — Virtualization",
        )
        .setColor(0x00a8ff)
        .setDescription(
          `**OS:** ${os.displayName}\n\n` +
          `🖥️ **Standard VPS**\n` +
          `Normal Incus container with nested virtualization disabled.\n\n` +
          `⚡ **Nested VPS**\n` +
          `Enables Incus nesting and attempts to expose \`/dev/kvm\`. ` +
          `The provisioning engine verifies KVM before the VPS can become active.\n\n` +
          `${
            nestedHostAvailable
              ? "Choose your virtualization mode below."
              : "Nested VPS is currently unavailable on this node. Standard VPS remains available."
          }`,
        )
        .setFooter({
          text:
            "Shark Byte • VPS Provisioning Wizard",
        });

    const row =
      new ActionRowBuilder<
        StringSelectMenuBuilder
      >().addComponents(menu);

    await interaction.editReply({
      content: "",
      embeds: [embed],
      components: [row],
    });
  } catch (error: any) {
    console.error(
      "[Discord] VPS virtualization screen error:",
      error,
    );

    await logBotError({
      client:
        interaction.client,
      guild:
        interaction.guild ||
        undefined,
      error,
      title:
        "VPS Virtualization Selection Error",
      context:
        "showVirtualizationSelectionScreen",
      userTag:
        interaction.user.tag,
      userId:
        interaction.user.id,
      channelId:
        interaction.channelId ||
        undefined,
    }).catch(() => {});

    await showWizardError(
      interaction,
      `Could not load virtualization options.\n\n\`${String(error?.message || "Unknown error").slice(0, 1500)}\``,
    );
  }
}

export async function handleVirtualizationSelectMenu(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  await acknowledgeUpdate(
    interaction,
  );

  try {
    const parts =
      interaction.customId.split(":");

    const ticketId =
      parts[2];

    const osId =
      parts[3];

    const mode =
      safeMode(
        interaction.values[0],
      );

    if (
      !ticketId ||
      !osId ||
      !mode
    ) {
      await showWizardError(
        interaction,
        "Invalid VPS virtualization selection.",
      );

      return;
    }

    const os =
      getOsById(osId);

    if (
      !os ||
      os.availability !==
        "available" ||
      !os.incusAlias
    ) {
      await showWizardError(
        interaction,
        "The selected operating system is unavailable.",
      );

      return;
    }

    if (
      mode === "nested"
    ) {
      const nestedSupported =
        await new IncusProvider()
          .isNestedVirtualizationSupported();

      if (!nestedSupported) {
        await showWizardError(
          interaction,
          "Nested virtualization is currently unavailable on this node. Please choose Standard VPS.",
        );

        return;
      }
    }

    await showConfirmationScreen(
      interaction,
      ticketId,
      osId,
      mode,
    );
  } catch (error: any) {
    console.error(
      "[Discord] VPS virtualization selection handling error:",
      error,
    );

    await logBotError({
      client:
        interaction.client,
      guild:
        interaction.guild ||
        undefined,
      error,
      title:
        "VPS Virtualization Selection Handling Error",
      context:
        "handleVirtualizationSelectMenu",
      userTag:
        interaction.user.tag,
      userId:
        interaction.user.id,
      channelId:
        interaction.channelId ||
        undefined,
    }).catch(() => {});

    await showWizardError(
      interaction,
      `Could not process that virtualization selection.\n\n\`${String(error?.message || "Unknown error").slice(0, 1500)}\``,
    );
  }
}

async function showConfirmationScreen(
  interaction: WizardInteraction,
  ticketId: string,
  osId: string,
  virtualizationMode: VirtualizationMode,
): Promise<void> {
  await acknowledgeUpdate(
    interaction,
  );

  try {
    const metadata =
      (await getTicketCreatedMetadata(
        ticketId,
      )) || {};

    const os =
      getOsById(osId);

    if (
      !os ||
      os.availability !==
        "available" ||
      !os.incusAlias
    ) {
      await showWizardError(
        interaction,
        "The selected operating system is no longer available.",
      );

      return;
    }

    const planName =
      String(
        metadata.planName ||
        "STANDARD",
      );

    const ramGb =
      Number(
        metadata.ramGb || 2,
      );

    const vcpu =
      Number(
        metadata.vcpu || 1,
      );

    const storageGb =
      Number(
        metadata.storageGb || 20,
      );

    const priceInr =
      Number(
        metadata.priceInr || 199,
      );

    const priceUsd =
      Number(
        metadata.priceUsd || 2.5,
      );

    const host =
      process.env.PUBLIC_SSH_HOST?.trim() ||
      "ssh.mysticservers.com";

    const embed =
      new EmbedBuilder()
        .setTitle(
          "🦈 Shark Byte VPS • Step 3/3 — Confirm",
        )
        .setColor(0x00a8ff)
        .setDescription(
          `Review everything before provisioning:\n\n` +
          `**Plan:** ${planName}\n` +
          `**OS:** ${os.displayName}\n` +
          `**Virtualization:** ${
            virtualizationMode ===
            "nested"
              ? "⚡ Nested"
              : "🖥️ Standard"
          }\n` +
          `**CPU:** ${vcpu} vCPU\n` +
          `**RAM:** ${ramGb} GB\n` +
          `**Storage:** ${storageGb} GB (plan allocation; current dir backend does not enforce a per-container disk quota)\n` +
          `**Billing:** ₹${priceInr} / $${priceUsd} per month\n` +
          `**SSH:** ${host}:<assigned port>\n\n` +
          `⚠️ Provisioning begins only after you click **Confirm Provision**.`,
        )
        .setFooter({
          text:
            "Shark Byte • Explicit confirmation required",
        })
        .setTimestamp();

    const row =
      new ActionRowBuilder<
        ButtonBuilder
      >().addComponents(
        new ButtonBuilder()
          .setCustomId(
            `vps:os_back:${ticketId}`,
          )
          .setLabel(
            "← Change OS",
          )
          .setStyle(
            ButtonStyle.Secondary,
          ),

        new ButtonBuilder()
          .setCustomId(
            `vps:virt_back:${ticketId}:${osId}`,
          )
          .setLabel(
            "← Change Virtualization",
          )
          .setStyle(
            ButtonStyle.Secondary,
          ),

        new ButtonBuilder()
          .setCustomId(
            `vps:provision_start:${ticketId}:${osId}:${virtualizationMode}`,
          )
          .setLabel(
            "Confirm Provision",
          )
          .setStyle(
            ButtonStyle.Success,
          ),
      );

    await interaction.editReply({
      content: "",
      embeds: [embed],
      components: [row],
    });
  } catch (error: any) {
    console.error(
      "[Discord] VPS confirmation screen error:",
      error,
    );

    await logBotError({
      client:
        interaction.client,
      guild:
        interaction.guild ||
        undefined,
      error,
      title:
        "VPS Confirmation Screen Error",
      context:
        "showConfirmationScreen",
      userTag:
        interaction.user.tag,
      userId:
        interaction.user.id,
      channelId:
        interaction.channelId ||
        undefined,
    }).catch(() => {});

    await showWizardError(
      interaction,
      `Could not load the VPS confirmation screen.\n\n\`${String(error?.message || "Unknown error").slice(0, 1500)}\``,
    );
  }
}

export async function handleVirtualizationBack(
  interaction: ButtonInteraction,
): Promise<void> {
  await acknowledgeUpdate(
    interaction,
  );

  const parts =
    interaction.customId.split(":");

  const ticketId =
    parts[2] || "";

  const osId =
    parts[3] || "";

  if (
    !ticketId ||
    !osId
  ) {
    await showWizardError(
      interaction,
      "Invalid virtualization navigation request.",
    );

    return;
  }

  await showVirtualizationSelectionScreen(
    interaction,
    ticketId,
    osId,
  );
}

export async function handleConfirmProvision(
  interaction: ButtonInteraction,
): Promise<void> {
  await acknowledgeUpdate(
    interaction,
  );

  const parts =
    interaction.customId.split(":");

  const ticketId =
    parts[2] || "";

  const osId =
    parts[3] || "";

  const virtualizationMode =
    safeMode(parts[4]);

  try {
    const os =
      getOsById(osId);

    if (
      !ticketId ||
      !os ||
      os.availability !==
        "available" ||
      !os.incusAlias ||
      !virtualizationMode
    ) {
      await showWizardError(
        interaction,
        "Invalid VPS provisioning request.",
      );

      return;
    }

    const initialEmbed =
      new EmbedBuilder()
        .setTitle(
          "⏳ Shark Byte VPS Provisioning",
        )
        .setColor(0x3498db)
        .setDescription(
          `**OS:** ${os.displayName}\n` +
          `**Virtualization:** ${
            virtualizationMode ===
            "nested"
              ? "⚡ Nested"
              : "🖥️ Standard"
          }\n\n` +
          `🟡 **ALLOCATING** — Preparing VPS resources...`,
        );

    await interaction.editReply({
      content: "",
      embeds: [initialEmbed],
      components: [],
    });

    const metadata =
      (await getTicketCreatedMetadata(
        ticketId,
      )) || {};

    const channel =
      interaction.channel as
        | TextChannel
        | null;

    const ownerMatch =
      channel?.topic?.match(
        /ticket-owner:(\d+)/,
      );

    let targetMember =
      interaction.member as GuildMember;

    if (
      ownerMatch &&
      interaction.guild
    ) {
      targetMember =
        await interaction.guild.members
          .fetch(
            ownerMatch[1],
          )
          .catch(
            () =>
              targetMember,
          );
    }

    await provisionVpsOrder(
      interaction.guild!,
      ticketId,
      targetMember,
      {
        ...metadata,
        osId,
        virtualizationMode,
      },
      async (stepText) => {
        const embed =
          new EmbedBuilder()
            .setTitle(
              "⏳ Shark Byte VPS Provisioning",
            )
            .setColor(
              0x3498db,
            )
            .setDescription(
              `**OS:** ${os.displayName}\n` +
              `**Virtualization:** ${
                virtualizationMode ===
                "nested"
                  ? "⚡ Nested"
                  : "🖥️ Standard"
              }\n\n` +
              `🟡 ${stepText}`,
            );

        await interaction
          .editReply({
            embeds: [embed],
          })
          .catch(
            (error) => {
              console.warn(
                "[Discord] Progress update failed; provisioning continues:",
                error?.message ||
                  error,
              );
            },
          );
      },
    );

    const successEmbed =
      new EmbedBuilder()
        .setTitle(
          "✅ VPS Provisioned Successfully",
        )
        .setColor(
          0x2ecc71,
        )
        .setDescription(
          `Your VPS has been successfully provisioned.\n\n` +
          `**OS:** ${os.displayName}\n` +
          `**Virtualization:** ${
            virtualizationMode ===
            "nested"
              ? "⚡ Nested"
              : "🖥️ Standard"
          }\n\n` +
          `Your VPS credentials and connection details have been recorded in the order system.`,
        )
        .setFooter({
          text:
            "Shark Byte • VPS Provisioning",
        })
        .setTimestamp();

    await interaction.editReply({
      embeds: [successEmbed],
      components: [],
    }).catch(
      (error) => {
        console.warn(
          "[Discord] Final provisioning message update failed:",
          error?.message ||
            error,
        );
      },
    );
  } catch (error: any) {
    console.error(
      "[Discord] VPS provisioning error:",
      error,
    );

    await logBotError({
      client:
        interaction.client,
      guild:
        interaction.guild ||
        undefined,
      error,
      title:
        "VPS Provisioning Error",
      context:
        "handleConfirmProvision",
      userTag:
        interaction.user.tag,
      userId:
        interaction.user.id,
      channelId:
        interaction.channelId ||
        undefined,
    }).catch(() => {});

    await showWizardError(
      interaction,
      `VPS provisioning failed.\n\n\`${String(error?.message || "Unknown error").slice(0, 1500)}\``,
    );
  }
}
