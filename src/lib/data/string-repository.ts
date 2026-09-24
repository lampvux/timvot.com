import "server-only";

import { cache } from "react";
import { cacheLife, cacheTag } from "next/cache";
import { createStaticClient } from "@/lib/supabase/server";
import type { BadmintonString, Seller, StringOffer, StringOfferWithSeller, StringPricePoint, StringWithMarket } from "@/lib/types";
import { mapSeller } from "./mappers";
import * as seed from "./seed";
import * as fallback from "./string-seed";
import { TAG } from "./tags";

type Row = Record<string, unknown>;

const mapString = (row: Row): BadmintonString => {
  const brand = Array.isArray(row.brand) ? row.brand[0] as Row : row.brand as Row | undefined;
  return { id: String(row.id), slug: String(row.slug), brandSlug: String(brand?.slug ?? ""), brandName: String(brand?.name ?? ""), name: String(row.name), gaugeMm: Number(row.gauge_mm), crossGaugeMm: row.cross_gauge_mm == null ? null : Number(row.cross_gauge_mm), feel: row.feel as BadmintonString["feel"], durability: Number(row.durability), repulsion: Number(row.repulsion), control: Number(row.control), playStyleTags: row.play_style_tags as BadmintonString["playStyleTags"], skillLevels: row.skill_levels as BadmintonString["skillLevels"], summary: { en: String(row.summary_en ?? ""), vi: String(row.summary_vi ?? "") }, imageUrl: typeof row.image_url === "string" && row.image_url ? row.image_url : null, thumbUrl: typeof row.thumb_url === "string" && row.thumb_url ? row.thumb_url : null };
};

interface StringSnapshot {
  strings: BadmintonString[];
  offers: StringOffer[];
  history: StringPricePoint[];
  sellers: Seller[];
}

async function loadStrings(): Promise<StringSnapshot> {
  "use cache";
  cacheLife("catalogue");
  cacheTag(TAG.strings, TAG.stringOffers, TAG.stringPricePoints, TAG.sellers);
  const supabase = createStaticClient();
  if (!supabase) {
    return {
      strings: fallback.strings,
      offers: fallback.stringOffers,
      history: fallback.stringPriceHistory,
      sellers: seed.sellers,
    };
  }
  try {
    const [stringRows, offerRows, historyRows, sellerRows] = await Promise.all([
      supabase.from("strings").select("*, brand:brands!inner(slug,name)").order("name"),
      supabase.from("string_offers").select("*").eq("status", "live"),
      supabase.from("string_price_points").select("*").order("observed_on"),
      supabase.from("sellers").select("*"),
    ]);
    if (
      stringRows.error ||
      offerRows.error ||
      historyRows.error ||
      sellerRows.error ||
      !stringRows.data?.length
    ) {
      throw new Error("String catalogue unavailable");
    }
    return {
      strings: stringRows.data.map((row) => mapString(row as Row)),
      offers: offerRows.data.map((row) => ({ id: row.id, stringId: row.string_id, sellerId: row.seller_id, price: Number(row.price), currency: "VND", qtyAvailable: row.qty_available, status: row.status, updatedAt: row.updated_at })),
      history: historyRows.data.map((row) => ({ stringId: row.string_id, observedOn: row.observed_on, price: Number(row.price) })),
      sellers: sellerRows.data.map((row) => mapSeller(row as Row)),
    };
  } catch {
    return {
      strings: fallback.strings,
      offers: fallback.stringOffers,
      history: fallback.stringPriceHistory,
      sellers: seed.sellers,
    };
  }
}

const snapshot = cache(loadStrings);

export const getStrings = cache(async (): Promise<StringWithMarket[]> => {
  const data = await snapshot();
  return data.strings.map((string) => {
    const offers = data.offers.filter((offer) => offer.stringId === string.id && offer.status === "live" && offer.qtyAvailable > 0);
    return { ...string, lowestPrice: offers.length ? Math.min(...offers.map((offer) => offer.price)) : null, sellerCount: new Set(offers.map((offer) => offer.sellerId)).size, history: data.history.filter((point) => point.stringId === string.id) };
  });
});

export async function getString(brand: string, slug: string) { return (await getStrings()).find((string) => string.brandSlug === brand && string.slug === slug) ?? null; }

export async function getStringOffers(stringId: string): Promise<StringOfferWithSeller[]> {
  const data = await snapshot();
  const sellerMap = new Map<string, Seller>(
    data.sellers.map((seller) => [seller.id, seller]),
  );
  return data.offers.filter((offer) => offer.stringId === stringId && offer.status === "live").map((offer) => ({ ...offer, seller: sellerMap.get(offer.sellerId)! })).filter((offer) => offer.seller).sort((a, b) => a.price - b.price);
}
