import { ChatInputCommandInteraction, Interaction, PermissionFlagsBits } from "discord.js";
import { handleVpsCommand } from "../commands/vps";
import { handleMinecraftCommand } from "../commands/minecraft";
import { handleTicketCommand } from "../commands/ticket";
import { handleAdminCommand } from "../commands/admin";
import { handleHelpCommand } from "../commands/help";
import { handleTicketButton } from "../handlers/ticketHandler";
import { handlePricingSelectMenu, handleLocationButtonClick } from "../handlers/pricingOrderHandler";
import { handleAutocomplete } from "../handlers/autocompleteHandler";
import { handlePaymentButton, handlePaymentModalSubmit } from "../handlers/paymentHandler";
import {
  handleOsSelectMenu,
  handleVirtualizationSelectMenu,
  handleVirtualizationBack,
  showOsSelectionScreen,
  handleConfirmProvision,
} from "../handlers/vpsWizardHandler";
import { logBotError } from "../services/loggerService";

export async function handleInteraction(interaction: Interaction): Promise<void> {
  try {
    if (interaction.isAutocomplete()) {
      await handleAutocomplete(interaction);
      return;
    }

    if (interaction.isChatInputCommand()) {
      await handleSlashCommand(interaction);
      return;
    }

    if (interaction.isModalSubmit()) {
      await handlePaymentModalSubmit(interaction);
      return;
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === "order_vps_plan" || interaction.customId === "order_mc_plan") {
        await handlePricingSelectMenu(interaction);
        return;
      }

      if (interaction.customId.startsWith("vps:os_select:")) {
        await handleOsSelectMenu(interaction);
        return;
      }

      if (interaction.customId.startsWith("vps:virt_select:")) {
        await handleVirtualizationSelectMenu(interaction);
        return;
      }
    }

    if (interaction.isButton()) {
      if (interaction.customId.startsWith("vps:os_back:")) {
        await showOsSelectionScreen(interaction, interaction.customId.split(":")[2]);
        return;
      }

      if (interaction.customId.startsWith("vps:virt_back:")) {
        await handleVirtualizationBack(interaction);
        return;
      }

      if (interaction.customId.startsWith("vps:provision_start:")) {
        await handleConfirmProvision(interaction);
        return;
      }

      if (
        interaction.customId.startsWith("ticket:") ||
        interaction.customId.startsWith("vps:") ||
        interaction.customId.startsWith("minecraft:")
      ) {
        await handleTicketButton(interaction);
        return;
      }

      if (interaction.customId.startsWith("order_loc:")) {
        await handleLocationButtonClick(interaction);
        return;
      }

      if (
        interaction.customId.startsWith("payment:gateway:") ||
        interaction.customId.startsWith("pay_check:") ||
        interaction.customId.startsWith("pay_proof_btn:") ||
        interaction.customId.startsWith("staff_confirm_pay:") ||
        interaction.customId.startsWith("staff_reject_pay:") ||
        interaction.customId.startsWith("claim_vps_btn:") ||
        interaction.customId.startsWith("claim_mc_btn:")
      ) {
        await handlePaymentButton(interaction);
        return;
      }
    }
  } catch (error) {
    console.error("[Discord] Interaction error:", error);

    const contextName = interaction.isChatInputCommand()
      ? `Slash Command /${interaction.commandName}`
      : interaction.isButton()
        ? `Button ${interaction.customId}`
        : interaction.isStringSelectMenu()
          ? `Select Menu ${interaction.customId}`
          : interaction.isModalSubmit()
            ? `Modal ${interaction.customId}`
            : "Interaction Handler";

    await logBotError({
      guild: interaction.guild || undefined,
      error,
      context: contextName,
      userTag: interaction.user.tag,
      userId: interaction.user.id,
      channelId: interaction.channelId || undefined,
    }).catch(() => {});

    if (interaction.isRepliable()) {
      const msg = "❌ An error occurred while processing your request.";
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: msg, flags: 64 }).catch(() => {});
      } else {
        await interaction.reply({ content: msg, flags: 64 }).catch(() => {});
      }
    }
  }
}

async function handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const supportRoleId = process.env.SUPPORT_ROLE_ID;
  const member = interaction.guild
    ? await interaction.guild.members.fetch(interaction.user.id).catch(() => null)
    : null;

  const isAdministrator = Boolean(member?.permissions.has(PermissionFlagsBits.Administrator));
  const isSupport = Boolean(supportRoleId && member?.roles.cache.has(supportRoleId));
  const isStaff = isAdministrator || isSupport;

  switch (interaction.commandName) {
    case "help":
      await handleHelpCommand(interaction, isStaff, isAdministrator);
      break;
    case "vps":
      await handleVpsCommand(interaction, isStaff);
      break;
    case "minecraft":
      await handleMinecraftCommand(interaction, isStaff);
      break;
    case "ticket":
      await handleTicketCommand(interaction, isStaff);
      break;
    case "admin":
      await handleAdminCommand(interaction, isAdministrator, isStaff);
      break;
  }
}
