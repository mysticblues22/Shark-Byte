import {
  ChannelType,
  Client,
  EmbedBuilder,
  Guild,
  PermissionFlagsBits,
  TextChannel,
} from "discord.js";

export interface LogBotErrorOptions {
  client?: Client;
  guild?: Guild;
  error: any;
  title?: string;
  context?: string;
  userTag?: string;
  userId?: string;
  channelId?: string;
  severity?: "ERROR" | "WARN" | "FATAL";
}

let cachedBotLogChannelId: string | null = process.env.BOT_LOG_CHANNEL_ID || null;

export async function getOrCreateBotLogChannel(guild: Guild): Promise<TextChannel | null> {
  try {
    await guild.channels.fetch();

    if (cachedBotLogChannelId) {
      const ch = guild.channels.cache.get(cachedBotLogChannelId) as TextChannel;
      if (ch) return ch;
    }

    let logChannel = guild.channels.cache.find(
      (c): c is TextChannel =>
        c.type === ChannelType.GuildText && (c.name === "bot-logs" || c.name === "system-logs" || c.name.includes("bot-log"))
    );

    if (logChannel) {
      cachedBotLogChannelId = logChannel.id;
      process.env.BOT_LOG_CHANNEL_ID = logChannel.id;
      return logChannel;
    }

    // Look for category SHARK LOGS & STAFF or create one
    let logsCategory = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildCategory && c.name.toUpperCase() === "SHARK LOGS & STAFF"
    );

    if (!logsCategory) {
      const supportRoleId = process.env.SUPPORT_ROLE_ID;
      const overwrites: any[] = [{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }];
      if (supportRoleId) {
        overwrites.push({
          id: supportRoleId,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
        });
      }
      logsCategory = await guild.channels.create({
        name: "SHARK LOGS & STAFF",
        type: ChannelType.GuildCategory,
        permissionOverwrites: overwrites,
      });
    }

    logChannel = await guild.channels.create({
      name: "bot-logs",
      type: ChannelType.GuildText,
      parent: logsCategory.id,
      topic: "Real-time Bot System Exceptions, API Failures & Diagnostic Error Tracker",
    });

    cachedBotLogChannelId = logChannel.id;
    process.env.BOT_LOG_CHANNEL_ID = logChannel.id;
    return logChannel;
  } catch (err) {
    console.error("❌ Failed to get or create #bot-logs channel:", err);
    return null;
  }
}

export async function logBotError(options: LogBotErrorOptions): Promise<void> {
  const { client, guild, error, title, context, userTag, userId, channelId, severity = "ERROR" } = options;

  const errMsg = error instanceof Error ? error.message : String(error || "Unknown Error");
  const stack = error instanceof Error && error.stack ? error.stack : undefined;

  console.error(`❌ [Shark Byte Bot Error] [${severity}] ${context ? `(${context})` : ""}:`, error);

  let targetGuild = guild;
  if (!targetGuild && client) {
    targetGuild = client.guilds.cache.first();
  }

  if (!targetGuild) return;

  const channel = await getOrCreateBotLogChannel(targetGuild);
  if (!channel) return;

  const emoji = severity === "FATAL" ? "🚨" : severity === "WARN" ? "⚠️" : "🔴";
  const color = severity === "FATAL" ? 0x990000 : severity === "WARN" ? 0xf39c12 : 0xe74c3c;

  const embed = new EmbedBuilder()
    .setTitle(`${emoji} Bot Error Log • ${title || context || "System Exception"}`)
    .setColor(color)
    .setTimestamp()
    .setFooter({ text: "Shark Byte Automated Diagnostic Log System" });

  if (context) {
    embed.addFields({ name: "Context / Feature", value: `\`${context}\``, inline: true });
  }

  if (userTag || userId) {
    embed.addFields({
      name: "User",
      value: userId ? `<@${userId}> (\`${userTag || userId}\`)` : `\`${userTag}\``,
      inline: true,
    });
  }

  if (channelId) {
    embed.addFields({ name: "Channel", value: `<#${channelId}>`, inline: true });
  }

  embed.addFields({
    name: "Error Message",
    value: `\`\`\`\n${errMsg.slice(0, 1000)}\n\`\`\``,
    inline: false,
  });

  if (stack) {
    const cleanStack = stack.replace(errMsg, "").trim();
    embed.addFields({
      name: "Stack Trace",
      value: `\`\`\`ts\n${cleanStack.slice(0, 1000)}\n\`\`\``,
      inline: false,
    });
  }

  await channel.send({ embeds: [embed] }).catch((e) => {
    console.error("❌ Failed to send error embed to #bot-logs:", e);
  });
}
