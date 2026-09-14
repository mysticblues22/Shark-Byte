import { Pool, QueryResult, QueryResultRow } from "pg";

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("❌ DATABASE_URL is missing from environment variables.");
    }

    const isLocal = databaseUrl.includes("localhost") || databaseUrl.includes("127.0.0.1");

    pool = new Pool({
      connectionString: databaseUrl,
      ssl: isLocal ? false : { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    pool.on("error", (err) => {
      console.error("❌ Unexpected PostgreSQL pool error:", err);
    });
  }

  return pool;
}

export async function testDatabaseConnection(): Promise<boolean> {
  try {
    const dbPool = getPool();
    const client = await dbPool.connect();
    try {
      const res = await client.query("SELECT current_database() AS db_name, NOW() AS connected_at");
      console.log(`✅ [Shark Byte DB] Connected to database: ${res.rows[0].db_name}`);
      return true;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("⚠️ [Shark Byte DB] Could not connect to database:", error);
    return false;
  }
}

export async function query<T extends QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> {
  const dbPool = getPool();
  return dbPool.query<T>(text, params);
}
