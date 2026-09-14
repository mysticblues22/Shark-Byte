import "dotenv/config";
import { Client, GatewayIntentBits, REST, Routes } from "discord.js";
import { env, getRequiredEnv } from "./config/env";
import { testDatabaseConnection } from "./config/database";
import { runDatabaseMigrations } from "./config/migrator";

import { ticketCommand } from "./commands/ticket";
import { vpsCommand } from "./commands/vps";
import { minecraftCommand } from "./commands/minecraft";
import { adminCommand } from "./commands/admin";
import { helpCommand } from "./commands/help";
import { handleInteraction } from "./events/interactionCreate";
import { handleMessageCreate } from "./services/moderationService";
import { handleGuildMemberAdd } from "./services/welcomeService";
import { logBotError } from "./services/loggerService";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildInvites,
  ],
});

async function registerCommands(token: string, clientId: string, guildId: string): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(token);
  const commands: any[] = [
    vpsCommand.toJSON(),
    minecraftCommand.toJSON(),
    ticketCommand.toJSON(),
    adminCommand.toJSON(),
    helpCommand.toJSON(),
  ];

  await rest.put(
    Routes.applicationGuildCommands(clientId, guildId),
    { body: commands }
  );

  console.log("✅ [Shark Byte] Slash commands registered successfully.");
}

client.once("ready", async (readyClient) => {
  console.log(`🦈 [Shark Byte] Logged in as ${readyClient.user.tag}`);
  console.log(`Connected to ${readyClient.guilds.cache.size} server(s).`);

  if (process.env.DATABASE_URL) {
    const connected = await testDatabaseConnection();
    if (connected) {
      try {
        await runDatabaseMigrations();
      } catch (migrationError) {
        console.error("❌ Failed database migration:", migrationError);
      }
    }
  } else {
    console.warn("⚠️ DATABASE_URL not set. Database features will be disabled until configured.");
  }

  if (env.DISCORD_TOKEN && env.CLIENT_ID && env.GUILD_ID) {
    try {
      await registerCommands(env.DISCORD_TOKEN, env.CLIENT_ID, env.GUILD_ID);
    } catch (err) {
      console.error("❌ Failed to register slash commands:", err);
    }
  }
});

client.on("guildMemberAdd", async (member) => {
  await handleGuildMemberAdd(member);
});

client.on("messageCreate", async (message) => {
  await handleMessageCreate(message);
});

client.on("interactionCreate", async (interaction) => {
  await handleInteraction(interaction);
});

client.on("error", (error) => {
  console.error("❌ Discord client error:", error);
  logBotError({ client, error, context: "Discord Client Event", severity: "ERROR" }).catch(() => {});
});

process.on("uncaughtException", (error) => {
  console.error("🚨 Uncaught Exception:", error);
  logBotError({ client, error, context: "Uncaught Exception Process Handler", severity: "FATAL" }).catch(() => {});
});

process.on("unhandledRejection", (reason) => {
  console.error("🚨 Unhandled Promise Rejection:", reason);
  logBotError({ client, error: reason, context: "Unhandled Rejection Process Handler", severity: "ERROR" }).catch(() => {});
});

if (process.env.DISCORD_TOKEN) {
  client.login(process.env.DISCORD_TOKEN);
} else {
  console.warn("⚠️ DISCORD_TOKEN is missing in .env. Bot startup skipped.");
}
