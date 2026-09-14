export interface PterodactylUser {
  id: number;
  external_id: string | null;
  uuid: string;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  created_at: string;
  updated_at: string;
}

export interface PterodactylAllocation {
  id: number;
  ip: string;
  alias: string | null;
  port: number;
  notes: string | null;
  assigned: boolean;
}

export interface PterodactylServer {
  id: number;
  external_id: string | null;
  uuid: string;
  identifier: string;
  name: string;
  user: number;
  node: number;
  allocation: number;
  status: string | null;
}

export interface CreatePterodactylUserInput {
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  password?: string;
}

export interface CreatePterodactylServerInput {
  name: string;
  userId: number;
  ramMb: number;
  cpuLimit: number;
  storageMb: number;
  allocationId: number;
  eggId?: number;
  nestId?: number;
  dockerImage?: string;
  startupCommand?: string;
  environment?: Record<string, string>;
}

export class PterodactylProvider {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly defaultNodeId: number;
  private readonly defaultAllocationIp: string;
  private readonly defaultNestId: number;
  private readonly defaultEggId: number;

  constructor() {
    const rawUrl = process.env.PTERODACTYL_URL?.trim() || "https://panel.sharkbyte.com";
    this.baseUrl = rawUrl.replace(/\/+$/, "");

    const token = process.env.PTERODACTYL_API_TOKEN?.trim() || process.env.PTERODACTYL_API_KEY?.trim();
    this.apiKey = token || "";

    this.defaultNodeId = Number(process.env.PTERODACTYL_NODE_ID || 1);
    this.defaultAllocationIp = process.env.PTERODACTYL_ALLOCATION_IP?.trim() || "10.0.3.1";
    this.defaultNestId = Number(process.env.PTERODACTYL_MINECRAFT_NEST_ID || 1);
    this.defaultEggId = Number(process.env.PTERODACTYL_MINECRAFT_EGG_ID || 1);
  }

  private get headers(): Record<string, string> {
    if (!this.apiKey) {
      throw new Error("❌ Missing PTERODACTYL_API_TOKEN / PTERODACTYL_API_KEY in environment variables.");
    }
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      Accept: "Application/vnd.pterodactyl.v1+json",
    };
  }

  private async handleResponseError(action: string, response: Response): Promise<never> {
    const status = response.status;
    const body = await response.text().catch(() => "");
    throw new Error(`Pterodactyl ${action} failed (${status}): ${body}`);
  }

  public async findUserByEmail(email: string): Promise<PterodactylUser | null> {
    const url = `${this.baseUrl}/api/application/users?filter[email]=${encodeURIComponent(email)}`;
    const response = await fetch(url, { headers: this.headers });
    if (!response.ok) await this.handleResponseError("user search by email", response);
    const data = (await response.json()) as { data: Array<{ attributes: PterodactylUser }> };
    return data.data?.[0]?.attributes ?? null;
  }

  public async createUser(input: CreatePterodactylUserInput): Promise<PterodactylUser> {
    const url = `${this.baseUrl}/api/application/users`;
    const payload = {
      username: input.username,
      email: input.email,
      first_name: input.firstName || input.username,
      last_name: input.lastName || "Customer",
      password: input.password,
    };

    const response = await fetch(url, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) await this.handleResponseError("user creation", response);
    const data = (await response.json()) as { attributes: PterodactylUser };
    return data.attributes;
  }

  public async listAllocations(nodeId?: number): Promise<PterodactylAllocation[]> {
    const targetNode = nodeId || this.defaultNodeId;
    const url = `${this.baseUrl}/api/application/nodes/${targetNode}/allocations?per_page=100`;
    const response = await fetch(url, { headers: this.headers });

    if (!response.ok) await this.handleResponseError("allocation list", response);
    const data = (await response.json()) as { data: Array<{ attributes: PterodactylAllocation }> };
    return (data.data || []).map((item) => item.attributes);
  }

  public async findAvailableAllocation(nodeId?: number, targetIp?: string): Promise<PterodactylAllocation> {
    const targetNode = nodeId || this.defaultNodeId;
    const targetAllocationIp = targetIp || this.defaultAllocationIp;
    const allocations = await this.listAllocations(targetNode);

    const available = allocations.find(
      (alloc) => !alloc.assigned && alloc.ip === targetAllocationIp
    ) || allocations.find((alloc) => !alloc.assigned);

    if (!available) {
      throw new Error(`No available unassigned allocations found on Pterodactyl node ${targetNode}.`);
    }

    return available;
  }

  public async createServer(input: CreatePterodactylServerInput): Promise<PterodactylServer> {
    const url = `${this.baseUrl}/api/application/servers`;
    const eggId = input.eggId || this.defaultEggId;
    const nestId = input.nestId || this.defaultNestId;

    const payload = {
      name: input.name,
      user: input.userId,
      nest: nestId,
      egg: eggId,
      docker_image: input.dockerImage || process.env.PTERODACTYL_DOCKER_IMAGE?.trim() || "ghcr.io/pterodactyl/yolks:java_25",
      startup: input.startupCommand || process.env.PTERODACTYL_STARTUP_COMMAND?.trim() || "java -Xms128M -XX:MaxRAMPercentage=95.0 -jar {{SERVER_JARFILE}}",
      environment: input.environment || {
        MINECRAFT_VERSION: "latest",
        SERVER_JARFILE: "paper.jar",
        BUILD_NUMBER: "latest",
      },
      limits: {
        memory: input.ramMb,
        swap: 0,
        disk: input.storageMb,
        io: 500,
        cpu: input.cpuLimit,
      },
      feature_limits: {
        databases: 0,
        allocations: 1,
        backups: 1,
      },
      allocation: {
        default: input.allocationId,
      },
    };

    const response = await fetch(url, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) await this.handleResponseError("server creation", response);
    const data = (await response.json()) as { attributes: PterodactylServer };
    return data.attributes;
  }
}
