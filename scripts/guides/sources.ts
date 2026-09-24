import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as cheerio from "cheerio";
import type { GuideSource } from "../../src/lib/guides/content";
import { config, dailyKey } from "./config";

export interface Evidence extends GuideSource { text: string }
// Extend this registry with publicly accessible source pages. Never crawl URLs supplied by the model.
export const SOURCE_PAGES = [
  "https://us.yonex.com/pages/product-safety",
  "https://us.yonex.com/collections/badminton-strings",
  "https://www.victorsport.com/badmintonaz/16586",
  "https://www.victorsport.com/product/js-520-a",
  "https://www.victor-europe.com/badmintonaz/2446/Choosing-the-right-racket-for-yourself-Part-1",
  "https://shopvnb.com/vot-cau-long.html",
  "https://fbshop.vn/vot-cau-long/",
  "https://hvshop.vn/vot-cau-long/",
  "https://qvbadminton.com/vot-cau-long/",
  "https://bwfbadminton.com/",
];
const hosts = new Set(SOURCE_PAGES.map((s) => new URL(s).hostname));
export function allowedUrl(input: string): URL {
  const url = new URL(input);
  if (url.protocol !== "https:" || url.port || url.username || url.password || !hosts.has(url.hostname) || isIP(url.hostname)) throw new Error("Source URL is outside the HTTPS source registry");
  url.hash = "";
  return url;
}
export function publicAddress(address: string): boolean {
  if (address.includes(":")) return /^[23]/i.test(address); // globally routable IPv6 only
  const [a, b] = address.split(".").map(Number);
  return a > 0 && a < 224 && a !== 10 && a !== 127 && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && b === 168) && !(a === 100 && b >= 64 && b <= 127);
}
async function request(input: string, beforeRequest?: (url: URL) => void): Promise<{ body: string; status: number; url: string }> {
  let url = allowedUrl(input);
  for (let redirects = 0; redirects < 4; redirects++) {
    beforeRequest?.(url);
    const addresses = await lookup(url.hostname, { all: true });
    if (!addresses.length || addresses.some((a) => !publicAddress(a.address))) throw new Error("Source resolves to a private address");
    const response = await fetch(url, { redirect: "manual", headers: { "user-agent": "ShuttlecraftGuideBot/1.0", accept: "text/html,application/xml,text/plain" }, signal: AbortSignal.timeout(18000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new Error("Redirect missing location");
      url = allowedUrl(new URL(location, url).href);
      continue;
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Empty source response");
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2_000_000) { await reader.cancel(); throw new Error("Source response too large"); }
      chunks.push(value);
    }
    return { body: Buffer.concat(chunks).toString("utf8"), status: response.status, url: url.href };
  }
  throw new Error("Too many source redirects");
}
/** Longest applicable robots rule wins; allow wins ties. Bot-specific groups override '*'. */
export function robotsAllow(robots: string, path: string): boolean {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  let group = { agents: [] as string[], rules: [] as { allow: boolean; path: string }[] };
  for (const line of robots.split(/\r?\n/)) {
    const match = line.split("#")[0].trim().match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1].toLowerCase(); const value = match[2].trim();
    if (key === "user-agent") {
      if (group.rules.length) { groups.push(group); group = { agents: [], rules: [] }; }
      group.agents.push(value.toLowerCase());
    } else if ((key === "allow" || key === "disallow") && value) group.rules.push({ allow: key === "allow", path: value });
  }
  groups.push(group);
  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && "shuttlecraftguidebot".includes(a)));
  const applicable = specific.length ? specific : groups.filter((g) => g.agents.includes("*"));
  const rules = applicable.flatMap((g) => g.rules).filter((r) => {
    const pattern = r.path.replace(/[.+?^{}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${pattern}`).test(path);
  }).sort((a, b) => b.path.length - a.path.length || Number(b.allow) - Number(a.allow));
  return !rules.length || rules[0].allow;
}
export function extract(html: string, url: string): { title: string; text: string; links: string[] } {
  const $ = cheerio.load(html);
  const title = $("h1").first().text().trim() || $("title").text().trim();
  const links = $("a[href]").map((_, a) => {
    try {
      const link = allowedUrl(new URL($(a).attr("href")!, url).href);
      return link.origin === new URL(url).origin && /badminton|racket|racquet|string|cau-long|cuoc|vot-|badmintonaz|product\//i.test(link.pathname) && !/login|cart|account|checkout|\.pdf$|\.jpg$|\.png$/i.test(link.pathname) ? link.href : null;
    } catch { return null; }
  }).get();
  $("script,style,nav,footer,header,form,noscript,iframe,.menu,.breadcrumb").remove();
  const content = $("article, main, [role=main], .product-detail, .entry-content").first();
  const text = (content.length ? content : $("body")).text().replace(/\s+/g, " ").trim().slice(0, 12000);
  return { title: title.slice(0, 220), text, links: [...new Set(links)] };
}
export async function collectEvidence(): Promise<Evidence[]> {
  const directory = `${config().output}/sources`;
  await mkdir(directory, { recursive: true });
  const evidence: Evidence[] = [];
  const seen = new Set<string>();
  const robots = new Map<string, string>();
  async function read(url: string): Promise<string[]> {
    if (seen.has(url) || evidence.length >= 24) return [];
    seen.add(url);
    try {
      const parsed = allowedUrl(url);
      if (!robots.has(parsed.origin)) {
        const res = await request(`${parsed.origin}/robots.txt`);
        if (res.status !== 200 && res.status !== 404) throw new Error(`robots.txt HTTP ${res.status}`);
        robots.set(parsed.origin, res.status === 404 ? "" : res.body);
      }
      if (!robotsAllow(robots.get(parsed.origin)!, parsed.pathname + parsed.search)) throw new Error("Disallowed by robots.txt");
      const path = `${directory}/${createHash("sha256").update(url).digest("hex")}.json`;
      let cached: { title: string; text: string; links: string[]; url: string; accessedAt: string } | undefined;
      try { const value = JSON.parse(await readFile(path, "utf8")); if (Date.now() - Date.parse(value.accessedAt) < 20 * 3600000) cached = value; } catch { /* cache miss */ }
      if (!cached) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const res = await request(url, (target) => {
          if (target.origin !== parsed.origin) throw new Error("Cross-origin source redirect requires a separate registry entry");
          if (!robotsAllow(robots.get(parsed.origin)!, target.pathname + target.search)) throw new Error("Redirect target disallowed by robots.txt");
        });
        if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
        // A redirect target can have a different robots policy/path.
        const target = new URL(res.url);
        if (target.origin !== parsed.origin) throw new Error("Cross-origin source redirect requires a separate registry entry");
        if (!robotsAllow(robots.get(parsed.origin)!, target.pathname + target.search)) throw new Error("Redirect target disallowed by robots.txt");
        cached = { ...extract(res.body, res.url), url: res.url, accessedAt: new Date().toISOString() };
        await writeFile(path, JSON.stringify(cached), "utf8");
      }
      if (cached.text.length >= 350 && cached.title) evidence.push({ id: evidence.length + 1, title: cached.title, url: cached.url, accessedAt: cached.accessedAt, text: cached.text });
      return cached.links;
    } catch (error) {
      console.warn(`Source skipped: ${url}: ${error instanceof Error ? error.message : "unavailable"}`);
      return [];
    }
  }
  // Visit every configured operator before spending the budget on discovered pages.
  const discovered: string[][] = [];
  for (const url of SOURCE_PAGES) discovered.push(await read(url));
  for (const links of discovered) {
    const ranked = links.sort((a, b) => createHash("sha256").update(dailyKey() + a).digest("hex").localeCompare(createHash("sha256").update(dailyKey() + b).digest("hex")));
    for (const url of ranked.slice(0, 2)) await read(url);
  }
  const operatorCount = new Set(evidence.map((s) => new URL(s.url).hostname)).size;
  if (operatorCount < 2) throw new Error("Research requires at least two accessible sources");
  console.log(`Research complete: ${evidence.length} sources across ${operatorCount} operators.`);
  return evidence;
}
