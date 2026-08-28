import type {
  Brand,
  Condition,
  Guide,
  GripSize,
  Offer,
  PricePoint,
  Racket,
  RacketVariant,
  Review,
  ReviewTier,
  Seller,
  WeightClass,
} from "@/lib/types";
import { WEIGHT_CLASS_GRAMS } from "@/lib/types";

/**
 * The seeded catalogue.
 *
 * This is the fallback the app runs on before a Supabase project is linked,
 * and it is also the source `supabase/seed.sql` is generated from, so the two
 * never drift. Everything derived (variants, offers, price history, reviews)
 * comes out of a deterministic generator — same input, same catalogue, on the
 * server and in the browser.
 */

/* ---------------------------------------------------------------- random */

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(rng: () => number, list: readonly T[]): T =>
  list[Math.floor(rng() * list.length) % list.length];

/* ---------------------------------------------------------------- brands */

export const brands: Brand[] = [
  { id: "b-yonex", slug: "yonex", name: "Yonex", country: "JP" },
  { id: "b-victor", slug: "victor", name: "Victor", country: "TW" },
  { id: "b-lining", slug: "li-ning", name: "Li-Ning", country: "CN" },
  { id: "b-mizuno", slug: "mizuno", name: "Mizuno", country: "JP" },
  { id: "b-kumpoo", slug: "kumpoo", name: "Kumpoo", country: "CN" },
  { id: "b-apacs", slug: "apacs", name: "Apacs", country: "MY" },
];

/* --------------------------------------------------------------- rackets */

type RacketSeed = Omit<
  Racket,
  "variants" | "brandName" | "id" | "heroImageUrl" | "heroThumbUrl"
> & {
  weightClasses: WeightClass[];
  gripSizes: GripSize[];
};

const racketSeeds: RacketSeed[] = [
  {
    slug: "astrox-88d-pro",
    brandSlug: "yonex",
    name: "Astrox 88D Pro",
    releaseYear: 2023,
    balancePointMm: 298,
    shaftFlex: "stiff",
    shaftDiameterMm: 6.8,
    frameShape: "isometric",
    frameMaterial: ["HM Graphite", "Namd", "Tungsten"],
    maxTensionLbs: [20, 28],
    lengthMm: 675,
    stringPattern: "22×21",
    msrp: 3_390_000,
    currency: "VND",
    playStyleTags: ["attack", "control"],
    skillLevel: "advanced",
    weightClasses: ["3U", "4U"],
    gripSizes: ["G4", "G5"],
    summary: {
      en: "Head-heavy, stiff shaft — built for rear-court attack. It needs a full swing to give anything back.",
      vi: "Nặng đầu, thân cứng — dành cho lối đánh tấn công cuối sân. Phải vung hết tay thì vợt mới trả lực.",
    },
  },
  {
    slug: "astrox-99-pro",
    brandSlug: "yonex",
    name: "Astrox 99 Pro",
    releaseYear: 2024,
    balancePointMm: 300,
    shaftFlex: "stiff",
    shaftDiameterMm: 6.9,
    frameShape: "isometric",
    frameMaterial: ["HM Graphite", "Namd", "Nanometric"],
    maxTensionLbs: [20, 28],
    lengthMm: 675,
    stringPattern: "22×21",
    msrp: 3_690_000,
    currency: "VND",
    playStyleTags: ["attack"],
    skillLevel: "advanced",
    weightClasses: ["3U", "4U"],
    gripSizes: ["G4", "G5"],
    summary: {
      en: "The heaviest head in the Astrox line. Clears come easy; the front court does not.",
      vi: "Đầu nặng nhất dòng Astrox. Cú phông rất nhẹ nhàng, nhưng trên lưới thì không.",
    },
  },
  {
    slug: "astrox-88s-pro",
    brandSlug: "yonex",
    name: "Astrox 88S Pro",
    releaseYear: 2023,
    balancePointMm: 291,
    shaftFlex: "medium",
    shaftDiameterMm: 6.8,
    frameShape: "isometric",
    frameMaterial: ["HM Graphite", "Namd"],
    maxTensionLbs: [20, 28],
    lengthMm: 675,
    stringPattern: "22×21",
    msrp: 3_350_000,
    currency: "VND",
    playStyleTags: ["all-round", "speed"],
    skillLevel: "intermediate",
    weightClasses: ["3U", "4U"],
    gripSizes: ["G4", "G5"],
    summary: {
      en: "The front-court half of the 88 pair. Even balance, softer shaft, quicker hands.",
      vi: "Nửa trên lưới của cặp 88. Cân bằng đều, thân mềm hơn, tay nhanh hơn.",
    },
  },
  {
    slug: "nanoflare-800-pro",
    brandSlug: "yonex",
    name: "Nanoflare 800 Pro",
    releaseYear: 2023,
    balancePointMm: 288,
    shaftFlex: "stiff",
    shaftDiameterMm: 6.6,
    frameShape: "aero-box",
    frameMaterial: ["HM Graphite", "Toraycar"],
    maxTensionLbs: [20, 28],
    lengthMm: 675,
    stringPattern: "22×21",
    msrp: 2_590_000,
    currency: "VND",
    playStyleTags: ["speed", "defence"],
    skillLevel: "advanced",
    weightClasses: ["4U", "5U"],
    gripSizes: ["G5", "G6"],
    summary: {
      en: "A speed frame with a stiff shaft — rare, and it only pays back a fast arm.",
      vi: "Khung tốc độ nhưng thân cứng — hiếm gặp, và chỉ trả lực cho tay vung nhanh.",
    },
  },
  {
    slug: "nanoflare-700",
    brandSlug: "yonex",
    name: "Nanoflare 700",
    releaseYear: 2022,
    balancePointMm: 285,
    shaftFlex: "medium",
    shaftDiameterMm: 6.8,
    frameShape: "aero-box",
    frameMaterial: ["Graphite", "Nanomesh Neo"],
    maxTensionLbs: [19, 27],
    lengthMm: 675,
    stringPattern: "22×21",
    msrp: 1_890_000,
    currency: "VND",
    playStyleTags: ["speed", "all-round"],
    skillLevel: "intermediate",
    weightClasses: ["4U", "5U"],
    gripSizes: ["G5", "G6"],
    summary: {
      en: "The safest first speed racket. Nothing about it punishes a slow swing.",
      vi: "Cây vợt tốc độ đầu tiên an toàn nhất. Không có gì trừng phạt cú vung chậm.",
    },
  },
  {
    slug: "arcsaber-11-pro",
    brandSlug: "yonex",
    name: "Arcsaber 11 Pro",
    releaseYear: 2022,
    balancePointMm: 292,
    shaftFlex: "medium",
    shaftDiameterMm: 6.7,
    frameShape: "isometric",
    frameMaterial: ["HM Graphite", "Namd", "Nanomesh"],
    maxTensionLbs: [20, 28],
    lengthMm: 675,
    stringPattern: "22×21",
    msrp: 3_290_000,
    currency: "VND",
    playStyleTags: ["control", "all-round"],
    skillLevel: "advanced",
    weightClasses: ["3U", "4U"],
    gripSizes: ["G4", "G5"],
    summary: {
      en: "Holds the shuttle longer than anything else in this price band. Placement over power.",
      vi: "Giữ cầu lâu hơn mọi cây khác cùng tầm giá. Đặt cầu hơn là ăn lực.",
    },
  },
  {
    slug: "astrox-77-pro",
    brandSlug: "yonex",
    name: "Astrox 77 Pro",
    releaseYear: 2022,
    balancePointMm: 296,
    shaftFlex: "medium",
    shaftDiameterMm: 6.9,
    frameShape: "isometric",
    frameMaterial: ["Graphite", "Namd"],
    maxTensionLbs: [19, 27],
    lengthMm: 675,
    stringPattern: "22×21",
    msrp: 2_490_000,
    currency: "VND",
    playStyleTags: ["attack", "all-round"],
    skillLevel: "intermediate",
    weightClasses: ["4U"],
    gripSizes: ["G5"],
    summary: {
      en: "Head-heavy without the stiff shaft tax. The usual step up from a starter racket.",
      vi: "Nặng đầu mà không phải trả giá bằng thân cứng. Bước nâng cấp quen thuộc từ vợt tập.",
    },
  },
  {
    slug: "thruster-ryuga-ii",
    brandSlug: "victor",
    name: "Thruster Ryuga II",
    releaseYear: 2023,
    balancePointMm: 301,
    shaftFlex: "extra-stiff",
    shaftDiameterMm: 6.8,
    frameShape: "isometric",
    frameMaterial: ["Graphite", "Nano Fortify TR+"],
    maxTensionLbs: [20, 30],
    lengthMm: 675,
    stringPattern: "22×21",
    msrp: 3_090_000,
    currency: "VND",
    playStyleTags: ["attack"],
    skillLevel: "advanced",
    weightClasses: ["3U", "4U"],
    gripSizes: ["G5"],
    summary: {
      en: "Takes 30 lbs and asks for it. The stiffest shaft in this comparison set.",
      vi: "Chịu được 30 lbs và đòi hỏi đúng mức đó. Thân cứng nhất trong nhóm so sánh này.",
    },
  },
  {
    slug: "auraspeed-90k",
    brandSlug: "victor",
    name: "Auraspeed 90K",
    releaseYear: 2022,
    balancePointMm: 286,
    shaftFlex: "stiff",
    shaftDiameterMm: 6.6,
    frameShape: "aero-box",
    frameMaterial: ["Graphite", "Hard Cored Technology"],
    maxTensionLbs: [20, 30],
    lengthMm: 675,
    stringPattern: "22×21",
    msrp: 2_490_000,
    currency: "VND",
    playStyleTags: ["speed", "defence"],
    skillLevel: "advanced",
    weightClasses: ["4U", "5U"],
    gripSizes: ["G5"],
    summary: {
      en: "Built for flat doubles exchanges. Loses to head-heavy frames from the back.",
      vi: "Sinh ra cho các pha cầu bằng trong đánh đôi. Từ cuối sân thì thua các khung nặng đầu.",
    },
  },
  {
    slug: "brave-sword-12",
    brandSlug: "victor",
    name: "Brave Sword 12",
    releaseYear: 2019,
    balancePointMm: 290,
    shaftFlex: "medium",
    shaftDiameterMm: 7.0,
    frameShape: "aero-box",
    frameMaterial: ["Graphite", "Nano Resin"],
    maxTensionLbs: [19, 28],
    lengthMm: 675,
    stringPattern: "22×21",
    msrp: 1_690_000,
    currency: "VND",
    playStyleTags: ["all-round", "speed"],
    skillLevel: "beginner",
    weightClasses: ["3U", "4U"],
    gripSizes: ["G5"],
    summary: {
      en: "Ten years old and still the honest answer for a first real racket.",
      vi: "Ra mắt đã mười năm và vẫn là câu trả lời thành thật cho cây vợt xịn đầu tiên.",
    },
  },
  {
    slug: "thruster-k-falcon",
    brandSlug: "victor",
    name: "Thruster K Falcon",
    releaseYear: 2021,
    balancePointMm: 297,
    shaftFlex: "medium",
    shaftDiameterMm: 7.0,
    frameShape: "isometric",
    frameMaterial: ["Graphite"],
    maxTensionLbs: [20, 28],
    lengthMm: 675,
    stringPattern: "22×21",
    msrp: 1_290_000,
    currency: "VND",
    playStyleTags: ["attack"],
    skillLevel: "beginner",
    weightClasses: ["4U"],
    gripSizes: ["G5"],
    summary: {
      en: "The cheapest head-heavy frame here that is not a counterfeit risk.",
      vi: "Khung nặng đầu rẻ nhất ở đây mà không kèm rủi ro hàng nhái.",
    },
  },
  {
    slug: "aeronaut-9000c",
    brandSlug: "li-ning",
    name: "Aeronaut 9000C",
    releaseYear: 2022,
    balancePointMm: 295,
    shaftFlex: "medium",
    shaftDiameterMm: 7.0,
    frameShape: "aero-box",
    frameMaterial: ["Carbon Fibre", "Aeronaut Tube"],
    maxTensionLbs: [20, 28],
    lengthMm: 675,
    stringPattern: "22×21",
    msrp: 2_590_000,
    currency: "VND",
    playStyleTags: ["all-round", "control"],
    skillLevel: "intermediate",
    weightClasses: ["3U", "4U"],
    gripSizes: ["G5", "G6"],
    summary: {
      en: "Trades power for a faster swing and a friendlier shaft. The comfortable one.",
      vi: "Đổi lực lấy nhịp vung nhanh hơn và thân vợt dễ chơi hơn. Cây êm tay nhất.",
    },
  },
  {
    slug: "axforce-90-dragon",
    brandSlug: "li-ning",
    name: "Axforce 90 Dragon",
    releaseYear: 2023,
    balancePointMm: 299,
    shaftFlex: "stiff",
    shaftDiameterMm: 6.8,
    frameShape: "aero-box",
    frameMaterial: ["Carbon Fibre", "Boron"],
    maxTensionLbs: [20, 30],
    lengthMm: 675,
    stringPattern: "22×21",
    msrp: 3_190_000,
    currency: "VND",
    playStyleTags: ["attack", "speed"],
    skillLevel: "advanced",
    weightClasses: ["3U", "4U"],
    gripSizes: ["G5"],
    summary: {
      en: "Head-heavy with an aero frame — heavy shots without the usual swing penalty.",
      vi: "Nặng đầu trên khung khí động — cú đánh nặng mà không phải trả giá bằng nhịp vung.",
    },
  },
  {
    slug: "windstorm-72",
    brandSlug: "li-ning",
    name: "Windstorm 72",
    releaseYear: 2021,
    balancePointMm: 283,
    shaftFlex: "flexible",
    shaftDiameterMm: 6.6,
    frameShape: "aero-box",
    frameMaterial: ["Carbon Fibre"],
    maxTensionLbs: [18, 26],
    lengthMm: 675,
    stringPattern: "22×21",
    msrp: 1_490_000,
    currency: "VND",
    playStyleTags: ["speed", "defence"],
    skillLevel: "beginner",
    weightClasses: ["5U"],
    gripSizes: ["G5", "G6"],
    summary: {
      en: "72 grams and a flexible shaft. Kind to a sore shoulder, quiet from the back.",
      vi: "72 gram với thân dẻo. Nhẹ nhàng cho vai đau, nhưng im tiếng ở cuối sân.",
    },
  },
  {
    slug: "fortius-11-power",
    brandSlug: "mizuno",
    name: "Fortius 11 Power",
    releaseYear: 2022,
    balancePointMm: 297,
    shaftFlex: "stiff",
    shaftDiameterMm: 6.9,
    frameShape: "isometric",
    frameMaterial: ["Graphite", "Toray M40X"],
    maxTensionLbs: [20, 28],
    lengthMm: 675,
    stringPattern: "22×21",
    msrp: 2_290_000,
    currency: "VND",
    playStyleTags: ["attack"],
    skillLevel: "intermediate",
    weightClasses: ["3U", "4U"],
    gripSizes: ["G5"],
    summary: {
      en: "The quiet alternative to an Astrox, at two thirds of the price.",
      vi: "Lựa chọn kín tiếng thay cho Astrox, ở hai phần ba mức giá.",
    },
  },
  {
    slug: "altius-01-feel",
    brandSlug: "mizuno",
    name: "Altius 01 Feel",
    releaseYear: 2021,
    balancePointMm: 287,
    shaftFlex: "medium",
    shaftDiameterMm: 6.8,
    frameShape: "isometric",
    frameMaterial: ["Graphite"],
    maxTensionLbs: [19, 27],
    lengthMm: 675,
    stringPattern: "22×21",
    msrp: 1_790_000,
    currency: "VND",
    playStyleTags: ["control", "defence"],
    skillLevel: "intermediate",
    weightClasses: ["4U"],
    gripSizes: ["G5"],
    summary: {
      en: "Even balance, medium shaft, nothing dramatic. That is the whole pitch.",
      vi: "Cân bằng đều, thân trung bình, không có gì kịch tính. Đó là toàn bộ điểm mạnh.",
    },
  },
  {
    slug: "power-control-900",
    brandSlug: "kumpoo",
    name: "Power Control 900",
    releaseYear: 2023,
    balancePointMm: 293,
    shaftFlex: "medium",
    shaftDiameterMm: 6.9,
    frameShape: "isometric",
    frameMaterial: ["Carbon Fibre"],
    maxTensionLbs: [20, 28],
    lengthMm: 675,
    stringPattern: "22×21",
    msrp: 1_390_000,
    currency: "VND",
    playStyleTags: ["all-round"],
    skillLevel: "beginner",
    weightClasses: ["4U", "5U"],
    gripSizes: ["G5", "G6"],
    summary: {
      en: "Sold mostly in club shops. The specs check out; the resale value does not.",
      vi: "Chủ yếu bán ở cửa hàng câu lạc bộ. Thông số thì ổn; giá bán lại thì không.",
    },
  },
  {
    slug: "feather-weight-55",
    brandSlug: "apacs",
    name: "Feather Weight 55",
    releaseYear: 2020,
    balancePointMm: 281,
    shaftFlex: "flexible",
    shaftDiameterMm: 6.6,
    frameShape: "conventional",
    frameMaterial: ["Graphite"],
    maxTensionLbs: [18, 24],
    lengthMm: 675,
    stringPattern: "22×21",
    msrp: 990_000,
    currency: "VND",
    playStyleTags: ["defence", "speed"],
    skillLevel: "beginner",
    weightClasses: ["5U"],
    gripSizes: ["G5", "G6"],
    summary: {
      en: "The lightest frame in the catalogue. Buy it for a recovering elbow, not for power.",
      vi: "Khung nhẹ nhất trong danh mục. Mua khi khuỷu tay đang hồi phục, không phải để lấy lực.",
    },
  },
];

function buildVariants(seed: RacketSeed, racketId: string): RacketVariant[] {
  const rng = mulberry32(hashSeed(`${seed.slug}:variants`));
  const variants: RacketVariant[] = [];

  for (const weightClass of seed.weightClasses) {
    const [minG, maxG] = WEIGHT_CLASS_GRAMS[weightClass];
    const grams = minG + Math.round(rng() * (maxG - minG));
    for (const gripSize of seed.gripSizes) {
      variants.push({
        id: `v-${seed.slug}-${weightClass}-${gripSize}`.toLowerCase(),
        racketId,
        weightClass,
        weightGrams: grams,
        gripSize,
        colourway: null,
        sku: `${seed.brandSlug.toUpperCase().slice(0, 3)}-${seed.slug
          .split("-")
          .map((part) => part.slice(0, 3).toUpperCase())
          .join("")}-${weightClass}${gripSize}`,
      });
    }
  }

  return variants;
}

export const rackets: Racket[] = racketSeeds.map((seed) => {
  const id = `r-${seed.slug}`;
  const brand = brands.find((b) => b.slug === seed.brandSlug)!;
  const { weightClasses: _wc, gripSizes: _gs, ...rest } = seed;
  return {
    ...rest,
    id,
    brandName: brand.name,
    // The seed carries no photography: it exists so the app renders without a
    // database, and the card falls back to the brand mark.
    heroImageUrl: null,
    heroThumbUrl: null,
    images: [],
    variants: buildVariants(seed, id),
  };
});

export const racketById = new Map(rackets.map((r) => [r.id, r]));
export const variantById = new Map(
  rackets.flatMap((r) => r.variants.map((v) => [v.id, v] as const)),
);

/* --------------------------------------------------------------- sellers */

export const sellers: Seller[] = [
  {
    id: "s-shuttle-pro-hn",
    slug: "shuttle-pro-hn",
    name: "Shuttle Pro HN",
    tier: "authorised",
    city: "Hà Nội",
    rating: 4.8,
    ordersCount: 1240,
    disputeRate: 0.004,
    since: 2019,
    about: {
      en: "Distributor agreement with Yonex Vietnam on file. Stringing on site, same day.",
      vi: "Có hợp đồng phân phối với Yonex Việt Nam. Đan lưới tại chỗ, trả trong ngày.",
    },
  },
  {
    id: "s-dong-do-sports",
    slug: "dong-do-sports",
    name: "Đông Đô Sports",
    tier: "authorised",
    city: "Hà Nội",
    rating: 4.9,
    ordersCount: 2110,
    disputeRate: 0.003,
    since: 2016,
    about: {
      en: "Two shops in Đống Đa. Serials are photographed at intake and kept on file.",
      vi: "Hai cửa hàng ở Đống Đa. Số serial được chụp lúc nhập và lưu lại hồ sơ.",
    },
  },
  {
    id: "s-vn-racket-store",
    slug: "vn-racket-store",
    name: "VN Racket Store",
    tier: "verified",
    city: "TP. Hồ Chí Minh",
    rating: 4.6,
    ordersCount: 860,
    disputeRate: 0.011,
    since: 2020,
    about: {
      en: "Online only. Ships nationwide in 2 days, 7-day return on unstrung frames.",
      vi: "Chỉ bán online. Giao toàn quốc trong 2 ngày, đổi trả 7 ngày với vợt chưa đan.",
    },
  },
  {
    id: "s-cau-long-24h",
    slug: "cau-long-24h",
    name: "Cầu Lông 24h",
    tier: "verified",
    city: "Đà Nẵng",
    rating: 4.5,
    ordersCount: 410,
    disputeRate: 0.018,
    since: 2021,
    about: {
      en: "Club shop attached to three courts. Try before you buy on weekday evenings.",
      vi: "Cửa hàng gắn với ba sân tập. Được thử vợt trước khi mua vào các tối trong tuần.",
    },
  },
  {
    id: "s-racket-lab-sg",
    slug: "racket-lab-sg",
    name: "Racket Lab SG",
    tier: "verified",
    city: "TP. Hồ Chí Minh",
    rating: 4.4,
    ordersCount: 320,
    disputeRate: 0.015,
    since: 2022,
    about: {
      en: "Specialises in used and open-box frames. Every listing carries intake photos.",
      vi: "Chuyên vợt cũ và hàng khui hộp. Mọi tin đăng đều kèm ảnh lúc nhập.",
    },
  },
  {
    id: "s-smash-corner",
    slug: "smash-corner",
    name: "Smash Corner",
    tier: "new",
    city: "Hải Phòng",
    rating: 0,
    ordersCount: 6,
    disputeRate: 0,
    since: 2026,
    about: {
      en: "Approved in February. First three listings were checked by hand.",
      vi: "Được duyệt hồi tháng Hai. Ba tin đăng đầu đã được kiểm tra thủ công.",
    },
  },
];

export const sellerById = new Map(sellers.map((s) => [s.id, s]));

/* ---------------------------------------------------------------- offers */

const CONDITIONS: Condition[] = [
  "new",
  "new",
  "new",
  "new",
  "open-box",
  "used-excellent",
  "used-good",
];

export const offers: Offer[] = rackets.flatMap((racket) => {
  const rng = mulberry32(hashSeed(`${racket.slug}:offers`));
  const sellerCount = 2 + Math.floor(rng() * 5);
  const shuffled = [...sellers].sort(
    (a, b) => hashSeed(a.id + racket.slug) - hashSeed(b.id + racket.slug),
  );

  return shuffled.slice(0, sellerCount).map((seller, index) => {
    const variant = racket.variants[Math.floor(rng() * racket.variants.length)];
    const condition =
      seller.tier === "authorised" ? "new" : pick(rng, CONDITIONS);
    const usedDiscount = condition === "new" ? 0 : condition === "open-box" ? 0.14 : 0.26;
    const spread = 0.88 + rng() * 0.16;
    const price =
      Math.round((racket.msrp * spread * (1 - usedDiscount)) / 10_000) * 10_000;

    const qtyRoll = rng();
    const qtyAvailable =
      qtyRoll > 0.78 ? 1 + Math.floor(rng() * 3) : Math.floor(rng() * 22);

    return {
      id: `o-${racket.slug}-${seller.slug}-${index}`,
      variantId: variant.id,
      racketId: racket.id,
      sellerId: seller.id,
      price,
      currency: "VND" as const,
      qtyAvailable,
      condition,
      warrantyMonths: condition === "new" ? 12 : 0,
      includesStringing: seller.tier === "authorised" && rng() > 0.4,
      shipsFrom: seller.city,
      leadTimeDays: 1 + Math.floor(rng() * 4),
      promoted: rng() > 0.86,
      status: "live" as const,
      updatedAt: new Date(2026, 7, 10 + Math.floor(rng() * 7)).toISOString(),
    };
  });
});

/* --------------------------------------------------------- price history */

const HISTORY_DAYS = 90;
const HISTORY_POINTS = 24;

export const priceHistory: PricePoint[] = rackets.flatMap((racket) => {
  const variants = racket.variants;
  return variants.flatMap((variant) => {
    const rng = mulberry32(hashSeed(`${variant.id}:history`));
    // Drift is per-variant so the catalogue does not move in lockstep, and is
    // skewed downward: street prices on last season's frames mostly fall.
    const drift = (rng() - 0.68) * 0.26;
    const base = racket.msrp * (0.9 + rng() * 0.08);
    const points: PricePoint[] = [];

    for (let i = 0; i < HISTORY_POINTS; i++) {
      const t = i / (HISTORY_POINTS - 1);
      const noise = (rng() - 0.5) * 0.02;
      const price = base * (1 + drift * t + noise);
      const daysAgo = Math.round(HISTORY_DAYS * (1 - t));
      const date = new Date(Date.UTC(2026, 7, 17) - daysAgo * 86_400_000);
      points.push({
        variantId: variant.id,
        observedOn: date.toISOString().slice(0, 10),
        price: Math.round(price / 10_000) * 10_000,
      });
    }

    return points;
  });
});

/* --------------------------------------------------------------- reviews */

const REVIEW_TIERS: ReviewTier[] = [
  "purchase",
  "purchase",
  "owner",
  "owner",
  "community",
];

const REVIEW_BODIES: { en: string; vi: string }[] = [
  {
    en: "Heavier through the head than my last frame. Clears are easier from the back, but the third shot in a fast exchange is late.",
    vi: "Đầu nặng hơn cây cũ của tôi. Phông từ cuối sân nhẹ hơn, nhưng tới quả thứ ba trong pha cầu nhanh thì đã trễ.",
  },
  {
    en: "Holds shape after four months of twice-weekly play. Elbow gets sore if I string it any tighter.",
    vi: "Sau bốn tháng đánh hai buổi mỗi tuần vẫn giữ dáng. Căng cao hơn nữa là khuỷu tay đau.",
  },
  {
    en: "Bought it for doubles at the net and it does that job. From the rear court it asks for a full swing every time.",
    vi: "Mua để đánh đôi trên lưới và nó làm tốt việc đó. Từ cuối sân thì lần nào cũng phải vung hết tay.",
  },
  {
    en: "The shaft is softer than the marketing says. That suits me — smashes land where I aim rather than long.",
    vi: "Thân mềm hơn quảng cáo. Với tôi thì hợp — cú đập rơi đúng chỗ nhắm chứ không ra ngoài.",
  },
  {
    en: "Strung at 26 lbs with BG80. Repulsion is fine, but the sweet spot is smaller than I expected for the price.",
    vi: "Đan BG80 ở 26 lbs. Độ nảy ổn, nhưng vùng ngọt nhỏ hơn tôi nghĩ so với mức giá.",
  },
  {
    en: "Second one I have owned. Same weight, same balance out of the box, which is not true of every brand at this price.",
    vi: "Đây là cây thứ hai tôi dùng. Trọng lượng và cân bằng giống hệt cây đầu, điều mà không phải hãng nào ở tầm giá này cũng làm được.",
  },
  {
    en: "Light enough to defend flat drives all evening. It does not have a finishing shot in it.",
    vi: "Đủ nhẹ để đỡ cầu bằng suốt cả buổi. Nhưng không có cú kết thúc điểm.",
  },
];

const REVIEW_NAMES = [
  "Minh N.",
  "Hương T.",
  "Tuấn A.",
  "Quang L.",
  "Linh P.",
  "Đức H.",
  "Trang V.",
  "Bảo K.",
  "Nam Đ.",
  "Thảo M.",
];

const STRINGS = ["BG80", "BG65 Ti", "Exbolt 63", "Aerobite", "NBG95", "VBS-66N"];

export const reviews: Review[] = rackets.flatMap((racket) => {
  const rng = mulberry32(hashSeed(`${racket.slug}:reviews`));
  // Flagship frames have review volume; the cheap club rackets do not, which
  // is what puts a "spec profile only" state on real pages.
  const base = racket.msrp > 2_400_000 ? 6 : 1;
  const count = base + Math.floor(rng() * 7);

  return Array.from({ length: count }, (_, i) => {
    const balanceBias = (racket.balancePointMm - 292) / 12;
    const flexBias =
      racket.shaftFlex === "extra-stiff"
        ? -0.5
        : racket.shaftFlex === "stiff"
          ? -0.25
          : racket.shaftFlex === "flexible"
            ? 0.4
            : 0;

    const axis = (bias: number) =>
      Math.min(5, Math.max(1, Math.round((3.6 + bias + (rng() - 0.5) * 1.4) * 2) / 2));

    // Reviewers skew toward the level the racket is built for. A page full of
    // beginners reviewing a stiff 3U frame would make the "filter to players
    // like me" feature meaningless.
    const skillPool =
      racket.skillLevel === "advanced"
        ? (["advanced", "advanced", "intermediate"] as const)
        : racket.skillLevel === "intermediate"
          ? (["intermediate", "intermediate", "advanced", "beginner"] as const)
          : (["beginner", "beginner", "intermediate"] as const);

    return {
      id: `rev-${racket.slug}-${i}`,
      racketId: racket.id,
      authorName: REVIEW_NAMES[(hashSeed(racket.slug) + i) % REVIEW_NAMES.length],
      tier: REVIEW_TIERS[Math.floor(rng() * REVIEW_TIERS.length)],
      skillLevel: pick(rng, skillPool),
      format: pick(rng, ["singles", "doubles"] as const),
      position: pick(rng, ["net", "mid", "rear"] as const),
      stringModel: pick(rng, STRINGS),
      tensionLbs: 22 + Math.floor(rng() * 7),
      power: axis(balanceBias * 0.9),
      speed: axis(-balanceBias * 0.9),
      control: axis(0.1),
      comfort: axis(flexBias),
      body: REVIEW_BODIES[(hashSeed(racket.slug) + i * 3) % REVIEW_BODIES.length],
      createdAt: new Date(
        Date.UTC(2026, 7, 17) - Math.floor(rng() * 240) * 86_400_000,
      ).toISOString(),
    };
  });
});

/* ---------------------------------------------------------------- guides */

export const guides: Guide[] = [
  {
    slug: "spot-a-fake-astrox-88d-pro",
    title: {
      en: "How to spot a fake Astrox 88D Pro",
      vi: "Cách nhận ra Astrox 88D Pro giả",
    },
    excerpt: {
      en: "Serial placement, grommet finish, cone weight.",
      vi: "Vị trí số serial, đường viền gen, trọng lượng chuôi.",
    },
    readMinutes: 6,
    tone: "default",
  },
  {
    slug: "what-balance-point-changes",
    title: {
      en: "What balance point actually changes",
      vi: "Điểm cân bằng thực sự thay đổi điều gì",
    },
    excerpt: {
      en: "Read the ruler before you read the reviews.",
      vi: "Đọc thước cân bằng trước khi đọc đánh giá.",
    },
    readMinutes: 4,
    tone: "default",
  },
  {
    slug: "buying-used-what-to-check",
    title: {
      en: "Buying used: what to check in person",
      vi: "Mua vợt cũ: cần kiểm tra gì khi gặp trực tiếp",
    },
    excerpt: {
      en: "Cracks, replaced grommets, re-glued joints.",
      vi: "Vết nứt, gen thay mới, mối nối dán lại.",
    },
    readMinutes: 8,
    tone: "used",
  },
  {
    slug: "string-tension-for-your-level",
    title: {
      en: "String tension for your level, not your idol's",
      vi: "Căng lưới theo trình độ của bạn, không phải của thần tượng",
    },
    excerpt: {
      en: "Why 30 lbs makes most club players worse.",
      vi: "Vì sao 30 lbs khiến phần lớn người chơi phong trào đánh tệ hơn.",
    },
    readMinutes: 5,
    tone: "default",
  },
];
