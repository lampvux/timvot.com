"use client";

import {
  createBrowserClient,
  parseCookieHeader,
  serializeCookieHeader,
} from "@supabase/ssr";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, isSupabaseConfigured } from "./config";
import {
  REMEMBER_SESSION_COOKIE,
  cookieOptionsForPersistence,
} from "./cookies";

export function createClient() {
  if (!isSupabaseConfigured) return null;
  return createBrowserClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return parseCookieHeader(document.cookie).map(({ name, value }) => ({
          name,
          value: value ?? "",
        }));
      },
      setAll(cookiesToSet) {
        const rememberSession = parseCookieHeader(document.cookie).some(
          ({ name, value }) =>
            name === REMEMBER_SESSION_COOKIE && value === "1",
        );

        for (const { name, value, options } of cookiesToSet) {
          document.cookie = serializeCookieHeader(
            name,
            value,
            cookieOptionsForPersistence(options, rememberSession),
          );
        }
      },
    },
  });
}
