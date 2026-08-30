import type { BadmintonString, StringOffer, StringPricePoint } from "@/lib/types";

type SeedString = Omit<BadmintonString, "id">;

const catalogue: SeedString[] = [
  { slug: "bg65", brandSlug: "yonex", brandName: "Yonex", name: "BG65", gaugeMm: 0.70, crossGaugeMm: null, feel: "medium", durability: 5, repulsion: 3, control: 3, playStyleTags: ["all-round"], skillLevels: ["beginner", "intermediate"], summary: { en: "A durable, forgiving benchmark string for everyday club play.", vi: "Mẫu cước bền, dễ chơi tiêu chuẩn cho người chơi phong trào hằng ngày." } },
  { slug: "bg65-titanium", brandSlug: "yonex", brandName: "Yonex", name: "BG65 Titanium", gaugeMm: 0.70, crossGaugeMm: null, feel: "hard", durability: 5, repulsion: 3, control: 3, playStyleTags: ["attack", "all-round"], skillLevels: ["beginner", "intermediate"], summary: { en: "The dependable BG65 construction with a crisper, harder impact.", vi: "Kết cấu BG65 bền bỉ với cảm giác chạm cầu cứng và sắc hơn." } },
  { slug: "bg80", brandSlug: "yonex", brandName: "Yonex", name: "BG80", gaugeMm: 0.68, crossGaugeMm: null, feel: "hard", durability: 4, repulsion: 4, control: 5, playStyleTags: ["attack", "control"], skillLevels: ["intermediate", "advanced"], summary: { en: "A textured, firm string known for bite, control and a direct response.", vi: "Cước nhám, cứng nổi tiếng nhờ độ bám, kiểm soát và phản hồi trực tiếp." } },
  { slug: "bg80-power", brandSlug: "yonex", brandName: "Yonex", name: "BG80 Power", gaugeMm: 0.68, crossGaugeMm: null, feel: "hard", durability: 4, repulsion: 4, control: 5, playStyleTags: ["attack"], skillLevels: ["intermediate", "advanced"], summary: { en: "A firm, grippy string for players who want a heavier, steeper attack.", vi: "Cước cứng, bám cầu dành cho người muốn cú tấn công nặng và dốc hơn." } },
  { slug: "bg66-ultimax", brandSlug: "yonex", brandName: "Yonex", name: "BG66 Ultimax", gaugeMm: 0.65, crossGaugeMm: null, feel: "medium", durability: 3, repulsion: 5, control: 4, playStyleTags: ["speed", "defence"], skillLevels: ["intermediate", "advanced"], summary: { en: "A lively thin string with fast rebound and a clean, bright response.", vi: "Cước mỏng, nảy nhanh với phản hồi trong và gọn." } },
  { slug: "exbolt-63", brandSlug: "yonex", brandName: "Yonex", name: "Exbolt 63", gaugeMm: 0.63, crossGaugeMm: null, feel: "medium", durability: 3, repulsion: 5, control: 4, playStyleTags: ["speed", "defence"], skillLevels: ["intermediate", "advanced"], summary: { en: "A thin, quick string with immediate shuttle release for flat exchanges.", vi: "Cước mỏng, thoát cầu nhanh cho các pha đôi công ngang tốc độ cao." } },
  { slug: "exbolt-65", brandSlug: "yonex", brandName: "Yonex", name: "Exbolt 65", gaugeMm: 0.65, crossGaugeMm: null, feel: "medium", durability: 4, repulsion: 5, control: 4, playStyleTags: ["speed", "all-round"], skillLevels: ["intermediate", "advanced"], summary: { en: "Fast repulsion with a little more substance and longevity than ultra-thin strings.", vi: "Độ nảy nhanh nhưng dày và bền hơn đôi chút so với cước siêu mỏng." } },
  { slug: "aerobite", brandSlug: "yonex", brandName: "Yonex", name: "Aerobite", gaugeMm: 0.67, crossGaugeMm: 0.61, feel: "medium", durability: 3, repulsion: 4, control: 5, playStyleTags: ["control"], skillLevels: ["intermediate", "advanced"], summary: { en: "A textured hybrid built for shuttle hold, slices and precise net work.", vi: "Cước lai nhám cho độ giữ cầu, cắt cầu và xử lý lưới chính xác." } },
  { slug: "aerobite-boost", brandSlug: "yonex", brandName: "Yonex", name: "Aerobite Boost", gaugeMm: 0.72, crossGaugeMm: 0.61, feel: "hard", durability: 4, repulsion: 4, control: 5, playStyleTags: ["attack", "control"], skillLevels: ["advanced"], summary: { en: "A robust hybrid pairing a thick main with a thin cross for control-led power.", vi: "Cước lai bền với dây dọc dày và dây ngang mỏng cho sức mạnh thiên kiểm soát." } },

  { slug: "vbs-63", brandSlug: "victor", brandName: "Victor", name: "VBS-63", gaugeMm: 0.63, crossGaugeMm: null, feel: "medium", durability: 3, repulsion: 5, control: 4, playStyleTags: ["speed", "defence"], skillLevels: ["intermediate", "advanced"], summary: { en: "A fast, fine-gauge option for sharp drives and easy shuttle acceleration.", vi: "Lựa chọn cước mảnh, nhanh cho các cú tạt sắc và tăng tốc cầu nhẹ nhàng." } },
  { slug: "vbs-66-nano", brandSlug: "victor", brandName: "Victor", name: "VBS-66 Nano", gaugeMm: 0.66, crossGaugeMm: null, feel: "medium", durability: 4, repulsion: 5, control: 4, playStyleTags: ["speed", "all-round"], skillLevels: ["intermediate", "advanced"], summary: { en: "A crisp all-round string balancing quick rebound with practical durability.", vi: "Cước toàn diện, giòn tiếng, cân bằng độ nảy nhanh và độ bền thực dụng." } },
  { slug: "vbs-68", brandSlug: "victor", brandName: "Victor", name: "VBS-68", gaugeMm: 0.68, crossGaugeMm: null, feel: "hard", durability: 4, repulsion: 4, control: 4, playStyleTags: ["attack", "control"], skillLevels: ["intermediate", "advanced"], summary: { en: "A firm 0.68 mm string for players seeking a solid, controlled strike.", vi: "Cước cứng 0,68 mm cho người cần cú đánh chắc và có kiểm soát." } },
  { slug: "vbs-70", brandSlug: "victor", brandName: "Victor", name: "VBS-70", gaugeMm: 0.70, crossGaugeMm: null, feel: "medium", durability: 5, repulsion: 3, control: 3, playStyleTags: ["all-round"], skillLevels: ["beginner", "intermediate"], summary: { en: "A thick, durable string suited to frequent play and economical restringing.", vi: "Cước dày, bền phù hợp tập thường xuyên và tối ưu chi phí căng lại." } },

  { slug: "no-1", brandSlug: "li-ning", brandName: "Li-Ning", name: "No.1", gaugeMm: 0.65, crossGaugeMm: null, feel: "medium", durability: 3, repulsion: 5, control: 4, playStyleTags: ["speed", "attack"], skillLevels: ["intermediate", "advanced"], summary: { en: "A popular thin string with lively rebound for fast attacks and drives.", vi: "Cước mỏng phổ biến, độ nảy cao cho tấn công nhanh và các pha tạt cầu." } },
  { slug: "no-1-boost", brandSlug: "li-ning", brandName: "Li-Ning", name: "No.1 Boost", gaugeMm: 0.66, crossGaugeMm: null, feel: "hard", durability: 4, repulsion: 5, control: 4, playStyleTags: ["attack", "speed"], skillLevels: ["intermediate", "advanced"], summary: { en: "A firmer No.1 variant tuned for punchy power without losing quick rebound.", vi: "Biến thể No.1 cứng hơn, tối ưu lực đánh mạnh mà vẫn giữ độ nảy nhanh." } },
  { slug: "no-5", brandSlug: "li-ning", brandName: "Li-Ning", name: "No.5", gaugeMm: 0.69, crossGaugeMm: null, feel: "medium", durability: 5, repulsion: 4, control: 4, playStyleTags: ["all-round", "attack"], skillLevels: ["beginner", "intermediate", "advanced"], summary: { en: "A durable all-rounder that keeps a solid feel and useful repulsion.", vi: "Cước toàn diện bền bỉ, giữ cảm giác chắc và độ nảy hữu dụng." } },
  { slug: "no-7", brandSlug: "li-ning", brandName: "Li-Ning", name: "No.7", gaugeMm: 0.70, crossGaugeMm: null, feel: "medium", durability: 5, repulsion: 3, control: 4, playStyleTags: ["all-round", "control"], skillLevels: ["beginner", "intermediate"], summary: { en: "A robust 0.70 mm choice for consistent feel and long service life.", vi: "Lựa chọn 0,70 mm bền chắc cho cảm giác ổn định và tuổi thọ dài." } },

  { slug: "g-tone-5", brandSlug: "gosen", brandName: "Gosen", name: "G-TONE 5", gaugeMm: 0.65, crossGaugeMm: null, feel: "medium", durability: 3, repulsion: 5, control: 4, playStyleTags: ["speed", "attack"], skillLevels: ["intermediate", "advanced"], summary: { en: "A lively 0.65 mm performance string with a crisp, high-pitched response.", vi: "Cước hiệu năng 0,65 mm nảy, cho phản hồi giòn và âm thanh cao." } },
  { slug: "g-tone-9", brandSlug: "gosen", brandName: "Gosen", name: "G-TONE 9", gaugeMm: 0.69, crossGaugeMm: null, feel: "hard", durability: 4, repulsion: 4, control: 5, playStyleTags: ["attack", "control"], skillLevels: ["intermediate", "advanced"], summary: { en: "A firm, textured option for a solid strike and confident shuttle placement.", vi: "Cước cứng, nhám cho cú đánh chắc và khả năng điều cầu tự tin." } },
  { slug: "g-tone-58", brandSlug: "gosen", brandName: "Gosen", name: "G-TONE 58", gaugeMm: 0.58, crossGaugeMm: null, feel: "medium", durability: 2, repulsion: 5, control: 4, playStyleTags: ["speed", "defence"], skillLevels: ["advanced"], summary: { en: "An ultra-thin specialist string prioritising immediate rebound over durability.", vi: "Cước siêu mỏng chuyên dụng, ưu tiên độ nảy tức thì hơn độ bền." } },
  { slug: "ryzonic-65", brandSlug: "gosen", brandName: "Gosen", name: "RYZONIC 65", gaugeMm: 0.65, crossGaugeMm: null, feel: "medium", durability: 4, repulsion: 5, control: 4, playStyleTags: ["speed", "all-round"], skillLevels: ["intermediate", "advanced"], summary: { en: "A modern, responsive 0.65 mm string balancing rebound and playing life.", vi: "Cước 0,65 mm hiện đại, nhạy, cân bằng độ nảy và thời gian sử dụng." } },
];

export const strings: BadmintonString[] = catalogue.map((string) => ({
  ...string,
  // Keep the original Yonex identifiers stable for databases seeded before the
  // catalogue expansion. New products include the brand to avoid collisions.
  id: ["bg65", "bg80-power", "exbolt-63", "bg66-ultimax", "aerobite"].includes(string.slug)
    ? `str-${string.slug}`
    : `str-${string.brandSlug}-${string.slug}`,
}));

const sellers = ["s-shuttle-pro-hn", "s-dong-do-sports", "s-vn-racket-store"];
const brandBasePrice: Record<string, number> = { yonex: 190_000, victor: 175_000, "li-ning": 165_000, gosen: 185_000 };

export const stringOffers: StringOffer[] = strings.flatMap((string, stringIndex) =>
  sellers.map((sellerId, sellerIndex) => ({
    id: `so-${string.brandSlug}-${string.slug}-${sellerIndex + 1}`,
    stringId: string.id,
    sellerId,
    price: brandBasePrice[string.brandSlug] + (stringIndex % 5) * 12_000 + sellerIndex * 14_000,
    currency: "VND" as const,
    qtyAvailable: 4 + (stringIndex % 9) + sellerIndex * 3,
    status: "live" as const,
    updatedAt: "2026-08-29T08:00:00.000Z",
  })),
);

export const stringPriceHistory: StringPricePoint[] = strings.flatMap((string, index) =>
  [60, 30, 0].map((daysAgo, point) => ({
    stringId: string.id,
    observedOn: new Date(Date.UTC(2026, 7, 29 - daysAgo)).toISOString().slice(0, 10),
    price: brandBasePrice[string.brandSlug] + (index % 5) * 12_000 + 15_000 - point * 7_500,
  })),
);
