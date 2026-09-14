import { PoolClient } from "pg";
import { getPool } from "../config/database";

export interface CustomerRecord {
  id: string;
  discordUserId: string;
  username?: string;
  displayName?: string;
  vpsSequenceCounter?: number;
  pterodactylUserId?: number;
  minecraftSequenceCounter?: number;
}

export interface TicketRecord {
  id: string;
  ticketNumber: number;
  customerId: string;
  department: string;
  status: string;
  discordGuildId?: string;
  discordChannelId?: string;
  claimedByDiscordId?: string;
  createdAt?: Date;
  claimedAt?: Date;
  closedAt?: Date;
}

export async function getOrCreateCustomer(
  discordUserId: string,
  username: string,
  displayName: string,
  client?: PoolClient
): Promise<CustomerRecord> {
  const runner = client ?? getPool();
  const result = await runner.query<CustomerRecord>(
    `
    INSERT INTO customers (
      discord_user_id,
      username,
      display_name
    )
    VALUES ($1, $2, $3)
    ON CONFLICT (discord_user_id)
    DO UPDATE SET
      username = EXCLUDED.username,
      display_name = EXCLUDED.display_name,
      updated_at = NOW()
    RETURNING
      id,
      discord_user_id AS "discordUserId",
      username,
      display_name AS "displayName",
      vps_sequence_counter AS "vpsSequenceCounter",
      pterodactyl_user_id AS "pterodactylUserId",
      minecraft_sequence_counter AS "minecraftSequenceCounter"
    `,
    [discordUserId, username, displayName]
  );

  return result.rows[0];
}

export async function getCustomerById(customerId: string): Promise<CustomerRecord | null> {
  const pool = getPool();
  const result = await pool.query<CustomerRecord>(
    `
    SELECT
      id,
      discord_user_id AS "discordUserId",
      username,
      display_name AS "displayName",
      vps_sequence_counter AS "vpsSequenceCounter",
      pterodactyl_user_id AS "pterodactylUserId",
      minecraft_sequence_counter AS "minecraftSequenceCounter"
    FROM customers
    WHERE id = $1
    LIMIT 1
    `,
    [customerId]
  );

  return result.rows[0] ?? null;
}

export async function createDatabaseTicket(
  customerId: string,
  guildId: string,
  department: string
): Promise<TicketRecord> {
  const pool = getPool();
  const result = await pool.query<TicketRecord>(
    `
    INSERT INTO tickets (
      customer_id,
      discord_guild_id,
      department
    )
    VALUES ($1, $2, $3)
    RETURNING
      id,
      ticket_number AS "ticketNumber",
      customer_id AS "customerId",
      department,
      status,
      discord_guild_id AS "discordGuildId"
    `,
    [customerId, guildId, department]
  );

  return result.rows[0];
}

export async function setTicketChannel(ticketId: string, channelId: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    `
    UPDATE tickets
    SET discord_channel_id = $1
    WHERE id = $2
    `,
    [channelId, ticketId]
  );
}

export async function getTicketById(ticketId: string): Promise<TicketRecord | null> {
  const pool = getPool();
  const result = await pool.query<TicketRecord>(
    `
    SELECT
      id,
      ticket_number AS "ticketNumber",
      customer_id AS "customerId",
      department,
      status,
      discord_guild_id AS "discordGuildId",
      discord_channel_id AS "discordChannelId",
      claimed_by_discord_id AS "claimedByDiscordId",
      created_at AS "createdAt",
      claimed_at AS "claimedAt",
      closed_at AS "closedAt"
    FROM tickets
    WHERE id = $1
    LIMIT 1
    `,
    [ticketId]
  );

  return result.rows[0] ?? null;
}

export async function claimDatabaseTicket(ticketId: string, staffDiscordId: string): Promise<TicketRecord> {
  const pool = getPool();
  const result = await pool.query<TicketRecord>(
    `
    UPDATE tickets
    SET
      status = 'claimed',
      claimed_by_discord_id = $1,
      claimed_at = NOW()
    WHERE id = $2
      AND status = 'open'
    RETURNING
      id,
      ticket_number AS "ticketNumber",
      customer_id AS "customerId",
      department,
      status,
      discord_guild_id AS "discordGuildId",
      discord_channel_id AS "discordChannelId",
      claimed_by_discord_id AS "claimedByDiscordId",
      created_at AS "createdAt",
      claimed_at AS "claimedAt",
      closed_at AS "closedAt"
    `,
    [staffDiscordId, ticketId]
  );

  if (result.rowCount === 0) {
    throw new Error("Ticket is already claimed, closed, or does not exist.");
  }

  await recordTicketEvent(ticketId, "claimed", staffDiscordId, {
    ticketNumber: result.rows[0].ticketNumber,
  });

  return result.rows[0];
}

export async function closeDatabaseTicket(ticketId: string, staffDiscordId: string): Promise<TicketRecord> {
  const pool = getPool();
  const result = await pool.query<TicketRecord>(
    `
    UPDATE tickets
    SET
      status = 'closed',
      closed_at = NOW()
    WHERE id = $1
      AND status != 'closed'
    RETURNING
      id,
      ticket_number AS "ticketNumber",
      customer_id AS "customerId",
      department,
      status,
      discord_guild_id AS "discordGuildId",
      discord_channel_id AS "discordChannelId",
      claimed_by_discord_id AS "claimedByDiscordId",
      created_at AS "createdAt",
      claimed_at AS "claimedAt",
      closed_at AS "closedAt"
    `,
    [ticketId]
  );

  if (result.rowCount === 0) {
    throw new Error("Ticket is already closed or does not exist.");
  }

  await recordTicketEvent(ticketId, "closed", staffDiscordId, {
    ticketNumber: result.rows[0].ticketNumber,
  });

  return result.rows[0];
}

export async function recordTicketEvent(
  ticketId: string,
  eventType: string,
  actorDiscordId: string | null,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `
    INSERT INTO ticket_events (
      ticket_id,
      event_type,
      actor_discord_id,
      metadata
    )
    VALUES ($1, $2, $3, $4)
    `,
    [ticketId, eventType, actorDiscordId, JSON.stringify(metadata)]
  );
}

export async function getTicketCreatedMetadata(ticketId: string): Promise<Record<string, unknown> | null> {
  const pool = getPool();
  const result = await pool.query<{ metadata: Record<string, unknown> }>(
    `
    SELECT metadata
    FROM ticket_events
    WHERE ticket_id = $1
      AND event_type = 'created'
    ORDER BY created_at ASC
    LIMIT 1
    `,
    [ticketId]
  );

  return result.rows[0]?.metadata ?? null;
}

export async function deleteDatabaseTicket(ticketId: string): Promise<void> {
  const pool = getPool();
  await pool.query(`DELETE FROM tickets WHERE id = $1`, [ticketId]);
}
