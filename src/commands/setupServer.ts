import {
  ChannelType,
  ChatInputCommandInteraction,
  ColorResolvable,
  EmbedBuilder,
  Guild,
  PermissionFlagsBits,
  Role,
  TextChannel,
} from "discord.js";

import { createTicketPanel } from "./ticket";
import { renderVpsPricingPanel, renderMinecraftPricingPanel } from "../services/pricingService";

export const RECOMMENDED_ROLES: Array<{
  name: string;
  color: ColorResolvable;
  hoist: boolean;
  reason: string;
  autoAssignOnJoin?: boolean;
}> = [
  { name: "👑 Owner", color: "#e74c3c", hoist: true, reason: "Platform & Community Owner" },
  { name: "🛡️ Shark Admin", color: "#e67e22", hoist: true, reason: "Executive Administration" },
  { name: "🦈 Shark Support", color: "#00a8ff", hoist: true, reason: "Support Team & Technical Staff" },
  { name: "👮 Moderator", color: "#9b59b6", hoist: true, reason: "Community Rule Enforcement" },
  { name: "🖥️ VPS Customer", color: "#2ecc71", hoist: true, reason: "Active Paid VPS Client" },
  { name: "🎁 Free VPS Customer", color: "#1abc9c", hoist: true, reason: "Active Trial / Reward Free VPS Client" },
  { name: "🎮 Minecraft Customer", color: "#f1c40f", hoist: true, reason: "Active Minecraft Server Client" },
  { name: "💎 VIP Supporter", color: "#fd79a8", hoist: true, reason: "Community VIPs & Server Boosters" },
  { name: "👥 Member", color: "#34495e", hoist: false, reason: "Default Verified Member Role", autoAssignOnJoin: true },
];

export async function provisionAllRoles(guild: Guild): Promise<{ createdCount: number; autoRole: Role; supportRole: Role }> {
  let createdCount = 0;
  let autoRole: Role | null = null;
  let supportRole: Role | null = null;

  for (const rDef of RECOMMENDED_ROLES) {
    let existingRole = guild.roles.cache.find(
      (r) => r.name === rDef.name || r.name.toLowerCase().includes(rDef.name.replace(/[^a-zA-Z]/g, "").toLowerCase())
    );

    if (!existingRole) {
      existingRole = await guild.roles.create({
        name: rDef.name,
        color: rDef.color,
        hoist: rDef.hoist,
        reason: rDef.reason,
      });
      createdCount++;
    } else if (existingRole.name !== rDef.name) {
      // Update role name with emoji if legacy name exists
      await existingRole.setName(rDef.name).catch(() => {});
    }

    if (rDef.autoAssignOnJoin || rDef.name.includes("Member")) {
      autoRole = existingRole;
      process.env.AUTO_MEMBER_ROLE_ID = existingRole.id;
    }

    if (rDef.name.includes("Shark Support")) {
      supportRole = existingRole;
      process.env.SUPPORT_ROLE_ID = existingRole.id;
    }
  }

  // Allocate default Member role to all existing guild members
  if (autoRole) {
    const members = await guild.members.fetch();
    for (const member of members.values()) {
      if (!member.user.bot && !member.roles.cache.has(autoRole.id)) {
        await member.roles.add(autoRole).catch(() => {});
      }
    }
  }

  return {
    createdCount,
    autoRole: autoRole!,
    supportRole: supportRole!,
  };
}

export async function handleSetupServerCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: "❌ This command must be run inside a Discord server.", flags: 64 });
    return;
  }

  await interaction.deferReply({ flags: 64 });

  try {
    // 1. Provision All Server Roles
    const { createdCount, autoRole, supportRole } = await provisionAllRoles(guild);

    // 2. Provision Category: SHARK BYTE PANELS (Public)
    let panelsCategory = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildCategory && c.name.toUpperCase() === "SHARK BYTE PANELS"
    );

    if (!panelsCategory) {
      panelsCategory = await guild.channels.create({
        name: "SHARK BYTE PANELS",
        type: ChannelType.GuildCategory,
      });
    }

    // Provision Channel: #support-panel
    let supportChannel = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildText && c.name === "support-panel" && c.parentId === panelsCategory!.id
    ) as TextChannel | undefined;

    if (!supportChannel) {
      supportChannel = await guild.channels.create({
        name: "support-panel",
        type: ChannelType.GuildText,
        parent: panelsCategory.id,
        topic: "Official Shark Byte Support Center — Click a button to open a support ticket.",
      });
    }

    const ticketPanel = createTicketPanel();
    await supportChannel.send(ticketPanel);

    // Provision Channel: #vps-plans
    let vpsChannel = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildText && c.name === "vps-plans" && c.parentId === panelsCategory!.id
    ) as TextChannel | undefined;

    if (!vpsChannel) {
      vpsChannel = await guild.channels.create({
        name: "vps-plans",
        type: ChannelType.GuildText,
        parent: panelsCategory.id,
        topic: "Shark Byte VPS Plans & Catalog",
      });
    }

    const vpsPanel = await renderVpsPricingPanel(supportChannel.id);
    await vpsChannel.send(vpsPanel);

    // Provision Channel: #minecraft-plans
    let minecraftChannel = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildText && c.name === "minecraft-plans" && c.parentId === panelsCategory!.id
    ) as TextChannel | undefined;

    if (!minecraftChannel) {
      minecraftChannel = await guild.channels.create({
        name: "minecraft-plans",
        type: ChannelType.GuildText,
        parent: panelsCategory.id,
        topic: "Shark Byte Minecraft Server Hosting Catalog",
      });
    }

    const mcPanel = await renderMinecraftPricingPanel();
    await minecraftChannel.send(mcPanel);

    // 3. Provision Ticket Categories: VPS TICKETS, MINECRAFT TICKETS, SUPPORT TICKETS
    for (const catName of ["VPS TICKETS", "MINECRAFT TICKETS", "SUPPORT TICKETS"]) {
      let cat = guild.channels.cache.find(
        (c) => c.type === ChannelType.GuildCategory && c.name.toUpperCase() === catName
      );
      if (!cat) {
        cat = await guild.channels.create({
          name: catName,
          type: ChannelType.GuildCategory,
          permissionOverwrites: [
            {
              id: guild.roles.everyone.id,
              deny: [PermissionFlagsBits.ViewChannel],
            },
            {
              id: supportRole.id,
              allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
            },
          ],
        });
      }
      if (catName === "SUPPORT TICKETS") {
        process.env.TICKET_CATEGORY_ID = cat.id;
      }
    }

    // 4. Provision Category: SHARK LOGS & STAFF
    let logsCategory = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildCategory && c.name.toUpperCase() === "SHARK LOGS & STAFF"
    );

    if (!logsCategory) {
      logsCategory = await guild.channels.create({
        name: "SHARK LOGS & STAFF",
        type: ChannelType.GuildCategory,
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            deny: [PermissionFlagsBits.ViewChannel],
          },
          {
            id: supportRole.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
          },
        ],
      });
    }

    let modLogsChannel = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildText && c.name === "moderation-logs" && c.parentId === logsCategory!.id
    ) as TextChannel | undefined;

    if (!modLogsChannel) {
      modLogsChannel = await guild.channels.create({
        name: "moderation-logs",
        type: ChannelType.GuildText,
        parent: logsCategory.id,
        topic: "Auto-Moderation Security Alerts & Incident History",
      });
    }

    process.env.MODERATION_LOG_CHANNEL_ID = modLogsChannel.id;

    let ticketLogsChannel = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildText && c.name === "ticket-logs" && c.parentId === logsCategory!.id
    ) as TextChannel | undefined;

    if (!ticketLogsChannel) {
      ticketLogsChannel = await guild.channels.create({
        name: "ticket-logs",
        type: ChannelType.GuildText,
        parent: logsCategory.id,
        topic: "Ticket Activity & Audit Trail",
      });
    }

    let botLogsChannel = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildText && c.name === "bot-logs" && c.parentId === logsCategory!.id
    ) as TextChannel | undefined;

    if (!botLogsChannel) {
      botLogsChannel = await guild.channels.create({
        name: "bot-logs",
        type: ChannelType.GuildText,
        parent: logsCategory.id,
        topic: "Real-time Bot System Exceptions, API Failures & Diagnostic Error Tracker",
      });
    }

    process.env.BOT_LOG_CHANNEL_ID = botLogsChannel.id;

    const summaryEmbed = new EmbedBuilder()
      .setTitle("✅ Shark Byte Complete Server & Emoji Role Provisioning Successful")
      .setDescription(
        "All emoji server roles, categories, channels, and panels have been provisioned and allocated!\n\n" +
          `👑 **Roles Provisioned:** ${RECOMMENDED_ROLES.map((r) => `\`${r.name}\``).join(", ")}\n` +
          `👥 **Auto-Allocated Join Role:** ${autoRole}\n` +
          `🦈 **Support Staff Role:** ${supportRole}\n\n` +
          `🔹 **Support Panel:** ${supportChannel}\n` +
          `🔹 **VPS Plans:** ${vpsChannel}\n` +
          `🔹 **Minecraft Plans:** ${minecraftChannel}\n` +
          `🔹 **Moderation Logs:** ${modLogsChannel}\n` +
          `🔹 **Bot Error Logs:** ${botLogsChannel}\n\n` +
          "Your server structure, emoji roles, and automated allocation are 100% active!"
      )
      .setColor(0x2ecc71)
      .setTimestamp();

    await interaction.editReply({ embeds: [summaryEmbed] });
  } catch (err: any) {
    console.error("❌ Error running /setup-server command:", err);
    await interaction.editReply({
      content: `❌ Could not complete server setup: ${err.message || "Unknown error"}`,
    });
  }
}
