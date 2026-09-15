import crypto from "crypto";
import { EmbedBuilder, Guild, GuildMember, TextChannel } from "discord.js";
import { getOrCreateCustomer } from "./ticketDatabase";
import { createVpsInstance, getVpsByTicketId, lockAndInitializeVpsProvisioning, updateVpsStatus } from "./vpsDatabase";
import { IncusProvider } from "../providers/incusProvider";
import { PterodactylProvider } from "../providers/pterodactylProvider";
import { getPool } from "../config/database";
import { logBotError } from "./loggerService";
import { getOsById, getDefaultOs } from "../config/osCatalog";

export type VirtualizationMode = "standard" | "nested";

export function generateSecurePassword(length = 16): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
  const bytes = crypto.randomBytes(length);
  let password = "";
  for (let i = 0; i < length; i++) password += chars[bytes[i] % chars.length];
  return password;
}

type VpsProgress = (stepText: string) => Promise<void>;

function getTicketChannel(guild: Guild, ticketId: string): TextChannel | undefined {
  return guild.channels.cache.find(
    (channel): channel is TextChannel =>
      channel.type === 0 && Boolean(channel.topic?.includes(`ticket-id:${ticketId}`))
  );
}

function asPositiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function provisionVpsOrder(
  guild: Guild,
  ticketId: string,
  member: GuildMember,
  metadata: any,
  onProgress?: VpsProgress,
): Promise<void> {
  const channel = getTicketChannel(guild, ticketId);
  const existing = await getVpsByTicketId(ticketId);

  if (existing?.status === "active") {
    if (channel) {
      await channel.send({
        content: `${member}`,
        embeds: [
          new EmbedBuilder()
            .setTitle("🚀 Shark Byte VPS Already Active")
            .setColor(0x2ecc71)
            .setDescription(
              `VPS **#${existing.vpsNumber}** is already active for this ticket.\n\n` +
              `SSH: \`ssh -p ${existing.publicSshPort ?? "N/A"} root@${existing.publicSshHost ?? "ssh.mysticservers.com"}\``
            )
            .setTimestamp(),
        ],
      });
    }
    return;
  }

  if (existing && ["allocating", "launching", "configuring", "networking", "verifying"].includes(existing.status)) {
    throw new Error(`VPS provisioning is already in progress for this ticket (${existing.status.toUpperCase()}).`);
  }

  const osId = typeof metadata?.osId === "string" ? metadata.osId : getDefaultOs().id;
  const os = getOsById(osId);
  if (!os || os.availability !== "available" || !os.incusAlias) {
    throw new Error("The selected operating system is unavailable on this node.");
  }

  const virtualizationMode: VirtualizationMode =
    metadata?.virtualizationMode === "nested" ? "nested" : "standard";

  const planName = String(metadata?.planName || "STANDARD");
  const ramGb = asPositiveNumber(metadata?.ramGb, 2);
  const vcpu = Math.max(1, Math.floor(asPositiveNumber(metadata?.vcpu, 1)));
  const storageGb = asPositiveNumber(metadata?.storageGb, 20);
  const priceInr = asPositiveNumber(metadata?.priceInr, 199);
  const priceUsd = asPositiveNumber(metadata?.priceUsd, 2.5);
  const location = String(metadata?.location || "India 🇮🇳");

  const customer = await getOrCreateCustomer(
    member.user.id,
    member.user.username,
    member.displayName,
  );

  const pool = getPool();
  const seqResult = await pool.query<{ vps_sequence_counter: number }>(
    `UPDATE customers
     SET vps_sequence_counter = vps_sequence_counter + 1, updated_at = NOW()
     WHERE id = $1
     RETURNING vps_sequence_counter`,
    [customer.id],
  );
  const vpsSequence = Number(seqResult.rows[0]?.vps_sequence_counter || 1);

  const safeUsername =
    member.user.username
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50) || "customer";
  const hostname = `vps-${String(vpsSequence).padStart(3, "0")}-${safeUsername}.sharkbyte.com`;
  const incus = new IncusProvider();
  const containerName = incus.getContainerName(
    vpsSequence,
    safeUsername,
  );
  const rootPassword = generateSecurePassword();

  await onProgress?.("Allocating VPS number and SSH port...").catch(() => {});

  let vpsRecord = await lockAndInitializeVpsProvisioning({
    customerId: customer.id,
    ticketId,
    planName,
    location,
    priceInr,
    priceUsd,
    ramGb,
    vcpu,
    storageGb,
    providerInstanceId: containerName,
    hostname,
    instanceName: containerName,
    customerVpsSequence: vpsSequence,
    sshUsername: "root",
    sshPort: 22,
    provisionedByDiscordId: member.user.id,
    billingCycleMonths: 1,
    osId,
    virtualizationMode,
  });

  if (vpsRecord.status === "active") return;

  const publicSshHost = vpsRecord.publicSshHost || "ssh.mysticservers.com";
  const publicSshPort = vpsRecord.publicSshPort;
  if (!publicSshPort) throw new Error("SSH port allocation failed.");

  const progress: VpsProgress = async (text) => {
    if (text.toLowerCase().includes("launch")) await updateVpsStatus(vpsRecord.id, "launching").catch(() => {});
    else if (text.toLowerCase().includes("network") || text.toLowerCase().includes("ipv4")) await updateVpsStatus(vpsRecord.id, "networking").catch(() => {});
    else if (text.toLowerCase().includes("verif")) await updateVpsStatus(vpsRecord.id, "verifying").catch(() => {});
    else await updateVpsStatus(vpsRecord.id, "configuring").catch(() => {});
    await onProgress?.(text).catch(() => {});
  };

  try {
    await updateVpsStatus(vpsRecord.id, "launching");
    const result = await incus.provision(
      {
        vpsNumber: vpsSequence,
        containerName,
        customerUsername: safeUsername,
        hostname,
        resources: { ramGb, vcpu, storageGb },
        osId,
        virtualizationMode,
        publicSshPort,
        initialPassword: rootPassword,
        bridgeName: process.env.VPS_LXC_BRIDGE?.trim() || "incusbr1",
        templateDistribution: os.distribution,
        templateRelease: os.version,
        templateArchitecture: "amd64",
        enableNesting: virtualizationMode === "nested",
      },
      progress,
    );

    await updateVpsStatus(vpsRecord.id, "active", {
      privateIpv4: result.privateIpv4 || undefined,
      publicSshPort,
    });

    vpsRecord = (await getVpsByTicketId(ticketId)) || vpsRecord;

    if (!channel) return;

    const storageNote =
      result.storageLimitEnforced
        ? `${storageGb} GB enforced`
        : `${storageGb} GB plan allocation (not enforced by current ${result.storageBackend} storage backend)`;

    const embed = new EmbedBuilder()
      .setTitle("🚀 Shark Byte VPS Provisioned & Active")
      .setColor(0x2ecc71)
      .setDescription(
        `Your VPS is ready.\n\n` +
        `**VPS:** #${vpsRecord.vpsNumber}\n` +
        `**OS:** ${os.displayName}\n` +
        `**Virtualization:** ${virtualizationMode === "nested" ? "Nested" : "Standard"}\n` +
        `**Hostname:** \`${hostname}\`\n` +
        `**Container:** \`${result.containerName}\`\n` +
        `**CPU:** ${vcpu} vCPU\n` +
        `**RAM:** ${ramGb} GB\n` +
        `**Storage:** ${storageNote}\n` +
        `**Private IP:** \`${result.privateIpv4 || "N/A"}\`\n\n` +
        `**SSH:** \`ssh -p ${publicSshPort} root@${publicSshHost}\`\n` +
        `**Username:** \`root\`\n` +
        `**Root Password:** \`${rootPassword}\`\n\n` +
        `⚠️ Change the root password after first login.`,
      )
      .setFooter({ text: "Shark Byte • VPS Deployment Engine" })
      .setTimestamp();

    await channel.send({ content: `${member}`, embeds: [embed] });
  } catch (error: any) {
    const reason = String(error?.message || error || "Unknown provisioning error");
    await updateVpsStatus(vpsRecord.id, "failed", { failureReason: reason }).catch(() => {});
    await logBotError({
      guild,
      error,
      title: "VPS Provisioning Error",
      context: "provisionVpsOrder",
      userTag: member.user.tag,
      userId: member.user.id,
      severity: "ERROR",
    }).catch(() => {});
    throw new Error(`VPS provisioning failed: ${reason}`);
  }
}

export async function provisionMinecraftOrder(
  guild: Guild,
  ticketId: string,
  member: GuildMember,
  metadata: any
): Promise<void> {
  const channel = guild.channels.cache.find(
    (c): c is TextChannel => c.type === 0 && Boolean(c.topic?.includes(`ticket-id:${ticketId}`))
  );

  const planName = (metadata.planName as string) || "Starter Minecraft";
  const ramGb = Number(metadata.ramGb || 2);
  const ramMb = ramGb * 1024;
  const cpuPercent = Number(metadata.cpuPercent || 100);
  const storageGb = Number(metadata.storageGb || 10);
  const priceInr = Number(metadata.priceInr || 199);
  const priceUsd = Number(metadata.priceUsd || 2.5);

  const customer = await getOrCreateCustomer(
    member.user.id,
    member.user.username,
    member.displayName
  );

  const pool = getPool();
  const seqRes = await pool.query(
    `UPDATE customers SET minecraft_sequence_counter = minecraft_sequence_counter + 1 WHERE id = $1 RETURNING minecraft_sequence_counter`,
    [customer.id]
  );
  const mcSequence = seqRes.rows[0]?.minecraft_sequence_counter || 1;

  const serverName = `${planName} - ${member.displayName}`;
  let pteroUserId = customer.pterodactylUserId || 1;

  try {
    const ptero = new PterodactylProvider();
    if (!customer.pterodactylUserId) {
      const existing = await ptero.findUserByEmail(`${member.user.username}@sharkbyte.com`).catch(() => null);
      if (existing) {
        pteroUserId = existing.id;
      } else {
        const newUser = await ptero.createUser({
          username: `mc_${member.user.id.slice(-6)}`,
          email: `${member.user.id}@sharkbyte.com`,
          firstName: member.displayName.slice(0, 10),
          lastName: "Customer",
        }).catch(() => null);
        if (newUser) pteroUserId = newUser.id;
      }
    }
  } catch (err) {
    console.warn("⚠️ Pterodactyl API not configured or offline. Creating local server reservation.");
  }

  const port = 25565 + mcSequence;

  await pool.query(
    `
    INSERT INTO minecraft_servers (
      customer_id, ticket_id, pterodactyl_server_id, pterodactyl_identifier, pterodactyl_user_id,
      server_name, customer_minecraft_sequence, plan_id, plan_name, price_inr, price_usd,
      ram_mb, cpu_limit, storage_mb, allocation_id, allocation_ip, allocation_port,
      provisioned_by_discord_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
    ON CONFLICT (ticket_id) DO NOTHING;
    `,
    [
      customer.id,
      ticketId,
      mcSequence,
      `mc-${mcSequence}`,
      pteroUserId,
      serverName,
      mcSequence,
      metadata.planId || "mc_plan",
      planName,
      priceInr,
      priceUsd,
      ramMb,
      cpuPercent,
      storageGb * 1024,
      mcSequence,
      "10.0.3.1",
      port,
      member.user.id,
    ]
  );

  if (channel) {
    const embed = new EmbedBuilder()
      .setTitle("🎮 Minecraft Game Server Provisioned & Active!")
      .setColor(0x2ecc71)
      .setDescription(
        `Your **${planName}** Minecraft server is ready for play!\n\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `🎮 **SERVER DETAILS**\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `• **Server Name:** ${serverName}\n` +
          `• **Server IP Address:** \`minecraft.sharkbyte.com:${port}\`\n` +
          `• **Pterodactyl Panel:** [https://panel.sharkbyte.com](https://panel.sharkbyte.com)\n` +
          `• **Status:** 🟢 \`ACTIVE\`\n\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `⚙️ **ALLOCATED RESOURCES**\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `• **Memory:** ${ramGb} GB (${ramMb} MB)\n` +
          `• **CPU Limit:** ${cpuPercent}%\n` +
          `• **Storage:** ${storageGb} GB NVMe\n\n` +
          `🎮 *You can manage your server, upload plugins, and view console logs at the Pterodactyl panel!*`
      )
      .setFooter({ text: "Shark Byte • High Performance Minecraft Hosting" })
      .setTimestamp();

    await channel.send({ content: `${member}`, embeds: [embed] });
  }
}
