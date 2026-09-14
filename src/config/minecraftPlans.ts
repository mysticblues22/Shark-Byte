export interface MinecraftPlan {
  id: string;
  name: string;
  ramGb: number;
  cpuPercent: number;
  storageGb: number;
  priceInr: number;
  priceUsd: number;
}

export const MINECRAFT_PLANS: Record<string, MinecraftPlan> = {
  starter: {
    id: "starter",
    name: "Starter Minecraft",
    ramGb: 2,
    cpuPercent: 100,
    storageGb: 10,
    priceInr: 199,
    priceUsd: 2.5,
  },
  pro: {
    id: "pro",
    name: "Pro Minecraft",
    ramGb: 4,
    cpuPercent: 200,
    storageGb: 20,
    priceInr: 399,
    priceUsd: 5.0,
  },
  ultimate: {
    id: "ultimate",
    name: "Ultimate Minecraft",
    ramGb: 8,
    cpuPercent: 400,
    storageGb: 40,
    priceInr: 799,
    priceUsd: 10.0,
  },
};

export function getMinecraftPlanById(id: string): MinecraftPlan | undefined {
  return MINECRAFT_PLANS[id.toLowerCase()];
}
