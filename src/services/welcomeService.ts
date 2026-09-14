import { GuildMember } from "discord.js";

export async function handleGuildMemberAdd(member: GuildMember): Promise<void> {
  try {
    await member.guild.roles.fetch().catch(() => {});
    const autoRoleId = process.env.AUTO_MEMBER_ROLE_ID || process.env.AUTO_ROLE_ID;
    let targetRole = autoRoleId ? member.guild.roles.cache.get(autoRoleId) : null;

    if (!targetRole) {
      targetRole =
        member.guild.roles.cache.find((r) => {
          const cleanName = r.name.replace(/[^a-zA-Z]/g, "").toLowerCase();
          return cleanName === "member" || cleanName === "customer" || cleanName.includes("member");
        }) || null;
    }

    if (targetRole) {
      await member.roles.add(targetRole).catch((err) => {
        console.error(`❌ [Auto-Role] Failed to assign role ${targetRole?.name} to ${member.user.tag}:`, err);
      });
      console.log(`✅ [Auto-Role] Granted "${targetRole.name}" role to new member ${member.user.tag}`);
    } else {
      console.warn(`⚠️ [Auto-Role] No role matching "Member" or "Customer" found in guild ${member.guild.name}.`);
    }
  } catch (err) {
    console.error("❌ Failed to grant auto-role on member join:", err);
  }
}
