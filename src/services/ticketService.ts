import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  Guild,
  GuildMember,
  PermissionFlagsBits,
  TextChannel,
} from "discord.js";

import {
  createDatabaseTicket,
  deleteDatabaseTicket,
  getOrCreateCustomer,
  recordTicketEvent,
  setTicketChannel,
} from "./ticketDatabase";

export interface TicketVPSDetails {
  location: string;
  hostingNodeId?: string;
  planId: string;
  planName: string;
  priceInr: number;
  priceUsd: number;
  ramGb: number;
  storageGb: number;
  vcpu: number;
  fullRootAccess: boolean;
  instantDeployment: boolean;
  discordSupport: boolean;
  networkAllocation: string;
  cpuModels: string[];
}

export interface TicketMinecraftDetails {
  planId: string;
  planName: string;
  billingMonths?: number;
  monthlyPriceInr?: number;
  monthlyPriceUsd?: number;
  priceInr: number;
  priceUsd: number;
  ramGb: number;
  cpuPercent: number;
  storageGb: number;
}

async function getOrCreateTicketCategory(guild: Guild, name: string): Promise<string> {
  await guild.channels.fetch();
  let category = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildCategory && c.name.toUpperCase() === name.toUpperCase()
  );

  if (!category) {
    const supportRoleId = process.env.SUPPORT_ROLE_ID;
    const overwrites: any[] = [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel],
      },
    ];
    if (supportRoleId) {
      overwrites.push({
        id: supportRoleId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
      });
    }

    category = await guild.channels.create({
      name,
      type: ChannelType.GuildCategory,
      permissionOverwrites: overwrites,
    });
  }

  return category.id;
}

export async function createTicket(
  guild: Guild,
  member: GuildMember,
  department: string,
  vpsDetails?: TicketVPSDetails,
  minecraftDetails?: TicketMinecraftDetails
): Promise<TextChannel> {
  const supportRoleId = process.env.SUPPORT_ROLE_ID;

  let targetCategoryName = "SUPPORT TICKETS";
  if (vpsDetails || department.toLowerCase().includes("vps")) {
    targetCategoryName = "VPS TICKETS";
  } else if (minecraftDetails || department.toLowerCase().includes("minecraft")) {
    targetCategoryName = "MINECRAFT TICKETS";
  }

  const ticketCategoryId = await getOrCreateTicketCategory(guild, targetCategoryName);

  // ----------------------------------------------------------
  // Check existing ticket in target category
  // ----------------------------------------------------------
  const existingTicket = guild.channels.cache.find(
    (channel): channel is TextChannel =>
      channel.type === ChannelType.GuildText &&
      channel.parentId === ticketCategoryId &&
      Boolean(channel.topic?.includes(`ticket-owner:${member.id}`))
  );

  if (existingTicket && existingTicket.type === ChannelType.GuildText) {
    return existingTicket;
  }

  // ----------------------------------------------------------
  // Get or Create Customer Record
  // ----------------------------------------------------------
  const customer = await getOrCreateCustomer(
    member.user.id,
    member.user.username,
    member.displayName
  );

  // ----------------------------------------------------------
  // Database Ticket Entry
  // ----------------------------------------------------------
  const ticket = await createDatabaseTicket(
    customer.id,
    guild.id,
    department.toLowerCase().replace(" support", "")
  );

  try {
    const ticketNumber = ticket.ticketNumber.toString().padStart(6, "0");
    const safeUsername = member.user.username
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .slice(0, 20);

    // Permission Overwrites setup
    const overwrites: any[] = [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel],
      },
      {
        id: member.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks,
        ],
      },
      {
        id: guild.members.me!.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.ManageMessages,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks,
        ],
      },
    ];

    if (supportRoleId) {
      overwrites.push({
        id: supportRoleId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks,
          PermissionFlagsBits.ManageMessages,
        ],
      });
    }

    const channel = await guild.channels.create({
      name: `ticket-${ticketNumber}-${safeUsername}`,
      type: ChannelType.GuildText,
      parent: ticketCategoryId,
      topic: `ticket-id:${ticket.id} ticket-number:${ticketNumber} ticket-owner:${member.id}`,
      permissionOverwrites: overwrites,
    });

    await setTicketChannel(ticket.id, channel.id);

    await recordTicketEvent(ticket.id, "created", member.user.id, {
      department,
      channelId: channel.id,
      ...(vpsDetails ? vpsDetails : {}),
      ...(minecraftDetails ? { ...minecraftDetails, serviceType: "minecraft" } : {}),
    });

    const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("ticket:claim")
        .setLabel("Claim Ticket")
        .setEmoji("👤")
        .setStyle(ButtonStyle.Primary),

      ...(vpsDetails
        ? [
            new ButtonBuilder()
              .setCustomId("vps:provision")
              .setLabel("Provision VPS")
              .setEmoji("🖥️")
              .setStyle(ButtonStyle.Success),
          ]
        : []),

      ...(minecraftDetails
        ? [
            new ButtonBuilder()
              .setCustomId("minecraft:provision")
              .setLabel("Provision Minecraft Server")
              .setEmoji("🎮")
              .setStyle(ButtonStyle.Success),
          ]
        : []),

      new ButtonBuilder()
        .setCustomId("ticket:close")
        .setLabel("Close Ticket")
        .setEmoji("🔒")
        .setStyle(ButtonStyle.Danger)
    );

    const paymentControls = (vpsDetails || minecraftDetails)
      ? new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`payment:gateway:razorpay:${ticket.id}`)
            .setLabel("Razorpay (Instant Auto-Pay 💳)")
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`payment:gateway:paypal:${ticket.id}`)
            .setLabel("PayPal (Manual 🅿️)")
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`payment:gateway:crypto:${ticket.id}`)
            .setLabel("Crypto (Manual 🪙)")
            .setStyle(ButtonStyle.Primary)
        )
      : null;

    let description =
      `Welcome ${member}!\n\n` +
      `**Department:** ${department}\n` +
      `**Ticket:** #${ticketNumber}\n` +
      `**Status:** 🟢 Open\n\n` +
      "A member of our support team will assist you shortly.\n\n" +
      "Please detail your request or inquiry below.";

    if (vpsDetails) {
      const locationEmoji =
        vpsDetails.location === "India"
          ? "🇮🇳"
          : vpsDetails.location === "Singapore"
          ? "🇸🇬"
          : "🇯🇵";

      description =
        `Welcome ${member}!\n\n` +
        `**Department:** ${department}\n` +
        `**Ticket:** #${ticketNumber}\n` +
        `**Status:** 🟢 Open\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🦈 **SHARK BYTE VPS CONFIGURATION**\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `${locationEmoji} **Location:** ${vpsDetails.location}\n` +
        `📦 **Plan:** ${vpsDetails.planName}\n` +
        `💰 **Price:** ₹${vpsDetails.priceInr} / $${vpsDetails.priceUsd} per month\n\n` +
        `🧠 **RAM:** ${vpsDetails.ramGb} GB\n` +
        `💾 **Disk:** ${vpsDetails.storageGb} GB\n` +
        `⚡ **vCore:** ${vpsDetails.vcpu}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `✨ **Included Features**\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `${vpsDetails.fullRootAccess ? "✅" : "❌"} Full Root Access\n` +
        `${vpsDetails.instantDeployment ? "✅" : "❌"} Instant Deployment\n` +
        `${vpsDetails.discordSupport ? "✅" : "❌"} Discord Support\n` +
        `🌐 **Network:** ${vpsDetails.networkAllocation}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `⚙️ **CPU Platform**\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        vpsDetails.cpuModels.map((cpu) => `• ${cpu}`).join("\n") +
        `\n\n━━━━━━━━━━━━━━━━━━━━\n\n` +
        "💳 **Payment Gateway:** Please select your payment method below to complete setup.";
    }

    if (minecraftDetails) {
      const duration = minecraftDetails.billingMonths || 1;
      const monthlyInr = minecraftDetails.monthlyPriceInr || Math.round(minecraftDetails.priceInr / duration);
      const monthlyUsd = minecraftDetails.monthlyPriceUsd || Math.round(minecraftDetails.priceUsd / duration);

      description =
        `Welcome ${member}!\n\n` +
        `**Department:** ${department}\n` +
        `**Ticket:** #${ticketNumber}\n` +
        `**Status:** 🟢 Open\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🎮 **MINECRAFT SERVER CONFIGURATION**\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📦 **Plan:** ${minecraftDetails.planName}\n` +
        `🗓️ **Duration:** ${duration} month${duration === 1 ? "" : "s"}\n` +
        `💳 **Monthly Price:** ₹${monthlyInr} / $${monthlyUsd}\n` +
        `💰 **Total Price:** ₹${minecraftDetails.priceInr} / $${minecraftDetails.priceUsd}\n\n` +
        `🧠 **RAM:** ${minecraftDetails.ramGb} GB\n` +
        `⚡ **CPU:** ${minecraftDetails.cpuPercent}%\n` +
        `💾 **Disk:** ${minecraftDetails.storageGb} GB\n` +
        `🌐 **Hostname:** minecraft.sharkbyte.com\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        "💳 **Payment Gateway:** Please select your payment method below to complete setup.";
    }

    const embed = new EmbedBuilder()
      .setTitle(`🦈 Shark Byte Support • #${ticketNumber}`)
      .setDescription(description)
      .setColor(0x00a8ff)
      .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
      .setFooter({ text: "Shark Byte • High Performance Hosting" })
      .setTimestamp();

    const pingRoles = supportRoleId ? `${member} <@&${supportRoleId}>` : `${member}`;

    const components = [controls];
    if (paymentControls) {
      components.push(paymentControls);
    }

    await channel.send({
      content: pingRoles,
      embeds: [embed],
      components,
    });

    return channel;
  } catch (error) {
    try {
      await deleteDatabaseTicket(ticket.id);
    } catch (rollbackError) {
      console.error("❌ Failed to rollback database ticket:", rollbackError);
    }
    throw error;
  }
}
