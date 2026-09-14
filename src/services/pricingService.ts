import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from "discord.js";
import { getPool } from "../config/database";

export interface CatalogPlan {
  id: string;
  category: "vps" | "minecraft";
  name: string;
  description?: string | null;
  ramGb: number;
  vcpu: number;
  storageGb: number;
  memoryMb?: number | null;
  cpuPercent?: number | null;
  priceInr: number;
  priceUsd: number;
  isActive: boolean;
  isArchived: boolean;
  displayOrder: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface HostingNode {
  id: string;
  category: "vps" | "minecraft" | "both";
  displayName: string;
  countryCode: string;
  countryFlag: string;
  locationName: string;
  nodeName: string;
  hostname: string;
  isActive: boolean;
  isArchived: boolean;
  displayOrder: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CreatePlanInput {
  category: "vps" | "minecraft";
  name: string;
  description?: string;
  ramGb: number;
  vcpu: number;
  storageGb: number;
  memoryMb?: number;
  cpuPercent?: number;
  priceInr: number;
  priceUsd: number;
  displayOrder?: number;
}

export interface UpdatePlanInput {
  name?: string;
  description?: string;
  ramGb?: number;
  vcpu?: number;
  storageGb?: number;
  memoryMb?: number;
  cpuPercent?: number;
  priceInr?: number;
  priceUsd?: number;
  displayOrder?: number;
}

/**
  Fetch catalog plans from PostgreSQL
 */
export async function getPricingPlans(
  category?: "vps" | "minecraft",
  includeInactive = false
): Promise<CatalogPlan[]> {
  const pool = getPool();
  let query = `
    SELECT
      id, category, name, description,
      ram_gb AS "ramGb", vcpu, storage_gb AS "storageGb",
      memory_mb AS "memoryMb", cpu_percent AS "cpuPercent",
      price_inr::float AS "priceInr", price_usd::float AS "priceUsd",
      is_active AS "isActive", is_archived AS "isArchived", display_order AS "displayOrder",
      created_at AS "createdAt", updated_at AS "updatedAt"
    FROM pricing_plans
    WHERE is_archived = FALSE
  `;

  const params: any[] = [];

  if (category) {
    params.push(category);
    query += ` AND LOWER(category) = LOWER($${params.length})`;
  }

  if (!includeInactive) {
    query += ` AND is_active = TRUE`;
  }

  query += ` ORDER BY display_order ASC, price_inr ASC`;

  const result = await pool.query<CatalogPlan>(query, params);
  return result.rows;
}

export async function getActivePlans(category: "vps" | "minecraft"): Promise<CatalogPlan[]> {
  return getPricingPlans(category, false);
}

export async function getPricingPlanByIdOrName(
  identifier: string,
  category?: "vps" | "minecraft"
): Promise<CatalogPlan | null> {
  const pool = getPool();
  let query = `
    SELECT
      id, category, name, description,
      ram_gb AS "ramGb", vcpu, storage_gb AS "storageGb",
      memory_mb AS "memoryMb", cpu_percent AS "cpuPercent",
      price_inr::float AS "priceInr", price_usd::float AS "priceUsd",
      is_active AS "isActive", is_archived AS "isArchived", display_order AS "displayOrder"
    FROM pricing_plans
    WHERE (id::text = $1 OR LOWER(name) = LOWER($1))
  `;

  const params: any[] = [identifier];

  if (category) {
    params.push(category);
    query += ` AND LOWER(category) = LOWER($2)`;
  }

  query += ` LIMIT 1`;

  const result = await pool.query<CatalogPlan>(query, params);
  return result.rows[0] ?? null;
}

/**
  Create a new catalog plan in PostgreSQL
 */
export async function createCatalogPlan(
  input: CreatePlanInput,
  adminDiscordId: string
): Promise<CatalogPlan> {
  const pool = getPool();
  const memoryMb = input.memoryMb ?? input.ramGb * 1024;
  const cpuPercent = input.cpuPercent ?? input.vcpu * 100;
  const displayOrder = input.displayOrder ?? 0;

  const result = await pool.query<CatalogPlan>(
    `
    INSERT INTO pricing_plans (
      category, name, description, ram_gb, vcpu, storage_gb, memory_mb, cpu_percent,
      price_inr, price_usd, display_order, is_active, is_archived
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, TRUE, FALSE)
    RETURNING
      id, category, name, description,
      ram_gb AS "ramGb", vcpu, storage_gb AS "storageGb",
      memory_mb AS "memoryMb", cpu_percent AS "cpuPercent",
      price_inr::float AS "priceInr", price_usd::float AS "priceUsd",
      is_active AS "isActive", is_archived AS "isArchived", display_order AS "displayOrder"
    `,
    [
      input.category,
      input.name,
      input.description ?? null,
      input.ramGb,
      input.vcpu,
      input.storageGb,
      memoryMb,
      cpuPercent,
      input.priceInr,
      input.priceUsd,
      displayOrder,
    ]
  );

  return result.rows[0];
}

/**
  Update existing catalog plan in PostgreSQL
 */
export async function updateCatalogPlan(
  identifier: string,
  input: UpdatePlanInput,
  adminDiscordId: string
): Promise<CatalogPlan> {
  const pool = getPool();
  const existing = await getPricingPlanByIdOrName(identifier);
  if (!existing) {
    throw new Error(`Plan "${identifier}" was not found.`);
  }

  const name = input.name ?? existing.name;
  const description = input.description !== undefined ? input.description : existing.description;
  const ramGb = input.ramGb ?? existing.ramGb;
  const vcpu = input.vcpu ?? existing.vcpu;
  const storageGb = input.storageGb ?? existing.storageGb;
  const memoryMb = input.memoryMb ?? (input.ramGb ? input.ramGb * 1024 : existing.memoryMb);
  const cpuPercent = input.cpuPercent ?? (input.vcpu ? input.vcpu * 100 : existing.cpuPercent);
  const priceInr = input.priceInr ?? existing.priceInr;
  const priceUsd = input.priceUsd ?? existing.priceUsd;
  const displayOrder = input.displayOrder ?? existing.displayOrder;

  const result = await pool.query<CatalogPlan>(
    `
    UPDATE pricing_plans
    SET name = $1, description = $2, ram_gb = $3, vcpu = $4, storage_gb = $5,
        memory_mb = $6, cpu_percent = $7, price_inr = $8, price_usd = $9,
        display_order = $10, updated_at = NOW()
    WHERE id = $11
    RETURNING
      id, category, name, description,
      ram_gb AS "ramGb", vcpu, storage_gb AS "storageGb",
      memory_mb AS "memoryMb", cpu_percent AS "cpuPercent",
      price_inr::float AS "priceInr", price_usd::float AS "priceUsd",
      is_active AS "isActive", is_archived AS "isArchived", display_order AS "displayOrder"
    `,
    [name, description, ramGb, vcpu, storageGb, memoryMb, cpuPercent, priceInr, priceUsd, displayOrder, existing.id]
  );

  return result.rows[0];
}

/**
  Toggle active state of a catalog plan
 */
export async function togglePlanActive(
  identifier: string,
  adminDiscordId: string
): Promise<CatalogPlan> {
  const pool = getPool();
  const existing = await getPricingPlanByIdOrName(identifier);
  if (!existing) {
    throw new Error(`Plan "${identifier}" was not found.`);
  }

  const nextState = !existing.isActive;
  const result = await pool.query<CatalogPlan>(
    `UPDATE pricing_plans SET is_active = $1, updated_at = NOW() WHERE id = $2
     RETURNING id, category, name, is_active AS "isActive"`,
    [nextState, existing.id]
  );

  return result.rows[0];
}

/**
  Archive a catalog plan
 */
export async function archivePlan(
  identifier: string,
  adminDiscordId: string
): Promise<CatalogPlan> {
  const pool = getPool();
  const existing = await getPricingPlanByIdOrName(identifier);
  if (!existing) {
    throw new Error(`Plan "${identifier}" was not found.`);
  }

  const result = await pool.query<CatalogPlan>(
    `UPDATE pricing_plans SET is_archived = TRUE, is_active = FALSE, updated_at = NOW() WHERE id = $1
     RETURNING id, category, name, is_archived AS "isArchived"`,
    [existing.id]
  );

  return result.rows[0];
}

/**
  Render Minecraft Pricing Panel Embed & Interactive Dropdown
 */
export async function renderMinecraftPricingPanel() {
  const plans = await getActivePlans("minecraft");

  const embed = new EmbedBuilder()
    .setTitle("🎮 Shark Byte Minecraft Server Hosting")
    .setDescription(
      "High Performance Minecraft Server Hosting powered by Pterodactyl:\n\n" +
        (plans.length > 0
          ? plans
              .map(
                (plan) =>
                  `🔹 **${plan.name}**\n` +
                  `  - 🧠 RAM: ${plan.ramGb} GB | ⚡ CPU: ${plan.cpuPercent || plan.vcpu * 100}% | 💾 Disk: ${plan.storageGb} GB\n` +
                  `  - 💰 Price: ₹${plan.priceInr} / $${plan.priceUsd} per month` +
                  (plan.description ? `\n  - ℹ️ ${plan.description}` : "")
              )
              .join("\n\n")
          : "⚠️ *No active Minecraft plans available currently.*") +
        "\n\n👇 **Select a Minecraft plan below to order and automatically create a sales ticket!**"
    )
    .setColor(0x00a8ff)
    .setFooter({ text: "Shark Byte • High Performance Game Hosting" });

  const components: any[] = [];

  if (plans.length > 0) {
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId("order_mc_plan")
      .setPlaceholder("🎮 Select a Minecraft plan to order...")
      .addOptions(
        plans.map((p) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(`${p.name} (${p.ramGb}GB RAM / ${p.storageGb}GB Disk)`)
            .setValue(p.id)
            .setDescription(`₹${p.priceInr} / $${p.priceUsd} per month`)
            .setEmoji("🎮")
        )
      );

    components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu));
  } else {
    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("ticket:sales")
          .setLabel("Order Minecraft Server")
          .setEmoji("🎮")
          .setStyle(ButtonStyle.Success)
      )
    );
  }

  return {
    embeds: [embed],
    components,
  };
}

/**
  Render VPS Pricing Panel Embed & Interactive Dropdown
 */
export async function renderVpsPricingPanel(supportChannelId?: string) {
  const plans = await getActivePlans("vps");

  const embed = new EmbedBuilder()
    .setTitle("🖥️ Shark Byte High Performance VPS Hosting")
    .setDescription(
      "Explore our ultra-fast LXC & Incus VPS instances powered by dedicated NVMe storage:\n\n" +
        (plans.length > 0
          ? plans
              .map(
                (plan) =>
                  `📦 **${plan.name}** — ${plan.ramGb}GB RAM / ${plan.vcpu} vCPU / ${plan.storageGb}GB NVMe — **₹${plan.priceInr} / $${plan.priceUsd} per month**` +
                  (plan.description ? `\n   *${plan.description}*` : "")
              )
              .join("\n")
          : "⚠️ *No active VPS plans available currently.*") +
        "\n\n✨ Includes Full Root Access, Dedicated Public SSH Gateway Port, and 24/7 Discord Support.\n" +
        "👇 **Select a VPS plan below to choose your location and create an automated ticket!**"
    )
    .setColor(0x00a8ff)
    .setFooter({ text: "Shark Byte • High Performance VPS Hosting" });

  const components: any[] = [];

  if (plans.length > 0) {
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId("order_vps_plan")
      .setPlaceholder("🛒 Select a VPS plan to order...")
      .addOptions(
        plans.map((p) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(`${p.name} (${p.ramGb}GB RAM / ${p.vcpu} vCPU / ${p.storageGb}GB NVMe)`)
            .setValue(p.id)
            .setDescription(`₹${p.priceInr} / $${p.priceUsd} per month`)
            .setEmoji("🖥️")
        )
      );

    components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu));
  } else {
    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("ticket:vps")
          .setLabel("Order VPS Host")
          .setEmoji("🖥️")
          .setStyle(ButtonStyle.Primary)
      )
    );
  }

  return {
    embeds: [embed],
    components,
  };
}

/**
  Fetch hosting locations from PostgreSQL
 */
export async function getHostingNodes(
  category?: "vps" | "minecraft" | "both",
  includeInactive = false
): Promise<HostingNode[]> {
  const pool = getPool();
  let query = `
    SELECT
      id, category,
      display_name AS "displayName",
      country_code AS "countryCode",
      country_flag AS "countryFlag",
      location_name AS "locationName",
      node_name AS "nodeName",
      hostname,
      is_active AS "isActive",
      is_archived AS "isArchived",
      display_order AS "displayOrder",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM hosting_nodes
    WHERE is_archived = FALSE
  `;

  const params: any[] = [];

  if (category && category !== "both") {
    params.push(category);
    query += ` AND (LOWER(category) = LOWER($${params.length}) OR LOWER(category) = 'both')`;
  }

  if (!includeInactive) {
    query += ` AND is_active = TRUE`;
  }

  query += ` ORDER BY display_order ASC, location_name ASC`;

  const result = await pool.query<HostingNode>(query, params);
  return result.rows;
}

export async function getActiveHostingNodes(category?: "vps" | "minecraft"): Promise<HostingNode[]> {
  return getHostingNodes(category, false);
}

export async function getHostingNodeByIdOrName(identifier: string): Promise<HostingNode | null> {
  const pool = getPool();
  const result = await pool.query<HostingNode>(
    `
    SELECT
      id, category,
      display_name AS "displayName",
      country_code AS "countryCode",
      country_flag AS "countryFlag",
      location_name AS "locationName",
      node_name AS "nodeName",
      hostname,
      is_active AS "isActive",
      is_archived AS "isArchived",
      display_order AS "displayOrder"
    FROM hosting_nodes
    WHERE (id::text = $1 OR LOWER(display_name) = LOWER($1) OR LOWER(location_name) = LOWER($1))
    LIMIT 1
    `,
    [identifier]
  );

  return result.rows[0] ?? null;
}

export async function createHostingNode(
  input: {
    category?: "vps" | "minecraft" | "both";
    displayName: string;
    countryCode?: string;
    countryFlag?: string;
    locationName: string;
    nodeName?: string;
    hostname?: string;
    displayOrder?: number;
  },
  adminDiscordId: string
): Promise<HostingNode> {
  const pool = getPool();
  const category = input.category || "both";
  const countryCode = input.countryCode || "XX";
  const countryFlag = input.countryFlag || "🌐";
  const nodeName = input.nodeName || `${input.locationName}-Node-1`;
  const hostname = input.hostname || "ssh.sharkbyte.com";
  const displayOrder = input.displayOrder ?? 0;

  const result = await pool.query<HostingNode>(
    `
    INSERT INTO hosting_nodes (
      category, display_name, country_code, country_flag, location_name, node_name, hostname,
      is_active, is_archived, display_order
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, FALSE, $8)
    RETURNING
      id, category, display_name AS "displayName", country_code AS "countryCode",
      country_flag AS "countryFlag", location_name AS "locationName", node_name AS "nodeName",
      hostname, is_active AS "isActive", is_archived AS "isArchived", display_order AS "displayOrder"
    `,
    [category, input.displayName, countryCode, countryFlag, input.locationName, nodeName, hostname, displayOrder]
  );

  return result.rows[0];
}

export async function updateHostingNode(
  identifier: string,
  input: {
    displayName?: string;
    countryFlag?: string;
    locationName?: string;
    hostname?: string;
    category?: "vps" | "minecraft" | "both";
    displayOrder?: number;
  },
  adminDiscordId: string
): Promise<HostingNode> {
  const pool = getPool();
  const existing = await getHostingNodeByIdOrName(identifier);
  if (!existing) {
    throw new Error(`Hosting location "${identifier}" not found.`);
  }

  const displayName = input.displayName ?? existing.displayName;
  const countryFlag = input.countryFlag ?? existing.countryFlag;
  const locationName = input.locationName ?? existing.locationName;
  const hostname = input.hostname ?? existing.hostname;
  const category = input.category ?? existing.category;
  const displayOrder = input.displayOrder ?? existing.displayOrder;

  const result = await pool.query<HostingNode>(
    `
    UPDATE hosting_nodes
    SET display_name = $1, country_flag = $2, location_name = $3, hostname = $4,
        category = $5, display_order = $6, updated_at = NOW()
    WHERE id = $7
    RETURNING
      id, category, display_name AS "displayName", country_code AS "countryCode",
      country_flag AS "countryFlag", location_name AS "locationName", node_name AS "nodeName",
      hostname, is_active AS "isActive", is_archived AS "isArchived", display_order AS "displayOrder"
    `,
    [displayName, countryFlag, locationName, hostname, category, displayOrder, existing.id]
  );

  return result.rows[0];
}

export async function toggleHostingNodeActive(
  identifier: string,
  adminDiscordId: string
): Promise<HostingNode> {
  const pool = getPool();
  const existing = await getHostingNodeByIdOrName(identifier);
  if (!existing) {
    throw new Error(`Hosting location "${identifier}" not found.`);
  }

  const nextState = !existing.isActive;
  const result = await pool.query<HostingNode>(
    `UPDATE hosting_nodes SET is_active = $1, updated_at = NOW() WHERE id = $2
     RETURNING id, display_name AS "displayName", is_active AS "isActive"`,
    [nextState, existing.id]
  );

  return result.rows[0];
}

export async function archiveHostingNode(
  identifier: string,
  adminDiscordId: string
): Promise<HostingNode> {
  const pool = getPool();
  const existing = await getHostingNodeByIdOrName(identifier);
  if (!existing) {
    throw new Error(`Hosting location "${identifier}" not found.`);
  }

  const result = await pool.query<HostingNode>(
    `UPDATE hosting_nodes SET is_archived = TRUE, is_active = FALSE, updated_at = NOW() WHERE id = $1
     RETURNING id, display_name AS "displayName", is_archived AS "isArchived"`,
    [existing.id]
  );

  return result.rows[0];
}
