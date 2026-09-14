import { EmbedBuilder, Message, TextChannel } from "discord.js";
import { detectMessageContent } from "../moderation/moderationRules";
import { isModerationWhitelisted, recordModerationEvent } from "./moderationDatabase";

export async function handleMessageCreate(message: Message): Promise<void> {
  if (message.author.bot || !message.guild) return;

  const whitelisted = await isModerationWhitelisted(message.guild.id, message.author.id);
  if (whitelisted) return;

  const detection = detectMessageContent(message.content);
  if (!detection) return;

  try {
    if (message.deletable) {
      await message.delete().catch(() => {});
    }

    const state = await recordModerationEvent({
      guildId: message.guild.id,
      userId: message.author.id,
      channelId: message.channel.id,
      messageId: message.id,
      detection,
      messageSnapshot: message.content,
      action: "delete_and_warn",
      warningIssued: true,
    });

    if ("send" in message.channel) {
      const warnMsg = await message.channel.send({
        content: `⚠️ ${message.author}, your message was automatically removed for violating server rules (${detection.reason}). Total warnings: **${state.warningCount}**.`,
      });

      setTimeout(() => {
        warnMsg.delete().catch(() => {});
      }, 10000);
    }

    const logChannelId = process.env.MODERATION_LOG_CHANNEL_ID;
    if (logChannelId) {
      const logChannel = message.guild.channels.cache.get(logChannelId) as TextChannel;
      if (logChannel) {
        const embed = new EmbedBuilder()
          .setTitle("🛡️ Auto-Moderation Alert")
          .setColor(0xe74c3c)
          .addFields(
            { name: "User", value: `${message.author} (\`${message.author.id}\`)`, inline: true },
            { name: "Channel", value: `${message.channel}`, inline: true },
            { name: "Rule Violation", value: `\`${detection.rule}\` - ${detection.reason}`, inline: false },
            { name: "Content", value: `\`\`\`${message.content.slice(0, 900)}\`\`\``, inline: false },
            { name: "Total Warnings", value: `${state.warningCount}`, inline: true }
          )
          .setTimestamp();

        await logChannel.send({ embeds: [embed] }).catch(() => {});
      }
    }
  } catch (err) {
    console.error("❌ Failed to process auto-moderation:", err);
  }
}
