import "dotenv/config";

export interface AppEnv {
  DISCORD_TOKEN: string;
  CLIENT_ID: string;
  GUILD_ID: string;
  MODERATION_LOG_CHANNEL_ID?: string;
  DATABASE_URL?: string;
  VPS_NODE_HOST?: string;
  VPS_NODE_SSH_USER?: string;
  VPS_NODE_SSH_PORT?: number;
  VPS_NODE_SSH_KEY_PATH?: string;
  VPS_LXC_TEMPLATE_DISTRIBUTION?: string;
  VPS_LXC_TEMPLATE_RELEASE?: string;
  VPS_LXC_TEMPLATE_ARCHITECTURE?: string;
  VPS_LXC_BRIDGE?: string;
  VPS_LXC_STARTUP_TIMEOUT_SECONDS?: number;
  PTERODACTYL_URL?: string;
  PTERODACTYL_API_KEY?: string;
  RAZORPAY_KEY_ID?: string;
  RAZORPAY_KEY_SECRET?: string;
  PUBLIC_SSH_HOST?: string;
  SSH_PORT_START?: number;
  SSH_PORT_END?: number;
  VPS_INCUS_IMAGE_ALIAS?: string;
  VPS_INCUS_STORAGE_POOL?: string;
}

export function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`❌ Missing required environment variable: ${name}`);
  }
  return value;
}

export function getOptionalEnv(name: string, fallback: string = ""): string {
  return process.env[name] || fallback;
}

export const env: AppEnv = {
  DISCORD_TOKEN: process.env.DISCORD_TOKEN || "",
  CLIENT_ID: process.env.CLIENT_ID || "",
  GUILD_ID: process.env.GUILD_ID || "",
  MODERATION_LOG_CHANNEL_ID: process.env.MODERATION_LOG_CHANNEL_ID,
  DATABASE_URL: process.env.DATABASE_URL,
  VPS_NODE_HOST: process.env.VPS_NODE_HOST || "100.77.142.52",
  VPS_NODE_SSH_USER: process.env.VPS_NODE_SSH_USER || "root",
  VPS_NODE_SSH_PORT: process.env.VPS_NODE_SSH_PORT ? parseInt(process.env.VPS_NODE_SSH_PORT, 10) : 22,
  VPS_NODE_SSH_KEY_PATH: process.env.VPS_NODE_SSH_KEY_PATH || "./shark_vps_key",
  VPS_LXC_TEMPLATE_DISTRIBUTION: process.env.VPS_LXC_TEMPLATE_DISTRIBUTION || "ubuntu",
  VPS_LXC_TEMPLATE_RELEASE: process.env.VPS_LXC_TEMPLATE_RELEASE || "jammy",
  VPS_LXC_TEMPLATE_ARCHITECTURE: process.env.VPS_LXC_TEMPLATE_ARCHITECTURE || "amd64",
  VPS_LXC_BRIDGE: process.env.VPS_LXC_BRIDGE || "incusbr1",
  VPS_LXC_STARTUP_TIMEOUT_SECONDS: process.env.VPS_LXC_STARTUP_TIMEOUT_SECONDS
    ? parseInt(process.env.VPS_LXC_STARTUP_TIMEOUT_SECONDS, 10)
    : 90,
  PTERODACTYL_URL: process.env.PTERODACTYL_URL,
  PTERODACTYL_API_KEY: process.env.PTERODACTYL_API_KEY,
  RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID,
  RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET,
  PUBLIC_SSH_HOST: process.env.PUBLIC_SSH_HOST || "ssh.mysticservers.com",
  SSH_PORT_START: process.env.SSH_PORT_START ? parseInt(process.env.SSH_PORT_START, 10) : 22100,
  SSH_PORT_END: process.env.SSH_PORT_END ? parseInt(process.env.SSH_PORT_END, 10) : 22200,
  VPS_INCUS_IMAGE_ALIAS: process.env.VPS_INCUS_IMAGE_ALIAS || "24.04",
  VPS_INCUS_STORAGE_POOL: process.env.VPS_INCUS_STORAGE_POOL || "default",
};
