import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from "discord.js";

export const helpCommand = new SlashCommandBuilder()
  .setName("help")
  .setDescription("Shark Byte System Command Guide & Reference Manual")
  .addStringOption((opt) =>
    opt
      .setName("category")
      .setDescription("Filter help guide by module category")
      .setRequired(false)
      .addChoices(
        { name: "VPS Hosting", value: "vps" },
        { name: "Minecraft Hosting", value: "minecraft" },
        { name: "Support Tickets", value: "ticket" },
        { name: "Administration & Provisioning", value: "admin" }
      )
  );

export async function handleHelpCommand(
  interaction: ChatInputCommandInteraction,
  isStaff: boolean,
  isAdministrator: boolean
): Promise<void> {
  const categoryChoice = interaction.options.getString("category");
  await interaction.deferReply({ flags: 64 });

  const embed = new EmbedBuilder()
    .setTitle("🦈 Shark Byte Command Reference & Manual")
    .setColor(0x00a8ff)
    .setTimestamp()
    .setFooter({ text: "Shark Byte • High Performance Hosting Platform" });

  if (!categoryChoice || categoryChoice === "vps") {
    embed.addFields({
      name: "🖥️ VPS Management (`/vps`)",
      value:
        "• `/vps plans` — View live VPS catalog, specs, INR/USD pricing, and location ordering dropdown.\n" +
        "• `/vps list` — View your active provisioned VPS instances, SSH gateway access ports & expiry.\n" +
        "• `/vps status` — Check Incus/LXC host capacity & public SSH gateway health *(Staff Only)*.\n" +
        "• `/vps delete <vps_number>` — Decommission a provisioned VPS instance *(Staff Only)*.",
    });
  }

  if (!categoryChoice || categoryChoice === "minecraft") {
    embed.addFields({
      name: "🎮 Minecraft Server Hosting (`/minecraft`)",
      value:
        "• `/minecraft plans` — View live Pterodactyl Minecraft server hosting catalog & ordering dropdown.\n" +
        "• `/minecraft list` — View your active provisioned Minecraft game servers & panel credentials.",
    });
  }

  if (!categoryChoice || categoryChoice === "ticket") {
    embed.addFields({
      name: "🎫 Support & Sales Ticket Suite (`/ticket`)",
      value:
        "• `/ticket open <department>` — Open a support ticket (`sales`, `technical`, `billing`, `vps`, `other`).\n" +
        "• `/ticket close` — Close and archive the active ticket channel.\n" +
        "• `/ticket claim` — Claim a customer support ticket *(Staff Only)*.",
    });
  }

  if (!categoryChoice || categoryChoice === "admin") {
    embed.addFields(
      {
        name: "🛡️ Admin Provisioning & Financial Ledger (`/admin`)",
        value:
          "• `/admin setup` — Provision all categories (`VPS TICKETS`, `MINECRAFT TICKETS`, etc.), channels & panels.\n" +
          "• `/admin setup-roles` — Automatically create and allocate all 9 emoji server roles.\n" +
          "• `/admin ledger summary` — Display Profit & Loss summary, revenue, refunds, expenses & metrics.\n" +
          "• `/admin ledger transactions` — List recent financial transactions.\n" +
          "• `/admin ledger refund` — Record a customer refund in the financial ledger.\n" +
          "• `/admin ledger expense` — Record an operational/infrastructure expense.",
      },
      {
        name: "⚙️ Admin Catalog, Channels & Moderation (`/admin`)",
        value:
          "• `/admin plan list|add|edit|toggle|archive` — Manage VPS & Minecraft pricing catalog.\n" +
          "• `/admin location list|add|edit|toggle|archive` — Manage server hosting nodes (`India 🇮🇳`, etc.).\n" +
          "• `/admin create-category`, `/admin create-channel`, `/admin create-role`, `/admin set-auto-role`.\n" +
          "• `/admin mod` — View auto-moderation security rules & incident log status.\n" +
          "• `/admin invites` — View referral leaderboards & invite statistics.",
      }
    );
  }

  embed.setDescription(
    "Welcome to **Shark Byte**! Below is the complete interactive command guide.\n" +
      "Select plans or locations using live dropdowns or slash commands to order hosting instantly!"
  );

  await interaction.editReply({ embeds: [embed] });
}
