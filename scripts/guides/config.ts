import { loadEnv } from "../scraper/env";

loadEnv([".env.local", ".env"]);
export function config() {
  const baseUrl = process.env.NINE_ROUTER_BASE_URL ?? "http://localhost:20128/v1";
  const url = new URL(baseUrl);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.username || url.password) throw new Error("9router must use a local loopback URL");
  const model = process.env.NINE_ROUTER_MODEL ?? "";
  const freeModels = (process.env.NINE_ROUTER_FREE_MODELS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const apiMode = process.env.NINE_ROUTER_API_MODE === "responses" ? "responses" : "chat";
  const reasoningEffort = (["minimal", "low", "medium", "high"] as const).find(
    (value) => value === process.env.NINE_ROUTER_REASONING_EFFORT,
  ) ?? "low";
  return {
    baseUrl: baseUrl.replace(/\/$/, ""), apiKey: process.env.NINE_ROUTER_API_KEY ?? "", model, freeModels, apiMode, reasoningEffort,
    timezone: process.env.GUIDE_TIMEZONE ?? "Asia/Hovd",
    output: "scripts/guides/output",
  };
}
export function dailyKey(date = new Date(), timezone = config().timezone): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return `daily:${part("year")}-${part("month")}-${part("day")}`;
}
