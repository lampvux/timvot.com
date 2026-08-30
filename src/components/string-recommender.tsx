"use client";

import { useMemo, useState } from "react";
import { Check, CircleGauge, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { PlayStyle, SkillLevel } from "@/lib/types";

type StringChoice = {
  model: string;
  brandSlug: string;
  stringSlug: string;
  gauge: string;
  feel: "soft" | "medium" | "hard";
};

const choice = (model: string, brandSlug: string, stringSlug: string, gauge: string, feel: StringChoice["feel"]): StringChoice =>
  ({ model, brandSlug, stringSlug, gauge, feel });

// Skill changes more than tension: newer players get durable, forgiving
// strings while advanced players get thinner or firmer performance options.
const STRINGS: Record<SkillLevel, Record<PlayStyle, StringChoice>> = {
  beginner: {
    attack: choice("Yonex BG65 Titanium", "yonex", "bg65-titanium", "0.70 mm", "hard"),
    "all-round": choice("Yonex BG65", "yonex", "bg65", "0.70 mm", "medium"),
    speed: choice("Victor VBS-70", "victor", "vbs-70", "0.70 mm", "medium"),
    defence: choice("Li-Ning No.7", "li-ning", "no-7", "0.70 mm", "medium"),
    control: choice("Li-Ning No.7", "li-ning", "no-7", "0.70 mm", "medium"),
  },
  intermediate: {
    attack: choice("Li-Ning No.1 Boost", "li-ning", "no-1-boost", "0.66 mm", "hard"),
    "all-round": choice("Li-Ning No.5", "li-ning", "no-5", "0.69 mm", "medium"),
    speed: choice("Victor VBS-66 Nano", "victor", "vbs-66-nano", "0.66 mm", "medium"),
    defence: choice("Gosen RYZONIC 65", "gosen", "ryzonic-65", "0.65 mm", "medium"),
    control: choice("Yonex BG80", "yonex", "bg80", "0.68 mm", "hard"),
  },
  advanced: {
    attack: choice("Yonex BG80 Power", "yonex", "bg80-power", "0.68 mm", "hard"),
    "all-round": choice("Gosen RYZONIC 65", "gosen", "ryzonic-65", "0.65 mm", "medium"),
    speed: choice("Gosen G-TONE 58", "gosen", "g-tone-58", "0.58 mm", "medium"),
    defence: choice("Yonex Exbolt 63", "yonex", "exbolt-63", "0.63 mm", "medium"),
    control: choice("Yonex Aerobite Boost", "yonex", "aerobite-boost", "0.72 / 0.61 mm", "hard"),
  },
};

const SKILLS: SkillLevel[] = ["beginner", "intermediate", "advanced"];
const STYLES: PlayStyle[] = ["attack", "all-round", "speed", "defence", "control"];

export function StringRecommender({
  racketName,
  maxTension,
  initialSkill,
  initialStyle,
}: {
  racketName: string;
  maxTension: [number, number];
  initialSkill: SkillLevel;
  initialStyle: PlayStyle;
}) {
  const t = useTranslations("stringRecommender");
  const te = useTranslations("enums");
  const [skill, setSkill] = useState(initialSkill);
  const [style, setStyle] = useState(initialStyle);

  const recommendation = useMemo(() => {
    const string = STRINGS[skill][style];
    const preferred: Record<SkillLevel, [number, number]> = {
      beginner: [20, 22],
      intermediate: [23, 25],
      advanced: [26, 28],
    };
    const racketCeiling = Math.max(...maxTension);
    const low = Math.min(preferred[skill][0], racketCeiling);
    const high = Math.min(preferred[skill][1], racketCeiling);
    return { ...string, tension: low === high ? `${high}` : `${low}–${high}` };
  }, [maxTension, skill, style]);

  const skillLabel = (value: SkillLevel) =>
    te(
      value === "beginner"
        ? "skillBeginner"
        : value === "intermediate"
          ? "skillIntermediate"
          : "skillAdvanced",
    );
  const styleLabel = (value: PlayStyle) =>
    te(
      value === "attack"
        ? "styleAttack"
        : value === "all-round"
          ? "styleAllRound"
          : value === "speed"
            ? "styleSpeed"
            : value === "defence"
              ? "styleDefence"
              : "styleControl",
    );

  return (
    <section
      aria-labelledby="string-finder-heading"
      className="mt-6 overflow-hidden rounded-lg border border-line bg-card shadow-1"
    >
      <div className="border-b border-line bg-brand-soft px-5 py-5 sm:px-6">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-green-700 text-white">
            <Sparkles aria-hidden size={18} strokeWidth={1.75} />
          </span>
          <div>
            <p className="eyebrow text-brand">{t("eyebrow")}</p>
            <h2 id="string-finder-heading" className="mt-1 font-display text-[22px] font-bold leading-tight text-primary">
              {t("title")}
            </h2>
            <p className="mt-1.5 max-w-[60ch] text-body-sm text-secondary">{t("intro", { racket: racketName })}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[1fr_0.9fr]">
        <div className="space-y-6">
          <fieldset>
            <legend className="text-[13.5px] font-semibold text-primary">{t("skillQuestion")}</legend>
            <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
              {SKILLS.map((value) => (
                <label key={value} className="cursor-pointer">
                  <input className="peer sr-only" type="radio" name="string-skill" value={value} checked={skill === value} onChange={() => setSkill(value)} />
                  <span className="flex min-h-11 items-center justify-center rounded-md border border-line-strong bg-card px-3 text-center text-[13px] font-semibold text-secondary transition-colors peer-checked:border-green-700 peer-checked:bg-brand-soft peer-checked:text-brand peer-focus-visible:ring-3 peer-focus-visible:ring-cyan-500/30">
                    {skillLabel(value)}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-[13.5px] font-semibold text-primary">{t("styleQuestion")}</legend>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {STYLES.map((value) => (
                <label key={value} className="cursor-pointer">
                  <input className="peer sr-only" type="radio" name="string-style" value={value} checked={style === value} onChange={() => setStyle(value)} />
                  <span className="flex min-h-11 items-center rounded-full border border-line-strong bg-card px-4 text-[13px] font-semibold text-secondary transition-colors peer-checked:border-green-700 peer-checked:bg-brand-soft peer-checked:text-brand peer-focus-visible:ring-3 peer-focus-visible:ring-cyan-500/30">
                    {styleLabel(value)}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <div className="rounded-md border border-green-200 bg-green-50 p-5" aria-live="polite">
          <div className="flex items-center gap-2 text-green-800">
            <Check aria-hidden size={18} strokeWidth={2} />
            <span className="eyebrow !text-green-800">{t("yourSetup")}</span>
          </div>
          <p className="mt-3 font-display text-[24px] font-bold leading-tight text-primary">{recommendation.model}</p>
          <div className="mt-3 flex flex-wrap gap-2 font-mono text-[11px] text-secondary">
            <span className="rounded-sm border border-green-200 bg-white px-2 py-1">{recommendation.gauge}</span>
            <span className="rounded-sm border border-green-200 bg-white px-2 py-1">{t(`feel.${recommendation.feel}`)}</span>
          </div>
          <div className="mt-5 flex items-center gap-3 border-t border-green-200 pt-4">
            <CircleGauge aria-hidden className="text-green-700" size={22} strokeWidth={1.75} />
            <div>
              <p className="text-[12px] font-medium text-secondary">{t("tension")}</p>
              <p className="font-mono text-[18px] font-semibold tabular-nums text-primary">{recommendation.tension} lbs</p>
            </div>
          </div>
          <p className="mt-4 text-body-sm text-secondary">{t(`reason.${style}`, { skill: skillLabel(skill).toLowerCase() })}</p>
          <p className="mt-3 text-[11.5px] leading-relaxed text-tertiary">{t("safety", { max: Math.max(...maxTension) })}</p>
          <Link href={`/strings/${recommendation.brandSlug}/${recommendation.stringSlug}`} className="mt-4 inline-flex min-h-11 items-center font-semibold no-underline hover:underline">
            {t("comparePrices")}
          </Link>
        </div>
      </div>
    </section>
  );
}
