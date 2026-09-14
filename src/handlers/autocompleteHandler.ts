import { AutocompleteInteraction } from "discord.js";
import { getHostingNodes, getPricingPlans } from "../services/pricingService";

export async function handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const commandName = interaction.commandName;

  if (commandName === "admin") {
    const focusedOption = interaction.options.getFocused(true);
    const subGroup = interaction.options.getSubcommandGroup(false);

    if (subGroup === "plan" && focusedOption.name === "plan") {
      try {
        const plans = await getPricingPlans(undefined, true);
        const queryStr = focusedOption.value.toLowerCase();
        const filtered = plans.filter(
          (p) =>
            p.name.toLowerCase().includes(queryStr) ||
            p.category.toLowerCase().includes(queryStr) ||
            p.id.toLowerCase().includes(queryStr)
        );

        await interaction.respond(
          filtered.slice(0, 25).map((p) => ({
            name: `${p.name} (${p.category.toUpperCase()} - ${p.ramGb}GB RAM / ${p.storageGb}GB Disk - ₹${p.priceInr} / $${p.priceUsd})${p.isActive ? "" : " [DISABLED]"}`,
            value: p.id,
          }))
        );
      } catch (err) {
        console.error("❌ Autocomplete error for plan:", err);
        await interaction.respond([]).catch(() => {});
      }
      return;
    }

    if (subGroup === "location" && focusedOption.name === "location") {
      try {
        const nodes = await getHostingNodes(undefined, true);
        const queryStr = focusedOption.value.toLowerCase();
        const filtered = nodes.filter(
          (n) =>
            n.displayName.toLowerCase().includes(queryStr) ||
            n.locationName.toLowerCase().includes(queryStr) ||
            n.hostname.toLowerCase().includes(queryStr) ||
            n.id.toLowerCase().includes(queryStr)
        );

        await interaction.respond(
          filtered.slice(0, 25).map((n) => ({
            name: `${n.displayName} (${n.hostname})${n.isActive ? "" : " [DISABLED]"}`,
            value: n.id,
          }))
        );
      } catch (err) {
        console.error("❌ Autocomplete error for location:", err);
        await interaction.respond([]).catch(() => {});
      }
      return;
    }
  }
}
