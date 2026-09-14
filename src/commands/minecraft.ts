import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from "discord.js";

import { renderMinecraftPricingPanel } from "../services/pricingService";

export const minecraftCommand = new SlashCommandBuilder()
  .setName("minecraft")
  .setDescription("Shark Byte Minecraft Game Server Command Suite")
  .addSubcommand((sub) =>
    sub.setName("plans").setDescription("View Minecraft server hosting plans and pricing")
  )
  .addSubcommand((sub) =>
    sub.setName("list").setDescription("View your active Minecraft game servers")
  );

export async function createMinecraftPricingPanel() {
  return await renderMinecraftPricingPanel();
}

export async function handleMinecraftCommand(
  interaction: ChatInputCommandInteraction,
  isStaff: boolean
): Promise<void> {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "plans") {
    await interaction.deferReply();
    const panel = await renderMinecraftPricingPanel();
    await interaction.editReply(panel);
    return;
  }

  if (subcommand === "list") {
    await interaction.deferReply({ flags: 64 });
    await interaction.editReply({
      content: "🎮 You currently do not have any active Minecraft servers provisioned.",
    });
    return;
  }
}
