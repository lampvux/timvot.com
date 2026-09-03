import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  brands,
  guides,
  offers,
  priceHistory,
  rackets,
  reviews,
  sellers,
} from "../src/lib/data/seed";
import { loadEnv } from "./scraper/env";

export interface DatabaseBackup {
  metadata: {
    version: string;
    timestamp: string;
    environment: string;
    tableCounts: Record<string, number>;
  };
  data: {
    brands: any[];
    rackets: any[];
    racket_variants: any[];
    racket_images: any[];
    sellers: any[];
    offers: any[];
    price_points: any[];
    guides: any[];
    reviews: any[];
  };
}

export async function backupDatabase() {
  loadEnv();
  console.log("=================================================");
  console.log("📦 Shuttlecraft Database Backup Utility");
  console.log("=================================================\n");

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = resolve(process.cwd(), "backups");
  mkdirSync(backupDir, { recursive: true });

  const backupPath = join(backupDir, `backup-${timestamp}.json`);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  let backupContent: DatabaseBackup;

  if (supabaseUrl && serviceRoleKey) {
    console.log(`📡 Exporting snapshot directly from Supabase DB (${supabaseUrl})...`);
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const fetchTable = async (table: string) => {
      const rows: any[] = [];
      const pageSize = 1000;
      const orderColumn = table === "guides" ? "slug" : "id";

      for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
          .from(table)
          .select("*")
          .order(orderColumn)
          .range(from, from + pageSize - 1);
        if (error) {
          console.warn(`⚠️ Warning: Failed to export table '${table}': ${error.message}`);
          return rows;
        }
        rows.push(...(data ?? []));
        if (!data || data.length < pageSize) break;
      }

      return rows;
    };

    const [b, r, rv, ri, s, o, pp, g, rev] = await Promise.all([
      fetchTable("brands"),
      fetchTable("rackets"),
      fetchTable("racket_variants"),
      fetchTable("racket_images"),
      fetchTable("sellers"),
      fetchTable("offers"),
      fetchTable("price_points"),
      fetchTable("guides"),
      fetchTable("reviews"),
    ]);

    backupContent = {
      metadata: {
        version: "1.0",
        timestamp: new Date().toISOString(),
        environment: "supabase",
        tableCounts: {
          brands: b.length,
          rackets: r.length,
          racket_variants: rv.length,
          racket_images: ri.length,
          sellers: s.length,
          offers: o.length,
          price_points: pp.length,
          guides: g.length,
          reviews: rev.length,
        },
      },
      data: {
        brands: b,
        rackets: r,
        racket_variants: rv,
        racket_images: ri,
        sellers: s,
        offers: o,
        price_points: pp,
        guides: g,
        reviews: rev,
      },
    };
  } else {
    console.log("ℹ️ Supabase environment variables not set. Generating baseline static snapshot...");
    backupContent = {
      metadata: {
        version: "1.0",
        timestamp: new Date().toISOString(),
        environment: "static_seed",
        tableCounts: {
          brands: brands.length,
          rackets: rackets.length,
          racket_variants: rackets.flatMap((r) => r.variants).length,
          racket_images: 0,
          sellers: sellers.length,
          offers: offers.length,
          price_points: priceHistory.length,
          guides: guides.length,
          reviews: reviews.length,
        },
      },
      data: {
        brands,
        rackets,
        racket_variants: rackets.flatMap((r) => r.variants),
        racket_images: [],
        sellers,
        offers,
        price_points: priceHistory,
        guides,
        reviews,
      },
    };
  }

  writeFileSync(backupPath, JSON.stringify(backupContent, null, 2), "utf-8");

  console.log(`\n✅ Backup snapshot saved successfully:`);
  console.log(`   File: ${backupPath}`);
  console.log(`   Summary: ${JSON.stringify(backupContent.metadata.tableCounts, null, 2)}`);
  return backupPath;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("backup.ts")) {
  backupDatabase().catch((err) => {
    console.error("Backup failed:", err);
    process.exit(1);
  });
}
