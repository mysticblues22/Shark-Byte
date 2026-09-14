import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextChannel,
} from "discord.js";

import { claimDatabaseTicket, closeDatabaseTicket } from "../services/ticketDatabase";

export const ticketCommand = new SlashCommandBuilder()
  .setName("ticket")
  .setDescription("Shark Byte Ticket System Command Suite")
  .addSubcommand((sub) =>
    sub.setName("panel").setDescription("Deploy the support ticket creation panel (Staff Only)")
  )
  .addSubcommand((sub) =>
    sub.setName("claim").setDescription("Claim the current ticket channel (Staff Only)")
  )
  .addSubcommand((sub) =>
    sub.setName("close").setDescription("Close the current ticket channel (Staff Only)")
  );

export function createTicketPanel() {
  const embed = new EmbedBuilder()
    .setTitle("🦈 Shark Byte Support Center")
    .setDescription(
      "Need assistance or looking to get started? Click a button below to open a ticket:\n\n" +
        "🛒 **Sales** — VPS & Server plans, custom quotes, pre-sales inquiries\n" +
        "🖥️ **Technical Support** — Technical issues, networking, container help\n" +
        "💳 **Billing** — Payments, renewals, invoices\n" +
        "🌐 **VPS Management** — Existing instance support\n" +
        "❓ **General Support** — Anything else"
    )
    .setColor(0x00a8ff)
    .setFooter({
      text: "Shark Byte • High Performance Hosting",
    });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket:sales")
      .setLabel("Sales")
      .setEmoji("🛒")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId("ticket:technical")
      .setLabel("Technical")
      .setEmoji("🖥️")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId("ticket:billing")
      .setLabel("Billing")
      .setEmoji("💳")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId("ticket:vps")
      .setLabel("VPS Support")
      .setEmoji("🌐")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId("ticket:other")
      .setLabel("Other")
      .setEmoji("❓")
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    embeds: [embed],
    components: [row],
  };
}

export async function handleTicketCommand(
  interaction: ChatInputCommandInteraction,
  isStaff: boolean
): Promise<void> {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "panel") {
    if (!isStaff) {
      await interaction.reply({
        content: "❌ Only Staff can deploy the ticket panel.",
        flags: 64,
      });
      return;
    }

    await interaction.reply(createTicketPanel());
    return;
  }

  if (subcommand === "claim") {
    if (!isStaff) {
      await interaction.reply({ content: "❌ Only Staff can claim tickets.", flags: 64 });
      return;
    }

    const channel = interaction.channel as TextChannel;
    if (!channel || !channel.topic?.includes("ticket-id:")) {
      await interaction.reply({ content: "❌ This command must be run inside a ticket channel.", flags: 64 });
      return;
    }

    const match = channel.topic.match(/ticket-id:([a-f0-9-]+)/);
    if (!match) {
      await interaction.reply({ content: "❌ Invalid ticket channel metadata.", flags: 64 });
      return;
    }

    await interaction.deferReply({ flags: 64 });
    try {
      await claimDatabaseTicket(match[1], interaction.user.id);
      const embed = new EmbedBuilder()
        .setTitle("👤 Ticket Claimed")
        .setDescription(`This ticket has been claimed by ${interaction.user}.`)
        .setColor(0x2ecc71)
        .setTimestamp();

      await channel.send({ embeds: [embed] });
      await interaction.editReply({ content: "✅ Ticket claimed." });
    } catch (err: any) {
      await interaction.editReply({ content: `❌ Could not claim ticket: ${err.message}` });
    }
    return;
  }

  if (subcommand === "close") {
    if (!isStaff) {
      await interaction.reply({ content: "❌ Only Staff can close tickets.", flags: 64 });
      return;
    }

    const channel = interaction.channel as TextChannel;
    if (!channel || !channel.topic?.includes("ticket-id:")) {
      await interaction.reply({ content: "❌ This command must be run inside a ticket channel.", flags: 64 });
      return;
    }

    const match = channel.topic.match(/ticket-id:([a-f0-9-]+)/);
    if (!match) {
      await interaction.reply({ content: "❌ Invalid ticket channel metadata.", flags: 64 });
      return;
    }

    await interaction.deferReply({ flags: 64 });
    try {
      await closeDatabaseTicket(match[1], interaction.user.id);
      const embed = new EmbedBuilder()
        .setTitle("🔒 Ticket Closed")
        .setDescription(`Ticket closed by ${interaction.user}. This channel will be deleted in 10 seconds.`)
        .setColor(0xe74c3c)
        .setTimestamp();

      await channel.send({ embeds: [embed] });
      await interaction.editReply({ content: "🔒 Closing ticket..." });

      setTimeout(() => {
        channel.delete("Ticket closed").catch(() => {});
      }, 10000);
    } catch (err: any) {
      await interaction.editReply({ content: `❌ Could not close ticket: ${err.message}` });
    }
    return;
  }
}
