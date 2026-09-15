import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ButtonInteraction,
  EmbedBuilder,
  GuildMember,
  ModalBuilder,
  ModalSubmitInteraction,
  TextChannel,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

import { getTicketById, getTicketCreatedMetadata } from "../services/ticketDatabase";
import { createPaymentLink, verifyPaymentLinkStatus } from "../services/razorpayService";
import { recordTransaction } from "../services/ledgerService";
import { provisionVpsOrder, provisionMinecraftOrder } from "../services/provisioningService";
import { showOsSelectionScreen } from "./vpsWizardHandler";
import { logBotError } from "../services/loggerService";

function buildTicketControlRow(serviceType: string = "vps"): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket:claim")
      .setLabel("Claim Ticket")
      .setEmoji("👤")
      .setStyle(ButtonStyle.Primary),
    serviceType === "minecraft" || serviceType === "mc"
      ? new ButtonBuilder()
          .setCustomId("minecraft:provision")
          .setLabel("Provision Minecraft Server")
          .setEmoji("🎮")
          .setStyle(ButtonStyle.Success)
      : new ButtonBuilder()
          .setCustomId("vps:provision")
          .setLabel("Provision VPS")
          .setEmoji("🖥️")
          .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("ticket:close")
      .setLabel("Close Ticket")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Danger)
  );
}

function buildOrderConfigEmbed(metadata: any): EmbedBuilder {
  const planName = (metadata?.planName as string) || "Standard Plan";
  const ramGb = metadata?.ramGb ? Number(metadata.ramGb) : null;
  const vcpu = metadata?.vcpu ? Number(metadata.vcpu) : 1;
  const storageGb = metadata?.storageGb ? Number(metadata.storageGb) : 10;
  const priceInr = Number(metadata?.priceInr || 0);
  const priceUsd = Number(metadata?.priceUsd || 0);
  const location = (metadata?.location as string) || "India 🇮🇳";

  const locationEmoji = location.includes("India")
    ? "🇮🇳"
    : location.includes("Singapore")
    ? "🇸🇬"
    : "🇯🇵";

  if (ramGb) {
    return new EmbedBuilder()
      .setTitle("🦈 SHARK BYTE VPS CONFIGURATION")
      .setColor(0x00a8ff)
      .setDescription(
        `${locationEmoji} **Location:** ${location}\n` +
          `📦 **Plan:** ${planName}\n` +
          `💰 **Price:** ₹${priceInr} / $${priceUsd} per month\n\n` +
          `🧠 **RAM:** ${ramGb} GB\n` +
          `💾 **Disk:** ${storageGb} GB NVMe\n` +
          `⚡ **vCore:** ${vcpu} Core(s)\n` +
          `🔑 **Root Access:** Full Root (Sudo)\n` +
          `🌐 **IPv4:** Dedicated Gateway Port + Private Subnet`
      );
  } else {
    return new EmbedBuilder()
      .setTitle("🎮 SHARK BYTE MINECRAFT CONFIGURATION")
      .setColor(0x2ecc71)
      .setDescription(
        `📦 **Plan:** ${planName}\n` +
          `💰 **Price:** ₹${priceInr} / $${priceUsd} per month\n\n` +
          `🧠 **RAM:** ${metadata?.ramGb || 2} GB\n` +
          `💾 **Disk:** ${storageGb} GB\n` +
          `⚡ **CPU Limit:** ${metadata?.cpuPercent || 100}%`
      );
  }
}

export async function handlePaymentButton(interaction: ButtonInteraction): Promise<void> {
  const customId = interaction.customId;

  // 1. Gateway Selection (payment:gateway:razorpay:<ticketId>, payment:gateway:paypal:<ticketId>, etc.)
  if (customId.startsWith("payment:gateway:")) {
    const parts = customId.split(":");
    const gateway = parts[2];
    const ticketId = parts[3];

    if (!ticketId) {
      await interaction.reply({ content: "❌ Missing ticket ID parameter.", flags: 64 });
      return;
    }

    const metadata = await getTicketCreatedMetadata(ticketId);
    if (!metadata) {
      await interaction.reply({ content: "❌ Order metadata was not found for this ticket.", flags: 64 });
      return;
    }

    const configEmbed = buildOrderConfigEmbed(metadata);
    const planName = (metadata.planName as string) || "Standard Plan";
    const priceInr = Number(metadata.priceInr || 0);
    const priceUsd = Number(metadata.priceUsd || 0);
    const serviceType = metadata.ramGb ? "vps" : "minecraft";

    // 1A. Razorpay Payment Link Flow
    if (gateway === "razorpay") {
      await interaction.deferUpdate();
      try {
        const linkResult = await createPaymentLink({
          amountInr: priceInr,
          description: `Shark Byte ${serviceType.toUpperCase()} - ${planName}`,
          customerName: interaction.user.username,
          ticketId,
          planName,
          serviceType,
        });

        const embed = new EmbedBuilder()
          .setTitle("💳 Razorpay Payment Link Generated (INR)")
          .setColor(0x00a8ff)
          .setDescription(
            `Please click the link below to complete your payment of **₹${priceInr} INR** via Razorpay.\n\n` +
              `🔗 **Payment Link:** [Click Here to Pay](${linkResult.shortUrl})\n\n` +
              `After completing your payment on Razorpay, click **Check Payment Status 🔄** below to automatically verify your payment and trigger instant provisioning!`
          )
          .setFooter({ text: linkResult.isMock ? "Simulated Mode • Instant Verification Enabled" : "Razorpay Secure Gateway (INR Only)" });

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setLabel("Pay Now (Razorpay) 💳")
            .setURL(linkResult.shortUrl)
            .setStyle(ButtonStyle.Link),
          new ButtonBuilder()
            .setCustomId(`pay_check:razorpay:${ticketId}:${linkResult.paymentLinkId}`)
            .setLabel("Check Payment Status 🔄")
            .setStyle(ButtonStyle.Success)
        );

        await interaction.editReply({ embeds: [configEmbed, embed], components: [buildTicketControlRow(serviceType), row] });
      } catch (err: any) {
        console.error("❌ Razorpay payment link error:", err);
        await logBotError({
          client: interaction.client,
          guild: interaction.guild!,
          error: err,
          title: "Razorpay Payment Link Error",
          context: "handlePaymentButton:razorpay",
          userTag: interaction.user.tag,
          userId: interaction.user.id,
          channelId: interaction.channelId || undefined,
        }).catch(() => {});
        await interaction.editReply({ content: `❌ Could not generate Razorpay payment link: ${err.message}` });
      }
      return;
    }

    // 1B. PayPal Manual Flow
    if (gateway === "paypal") {
      const paypalEmail = process.env.PAYPAL_EMAIL || "payments@sharkbyte.com";
      const paypalLink = process.env.PAYPAL_ME_URL || "https://paypal.me/sharkbytehost";

      const embed = new EmbedBuilder()
        .setTitle("🅿️ PayPal Manual Payment Instructions")
        .setColor(0x0070ba)
        .setDescription(
          `Please transfer **$${priceUsd} USD** (or ₹${priceInr}) using PayPal:\n\n` +
            `• **PayPal Email:** \`${paypalEmail}\`\n` +
            `• **Direct Link:** [${paypalLink}](${paypalLink})\n` +
            `• **Memo / Note:** Include Ticket ID \`${ticketId.slice(0, 8)}\`\n\n` +
            `Once sent, click **Submit Payment Proof 📤** below to enter your Transaction ID.`
        )
        .setFooter({ text: "Shark Byte Manual Staff Verification" });

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`pay_proof_btn:paypal:${ticketId}`)
          .setLabel("Submit Payment Proof 📤")
          .setStyle(ButtonStyle.Primary)
      );

      await interaction.update({ embeds: [configEmbed, embed], components: [buildTicketControlRow(serviceType), row] });
      return;
    }

    // 1C. Crypto Manual Flow
    if (gateway === "crypto") {
      const usdtAddress = process.env.CRYPTO_USDT_TRC20 || "TSharkByteWalletAddressTRC20";
      const btcAddress = process.env.CRYPTO_BTC_ADDRESS || "bc1qSharkByteBtcAddress";

      const embed = new EmbedBuilder()
        .setTitle("🪙 Crypto Payment Instructions")
        .setColor(0xf39c12)
        .setDescription(
          `Please send **$${priceUsd} USD** equivalent in USDT (TRC-20) or BTC:\n\n` +
            `• **USDT (TRC-20):** \`${usdtAddress}\`\n` +
            `• **BTC:** \`${btcAddress}\`\n` +
            `• **Amount:** $${priceUsd} USD\n\n` +
            `Once transferred, click **Submit Payment Proof 📤** below to submit your transaction hash/ID.`
        )
        .setFooter({ text: "Shark Byte Crypto Direct Gateway" });

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`pay_proof_btn:crypto:${ticketId}`)
          .setLabel("Submit Payment Proof 📤")
          .setStyle(ButtonStyle.Primary)
      );

      await interaction.update({ embeds: [configEmbed, embed], components: [buildTicketControlRow(serviceType), row] });
      return;
    }
  }

  // 2. Check Razorpay Status Click (pay_check:razorpay:<ticketId>:<paymentLinkId>)
  if (customId.startsWith("pay_check:razorpay:")) {
    const parts = customId.split(":");
    const ticketId = parts[2];
    const paymentLinkId = parts[3];

    await interaction.deferUpdate();

    try {
      const statusRes = await verifyPaymentLinkStatus(paymentLinkId);
      if (!statusRes.isPaid) {
        await interaction.followUp({
          content: "⚠️ Payment is still **PENDING** on Razorpay. Please complete payment using the link and try checking again.",
          flags: 64,
        });
        return;
      }

      const metadata = await getTicketCreatedMetadata(ticketId);
      const configEmbed = buildOrderConfigEmbed(metadata);
      const planName = (metadata?.planName as string) || "Standard Plan";
      const priceInr = Number(metadata?.priceInr || statusRes.amountPaidInr || 0);
      const priceUsd = Number(metadata?.priceUsd || 0);
      const serviceType = metadata?.ramGb ? "vps" : "minecraft";

      const dbTicket = await getTicketById(ticketId);

      // Record transaction in ledger table
      await recordTransaction({
        customerId: dbTicket?.customerId,
        ticketId,
        type: "payment",
        gateway: "razorpay",
        gatewayTransactionId: statusRes.paymentId || paymentLinkId,
        amountInr: priceInr,
        amountUsd: priceUsd,
        status: "completed",
        serviceType: serviceType as any,
        planName,
        notes: `Automated Razorpay Instant Capture (Pay ID: ${statusRes.paymentId})`,
        recordedByDiscordId: interaction.user.id,
      });

      const claimRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(serviceType === "vps" ? `claim_vps_btn:${ticketId}` : `claim_mc_btn:${ticketId}`)
          .setLabel(`Claim ${serviceType.toUpperCase()} 🚀`)
          .setStyle(ButtonStyle.Success)
      );

      const successEmbed = new EmbedBuilder()
        .setTitle("✅ Payment Verified & Captured!")
        .setColor(0x2ecc71)
        .setDescription(
          `Payment of **₹${priceInr}** ($${priceUsd}) was verified via Razorpay! (Tx: \`${statusRes.paymentId}\`).\n\n` +
            `🎉 **Your payment is confirmed!** Click **Claim ${serviceType.toUpperCase()} 🚀** below to launch your server and generate credentials.`
        )
        .setFooter({ text: "Shark Byte Automated Financial Ledger" })
        .setTimestamp();

      await interaction.editReply({ embeds: [configEmbed, successEmbed], components: [buildTicketControlRow(serviceType), claimRow] });
    } catch (err: any) {
      console.error("❌ Verification error:", err);
      await logBotError({
        client: interaction.client,
        guild: interaction.guild!,
        error: err,
        title: "Payment Verification Error",
        context: "handlePaymentButton:pay_check",
        userTag: interaction.user.tag,
        userId: interaction.user.id,
        channelId: interaction.channelId || undefined,
      }).catch(() => {});
      await interaction.followUp({ content: `❌ Error checking payment status: ${err.message}`, flags: 64 });
    }
    return;
  }

  // 2b. Customer Claim VPS Button Click (claim_vps_btn:<ticketId>)
  if (customId.startsWith("claim_vps_btn:")) {
    const parts = customId.split(":");
    const ticketId = parts[1];

    console.log(`🚀 [Claim VPS] Button clicked by ${interaction.user.tag} for ticket ${ticketId}`);

    try {
      await showOsSelectionScreen(
        interaction,
        ticketId,
        true,
      );
    } catch (err: any) {
      console.error("❌ VPS Claim OS Wizard Error:", err);
      await logBotError({
        client: interaction.client,
        guild: interaction.guild!,
        error: err,
        title: "Customer VPS Claim Wizard Error",
        context: "claim_vps_btn",
        userTag: interaction.user.tag,
        userId: interaction.user.id,
        channelId: interaction.channelId || undefined,
      }).catch(() => {});

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: `❌ Error launching OS selection wizard: ${err.message}`, flags: 64 });
      } else {
        await interaction.reply({ content: `❌ Error launching OS selection wizard: ${err.message}`, flags: 64 });
      }
    }
    return;
  }

  // 2c. Customer Claim Minecraft Button Click (claim_mc_btn:<ticketId>)
  if (customId.startsWith("claim_mc_btn:")) {
    const parts = customId.split(":");
    const ticketId = parts[1];

    const launchingEmbed = new EmbedBuilder()
      .setTitle("⏳ Provisioning Your Minecraft Server...")
      .setColor(0x3498db)
      .setDescription(
        `🎮 **Minecraft Server Provisioning in progress!**\n\n` +
          `• Allocating server resources\n` +
          `• Creating Pterodactyl panel user & server\n\n` +
          `*Please wait 10-20 seconds. Details will be posted below...*`
      )
      .setTimestamp();

    const launchingRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`claiming_in_progress:${ticketId}`)
        .setLabel("⏳ Provisioning Server...")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true)
    );

    await interaction.update({ embeds: [launchingEmbed], components: [buildTicketControlRow("minecraft"), launchingRow] });

    try {
      const channel = interaction.channel as TextChannel;
      const ownerIdMatch = channel?.topic?.match(/ticket-owner:(\d+)/);
      const metadata = await getTicketCreatedMetadata(ticketId);

      let targetMember = interaction.member as GuildMember;
      if (ownerIdMatch && ownerIdMatch[1] && interaction.guild) {
        targetMember = await interaction.guild.members.fetch(ownerIdMatch[1]).catch(() => targetMember);
      }

      await provisionMinecraftOrder(interaction.guild!, ticketId, targetMember, metadata || {});

      const doneEmbed = new EmbedBuilder()
        .setTitle("🟢 Minecraft Server Provisioned!")
        .setColor(0x2ecc71)
        .setDescription(
          `🎉 **Your Minecraft Server has been successfully created!**\n\n` +
            `Check the panel credentials card posted above in this channel for details.`
        )
        .setTimestamp();

      const doneRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`claimed_done:${ticketId}`)
          .setLabel("Server Active & Provisioned 🟢")
          .setStyle(ButtonStyle.Success)
          .setDisabled(true)
      );

      await interaction.editReply({ embeds: [doneEmbed], components: [buildTicketControlRow("minecraft"), doneRow] });
    } catch (err: any) {
      console.error("❌ Minecraft Claim Error:", err);
      await logBotError({
        client: interaction.client,
        guild: interaction.guild!,
        error: err,
        title: "Customer Minecraft Claim Error",
        context: "claim_mc_btn",
        userTag: interaction.user.tag,
        userId: interaction.user.id,
        channelId: interaction.channelId || undefined,
      }).catch(() => {});

      const errorEmbed = new EmbedBuilder()
        .setTitle("❌ Provisioning Failed")
        .setColor(0xe74c3c)
        .setDescription(`Could not provision Minecraft server: ${err.message}\n\nPlease try again or contact staff.`)
        .setTimestamp();

      const retryRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`claim_mc_btn:${ticketId}`)
          .setLabel("Retry Claiming Minecraft 🚀")
          .setStyle(ButtonStyle.Primary)
      );

      await interaction.editReply({ embeds: [errorEmbed], components: [buildTicketControlRow("minecraft"), retryRow] });
    }
    return;
  }

  // 3. Open Submit Proof Modal Button (pay_proof_btn:<gateway>:<ticketId>)
  if (customId.startsWith("pay_proof_btn:")) {
    const parts = customId.split(":");
    const gateway = parts[1];
    const ticketId = parts[2];

    const modal = new ModalBuilder()
      .setCustomId(`pay_proof_modal:${gateway}:${ticketId}`)
      .setTitle(`Submit ${gateway.toUpperCase()} Payment Proof`);

    const txInput = new TextInputBuilder()
      .setCustomId("tx_ref")
      .setLabel("Transaction ID / Hash / Ref Number")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("e.g. 9876543210 or 0x71a...")
      .setRequired(true);

    const notesInput = new TextInputBuilder()
      .setCustomId("notes")
      .setLabel("Sender Email / Wallet / Notes")
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder("Optional notes for staff verification...")
      .setRequired(false);

    const row1 = new ActionRowBuilder<TextInputBuilder>().addComponents(txInput);
    const row2 = new ActionRowBuilder<TextInputBuilder>().addComponents(notesInput);
    modal.addComponents(row1, row2);

    await interaction.showModal(modal);
    return;
  }

  // 4. Staff Confirm Payment & Provision (staff_confirm_pay:<ticketId>:<gateway>)
  if (customId.startsWith("staff_confirm_pay:")) {
    const parts = customId.split(":");
    const ticketId = parts[1];
    const gateway = parts[2];

    await interaction.deferReply();

    try {
      const metadata = await getTicketCreatedMetadata(ticketId);
      const planName = (metadata?.planName as string) || "Standard Plan";
      const priceInr = Number(metadata?.priceInr || 0);
      const priceUsd = Number(metadata?.priceUsd || 0);
      const serviceType = metadata?.ramGb ? "vps" : "minecraft";

      const dbTicket = await getTicketById(ticketId);

      // Record transaction as confirmed manual payment
      const txRecord = await recordTransaction({
        customerId: dbTicket?.customerId,
        ticketId,
        type: "payment",
        gateway: gateway as any,
        gatewayTransactionId: `manual_${Date.now()}`,
        amountInr: priceInr,
        amountUsd: priceUsd,
        status: "completed",
        serviceType: serviceType as any,
        planName,
        notes: `Staff Approved Manual Payment (${gateway.toUpperCase()}) by ${interaction.user.tag}`,
        recordedByDiscordId: interaction.user.id,
      });

      const claimRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(serviceType === "vps" ? `claim_vps_btn:${ticketId}` : `claim_mc_btn:${ticketId}`)
          .setLabel(`Claim ${serviceType.toUpperCase()} 🚀`)
          .setStyle(ButtonStyle.Success)
      );

      const confirmEmbed = new EmbedBuilder()
        .setTitle("✅ Payment Verified & Recorded in Ledger")
        .setColor(0x2ecc71)
        .setDescription(
          `Staff ${interaction.user} confirmed payment receipt via **${gateway.toUpperCase()}**.\n` +
            `• Transaction Record: **#${txRecord.transactionNumber}**\n` +
            `• Amount: **₹${priceInr} / $${priceUsd}**\n\n` +
            `🎉 **Click Claim ${serviceType.toUpperCase()} 🚀 below to launch your server!**`
        )
        .setTimestamp();

      const channel = interaction.channel as TextChannel;
      if (channel) {
        await channel.send({ embeds: [confirmEmbed], components: [claimRow] });
      }

      await interaction.editReply({ content: "✅ Payment approved! Claim button posted in channel." });
    } catch (err: any) {
      console.error("❌ Staff Payment Confirm Error:", err);
      await logBotError({
        client: interaction.client,
        guild: interaction.guild!,
        error: err,
        title: "Staff Payment Confirmation Error",
        context: "handlePaymentButton:staff_confirm_pay",
        userTag: interaction.user.tag,
        userId: interaction.user.id,
        channelId: interaction.channelId || undefined,
      }).catch(() => {});
      await interaction.editReply({ content: `❌ Could not approve payment: ${err.message}` });
    }
    return;
  }

  // 5. Staff Reject Payment (staff_reject_pay:<ticketId>)
  if (customId.startsWith("staff_reject_pay:")) {
    const channel = interaction.channel as TextChannel;

    const rejectEmbed = new EmbedBuilder()
      .setTitle("❌ Payment Proof Rejected")
      .setColor(0xe74c3c)
      .setDescription(
        `Staff ${interaction.user} reviewed the submitted payment proof and could not verify the transaction.\n\n` +
          `Please double-check your payment details or contact our support team in this ticket.`
      )
      .setTimestamp();

    if (channel) {
      await channel.send({ embeds: [rejectEmbed] });
    }

    await interaction.reply({ content: "❌ Payment proof marked as rejected.", flags: 64 });
    return;
  }
}

export async function handlePaymentModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  const customId = interaction.customId;

  if (customId.startsWith("pay_proof_modal:")) {
    const parts = customId.split(":");
    const gateway = parts[1];
    const ticketId = parts[2];

    const txRef = interaction.fields.getTextInputValue("tx_ref");
    const notes = interaction.fields.getTextInputValue("notes") || "None";

    await interaction.deferReply({ flags: 64 });

    try {
      const channel = interaction.channel as TextChannel;
      const metadata = await getTicketCreatedMetadata(ticketId);
      const planName = (metadata?.planName as string) || "Standard Plan";
      const priceInr = Number(metadata?.priceInr || 0);
      const priceUsd = Number(metadata?.priceUsd || 0);

      const staffEmbed = new EmbedBuilder()
        .setTitle(`📩 Payment Proof Submitted (${gateway.toUpperCase()})`)
        .setColor(0x3498db)
        .addFields(
          { name: "Customer", value: `${interaction.user}`, inline: true },
          { name: "Gateway", value: gateway.toUpperCase(), inline: true },
          { name: "Plan", value: planName, inline: true },
          { name: "Amount", value: `₹${priceInr} / $${priceUsd}`, inline: true },
          { name: "Tx Reference ID", value: `\`${txRef}\``, inline: false },
          { name: "Notes / Sender", value: notes, inline: false }
        )
        .setFooter({ text: "Staff Action Required • Verify receipt in account before clicking Approve" })
        .setTimestamp();

      const staffRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`staff_confirm_pay:${ticketId}:${gateway}`)
          .setLabel("Approve Payment & Provision 🚀")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`staff_reject_pay:${ticketId}`)
          .setLabel("Reject Payment ❌")
          .setStyle(ButtonStyle.Danger)
      );

      if (channel) {
        await channel.send({ embeds: [staffEmbed], components: [staffRow] });
      }

      await interaction.editReply({
        content: `✅ Payment proof for **${gateway.toUpperCase()}** submitted! Staff will verify your transaction shortly.`,
      });
    } catch (err: any) {
      console.error("❌ Payment Proof Modal Submit Error:", err);
      await logBotError({
        client: interaction.client,
        guild: interaction.guild!,
        error: err,
        title: "Payment Proof Submission Error",
        context: "handlePaymentModalSubmit",
        userTag: interaction.user.tag,
        userId: interaction.user.id,
        channelId: interaction.channelId || undefined,
      }).catch(() => {});
      await interaction.editReply({ content: `❌ Could not submit payment proof: ${err.message}` });
    }
    return;
  }
}
