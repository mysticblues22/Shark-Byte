import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ButtonInteraction,
  GuildMember,
  TextChannel,
  EmbedBuilder,
  ChannelType,
  PermissionFlagsBits,
} from "discord.js";

import { createTicket } from "../services/ticketService";
import {
  claimDatabaseTicket,
  closeDatabaseTicket,
  getTicketById,
  getTicketCreatedMetadata,
} from "../services/ticketDatabase";
import { provisionMinecraftOrder } from "../services/provisioningService";
import { showOsSelectionScreen } from "./vpsWizardHandler";
import { logBotError } from "../services/loggerService";

const departmentNames: Record<string, string> = {
  sales: "Sales",
  technical: "Technical Support",
  billing: "Billing",
  vps: "VPS Support",
  other: "Other",
};

export function isStaffMember(member: GuildMember | null): boolean {
  if (!member) return false;
  const supportRoleId = process.env.SUPPORT_ROLE_ID;
  const isAdministrator = member.permissions.has(PermissionFlagsBits.Administrator);
  const isSupportRole = Boolean(supportRoleId && member.roles.cache.has(supportRoleId));
  const hasStaffNamedRole = member.roles.cache.some((r) => {
    const name = r.name.toLowerCase();
    return name.includes("staff") || name.includes("admin") || name.includes("support") || name.includes("mod");
  });
  return isAdministrator || isSupportRole || hasStaffNamedRole;
}

export async function handleTicketButton(interaction: ButtonInteraction): Promise<void> {
  const customId = interaction.customId;

  // 1. Department Selection (ticket:sales, ticket:technical, etc.)
  if (
    customId === "ticket:sales" ||
    customId === "ticket:technical" ||
    customId === "ticket:billing" ||
    customId === "ticket:vps" ||
    customId === "ticket:other"
  ) {
    const departmentKey = customId.replace("ticket:", "");
    const departmentName = departmentNames[departmentKey] || "Support";

    await interaction.deferReply({ flags: 64 });

    try {
      const member = interaction.member as GuildMember;
      const guild = interaction.guild;

      if (!guild || !member) {
        await interaction.editReply({ content: "❌ This button can only be used within a server." });
        return;
      }

      const channel = await createTicket(guild, member, departmentName);

      await interaction.editReply({
        content: `✅ Ticket channel created: ${channel}`,
      });
    } catch (err: any) {
      console.error("❌ Failed to create ticket:", err);
      await interaction.editReply({
        content: `❌ Could not create ticket: ${err.message || "Unknown error"}`,
      });
    }
    return;
  }

  // 2. Claim Ticket (Staff Only)
  if (customId === "ticket:claim") {
    const member = interaction.member as GuildMember;
    if (!isStaffMember(member)) {
      await interaction.reply({ content: "❌ Only staff members can claim tickets.", flags: 64 });
      return;
    }

    await interaction.deferReply({ flags: 64 });

    const channel = interaction.channel as TextChannel;
    if (!channel || !channel.topic) {
      await interaction.editReply({ content: "❌ This command must be executed within a ticket channel." });
      return;
    }

    const ticketIdMatch = channel.topic.match(/ticket-id:([a-f0-9-]+)/);
    if (!ticketIdMatch) {
      await interaction.editReply({ content: "❌ Invalid ticket channel topic structure." });
      return;
    }

    const ticketId = ticketIdMatch[1];
    try {
      await claimDatabaseTicket(ticketId, interaction.user.id);

      const embed = new EmbedBuilder()
        .setTitle("👤 Ticket Claimed")
        .setDescription(`This ticket has been claimed by ${interaction.user}. They will assist you shortly!`)
        .setColor(0x2ecc71)
        .setTimestamp();

      await channel.send({ embeds: [embed] });
      await interaction.editReply({ content: "✅ Ticket claimed successfully." });
    } catch (err: any) {
      await interaction.editReply({ content: `❌ ${err.message || "Failed to claim ticket."}` });
    }
    return;
  }

  // 2b. Provision VPS Button (Staff Only) -> Triggers Interactive OS Wizard
  if (customId === "vps:provision") {
    const member = interaction.member as GuildMember;
    if (!isStaffMember(member)) {
      await interaction.reply({ content: "❌ Only staff members can manually provision VPS instances.", flags: 64 });
      return;
    }

    try {
      const channel = interaction.channel as TextChannel;
      const ticketIdMatch = channel?.topic?.match(/ticket-id:([a-f0-9-]+)/);

      if (!ticketIdMatch) {
        await interaction.reply({ content: "❌ Could not find ticket metadata.", flags: 64 });
        return;
      }

      const ticketId = ticketIdMatch[1];
      await showOsSelectionScreen(interaction, ticketId);
    } catch (err: any) {
      console.error("❌ Manual VPS Provision Wizard Launch Error:", err);
      await logBotError({
        client: interaction.client,
        guild: interaction.guild!,
        error: err,
        title: "Manual VPS Provisioning Wizard Error",
        context: "vps:provision",
        userTag: interaction.user.tag,
        userId: interaction.user.id,
        channelId: interaction.channelId || undefined,
      }).catch(() => {});

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: `❌ Could not start OS wizard: ${err.message || "Unknown error"}`, flags: 64 });
      } else {
        await interaction.reply({ content: `❌ Could not start OS wizard: ${err.message || "Unknown error"}`, flags: 64 });
      }
    }
    return;
  }

  // 2c. Provision Minecraft Button (Staff Only)
  if (customId === "minecraft:provision") {
    const member = interaction.member as GuildMember;
    if (!isStaffMember(member)) {
      await interaction.reply({ content: "❌ Only staff members can manually provision Minecraft servers.", flags: 64 });
      return;
    }

    await interaction.deferReply({ flags: 64 });
    try {
      const channel = interaction.channel as TextChannel;
      const ticketIdMatch = channel?.topic?.match(/ticket-id:([a-f0-9-]+)/);
      const ownerIdMatch = channel?.topic?.match(/ticket-owner:(\d+)/);

      if (!ticketIdMatch) {
        await interaction.editReply({ content: "❌ Could not find ticket metadata." });
        return;
      }

      const ticketId = ticketIdMatch[1];
      const metadata = await getTicketCreatedMetadata(ticketId);

      let targetCustomerMember: GuildMember = member;
      if (ownerIdMatch && ownerIdMatch[1] && interaction.guild) {
        targetCustomerMember = await interaction.guild.members.fetch(ownerIdMatch[1]).catch(() => member);
      }

      await provisionMinecraftOrder(interaction.guild!, ticketId, targetCustomerMember, metadata || {});
      await interaction.editReply({ content: "✅ Minecraft server provisioned successfully! Check credentials card in channel." });
    } catch (err: any) {
      console.error("❌ Manual Minecraft Provision Error:", err);
      await logBotError({
        client: interaction.client,
        guild: interaction.guild!,
        error: err,
        title: "Manual Minecraft Provisioning Error",
        context: "minecraft:provision",
        userTag: interaction.user.tag,
        userId: interaction.user.id,
        channelId: interaction.channelId || undefined,
      }).catch(() => {});
      await interaction.editReply({ content: `❌ Minecraft Provisioning failed: ${err.message || "Unknown error"}` });
    }
    return;
  }

  // 3. Prompt Close Confirmation
  if (customId === "ticket:close") {
    const channel = interaction.channel as TextChannel;
    if (!channel || !channel.topic) {
      await interaction.reply({ content: "❌ This button must be used inside a ticket channel.", flags: 64 });
      return;
    }

    const ownerIdMatch = channel.topic.match(/ticket-owner:(\d+)/);
    const ownerId = ownerIdMatch ? ownerIdMatch[1] : null;
    const member = interaction.member as GuildMember;

    if (!isStaffMember(member) && member.id !== ownerId) {
      await interaction.reply({ content: "❌ Only the ticket creator or staff members can close this ticket.", flags: 64 });
      return;
    }

    const ticketIdMatch = channel.topic.match(/ticket-id:([a-f0-9-]+)/);
    if (!ticketIdMatch) {
      await interaction.reply({ content: "❌ Invalid ticket channel topic structure.", flags: 64 });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle("🔒 Confirm Ticket Closure")
      .setDescription(
        "Are you sure you want to close this ticket?\n\n" +
          "• A full message transcript will be recorded and saved to `#ticket-logs`.\n" +
          "• This ticket channel will be permanently deleted."
      )
      .setColor(0xe74c3c)
      .setFooter({ text: "Shark Byte • Support Ticket System" });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("ticket:close_confirm")
        .setLabel("Confirm Close")
        .setEmoji("🔒")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId("ticket:close_cancel")
        .setLabel("Cancel")
        .setEmoji("❌")
        .setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({ embeds: [embed], components: [row], flags: 64 });
    return;
  }

  // 4. Cancel Close
  if (customId === "ticket:close_cancel") {
    await interaction.update({
      content: "❌ Ticket closure cancelled.",
      embeds: [],
      components: [],
    });
    return;
  }

  // 5. Confirm Close & Save Transcript to #ticket-logs
  if (customId === "ticket:close_confirm") {
    const channel = interaction.channel as TextChannel;
    const guild = interaction.guild;

    if (!channel || !channel.topic || !guild) {
      await interaction.reply({ content: "❌ Unable to close channel context.", flags: 64 });
      return;
    }

    await interaction.update({
      content: "🔒 Closing ticket and generating transcript...",
      embeds: [],
      components: [],
    });

    const ticketIdMatch = channel.topic.match(/ticket-id:([a-f0-9-]+)/);
    const ticketNumMatch = channel.topic.match(/ticket-number:(\d+)/);
    const ownerIdMatch = channel.topic.match(/ticket-owner:(\d+)/);

    const ticketId = ticketIdMatch ? ticketIdMatch[1] : null;
    const ticketNumber = ticketNumMatch ? ticketNumMatch[1] : "000000";
    const ownerId = ownerIdMatch ? ownerIdMatch[1] : "Unknown";

    if (!ticketId) {
      await channel.send("❌ Error reading ticket metadata from channel topic.");
      return;
    }

    try {
      // 1. Fetch message history for transcript (up to 100 messages)
      const fetchedMessages = await channel.messages.fetch({ limit: 100 });
      const sortedMessages = Array.from(fetchedMessages.values()).sort(
        (a, b) => a.createdTimestamp - b.createdTimestamp
      );

      const transcriptLines: string[] = [
        "================================================================================",
        "                      SHARK BYTE SUPPORT TICKET TRANSCRIPT                      ",
        "================================================================================",
        `Ticket ID:      ${ticketId}`,
        `Ticket Number:  #${ticketNumber}`,
        `Channel Name:   #${channel.name}`,
        `Guild:          ${guild.name} (${guild.id})`,
        `Opened By ID:   ${ownerId}`,
        `Closed By:      ${interaction.user.tag} (${interaction.user.id})`,
        `Closed At:      ${new Date().toISOString()}`,
        `Messages Count: ${sortedMessages.length}`,
        "================================================================================",
        "",
      ];

      for (const msg of sortedMessages) {
        const timeStr = new Date(msg.createdTimestamp).toISOString();
        const authorStr = `${msg.author.tag} (${msg.author.id})`;
        const contentStr = msg.content || (msg.embeds.length > 0 ? "[Embed Message]" : "[Attachment / Component]");
        transcriptLines.push(`[${timeStr}] ${authorStr}:\n  ${contentStr}\n`);
      }

      const transcriptBuffer = Buffer.from(transcriptLines.join("\n"), "utf-8");
      const attachment = new AttachmentBuilder(transcriptBuffer, {
        name: `transcript-ticket-${ticketNumber}.txt`,
      });

      // 2. Fetch database record & mark as closed
      const dbTicket = await getTicketById(ticketId).catch(() => null);
      const claimedById = dbTicket?.claimedByDiscordId;
      await closeDatabaseTicket(ticketId, interaction.user.id).catch(() => {});

      // 3. Log to #ticket-logs channel
      await guild.channels.fetch();
      let logChannel = guild.channels.cache.find(
        (c): c is TextChannel =>
          c.type === ChannelType.GuildText &&
          (c.id === process.env.TICKET_LOG_CHANNEL_ID || c.name === "ticket-logs" || c.name.includes("ticket-log"))
      );

      if (logChannel) {
        const logEmbed = new EmbedBuilder()
          .setTitle(`🔒 Ticket Archived • #${ticketNumber}`)
          .setColor(0xe74c3c)
          .addFields(
            { name: "Ticket Number", value: `#${ticketNumber}`, inline: true },
            { name: "Channel", value: `\`#${channel.name}\``, inline: true },
            { name: "Opened By", value: `<@${ownerId}>`, inline: true },
            { name: "Closed By", value: `${interaction.user}`, inline: true },
            { name: "Claimed By", value: claimedById ? `<@${claimedById}>` : "*Unclaimed*", inline: true },
            { name: "Messages Archived", value: `${sortedMessages.length}`, inline: true }
          )
          .setFooter({ text: "Shark Byte Audit Logs" })
          .setTimestamp();

        await logChannel.send({ embeds: [logEmbed], files: [attachment] }).catch((err) => {
          console.error("❌ Could not post transcript to ticket-logs channel:", err);
        });
      } else {
        console.warn("⚠️ #ticket-logs channel was not found in guild cache.");
      }

      // 4. Send closing notice and delete channel after 5 seconds
      const closeNotice = new EmbedBuilder()
        .setTitle("🔒 Ticket Closed & Archived")
        .setDescription(
          `Ticket #${ticketNumber} closed by ${interaction.user}.\n` +
            `Transcript saved in ${logChannel ? logChannel : "`#ticket-logs`"}.\n\n` +
            "Deleting channel in **5 seconds**..."
        )
        .setColor(0xe74c3c)
        .setTimestamp();

      await channel.send({ embeds: [closeNotice] }).catch(() => {});

      setTimeout(async () => {
        await channel.delete("Ticket closed & transcript logged").catch(() => {});
      }, 5000);
    } catch (err: any) {
      console.error("❌ Error closing ticket:", err);
      await channel.send(`❌ Error while archiving ticket: ${err.message}`).catch(() => {});
    }
    return;
  }
}
