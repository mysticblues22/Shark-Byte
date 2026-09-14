import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";

import { renderVpsPricingPanel } from "../services/pricingService";
import { listVpsByDiscordUserId, decommissionVpsInstance, getVpsByNumber } from "../services/vpsDatabase";
import { IncusProvider } from "../providers/incusProvider";

export const vpsCommand = new SlashCommandBuilder()
  .setName("vps")
  .setDescription("Shark Byte VPS Management Command Suite")
  .addSubcommand((sub) =>
    sub.setName("plans").setDescription("View VPS hosting plans, specs and pricing")
  )
  .addSubcommand((sub) =>
    sub.setName("list").setDescription("View your active Shark Byte VPS instances")
  )
  .addSubcommand((sub) =>
    sub
      .setName("nesting")
      .setDescription("Enable or disable LXC container security nesting for Docker/LXC (Staff Only)")
      .addIntegerOption((opt) => opt.setName("vps_number").setDescription("The numeric VPS ID").setRequired(true))
      .addStringOption((opt) =>
        opt
          .setName("state")
          .setDescription("Enable or disable nested features")
          .setRequired(true)
          .addChoices({ name: "Enable", value: "enable" }, { name: "Disable", value: "disable" })
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("delete")
      .setDescription("Decommission a VPS instance (Staff Only)")
      .addIntegerOption((opt) =>
        opt.setName("vps_number").setDescription("The numeric VPS ID to delete").setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub.setName("status").setDescription("Check VPS host capacity and SSH gateway status (Staff Only)")
  );

export async function handleVpsCommand(
  interaction: ChatInputCommandInteraction,
  isStaff: boolean
): Promise<void> {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "plans") {
    await interaction.deferReply();
    const panel = await renderVpsPricingPanel();
    await interaction.editReply(panel);
    return;
  }

  if (subcommand === "list") {
    await interaction.deferReply({ flags: 64 });
    try {
      const instances = await listVpsByDiscordUserId(interaction.user.id);
      if (instances.length === 0) {
        await interaction.editReply({
          content: "ℹ️ You do not have any active Shark Byte VPS instances currently provisioned.",
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle("🖥️ Your Shark Byte VPS Instances")
        .setColor(0x00a8ff)
        .setDescription(
          instances
            .map(
              (vps) =>
                `• **${vps.hostname}** (#${vps.vpsNumber})\n` +
                `  - Plan: ${vps.planName} (${vps.ramGb}GB RAM / ${vps.vcpu} vCPU / ${vps.storageGb}GB Disk)\n` +
                `  - Status: \`${vps.status.toUpperCase()}\` | Expires: <t:${Math.floor(new Date(vps.expiresAt).getTime() / 1000)}:R>\n` +
                `  - SSH Access: \`ssh -p ${vps.publicSshPort || 22} root@${vps.publicSshHost || "ssh.sharkbyte.com"}\``
            )
            .join("\n\n")
        )
        .setFooter({ text: "Shark Byte • High Performance VPS Hosting" });

      await interaction.editReply({ embeds: [embed] });
    } catch (err: any) {
      await interaction.editReply({ content: `❌ Error fetching VPS list: ${err.message}` });
    }
    return;
  }

  if (subcommand === "nesting") {
    if (!isStaff) {
      await interaction.reply({ content: "❌ Only Staff can modify VPS container nesting features.", flags: 64 });
      return;
    }

    const vpsNumber = interaction.options.getInteger("vps_number", true);
    const stateChoice = interaction.options.getString("state", true);
    const enableNesting = stateChoice === "enable";

    await interaction.deferReply({ flags: 64 });

    try {
      const vps = await getVpsByNumber(vpsNumber);
      if (!vps) {
        await interaction.editReply({ content: `❌ VPS #${vpsNumber} was not found.` });
        return;
      }

      const incus = new IncusProvider();
      await incus.setNesting(vps.providerInstanceId, enableNesting);

      await interaction.editReply({
        content: `✅ Container security nesting for VPS #${vpsNumber} (\`${vps.providerInstanceId}\`) has been **${enableNesting ? "ENABLED" : "DISABLED"}**.`,
      });
    } catch (err: any) {
      await interaction.editReply({ content: `❌ Could not update container nesting: ${err.message}` });
    }
    return;
  }

  if (subcommand === "delete") {
    if (!isStaff) {
      await interaction.reply({ content: "❌ Only Staff can decommission VPS instances.", flags: 64 });
      return;
    }

    const vpsNumber = interaction.options.getInteger("vps_number", true);
    await interaction.deferReply({ flags: 64 });

    try {
      const vps = await getVpsByNumber(vpsNumber);
      if (!vps) {
        await interaction.editReply({ content: `❌ VPS #${vpsNumber} was not found.` });
        return;
      }

      await decommissionVpsInstance(vps.id);
      await interaction.editReply({
        content: `✅ VPS #${vpsNumber} (${vps.hostname}) has been successfully decommissioned.`,
      });
    } catch (err: any) {
      await interaction.editReply({ content: `❌ Could not delete VPS: ${err.message}` });
    }
    return;
  }

  if (subcommand === "status") {
    if (!isStaff) {
      await interaction.reply({ content: "❌ Only Staff can check VPS system status.", flags: 64 });
      return;
    }

    await interaction.deferReply({ flags: 64 });

    try {
      const incus = new IncusProvider();
      const diag = await incus.getDiagnostics();
      const startPort = process.env.SSH_PORT_START ? parseInt(process.env.SSH_PORT_START, 10) : 22100;
      const endPort = process.env.SSH_PORT_END ? parseInt(process.env.SSH_PORT_END, 10) : 22200;
      const totalPorts = endPort - startPort + 1;

      const { getPool } = await import("../config/database");
      const pool = getPool();
      const portRes = await pool.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM vps_instances WHERE status != 'deleted' AND public_ssh_port IS NOT NULL`
      );
      const allocatedPorts = parseInt(portRes.rows[0]?.count || "0", 10);
      const availablePorts = totalPorts - allocatedPorts;

      const embed = new EmbedBuilder()
        .setTitle("🖥️ Shark Byte VPS Infrastructure Diagnostics")
        .setColor(0x00a8ff)
        .addFields(
          { name: "Incus Daemon", value: `\`${diag.incusVersion}\``, inline: true },
          { name: "Default Profile", value: diag.defaultProfileExists ? "🟢 Valid" : "🔴 Missing", inline: true },
          { name: "Configured Image", value: `\`${diag.configuredImageAlias}\` (${diag.imageAvailable ? "🟢 Available" : "🔴 Unavailable"})`, inline: true },
          { name: "Public SSH Gateway Host", value: `\`${process.env.PUBLIC_SSH_HOST || "ssh.mysticservers.com"}\``, inline: true },
          { name: "SSH Port Range", value: `\`${startPort}-${endPort}\``, inline: true },
          { name: "Port Allocation", value: `\`${allocatedPorts} used / ${availablePorts} free\` (Total ${totalPorts})`, inline: true },
          { name: "Active Containers", value: `\`${diag.hostCapacity?.existingContainerCount ?? "Unknown"}\``, inline: true },
          { name: "Available Host RAM", value: diag.hostCapacity ? `\`${(diag.hostCapacity.availableMemoryBytes / 1024 / 1024 / 1024).toFixed(2)} GB / ${(diag.hostCapacity.totalMemoryBytes / 1024 / 1024 / 1024).toFixed(2)} GB\`` : "Unknown", inline: true }
        )
        .setFooter({ text: "Shark Byte • Real-Time Local Incus Node Inspection" })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (err: any) {
      await interaction.editReply({ content: `❌ Diagnostics check failed: ${err.message}` });
    }
    return;
  }
}
