/**
 * Minimal .env loader.
 *
 * Nothing under `scripts/` loaded .env before — every script read
 * `process.env` directly and quietly took the "no credentials" branch unless
 * the caller had exported them by hand. `--sync-db` could therefore never find
 * a key that was sitting in the file the whole time.
 *
 * Files are read in increasing priority, and a value already present in the
 * real environment always wins, so `SUPABASE_SERVICE_ROLE_KEY=… npm run scrape`
 * still overrides the file.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_FILES = [".env", ".env.local"];

export function loadEnv(files: string[] = DEFAULT_FILES): void {
  for (const file of files) {
    const path = resolve(process.cwd(), file);
    if (!existsSync(path)) continue;

    // Strip a BOM, and normalise CRLF up front. This matters more than it
    // looks: JavaScript counts \r as a line terminator, so `.` in a regex will
    // not match it and a naive /^(\w+)=(.*)$/ silently fails on every line of
    // a Windows-authored .env except the last.
    const text = readFileSync(path, "utf8").replace(/^﻿/, "").replace(/\r\n?/g, "\n");

    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;

      const key = trimmed.slice(0, eq).replace(/^export\s+/, "").trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

      let value = trimmed.slice(eq + 1).trim();
      // Unwrap matched quotes, leaving inner quotes alone.
      if (
        (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
        (value.startsWith("'") && value.endsWith("'") && value.length > 1)
      ) {
        value = value.slice(1, -1);
      }

      // A real environment variable beats the file.
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}
