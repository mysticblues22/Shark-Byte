import { PoolClient } from "pg";
import { getPool } from "../config/database";

export interface VpsInstanceRecord {
  id: string;
  vpsNumber: number;
  customerId: string;
  ticketId: string;
  planId?: string;
  planName: string;
  location: string;
  priceInr: number;
  priceUsd: number;
  ramGb: number;
  vcpu: number;
  storageGb: number;
  providerInstanceId: string;
  hostname: string;
  instanceName?: string;
  customerVpsSequence?: number;
  publicIpv4?: string;
  privateIpv4?: string;
  ipv6?: string;
  sshUsername: string;
  sshPort: number;
  publicSshHost?: string;
  publicSshPort?: number;
  status: string;
  provisionedByDiscordId: string;
  createdAt?: Date;
  updatedAt?: Date;
  billingCycleMonths: number;
  provisionedAt?: Date;
  expiresAt: Date;
  renewalCount: number;
  osId?: string;
  virtualizationMode?: "standard" | "nested";
  failureReason?: string;
}

export interface CreateVpsInstanceInput {
  customerId: string;
  ticketId?: string;
  planId?: string;
  planName: string;
  location: string;
  priceInr: number;
  priceUsd: number;
  ramGb: number;
  vcpu: number;
  storageGb: number;
  providerInstanceId: string;
  hostname: string;
  instanceName?: string;
  customerVpsSequence?: number;
  publicIpv4?: string;
  privateIpv4?: string;
  ipv6?: string;
  sshUsername: string;
  sshPort: number;
  publicSshHost?: string;
  publicSshPort?: number;
  status?: string;
  provisionedByDiscordId: string;
  billingCycleMonths: number;
  osId: string;
  virtualizationMode: "standard" | "nested";
}

const VPS_SELECT = `
  vps_instances.id,
  vps_instances.vps_number AS "vpsNumber",
  vps_instances.customer_id AS "customerId",
  vps_instances.ticket_id AS "ticketId",
  vps_instances.plan_id AS "planId",
  vps_instances.plan_name AS "planName",
  vps_instances.location,
  vps_instances.price_inr::float AS "priceInr",
  vps_instances.price_usd::float AS "priceUsd",
  vps_instances.ram_gb AS "ramGb",
  vps_instances.vcpu,
  vps_instances.storage_gb AS "storageGb",
  vps_instances.provider_instance_id AS "providerInstanceId",
  vps_instances.hostname,
  vps_instances.instance_name AS "instanceName",
  vps_instances.customer_vps_sequence AS "customerVpsSequence",
  vps_instances.public_ipv4::text AS "publicIpv4",
  vps_instances.private_ipv4::text AS "privateIpv4",
  vps_instances.ipv6::text AS "ipv6",
  vps_instances.ssh_username AS "sshUsername",
  vps_instances.ssh_port AS "sshPort",
  vps_instances.public_ssh_host AS "publicSshHost",
  vps_instances.public_ssh_port AS "publicSshPort",
  vps_instances.status,
  vps_instances.provisioned_by_discord_id AS "provisionedByDiscordId",
  vps_instances.billing_cycle_months AS "billingCycleMonths",
  vps_instances.provisioned_at AS "provisionedAt",
  vps_instances.expires_at AS "expiresAt",
  vps_instances.renewal_count AS "renewalCount",
  vps_instances.os_id AS "osId",
  vps_instances.virtualization_mode AS "virtualizationMode",
  vps_instances.failure_reason AS "failureReason",
  vps_instances.created_at AS "createdAt",
  vps_instances.updated_at AS "updatedAt"
`;

function normalizeVpsRecord(record: VpsInstanceRecord): VpsInstanceRecord {
  const vpsNumber = Number(record.vpsNumber);
  if (!Number.isSafeInteger(vpsNumber) || vpsNumber < 1) {
    throw new Error(`Invalid VPS number: ${String(record.vpsNumber)}`);
  }
  return { ...record, vpsNumber };
}

export async function allocatePrivateIpv4(client?: PoolClient): Promise<string> {
  const runner = client || getPool();
  const result = await runner.query<{ privateIpv4: string }>(
    `SELECT private_ipv4::text AS "privateIpv4"
     FROM vps_instances
     WHERE status != 'deleted' AND private_ipv4 IS NOT NULL`
  );

  const usedIps = new Set(result.rows.map((r) => r.privateIpv4));
  const subnetPrefix = process.env.VPS_PRIVATE_SUBNET_PREFIX?.trim() || "10.0.4";

  for (let hostNum = 10; hostNum <= 250; hostNum++) {
    const candidateIp = `${subnetPrefix}.${hostNum}`;
    if (!usedIps.has(candidateIp)) {
      return candidateIp;
    }
  }

  throw new Error(`No available private IPv4 addresses in subnet ${subnetPrefix}.0/24.`);
}

export async function allocatePublicSshPort(client?: PoolClient): Promise<{ publicSshHost: string; publicSshPort: number }> {
  const runner = client || getPool();
  const startPort = process.env.SSH_PORT_START ? parseInt(process.env.SSH_PORT_START, 10) : 22100;
  const endPort = process.env.SSH_PORT_END ? parseInt(process.env.SSH_PORT_END, 10) : 22200;

  const result = await runner.query<{ publicSshPort: number }>(
    `SELECT public_ssh_port AS "publicSshPort"
     FROM vps_instances
     WHERE status != 'deleted' AND public_ssh_port IS NOT NULL
     FOR UPDATE`
  );

  const usedPorts = new Set(result.rows.map((r) => Number(r.publicSshPort)));
  const defaultHost = process.env.PUBLIC_SSH_HOST?.trim() || "ssh.mysticservers.com";

  for (let port = startPort; port <= endPort; port++) {
    if (!usedPorts.has(port)) {
      return {
        publicSshHost: defaultHost,
        publicSshPort: port,
      };
    }
  }

  throw new Error(`No available public SSH ports in range ${startPort}-${endPort}.`);
}

export async function getVpsByTicketId(ticketId: string): Promise<VpsInstanceRecord | null> {
  const pool = getPool();
  const result = await pool.query<VpsInstanceRecord>(
    `SELECT ${VPS_SELECT} FROM vps_instances WHERE ticket_id = $1 LIMIT 1`,
    [ticketId]
  );
  return result.rows[0] ? normalizeVpsRecord(result.rows[0]) : null;
}

export async function getVpsByNumber(vpsNumber: number): Promise<VpsInstanceRecord | null> {
  const pool = getPool();
  const result = await pool.query<VpsInstanceRecord>(
    `SELECT ${VPS_SELECT} FROM vps_instances WHERE vps_number = $1 LIMIT 1`,
    [vpsNumber]
  );
  return result.rows[0] ? normalizeVpsRecord(result.rows[0]) : null;
}

export async function getVpsById(vpsId: string): Promise<VpsInstanceRecord | null> {
  const pool = getPool();
  const result = await pool.query<VpsInstanceRecord>(
    `SELECT ${VPS_SELECT} FROM vps_instances WHERE id = $1 LIMIT 1`,
    [vpsId]
  );
  return result.rows[0] ? normalizeVpsRecord(result.rows[0]) : null;
}

export async function listVpsInstances(): Promise<VpsInstanceRecord[]> {
  const pool = getPool();
  const result = await pool.query<VpsInstanceRecord>(
    `SELECT ${VPS_SELECT} FROM vps_instances ORDER BY expires_at ASC`
  );
  return result.rows.map(normalizeVpsRecord);
}

export async function listVpsByDiscordUserId(discordUserId: string): Promise<VpsInstanceRecord[]> {
  const pool = getPool();
  const result = await pool.query<VpsInstanceRecord>(
    `SELECT ${VPS_SELECT}
     FROM vps_instances
     INNER JOIN customers ON customers.id = vps_instances.customer_id
     WHERE customers.discord_user_id = $1
     ORDER BY vps_instances.created_at DESC`,
    [discordUserId]
  );
  return result.rows.map(normalizeVpsRecord);
}

export async function updateVpsStatus(
  vpsId: string,
  status: string,
  extra?: { privateIpv4?: string; publicSshPort?: number; failureReason?: string }
): Promise<VpsInstanceRecord | null> {
  const pool = getPool();
  const setClauses = ["status = $2", "updated_at = NOW()"];
  const params: any[] = [vpsId, status];

  if (extra?.privateIpv4) {
    params.push(extra.privateIpv4);
    setClauses.push(`private_ipv4 = $${params.length}::inet`);
  }
  if (extra?.publicSshPort) {
    params.push(extra.publicSshPort);
    setClauses.push(`public_ssh_port = $${params.length}`);
  }
  if (extra?.failureReason) {
    params.push(extra.failureReason.slice(0, 4000));
    setClauses.push(`failure_reason = $${params.length}`);
  }

  const result = await pool.query<VpsInstanceRecord>(
    `UPDATE vps_instances SET ${setClauses.join(", ")} WHERE id = $1 RETURNING ${VPS_SELECT}`,
    params
  );
  return result.rows[0] ? normalizeVpsRecord(result.rows[0]) : null;
}

export async function lockAndInitializeVpsProvisioning(
  input: CreateVpsInstanceInput,
  attempt: number = 1
): Promise<VpsInstanceRecord> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    if (input.ticketId) {
      const checkRes = await client.query<VpsInstanceRecord>(
        `SELECT ${VPS_SELECT} FROM vps_instances WHERE ticket_id = $1 FOR UPDATE`,
        [input.ticketId]
      );
      const existing = checkRes.rows[0] ? normalizeVpsRecord(checkRes.rows[0]) : null;

      if (existing) {
        if (existing.status === "active") {
          await client.query("COMMIT");
          return existing;
        }
        if (["allocating", "launching", "configuring", "networking", "ssh_configuring", "verifying"].includes(existing.status)) {
          await client.query("ROLLBACK");
          throw new Error(`⌛ VPS provisioning is currently in progress for this ticket (Status: ${existing.status.toUpperCase()}). Please wait.`);
        }
      }
    }

    const allocated = await allocatePublicSshPort(client);
    const publicSshHost = input.publicSshHost?.trim() || allocated.publicSshHost;
    const publicSshPort = input.publicSshPort || allocated.publicSshPort;
    const privateIpv4 = input.privateIpv4 || (await allocatePrivateIpv4(client));

    const insertRes = await client.query<VpsInstanceRecord>(
      `
      INSERT INTO vps_instances (
        customer_id, ticket_id, plan_id, plan_name, location, price_inr, price_usd,
        ram_gb, vcpu, storage_gb, provider_instance_id, hostname, instance_name,
        customer_vps_sequence, public_ipv4, private_ipv4, ipv6, ssh_username, ssh_port,
        public_ssh_host, public_ssh_port, status, provisioned_by_discord_id, billing_cycle_months,
        os_id, virtualization_mode, failure_reason, provisioned_at, expires_at, renewal_count
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
        $15::inet, $16::inet, $17::inet, $18, $19, $20, $21, 'allocating', $22, $23::integer,
        $24, $25, NULL, NOW(), NOW() + make_interval(months => $23::integer), 0
      )
      ON CONFLICT (ticket_id) DO UPDATE SET
        status = 'allocating',
        public_ssh_port = EXCLUDED.public_ssh_port,
        private_ipv4 = EXCLUDED.private_ipv4,
        updated_at = NOW()
      RETURNING ${VPS_SELECT}
      `,
      [
        input.customerId,
        input.ticketId ?? null,
        input.planId ?? null,
        input.planName,
        input.location,
        input.priceInr,
        input.priceUsd,
        input.ramGb,
        input.vcpu,
        input.storageGb,
        input.providerInstanceId,
        input.hostname,
        input.instanceName ?? input.providerInstanceId,
        input.customerVpsSequence ?? null,
        input.publicIpv4 ?? null,
        privateIpv4,
        input.ipv6 ?? null,
        input.sshUsername,
        input.sshPort,
        publicSshHost,
        publicSshPort,
        input.provisionedByDiscordId,
        input.billingCycleMonths,
        input.osId,
        input.virtualizationMode,
      ]
    );

    const record = normalizeVpsRecord(insertRes.rows[0]);
    await client.query("COMMIT");
    return record;
  } catch (error: any) {
    await client.query("ROLLBACK").catch(() => {});
    if (error.code === "23505" && attempt < 3) {
      console.warn(`⚠️ PostgreSQL unique port collision (23505) encountered on attempt ${attempt}, retrying allocation...`);
      client.release();
      return lockAndInitializeVpsProvisioning(input, attempt + 1);
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function createVpsInstance(input: CreateVpsInstanceInput, client?: PoolClient): Promise<VpsInstanceRecord> {
  const runner = client ?? getPool();
  const publicSshHost = input.publicSshHost?.trim() || process.env.PUBLIC_SSH_HOST?.trim() || "ssh.mysticservers.com";

  let publicSshPort = input.publicSshPort;
  if (!publicSshPort) {
    const allocated = await allocatePublicSshPort(client);
    publicSshPort = allocated.publicSshPort;
  }

  let privateIpv4 = input.privateIpv4;
  if (!privateIpv4) {
    privateIpv4 = await allocatePrivateIpv4(client);
  }

  const status = input.status || "active";

  const result = await runner.query<VpsInstanceRecord>(
    `
    INSERT INTO vps_instances (
      customer_id, ticket_id, plan_id, plan_name, location, price_inr, price_usd,
      ram_gb, vcpu, storage_gb, provider_instance_id, hostname, instance_name,
      customer_vps_sequence, public_ipv4, private_ipv4, ipv6, ssh_username, ssh_port,
      public_ssh_host, public_ssh_port, status, provisioned_by_discord_id, billing_cycle_months,
      os_id, virtualization_mode, failure_reason, provisioned_at, expires_at, renewal_count
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
      $15::inet, $16::inet, $17::inet, $18, $19, $20, $21, $24, $22, $23::integer,
      $25, $26, NULL, NOW(), NOW() + make_interval(months => $23::integer), 0
    )
    RETURNING ${VPS_SELECT}
    `,
    [
      input.customerId,
      input.ticketId ?? null,
      input.planId ?? null,
      input.planName,
      input.location,
      input.priceInr,
      input.priceUsd,
      input.ramGb,
      input.vcpu,
      input.storageGb,
      input.providerInstanceId,
      input.hostname,
      input.instanceName ?? input.providerInstanceId,
      input.customerVpsSequence ?? null,
      input.publicIpv4 ?? null,
      privateIpv4,
      input.ipv6 ?? null,
      input.sshUsername,
      input.sshPort,
      publicSshHost,
      publicSshPort,
      input.provisionedByDiscordId,
      input.billingCycleMonths,
      status,
      input.osId,
      input.virtualizationMode,
    ]
  );

  return normalizeVpsRecord(result.rows[0]);
}

export async function decommissionVpsInstance(id: string): Promise<VpsInstanceRecord | null> {
  const pool = getPool();
  const result = await pool.query<VpsInstanceRecord>(
    `UPDATE vps_instances SET status = 'deleted', updated_at = NOW() WHERE id = $1 AND status != 'deleted' RETURNING ${VPS_SELECT}`,
    [id]
  );
  return result.rows[0] ? normalizeVpsRecord(result.rows[0]) : null;
}
