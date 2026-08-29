import type { BadmintonString, StringOffer, StringPricePoint } from "@/lib/types";

export const strings: BadmintonString[] = [
  { id: "str-bg80-power", slug: "bg80-power", brandSlug: "yonex", brandName: "Yonex", name: "BG80 Power", gaugeMm: 0.68, crossGaugeMm: null, feel: "hard", durability: 4, repulsion: 4, control: 5, playStyleTags: ["attack"], skillLevels: ["intermediate", "advanced"], summary: { en: "A firm, grippy string for players who want a heavier, steeper attack.", vi: "Cước cứng, bám cầu dành cho người muốn cú tấn công nặng và dốc hơn." } },
  { id: "str-bg65", slug: "bg65", brandSlug: "yonex", brandName: "Yonex", name: "BG65", gaugeMm: 0.7, crossGaugeMm: null, feel: "medium", durability: 5, repulsion: 3, control: 3, playStyleTags: ["all-round"], skillLevels: ["beginner", "intermediate"], summary: { en: "The durable reference string: forgiving, predictable and inexpensive to maintain.", vi: "Mẫu cước bền tiêu chuẩn: dễ chơi, ổn định và tiết kiệm chi phí thay cước." } },
  { id: "str-exbolt-63", slug: "exbolt-63", brandSlug: "yonex", brandName: "Yonex", name: "Exbolt 63", gaugeMm: 0.63, crossGaugeMm: null, feel: "medium", durability: 3, repulsion: 5, control: 4, playStyleTags: ["speed"], skillLevels: ["intermediate", "advanced"], summary: { en: "A thin, quick string with immediate shuttle release for flat exchanges.", vi: "Cước mỏng, thoát cầu nhanh cho các pha đôi công ngang tốc độ cao." } },
  { id: "str-bg66-ultimax", slug: "bg66-ultimax", brandSlug: "yonex", brandName: "Yonex", name: "BG66 Ultimax", gaugeMm: 0.65, crossGaugeMm: null, feel: "soft", durability: 3, repulsion: 5, control: 4, playStyleTags: ["defence"], skillLevels: ["beginner", "intermediate", "advanced"], summary: { en: "A lively, softer response that makes lifts and counter-drives easier.", vi: "Phản hồi nảy và mềm hơn, giúp nâng cầu và phản tạt nhẹ nhàng." } },
  { id: "str-aerobite", slug: "aerobite", brandSlug: "yonex", brandName: "Yonex", name: "Aerobite", gaugeMm: 0.67, crossGaugeMm: 0.61, feel: "medium", durability: 3, repulsion: 4, control: 5, playStyleTags: ["control"], skillLevels: ["intermediate", "advanced"], summary: { en: "A textured hybrid built for shuttle hold, slices and precise net work.", vi: "Cước lai nhám cho độ giữ cầu, cắt cầu và xử lý lưới chính xác." } },
];

const sellers = ["s-shuttle-pro-hn", "s-dong-do-sports", "s-vn-racket-store"];
export const stringOffers: StringOffer[] = strings.flatMap((string, stringIndex) =>
  sellers.map((sellerId, sellerIndex) => ({
    id: `so-${string.slug}-${sellerIndex + 1}`,
    stringId: string.id,
    sellerId,
    price: 175_000 + stringIndex * 22_000 + sellerIndex * 14_000,
    currency: "VND" as const,
    qtyAvailable: 4 + stringIndex + sellerIndex * 3,
    status: "live" as const,
    updatedAt: "2026-08-29T08:00:00.000Z",
  })),
);

export const stringPriceHistory: StringPricePoint[] = strings.flatMap((string, index) =>
  [60, 30, 0].map((daysAgo, point) => ({
    stringId: string.id,
    observedOn: new Date(Date.UTC(2026, 7, 29 - daysAgo)).toISOString().slice(0, 10),
    price: 190_000 + index * 22_000 - point * 7_500,
  })),
);
