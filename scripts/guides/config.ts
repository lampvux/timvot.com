import { loadEnv } from "../scraper/env";

loadEnv([".env.local", ".env"]);
export function config(env: Record<string, string | undefined> = process.env) {
  const baseUrl = env.NINE_ROUTER_BASE_URL ?? "http://localhost:20128/v1";
  const url = new URL(baseUrl);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.username || url.password) throw new Error("9router must use a local loopback URL");
  const model = (env.NINE_ROUTER_MODEL ?? "").trim();
  const freeModels = (env.NINE_ROUTER_FREE_MODELS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  // Keep existing free-only installations working. A new explicit allowlist
  // can opt into other configured providers without claiming they are free.
  const allowedModels = env.NINE_ROUTER_ALLOWED_MODELS?.trim()
    ? env.NINE_ROUTER_ALLOWED_MODELS.split(",").map((s) => s.trim()).filter(Boolean)
    : freeModels;
  const apiMode = env.NINE_ROUTER_API_MODE === "responses" ? "responses" : "chat";
  const reasoningEffort = (["minimal", "low", "medium", "high"] as const).find(
    (value) => value === env.NINE_ROUTER_REASONING_EFFORT,
  ) ?? "low";
  const requestTimeoutMs = Number(env.NINE_ROUTER_REQUEST_TIMEOUT_MS ?? 600_000);
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 60_000 || requestTimeoutMs > 1_200_000) {
    throw new Error("NINE_ROUTER_REQUEST_TIMEOUT_MS must be an integer from 60000 to 1200000");
  }
  return {
    baseUrl: baseUrl.replace(/\/$/, ""), apiKey: env.NINE_ROUTER_API_KEY ?? "", model, freeModels, allowedModels, apiMode, reasoningEffort, requestTimeoutMs,
    timezone: env.GUIDE_TIMEZONE ?? "Asia/Hovd",
    output: "scripts/guides/output",
  };
}
export function dailyKey(date = new Date(), timezone = config().timezone): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return `daily:${part("year")}-${part("month")}-${part("day")}`;
}
