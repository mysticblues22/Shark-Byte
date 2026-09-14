import {
  ChannelType,
  ChatInputCommandInteraction,
  ColorResolvable,
  EmbedBuilder,
  Guild,
  PermissionFlagsBits,
  Role,
  SlashCommandBuilder,
  TextChannel,
  VoiceChannel,
} from "discord.js";

import { handleSetupServerCommand, provisionAllRoles, RECOMMENDED_ROLES } from "./setupServer";
import {
  createCatalogPlan,
  updateCatalogPlan,
  togglePlanActive,
  archivePlan,
  getPricingPlans,
  createHostingNode,
  updateHostingNode,
  toggleHostingNodeActive,
  archiveHostingNode,
  getHostingNodes,
} from "../services/pricingService";

import {
  getFinancialSummary,
  listRecentTransactions,
  recordRefund,
  recordExpense,
} from "../services/ledgerService";

export const adminCommand = new SlashCommandBuilder()
  .setName("admin")
  .setDescription("Shark Byte Administration & Provisioning Command Suite")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((sub) =>
    sub.setName("setup").setDescription("Run automated server channel, category, role & panel provisioner")
  )
  .addSubcommand((sub) =>
    sub.setName("setup-roles").setDescription("Automatically create and allocate all recommended community & hosting roles")
  )
  .addSubcommandGroup((group) =>
    group
      .setName("plan")
      .setDescription("Manage VPS & Minecraft hosting pricing catalog plans")
      .addSubcommand((sub) =>
        sub
          .setName("list")
          .setDescription("List catalog plans")
          .addStringOption((opt) =>
            opt
              .setName("category")
              .setDescription("Filter by category")
              .setRequired(false)
              .addChoices(
                { name: "VPS Hosting", value: "vps" },
                { name: "Minecraft Hosting", value: "minecraft" }
              )
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName("add")
          .setDescription("Add a new pricing plan to catalog")
          .addStringOption((opt) =>
            opt
              .setName("category")
              .setDescription("Plan category")
              .setRequired(true)
              .addChoices(
                { name: "VPS Hosting", value: "vps" },
                { name: "Minecraft Hosting", value: "minecraft" }
              )
          )
          .addStringOption((opt) => opt.setName("name").setDescription("Plan Name (e.g. ULTRA)").setRequired(true))
          .addIntegerOption((opt) => opt.setName("ram_gb").setDescription("RAM in GB").setRequired(true))
          .addIntegerOption((opt) => opt.setName("vcpu").setDescription("vCPU Cores / CPU allocation").setRequired(true))
          .addIntegerOption((opt) => opt.setName("storage_gb").setDescription("Storage NVMe in GB").setRequired(true))
          .addNumberOption((opt) => opt.setName("price_inr").setDescription("Price in INR per month").setRequired(true))
          .addNumberOption((opt) => opt.setName("price_usd").setDescription("Price in USD per month").setRequired(true))
          .addStringOption((opt) => opt.setName("description").setDescription("Plan description / highlights").setRequired(false))
      )
      .addSubcommand((sub) =>
        sub
          .setName("edit")
          .setDescription("Edit an existing pricing plan")
          .addStringOption((opt) => opt.setName("plan").setDescription("Plan Name or UUID to edit").setRequired(true).setAutocomplete(true))
          .addStringOption((opt) => opt.setName("name").setDescription("New Plan Name").setRequired(false))
          .addIntegerOption((opt) => opt.setName("ram_gb").setDescription("New RAM in GB").setRequired(false))
          .addIntegerOption((opt) => opt.setName("vcpu").setDescription("New vCPU Cores").setRequired(false))
          .addIntegerOption((opt) => opt.setName("storage_gb").setDescription("New Storage in GB").setRequired(false))
          .addNumberOption((opt) => opt.setName("price_inr").setDescription("New Price in INR").setRequired(false))
          .addNumberOption((opt) => opt.setName("price_usd").setDescription("New Price in USD").setRequired(false))
          .addStringOption((opt) => opt.setName("description").setDescription("New Description").setRequired(false))
      )
      .addSubcommand((sub) =>
        sub
          .setName("toggle")
          .setDescription("Enable or disable live visibility of a plan")
          .addStringOption((opt) => opt.setName("plan").setDescription("Plan Name or UUID to toggle").setRequired(true).setAutocomplete(true))
      )
      .addSubcommand((sub) =>
        sub
          .setName("archive")
          .setDescription("Archive a pricing plan")
          .addStringOption((opt) => opt.setName("plan").setDescription("Plan Name or UUID to archive").setRequired(true).setAutocomplete(true))
      )
  )
  .addSubcommandGroup((group) =>
    group
      .setName("location")
      .setDescription("Manage server hosting locations and nodes catalog")
      .addSubcommand((sub) =>
        sub
          .setName("list")
          .setDescription("List hosting locations")
          .addStringOption((opt) =>
            opt
              .setName("category")
              .setDescription("Filter by category")
              .setRequired(false)
              .addChoices(
                { name: "VPS Hosting", value: "vps" },
                { name: "Minecraft Hosting", value: "minecraft" },
                { name: "Both / All", value: "both" }
              )
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName("add")
          .setDescription("Add a new hosting location node")
          .addStringOption((opt) => opt.setName("display_name").setDescription("Display Name (e.g. Japan 🇯🇵)").setRequired(true))
          .addStringOption((opt) => opt.setName("location_name").setDescription("Location Name (e.g. Japan)").setRequired(true))
          .addStringOption((opt) => opt.setName("country_flag").setDescription("Emoji Flag (e.g. 🇯🇵)").setRequired(false))
          .addStringOption((opt) => opt.setName("hostname").setDescription("SSH Gateway Hostname").setRequired(false))
          .addStringOption((opt) =>
            opt
              .setName("category")
              .setDescription("Category support")
              .setRequired(false)
              .addChoices(
                { name: "Both (VPS & MC)", value: "both" },
                { name: "VPS Only", value: "vps" },
                { name: "Minecraft Only", value: "minecraft" }
              )
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName("edit")
          .setDescription("Edit a hosting location")
          .addStringOption((opt) => opt.setName("location").setDescription("Location ID or Display Name to edit").setRequired(true).setAutocomplete(true))
          .addStringOption((opt) => opt.setName("display_name").setDescription("New Display Name").setRequired(false))
          .addStringOption((opt) => opt.setName("location_name").setDescription("New Location Name").setRequired(false))
          .addStringOption((opt) => opt.setName("country_flag").setDescription("New Emoji Flag").setRequired(false))
          .addStringOption((opt) => opt.setName("hostname").setDescription("New Hostname").setRequired(false))
      )
      .addSubcommand((sub) =>
        sub
          .setName("toggle")
          .setDescription("Enable or disable live visibility of a location")
          .addStringOption((opt) => opt.setName("location").setDescription("Location ID or Display Name to toggle").setRequired(true).setAutocomplete(true))
      )
      .addSubcommand((sub) =>
        sub
          .setName("archive")
          .setDescription("Archive a location node")
          .addStringOption((opt) => opt.setName("location").setDescription("Location ID or Display Name to archive").setRequired(true).setAutocomplete(true))
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("create-category")
      .setDescription("Create a new custom category with access controls")
      .addStringOption((opt) =>
        opt.setName("name").setDescription("Category name").setRequired(true)
      )
      .addStringOption((opt) =>
        opt
          .setName("visibility")
          .setDescription("Who can access this category")
          .setRequired(true)
          .addChoices(
            { name: "Public (Everyone)", value: "public" },
            { name: "Staff Only", value: "staff" },
            { name: "Admin Only", value: "admin" }
          )
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("create-channel")
      .setDescription("Create a new text or voice channel with custom visibility & permissions")
      .addStringOption((opt) =>
        opt.setName("name").setDescription("Channel name").setRequired(true)
      )
      .addStringOption((opt) =>
        opt
          .setName("type")
          .setDescription("Channel type")
          .setRequired(true)
          .addChoices(
            { name: "Text Channel", value: "text" },
            { name: "Voice Channel", value: "voice" }
          )
      )
      .addChannelOption((opt) =>
        opt
          .setName("category")
          .setDescription("Parent category under which to place the channel")
          .addChannelTypes(ChannelType.GuildCategory)
          .setRequired(false)
      )
      .addStringOption((opt) =>
        opt
          .setName("visibility")
          .setDescription("Access permissions")
          .setRequired(false)
          .addChoices(
            { name: "Public (Everyone)", value: "public" },
            { name: "Staff Only", value: "staff" },
            { name: "Admin Only", value: "admin" },
            { name: "Role Restricted", value: "role" }
          )
      )
      .addRoleOption((opt) =>
        opt.setName("allowed_role").setDescription("Specific role allowed if Role Restricted is selected").setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("create-role")
      .setDescription("Create a custom server role")
      .addStringOption((opt) =>
        opt.setName("name").setDescription("Role name").setRequired(true)
      )
      .addStringOption((opt) =>
        opt.setName("color").setDescription("Hex color (e.g. #00a8ff, red, green, blue)").setRequired(false)
      )
      .addBooleanOption((opt) =>
        opt.setName("hoist").setDescription("Display role members separately in user list sidebar").setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("set-auto-role")
      .setDescription("Set the role automatically granted to new members upon joining")
      .addRoleOption((opt) =>
        opt.setName("role").setDescription("The role to auto-assign on join").setRequired(true)
      )
  )
  .addSubcommandGroup((group) =>
    group
      .setName("ledger")
      .setDescription("Financial accounting, revenue, expenses, and Profit/Loss analytics")
      .addSubcommand((sub) =>
        sub.setName("summary").setDescription("Display Profit & Loss summary, revenue, refunds, expenses, and gateway metrics")
      )
      .addSubcommand((sub) =>
        sub
          .setName("transactions")
          .setDescription("List recent financial transactions")
          .addIntegerOption((opt) =>
            opt.setName("limit").setDescription("Number of transactions to show (default: 10)").setRequired(false)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName("refund")
          .setDescription("Record a refund transaction")
          .addStringOption((opt) =>
            opt.setName("transaction").setDescription("Transaction Number or UUID to refund").setRequired(true)
          )
          .addNumberOption((opt) =>
            opt.setName("amount_inr").setDescription("Refund amount in INR").setRequired(true)
          )
          .addNumberOption((opt) =>
            opt.setName("amount_usd").setDescription("Refund amount in USD").setRequired(true)
          )
          .addStringOption((opt) =>
            opt.setName("notes").setDescription("Reason for refund").setRequired(false)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName("expense")
          .setDescription("Record an infrastructure or operational expense")
          .addNumberOption((opt) =>
            opt.setName("amount_inr").setDescription("Expense amount in INR").setRequired(true)
          )
          .addNumberOption((opt) =>
            opt.setName("amount_usd").setDescription("Expense amount in USD").setRequired(true)
          )
          .addStringOption((opt) =>
            opt.setName("description").setDescription("Description / Notes (e.g. Hetzner Host Server Node #1)").setRequired(true)
          )
      )
  )
  .addSubcommand((sub) =>
    sub.setName("mod").setDescription("View auto-moderation status and security metrics")
  )
  .addSubcommand((sub) =>
    sub.setName("invites").setDescription("View referral leaderboards and invite stats")
  );

export async function handleAdminCommand(
  interaction: ChatInputCommandInteraction,
  isAdministrator: boolean,
  isStaff: boolean
): Promise<void> {
  const subGroup = interaction.options.getSubcommandGroup(false);
  const subcommand = interaction.options.getSubcommand();
  const guild = interaction.guild;

  if (!guild) {
    await interaction.reply({ content: "❌ This command can only be used inside a Discord server.", flags: 64 });
    return;
  }

  // Plan Subcommand Group (/admin plan list|add|edit|toggle|archive)
  if (subGroup === "plan") {
    if (!isAdministrator) {
      await interaction.reply({ content: "❌ Only Administrators can manage pricing catalog plans.", flags: 64 });
      return;
    }

    if (subcommand === "list") {
      await interaction.deferReply({ flags: 64 });
      const cat = interaction.options.getString("category") as "vps" | "minecraft" | null;
      const plans = await getPricingPlans(cat || undefined, true);

      if (plans.length === 0) {
        await interaction.editReply({ content: "ℹ️ No plans found in catalog." });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle(`📦 Pricing Catalog Plans ${cat ? `(${cat.toUpperCase()})` : ""}`)
        .setColor(0x00a8ff)
        .setDescription(
          plans
            .map(
              (p) =>
                `• **${p.name}** (\`${p.category.toUpperCase()}\`) — ID: \`${p.id}\`\n` +
                `  - Specs: ${p.ramGb}GB RAM / ${p.vcpu} vCPU / ${p.storageGb}GB Disk\n` +
                `  - Price: ₹${p.priceInr} / $${p.priceUsd} per month\n` +
                `  - Status: ${p.isActive ? "🟢 ACTIVE" : "🔴 DISABLED"} ${p.isArchived ? "(ARCHIVED)" : ""}` +
                (p.description ? `\n  - Note: *${p.description}*` : "")
            )
            .join("\n\n")
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (subcommand === "add") {
      await interaction.deferReply({ flags: 64 });
      try {
        const category = interaction.options.getString("category", true) as "vps" | "minecraft";
        const name = interaction.options.getString("name", true);
        const ramGb = interaction.options.getInteger("ram_gb", true);
        const vcpu = interaction.options.getInteger("vcpu", true);
        const storageGb = interaction.options.getInteger("storage_gb", true);
        const priceInr = interaction.options.getNumber("price_inr", true);
        const priceUsd = interaction.options.getNumber("price_usd", true);
        const description = interaction.options.getString("description") || undefined;

        const newPlan = await createCatalogPlan(
          { category, name, ramGb, vcpu, storageGb, priceInr, priceUsd, description },
          interaction.user.id
        );

        await interaction.editReply({
          content: `✅ New **${category.toUpperCase()}** plan **${newPlan.name}** created successfully!\n- Specs: ${newPlan.ramGb}GB RAM | ${newPlan.vcpu} vCPU | ${newPlan.storageGb}GB NVMe\n- Price: ₹${newPlan.priceInr} / $${newPlan.priceUsd}`,
        });
      } catch (err: any) {
        await interaction.editReply({ content: `❌ Failed to create plan: ${err.message}` });
      }
      return;
    }

    if (subcommand === "edit") {
      await interaction.deferReply({ flags: 64 });
      try {
        const planIdentifier = interaction.options.getString("plan", true);
        const name = interaction.options.getString("name") || undefined;
        const ramGb = interaction.options.getInteger("ram_gb") ?? undefined;
        const vcpu = interaction.options.getInteger("vcpu") ?? undefined;
        const storageGb = interaction.options.getInteger("storage_gb") ?? undefined;
        const priceInr = interaction.options.getNumber("price_inr") ?? undefined;
        const priceUsd = interaction.options.getNumber("price_usd") ?? undefined;
        const description = interaction.options.getString("description") ?? undefined;

        const updated = await updateCatalogPlan(
          planIdentifier,
          { name, ramGb, vcpu, storageGb, priceInr, priceUsd, description },
          interaction.user.id
        );

        await interaction.editReply({
          content: `✅ Plan **${updated.name}** (\`${updated.category.toUpperCase()}\`) updated successfully!\n- Specs: ${updated.ramGb}GB RAM | ${updated.vcpu} vCPU | ${updated.storageGb}GB NVMe\n- Price: ₹${updated.priceInr} / $${updated.priceUsd}`,
        });
      } catch (err: any) {
        await interaction.editReply({ content: `❌ Failed to edit plan: ${err.message}` });
      }
      return;
    }

    if (subcommand === "toggle") {
      await interaction.deferReply({ flags: 64 });
      try {
        const planIdentifier = interaction.options.getString("plan", true);
        const toggled = await togglePlanActive(planIdentifier, interaction.user.id);
        await interaction.editReply({
          content: `✅ Plan **${toggled.name}** is now **${toggled.isActive ? "🟢 ACTIVE" : "🔴 DISABLED"}**.`,
        });
      } catch (err: any) {
        await interaction.editReply({ content: `❌ Failed to toggle plan: ${err.message}` });
      }
      return;
    }

    if (subcommand === "archive") {
      await interaction.deferReply({ flags: 64 });
      try {
        const planIdentifier = interaction.options.getString("plan", true);
        const archived = await archivePlan(planIdentifier, interaction.user.id);
        await interaction.editReply({
          content: `✅ Plan **${archived.name}** has been archived.`,
        });
      } catch (err: any) {
        await interaction.editReply({ content: `❌ Failed to archive plan: ${err.message}` });
      }
      return;
    }
  }

  // Location Subcommand Group (/admin location list|add|edit|toggle|archive)
  if (subGroup === "location") {
    if (!isAdministrator) {
      await interaction.reply({ content: "❌ Only Administrators can manage hosting locations.", flags: 64 });
      return;
    }

    if (subcommand === "list") {
      await interaction.deferReply({ flags: 64 });
      const cat = interaction.options.getString("category") as "vps" | "minecraft" | "both" | null;
      const nodes = await getHostingNodes(cat || undefined, true);

      if (nodes.length === 0) {
        await interaction.editReply({ content: "ℹ️ No hosting locations found." });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle(`📍 Hosting Locations ${cat ? `(${cat.toUpperCase()})` : ""}`)
        .setColor(0x00a8ff)
        .setDescription(
          nodes
            .map(
              (n) =>
                `• **${n.displayName}** (\`${n.category.toUpperCase()}\`) — ID: \`${n.id}\`\n` +
                `  - Hostname: \`${n.hostname}\` | Node: \`${n.nodeName}\`\n` +
                `  - Status: ${n.isActive ? "🟢 ACTIVE" : "🔴 DISABLED"} ${n.isArchived ? "(ARCHIVED)" : ""}`
            )
            .join("\n\n")
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (subcommand === "add") {
      await interaction.deferReply({ flags: 64 });
      try {
        const displayName = interaction.options.getString("display_name", true);
        const locationName = interaction.options.getString("location_name", true);
        const countryFlag = interaction.options.getString("country_flag") || undefined;
        const hostname = interaction.options.getString("hostname") || undefined;
        const category = (interaction.options.getString("category") as any) || "both";

        const newNode = await createHostingNode(
          { displayName, locationName, countryFlag, hostname, category },
          interaction.user.id
        );

        await interaction.editReply({
          content: `✅ Hosting Location **${newNode.displayName}** created successfully! (Hostname: \`${newNode.hostname}\`)`,
        });
      } catch (err: any) {
        await interaction.editReply({ content: `❌ Failed to create location: ${err.message}` });
      }
      return;
    }

    if (subcommand === "edit") {
      await interaction.deferReply({ flags: 64 });
      try {
        const identifier = interaction.options.getString("location", true);
        const displayName = interaction.options.getString("display_name") || undefined;
        const locationName = interaction.options.getString("location_name") || undefined;
        const countryFlag = interaction.options.getString("country_flag") || undefined;
        const hostname = interaction.options.getString("hostname") || undefined;

        const updated = await updateHostingNode(
          identifier,
          { displayName, locationName, countryFlag, hostname },
          interaction.user.id
        );

        await interaction.editReply({
          content: `✅ Location **${updated.displayName}** updated successfully! (Hostname: \`${updated.hostname}\`)`,
        });
      } catch (err: any) {
        await interaction.editReply({ content: `❌ Failed to edit location: ${err.message}` });
      }
      return;
    }

    if (subcommand === "toggle") {
      await interaction.deferReply({ flags: 64 });
      try {
        const identifier = interaction.options.getString("location", true);
        const toggled = await toggleHostingNodeActive(identifier, interaction.user.id);
        await interaction.editReply({
          content: `✅ Location **${toggled.displayName}** is now **${toggled.isActive ? "🟢 ACTIVE" : "🔴 DISABLED"}**.`,
        });
      } catch (err: any) {
        await interaction.editReply({ content: `❌ Failed to toggle location: ${err.message}` });
      }
      return;
    }

    if (subcommand === "archive") {
      await interaction.deferReply({ flags: 64 });
      try {
        const identifier = interaction.options.getString("location", true);
        const archived = await archiveHostingNode(identifier, interaction.user.id);
        await interaction.editReply({
          content: `✅ Location **${archived.displayName}** has been archived.`,
        });
      } catch (err: any) {
        await interaction.editReply({ content: `❌ Failed to archive location: ${err.message}` });
      }
      return;
    }
  }

  // Ledger Subcommand Group (/admin ledger summary|transactions|refund|expense)
  if (subGroup === "ledger") {
    if (!isAdministrator) {
      await interaction.reply({ content: "❌ Only Administrators can access financial accounting ledger data.", flags: 64 });
      return;
    }

    if (subcommand === "summary") {
      await interaction.deferReply({ flags: 64 });
      try {
        const summary = await getFinancialSummary();
        const netEmoji = summary.netProfitInr >= 0 ? "📈" : "📉";
        const netColor = summary.netProfitInr >= 0 ? 0x2ecc71 : 0xe74c3c;

        const embed = new EmbedBuilder()
          .setTitle(`${netEmoji} Shark Byte Financial Accounting & P&L Summary`)
          .setColor(netColor)
          .addFields(
            { name: "💰 Total Revenue", value: `**₹${summary.totalRevenueInr.toFixed(2)}** / **$${summary.totalRevenueUsd.toFixed(2)}** (${summary.completedTransactionCount} sales)`, inline: true },
            { name: "💸 Total Refunds", value: `**₹${summary.totalRefundsInr.toFixed(2)}** / **$${summary.totalRefundsUsd.toFixed(2)}** (${summary.refundCount} refunds)`, inline: true },
            { name: "🛠️ Total Expenses", value: `**₹${summary.totalExpensesInr.toFixed(2)}** / **$${summary.totalExpensesUsd.toFixed(2)}** (${summary.expenseCount} entries)`, inline: true },
            { name: `${netEmoji} Net Profit / Loss`, value: `**₹${summary.netProfitInr.toFixed(2)}** / **$${summary.netProfitUsd.toFixed(2)}**`, inline: false }
          );

        if (summary.gatewayBreakdown.length > 0) {
          embed.addFields({
            name: "💳 Gateway Revenue Breakdown",
            value: summary.gatewayBreakdown
              .map((g) => `• **${g.gateway.toUpperCase()}**: ₹${g.totalInr.toFixed(2)} / $${g.totalUsd.toFixed(2)} (${g.count} transactions)`)
              .join("\n"),
            inline: false,
          });
        }

        if (summary.serviceBreakdown.length > 0) {
          embed.addFields({
            name: "📦 Service Revenue Breakdown",
            value: summary.serviceBreakdown
              .map((s) => `• **${s.serviceType.toUpperCase()}**: ₹${s.totalInr.toFixed(2)} / $${s.totalUsd.toFixed(2)} (${s.count} orders)`)
              .join("\n"),
            inline: false,
          });
        }

        embed.setFooter({ text: "Shark Byte Real-Time Financial Ledger" }).setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      } catch (err: any) {
        await interaction.editReply({ content: `❌ Error calculating financial summary: ${err.message}` });
      }
      return;
    }

    if (subcommand === "transactions") {
      await interaction.deferReply({ flags: 64 });
      try {
        const limit = interaction.options.getInteger("limit") || 10;
        const txs = await listRecentTransactions(limit);

        if (txs.length === 0) {
          await interaction.editReply({ content: "ℹ️ No financial transactions recorded in ledger yet." });
          return;
        }

        const embed = new EmbedBuilder()
          .setTitle(`🧾 Recent Financial Transactions (${txs.length})`)
          .setColor(0x00a8ff)
          .setDescription(
            txs
              .map(
                (t) =>
                  `• **#${t.transactionNumber}** [\`${t.type.toUpperCase()}\`] — \`${t.gateway.toUpperCase()}\` (${t.serviceType.toUpperCase()})\n` +
                  `  - Amount: ₹${t.amountInr.toFixed(2)} / $${t.amountUsd.toFixed(2)} | Status: \`${t.status.toUpperCase()}\`\n` +
                  `  - Date: <t:${Math.floor(t.createdAt.getTime() / 1000)}:R>` +
                  (t.notes ? `\n  - Notes: *${t.notes}*` : "")
              )
              .join("\n\n")
          )
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      } catch (err: any) {
        await interaction.editReply({ content: `❌ Error listing transactions: ${err.message}` });
      }
      return;
    }

    if (subcommand === "refund") {
      await interaction.deferReply({ flags: 64 });
      try {
        const txIdentifier = interaction.options.getString("transaction", true);
        const amountInr = interaction.options.getNumber("amount_inr", true);
        const amountUsd = interaction.options.getNumber("amount_usd", true);
        const notes = interaction.options.getString("notes") || undefined;

        const refundTx = await recordRefund(txIdentifier, amountInr, amountUsd, interaction.user.id, notes);

        await interaction.editReply({
          content: `✅ Refund recorded in ledger! (Refund Transaction **#${refundTx.transactionNumber}** — ₹${refundTx.amountInr} / $${refundTx.amountUsd})`,
        });
      } catch (err: any) {
        await interaction.editReply({ content: `❌ Could not record refund: ${err.message}` });
      }
      return;
    }

    if (subcommand === "expense") {
      await interaction.deferReply({ flags: 64 });
      try {
        const amountInr = interaction.options.getNumber("amount_inr", true);
        const amountUsd = interaction.options.getNumber("amount_usd", true);
        const description = interaction.options.getString("description", true);

        const expTx = await recordExpense(amountInr, amountUsd, interaction.user.id, description);

        await interaction.editReply({
          content: `✅ Infrastructure expense recorded! (Expense Transaction **#${expTx.transactionNumber}** — ₹${expTx.amountInr} / $${expTx.amountUsd})`,
        });
      } catch (err: any) {
        await interaction.editReply({ content: `❌ Could not record expense: ${err.message}` });
      }
      return;
    }
  }

  // 1. /admin setup
  if (subcommand === "setup") {
    if (!isAdministrator) {
      await interaction.reply({ content: "❌ Only Server Administrators can execute automated setup.", flags: 64 });
      return;
    }
    await handleSetupServerCommand(interaction);
    return;
  }

  // 1b. /admin setup-roles
  if (subcommand === "setup-roles") {
    if (!isAdministrator) {
      await interaction.reply({ content: "❌ Only Server Administrators can setup roles.", flags: 64 });
      return;
    }

    await interaction.deferReply({ flags: 64 });

    try {
      const { createdCount, autoRole, supportRole } = await provisionAllRoles(guild);
      const embed = new EmbedBuilder()
        .setTitle("✅ Server Roles Provisioned & Allocated Successfully")
        .setColor(0x2ecc71)
        .setDescription(
          "The complete role hierarchy for **Shark Byte** has been automatically created and assigned:\n\n" +
            RECOMMENDED_ROLES.map((r) => `• **${r.name}** — ${r.reason}`).join("\n") +
            `\n\n👥 **Auto-Assigned Join Role:** ${autoRole}\n` +
            `🦈 **Support Staff Role:** ${supportRole}\n\n` +
            "All existing members in your server have been allocated the `@Member` role!"
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (err: any) {
      await interaction.editReply({ content: `❌ Failed to setup roles: ${err.message}` });
    }
    return;
  }

  // 2. /admin create-category
  if (subcommand === "create-category") {
    if (!isAdministrator) {
      await interaction.reply({ content: "❌ Only Server Administrators can create categories.", flags: 64 });
      return;
    }

    const name = interaction.options.getString("name", true);
    const visibility = interaction.options.getString("visibility", true);

    await interaction.deferReply({ flags: 64 });

    try {
      const supportRoleId = process.env.SUPPORT_ROLE_ID;
      const overwrites: any[] = [];

      if (visibility === "staff") {
        overwrites.push({ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] });
        if (supportRoleId) {
          overwrites.push({
            id: supportRoleId,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
          });
        }
      } else if (visibility === "admin") {
        overwrites.push({ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] });
      }

      const category = await guild.channels.create({
        name,
        type: ChannelType.GuildCategory,
        permissionOverwrites: overwrites,
      });

      await interaction.editReply({
        content: `✅ Category **${category.name}** created successfully (Visibility: \`${visibility.toUpperCase()}\`).`,
      });
    } catch (err: any) {
      await interaction.editReply({ content: `❌ Could not create category: ${err.message}` });
    }
    return;
  }

  // 3. /admin create-channel
  if (subcommand === "create-channel") {
    if (!isAdministrator) {
      await interaction.reply({ content: "❌ Only Server Administrators can create channels.", flags: 64 });
      return;
    }

    const name = interaction.options.getString("name", true);
    const typeStr = interaction.options.getString("type", true);
    const category = interaction.options.getChannel("category");
    const visibility = interaction.options.getString("visibility") || "public";
    const allowedRole = interaction.options.getRole("allowed_role") as Role | null;

    await interaction.deferReply({ flags: 64 });

    try {
      const channelType = typeStr === "voice" ? ChannelType.GuildVoice : ChannelType.GuildText;
      const supportRoleId = process.env.SUPPORT_ROLE_ID;
      const overwrites: any[] = [];

      if (visibility === "staff") {
        overwrites.push({ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] });
        if (supportRoleId) {
          overwrites.push({
            id: supportRoleId,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
          });
        }
      } else if (visibility === "admin") {
        overwrites.push({ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] });
      } else if (visibility === "role" && allowedRole) {
        overwrites.push({ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] });
        overwrites.push({
          id: allowedRole.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
        });
      }

      const newChannel = await guild.channels.create({
        name,
        type: channelType,
        parent: category?.id,
        permissionOverwrites: overwrites.length > 0 ? overwrites : undefined,
      });

      await interaction.editReply({
        content: `✅ ${typeStr === "voice" ? "Voice" : "Text"} Channel ${newChannel} created successfully!`,
      });
    } catch (err: any) {
      await interaction.editReply({ content: `❌ Could not create channel: ${err.message}` });
    }
    return;
  }

  // 4. /admin create-role
  if (subcommand === "create-role") {
    if (!isAdministrator) {
      await interaction.reply({ content: "❌ Only Server Administrators can create roles.", flags: 64 });
      return;
    }

    const name = interaction.options.getString("name", true);
    const colorStr = interaction.options.getString("color") || undefined;
    const hoist = interaction.options.getBoolean("hoist") ?? false;

    await interaction.deferReply({ flags: 64 });

    try {
      const role = await guild.roles.create({
        name,
        color: (colorStr || "#00a8ff") as ColorResolvable,
        hoist,
        reason: `Created by ${interaction.user.tag} via /admin create-role`,
      });

      await interaction.editReply({
        content: `✅ Role ${role} created successfully (Color: \`${role.hexColor}\`, Hoist: \`${hoist}\`).`,
      });
    } catch (err: any) {
      await interaction.editReply({ content: `❌ Could not create role: ${err.message}` });
    }
    return;
  }

  // 5. /admin set-auto-role
  if (subcommand === "set-auto-role") {
    if (!isAdministrator) {
      await interaction.reply({ content: "❌ Only Server Administrators can configure auto-role.", flags: 64 });
      return;
    }

    const role = interaction.options.getRole("role", true) as Role;
    process.env.AUTO_MEMBER_ROLE_ID = role.id;

    await interaction.reply({
      content: `✅ Auto-role on member join updated to ${role}. New members joining **${guild.name}** will automatically receive this role!`,
      flags: 64,
    });
    return;
  }

  // 6. /admin mod
  if (subcommand === "mod") {
    if (!isStaff) {
      await interaction.reply({ content: "❌ Only Staff can access moderation dashboard.", flags: 64 });
      return;
    }

    await interaction.deferReply({ flags: 64 });
    const embed = new EmbedBuilder()
      .setTitle("🛡️ Shark Byte Auto-Moderation Dashboard")
      .setDescription(
        "Auto-Moderation active with rule filters for:\n" +
          "• Credential theft & account selling\n" +
          "• Malware distribution\n" +
          "• Payment scams\n" +
          "• Unauthorized Discord/Telegram promotion\n" +
          "• Link shorteners & mass mentions\n\n" +
          `Log Channel: <#${process.env.MODERATION_LOG_CHANNEL_ID || "not-configured"}>`
      )
      .setColor(0x00a8ff)
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // 7. /admin invites
  if (subcommand === "invites") {
    if (!isStaff) {
      await interaction.reply({ content: "❌ Only Staff can view referral stats.", flags: 64 });
      return;
    }

    await interaction.deferReply({ flags: 64 });
    const embed = new EmbedBuilder()
      .setTitle("📊 Shark Byte Referral Leaderboard")
      .setDescription("No referral data recorded yet.")
      .setColor(0x00a8ff)
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    return;
  }
}
