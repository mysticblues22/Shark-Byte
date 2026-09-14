import { getPool } from "../config/database";

export interface TransactionRecord {
  id: string;
  transactionNumber: number;
  customerId?: string;
  ticketId?: string;
  type: "payment" | "refund" | "expense";
  gateway: "razorpay" | "paypal" | "crypto" | "manual_staff" | "internal";
  gatewayTransactionId?: string;
  amountInr: number;
  amountUsd: number;
  status: "completed" | "pending" | "failed" | "refunded";
  serviceType: "vps" | "minecraft" | "general" | "infrastructure";
  planName?: string;
  notes?: string;
  recordedByDiscordId: string;
  createdAt: Date;
}

export interface RecordTransactionInput {
  customerId?: string;
  ticketId?: string;
  type?: "payment" | "refund" | "expense";
  gateway?: "razorpay" | "paypal" | "crypto" | "manual_staff" | "internal";
  gatewayTransactionId?: string;
  amountInr: number;
  amountUsd: number;
  status?: "completed" | "pending" | "failed" | "refunded";
  serviceType?: "vps" | "minecraft" | "general" | "infrastructure";
  planName?: string;
  notes?: string;
  recordedByDiscordId: string;
}

export interface FinancialSummary {
  totalRevenueInr: number;
  totalRevenueUsd: number;
  totalRefundsInr: number;
  totalRefundsUsd: number;
  totalExpensesInr: number;
  totalExpensesUsd: number;
  netProfitInr: number;
  netProfitUsd: number;
  gatewayBreakdown: Array<{ gateway: string; totalInr: number; totalUsd: number; count: number }>;
  serviceBreakdown: Array<{ serviceType: string; totalInr: number; totalUsd: number; count: number }>;
  completedTransactionCount: number;
  refundCount: number;
  expenseCount: number;
}

function mapRowToTransaction(row: any): TransactionRecord {
  return {
    id: row.id,
    transactionNumber: parseInt(row.transaction_number, 10),
    customerId: row.customer_id || undefined,
    ticketId: row.ticket_id || undefined,
    type: row.type,
    gateway: row.gateway,
    gatewayTransactionId: row.gateway_transaction_id || undefined,
    amountInr: parseFloat(row.amount_inr || "0"),
    amountUsd: parseFloat(row.amount_usd || "0"),
    status: row.status,
    serviceType: row.service_type,
    planName: row.plan_name || undefined,
    notes: row.notes || undefined,
    recordedByDiscordId: row.recorded_by_discord_id,
    createdAt: new Date(row.created_at),
  };
}

export async function recordTransaction(input: RecordTransactionInput): Promise<TransactionRecord> {
  const pool = getPool();
  const query = `
    INSERT INTO transactions (
      customer_id, ticket_id, type, gateway, gateway_transaction_id,
      amount_inr, amount_usd, status, service_type, plan_name, notes, recorded_by_discord_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING *;
  `;

  const values = [
    input.customerId || null,
    input.ticketId || null,
    input.type || "payment",
    input.gateway || "manual_staff",
    input.gatewayTransactionId || null,
    input.amountInr,
    input.amountUsd,
    input.status || "completed",
    input.serviceType || "vps",
    input.planName || null,
    input.notes || null,
    input.recordedByDiscordId,
  ];

  const result = await pool.query(query, values);
  return mapRowToTransaction(result.rows[0]);
}

export async function recordRefund(
  transactionIdentifier: string,
  amountInr: number,
  amountUsd: number,
  recordedByDiscordId: string,
  notes?: string
): Promise<TransactionRecord> {
  const pool = getPool();

  // Look up original transaction if provided
  let originalTx: TransactionRecord | null = null;
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(transactionIdentifier);
  const findQuery = isUuid
    ? `SELECT * FROM transactions WHERE id = $1`
    : `SELECT * FROM transactions WHERE transaction_number = $1`;
  const findValues: any[] = isUuid ? [transactionIdentifier] : [parseInt(transactionIdentifier, 10) || 0];

  const findResult = await pool.query(findQuery, findValues);
  if (findResult.rows.length > 0) {
    originalTx = mapRowToTransaction(findResult.rows[0]);
    // Mark original as refunded if full or partial refund
    await pool.query(`UPDATE transactions SET status = 'refunded' WHERE id = $1`, [originalTx.id]);
  }

  const refundInput: RecordTransactionInput = {
    customerId: originalTx?.customerId,
    ticketId: originalTx?.ticketId,
    type: "refund",
    gateway: originalTx?.gateway || "internal",
    gatewayTransactionId: originalTx?.gatewayTransactionId,
    amountInr: Math.abs(amountInr),
    amountUsd: Math.abs(amountUsd),
    status: "completed",
    serviceType: originalTx?.serviceType || "general",
    planName: originalTx?.planName,
    notes: notes || `Refund for transaction #${originalTx?.transactionNumber || transactionIdentifier}`,
    recordedByDiscordId,
  };

  return recordTransaction(refundInput);
}

export async function recordExpense(
  amountInr: number,
  amountUsd: number,
  recordedByDiscordId: string,
  notes: string,
  category: "infrastructure" | "general" = "infrastructure"
): Promise<TransactionRecord> {
  const expenseInput: RecordTransactionInput = {
    type: "expense",
    gateway: "internal",
    amountInr: Math.abs(amountInr),
    amountUsd: Math.abs(amountUsd),
    status: "completed",
    serviceType: category,
    notes,
    recordedByDiscordId,
  };

  return recordTransaction(expenseInput);
}

export async function getFinancialSummary(): Promise<FinancialSummary> {
  const pool = getPool();

  const totalsQuery = `
    SELECT
      COALESCE(SUM(CASE WHEN type = 'payment' AND status = 'completed' THEN amount_inr ELSE 0 END), 0) AS total_revenue_inr,
      COALESCE(SUM(CASE WHEN type = 'payment' AND status = 'completed' THEN amount_usd ELSE 0 END), 0) AS total_revenue_usd,
      COALESCE(SUM(CASE WHEN type = 'refund' AND status = 'completed' THEN amount_inr ELSE 0 END), 0) AS total_refunds_inr,
      COALESCE(SUM(CASE WHEN type = 'refund' AND status = 'completed' THEN amount_usd ELSE 0 END), 0) AS total_refunds_usd,
      COALESCE(SUM(CASE WHEN type = 'expense' AND status = 'completed' THEN amount_inr ELSE 0 END), 0) AS total_expenses_inr,
      COALESCE(SUM(CASE WHEN type = 'expense' AND status = 'completed' THEN amount_usd ELSE 0 END), 0) AS total_expenses_usd,
      COUNT(CASE WHEN type = 'payment' AND status = 'completed' THEN 1 END) AS completed_payment_count,
      COUNT(CASE WHEN type = 'refund' AND status = 'completed' THEN 1 END) AS refund_count,
      COUNT(CASE WHEN type = 'expense' AND status = 'completed' THEN 1 END) AS expense_count
    FROM transactions;
  `;

  const gatewayQuery = `
    SELECT
      gateway,
      COALESCE(SUM(amount_inr), 0) AS total_inr,
      COALESCE(SUM(amount_usd), 0) AS total_usd,
      COUNT(*) AS count
    FROM transactions
    WHERE type = 'payment' AND status = 'completed'
    GROUP BY gateway;
  `;

  const serviceQuery = `
    SELECT
      service_type,
      COALESCE(SUM(amount_inr), 0) AS total_inr,
      COALESCE(SUM(amount_usd), 0) AS total_usd,
      COUNT(*) AS count
    FROM transactions
    WHERE type = 'payment' AND status = 'completed'
    GROUP BY service_type;
  `;

  const [totalsRes, gatewayRes, serviceRes] = await Promise.all([
    pool.query(totalsQuery),
    pool.query(gatewayQuery),
    pool.query(serviceQuery),
  ]);

  const totals = totalsRes.rows[0];
  const revInr = parseFloat(totals.total_revenue_inr);
  const revUsd = parseFloat(totals.total_revenue_usd);
  const refInr = parseFloat(totals.total_refunds_inr);
  const refUsd = parseFloat(totals.total_refunds_usd);
  const expInr = parseFloat(totals.total_expenses_inr);
  const expUsd = parseFloat(totals.total_expenses_usd);

  const netInr = revInr - refInr - expInr;
  const netUsd = revUsd - refUsd - expUsd;

  return {
    totalRevenueInr: revInr,
    totalRevenueUsd: revUsd,
    totalRefundsInr: refInr,
    totalRefundsUsd: refUsd,
    totalExpensesInr: expInr,
    totalExpensesUsd: expUsd,
    netProfitInr: netInr,
    netProfitUsd: netUsd,
    gatewayBreakdown: gatewayRes.rows.map((row) => ({
      gateway: row.gateway,
      totalInr: parseFloat(row.total_inr),
      totalUsd: parseFloat(row.total_usd),
      count: parseInt(row.count, 10),
    })),
    serviceBreakdown: serviceRes.rows.map((row) => ({
      serviceType: row.service_type,
      totalInr: parseFloat(row.total_inr),
      totalUsd: parseFloat(row.total_usd),
      count: parseInt(row.count, 10),
    })),
    completedTransactionCount: parseInt(totals.completed_payment_count, 10),
    refundCount: parseInt(totals.refund_count, 10),
    expenseCount: parseInt(totals.expense_count, 10),
  };
}

export async function listRecentTransactions(limit: number = 10): Promise<TransactionRecord[]> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT * FROM transactions ORDER BY created_at DESC LIMIT $1;`,
    [limit]
  );
  return result.rows.map(mapRowToTransaction);
}

export async function getTransactionByIdOrNumber(identifier: string): Promise<TransactionRecord | null> {
  const pool = getPool();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);
  const query = isUuid
    ? `SELECT * FROM transactions WHERE id = $1`
    : `SELECT * FROM transactions WHERE transaction_number = $1`;
  const values: any[] = isUuid ? [identifier] : [parseInt(identifier, 10) || 0];

  const result = await pool.query(query, values);
  if (result.rows.length === 0) return null;
  return mapRowToTransaction(result.rows[0]);
}
