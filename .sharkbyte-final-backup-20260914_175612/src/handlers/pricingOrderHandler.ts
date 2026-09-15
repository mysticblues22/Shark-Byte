import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ButtonInteraction,
  EmbedBuilder,
  GuildMember,
  StringSelectMenuInteraction,
} from "discord.js";

import {
  getActiveHostingNodes,
  getPricingPlanByIdOrName,
  renderVpsPricingPanel,
  renderMinecraftPricingPanel,
} from "../services/pricingService";
import { createTicket, TicketMinecraftDetails, TicketVPSDetails } from "../services/ticketService";

export async function handlePricingSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
  const customId = interaction.customId;
  const selectedPlanId = interaction.values[0];

  if (customId !== "order_vps_plan" && customId !== "order_mc_plan") {
    return;
  }

  // Reset the panel select menu back to default placeholder state
  if (interaction.message) {
    if (customId === "order_vps_plan") {
      const panel = await renderVpsPricingPanel();
      await interaction.message.edit({ embeds: panel.embeds, components: panel.components }).catch(() => {});
    } else {
      const panel = await renderMinecraftPricingPanel();
      await interaction.message.edit({ embeds: panel.embeds, components: panel.components }).catch(() => {});
    }
  }

  await interaction.deferReply({ flags: 64 });

  try {
    const plan = await getPricingPlanByIdOrName(selectedPlanId);
    if (!plan) {
      await interaction.editReply({ content: "❌ Selected pricing plan was not found." });
      return;
    }

    const type = customId === "order_vps_plan" ? "vps" : "mc";
    const typeLabel = type === "vps" ? "VPS Host" : "Minecraft Server";

    const nodes = await getActiveHostingNodes(type === "vps" ? "vps" : "minecraft");
    if (nodes.length === 0) {
      await interaction.editReply({ content: "⚠️ No active hosting locations found in database." });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`📍 Select Hosting Location for ${plan.name} ${typeLabel}`)
      .setDescription(
        `You selected **${plan.name}** (${plan.ramGb}GB RAM / ${plan.storageGb}GB Disk — ₹${plan.priceInr} / $${plan.priceUsd} per month).\n\n` +
          `Please choose your preferred server location below to create your automated sales ticket:`
      )
      .setColor(0x00a8ff)
      .setFooter({ text: "Shark Byte • High Performance Hosting" });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      nodes.slice(0, 5).map((node) =>
        new ButtonBuilder()
          .setCustomId(`order_loc:${type}:${plan.id}:${node.locationName}`)
          .setLabel(node.displayName)
          .setStyle(ButtonStyle.Primary)
      )
    );

    await interaction.editReply({ embeds: [embed], components: [row] });
  } catch (err: any) {
    console.error("❌ Error handling plan selection:", err);
    await interaction.editReply({ content: `❌ Could not process selection: ${err.message}` });
  }
}

export async function handleLocationButtonClick(interaction: ButtonInteraction): Promise<void> {
  const customId = interaction.customId;
  if (!customId.startsWith("order_loc:")) {
    return;
  }

  // customId format: order_loc:<type>:<planId>:<location>
  const parts = customId.split(":");
  if (parts.length < 4) {
    await interaction.reply({ content: "❌ Invalid location button payload.", flags: 64 });
    return;
  }

  const type = parts[1];
  const planId = parts[2];
  const location = parts[3];

  await interaction.deferReply({ flags: 64 });

  try {
    const member = interaction.member as GuildMember;
    const guild = interaction.guild;

    if (!guild || !member) {
      await interaction.editReply({ content: "❌ Orders can only be placed within a server." });
      return;
    }

    const plan = await getPricingPlanByIdOrName(planId);
    if (!plan) {
      await interaction.editReply({ content: "❌ Target pricing plan was not found." });
      return;
    }

    let ticketChannel;

    if (type === "vps") {
      const vpsDetails: TicketVPSDetails = {
        location,
        planId: plan.id,
        planName: plan.name,
        priceInr: plan.priceInr,
        priceUsd: plan.priceUsd,
        ramGb: plan.ramGb,
        storageGb: plan.storageGb,
        vcpu: plan.vcpu,
        fullRootAccess: true,
        instantDeployment: true,
        discordSupport: true,
        networkAllocation: "Dedicated Public Gateway Port + Private Subnet IPv4",
        cpuModels: ["AMD EPYC™ High Frequency Enterprise Core"],
      };

      ticketChannel = await createTicket(guild, member, "Sales", vpsDetails);
    } else {
      const mcDetails: TicketMinecraftDetails = {
        planId: plan.id,
        planName: plan.name,
        priceInr: plan.priceInr,
        priceUsd: plan.priceUsd,
        ramGb: plan.ramGb,
        cpuPercent: plan.cpuPercent || plan.vcpu * 100,
        storageGb: plan.storageGb,
      };

      ticketChannel = await createTicket(guild, member, "Sales", undefined, mcDetails);
    }

    await interaction.editReply({
      content: `✅ Your order ticket has been created! Head over to ${ticketChannel} to complete your order setup.`,
      components: [],
    });
  } catch (err: any) {
    console.error("❌ Failed to create order ticket:", err);
    await interaction.editReply({ content: `❌ Could not create order ticket: ${err.message}` });
  }
}
