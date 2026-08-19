import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { DatabaseBackup } from "./backup";

export async function restoreDatabase() {
  console.log("=================================================");
  console.log("🔄 Shuttlecraft Database Restore Utility");
  console.log("=================================================\n");

  const args = process.argv.slice(2);
  let fileArg = args.find((a) => !a.startsWith("--"));
  const dryRun = args.includes("--dry-run");

  if (!fileArg) {
    const backupDir = resolve(process.cwd(), "backups");
    if (existsSync(backupDir)) {
      const files = readdirSync(backupDir).filter((f) => f.endsWith(".json")).sort().reverse();
      if (files.length > 0) {
        fileArg = join(backupDir, files[0]);
        console.log(`ℹ️ No backup file specified. Auto-selected latest backup: ${fileArg}`);
      }
    }
  }

  if (!fileArg || !existsSync(fileArg)) {
    console.error("❌ Error: Backup file not found. Usage: npx tsx scripts/restore.ts <path-to-backup.json>");
    process.exit(1);
  }

  console.log(`📂 Reading backup file: ${fileArg}`);
  const rawData = readFileSync(fileArg, "utf-8");
  const backup: DatabaseBackup = JSON.parse(rawData);

  console.log(`📋 Backup Metadata:`);
  console.log(`   Timestamp: ${backup.metadata.timestamp}`);
  console.log(`   Environment: ${backup.metadata.environment}`);
  console.log(`   Table Counts:`, backup.metadata.tableCounts);

  if (dryRun) {
    console.log("\n🔍 [DRY RUN] Verification successful. No database records modified.");
    return;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("❌ Error: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY to perform restoration.");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  console.log(`\n📡 Restoring data to Supabase (${supabaseUrl})...`);

  const tablesOrder = [
    "brands",
    "rackets",
    "racket_variants",
    "sellers",
    "offers",
    "price_points",
    "guides",
    "reviews",
  ] as const;

  for (const table of tablesOrder) {
    const records = backup.data[table];
    if (!records || records.length === 0) continue;

    console.log(`🔹 Restoring ${records.length} records into '${table}'...`);

    // Determine primary key / unique constraint target for upsert
    let onConflict = "id";
    if (table === "rackets") onConflict = "id";
    if (table === "price_points") onConflict = "variant_id,observed_on";
    if (table === "guides") onConflict = "slug";

    const { error } = await supabase.from(table).upsert(records, { onConflict });
    if (error) {
      console.error(`❌ Failed restoring table '${table}': ${error.message}`);
    }
  }

  console.log("\n🎉 Database restoration completed successfully!");
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("restore.ts")) {
  restoreDatabase().catch((err) => {
    console.error("Restore failed:", err);
    process.exit(1);
  });
}
