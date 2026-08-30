import { strings } from "../../src/lib/data/string-seed";

const simplify = (value: string) => value
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/li[ -]?ning/g, "lining")
  .replace(/yonex|victor|gosen/g, "")
  .replace(/titanium/g, "ti")
  .replace(/nano/g, "n")
  .replace(/[^a-z0-9]+/g, "")
  .replace(/^cuoccaulong|^daycuoc|^cuoc/, "");

const aliases = new Map<string, (typeof strings)[number]>();
for (const string of strings) {
  const names = [string.name, `${string.brandName} ${string.name}`];
  if (string.slug === "bg65-titanium") names.push("BG65 Ti");
  if (string.slug === "vbs-66-nano") names.push("VBS 66N", "VBS-66N");
  for (const name of names) aliases.set(simplify(name), string);
}

/** Match only known catalogue models; accessories and similarly named rackets are rejected. */
export function matchString(title: string): (typeof strings)[number] | null {
  const normalized = simplify(title);
  // Retail titles commonly append colour, reel length, or promotional text.
  const candidates = [...aliases.entries()]
    .filter(([alias]) => normalized.includes(alias))
    .sort(([a], [b]) => b.length - a.length);
  return candidates[0]?.[1] ?? null;
}
