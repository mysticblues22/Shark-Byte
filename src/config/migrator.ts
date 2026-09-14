import fs from "fs";
import path from "path";
import { getPool } from "./database";

export async function runDatabaseMigrations(): Promise<void> {
  const schemaPath = path.join(process.cwd(), "database", "schema.sql");

  if (!fs.existsSync(schemaPath)) {
    console.warn("⚠️ [Shark Byte Migration] database/schema.sql file not found. Skipping auto-migration.");
    return;
  }

  const sqlContent = fs.readFileSync(schemaPath, "utf-8");
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN;");
    await client.query(sqlContent);
    await client.query("COMMIT;");
    console.log("✅ [Shark Byte Migration] Unified database schema applied successfully.");
  } catch (error) {
    await client.query("ROLLBACK;");
    console.error("❌ [Shark Byte Migration] Failed to run database schema migration:", error);
    throw error;
  } finally {
    client.release();
  }
}
