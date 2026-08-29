"use client";

import { useMemo, useState } from "react";
import { Check, CircleGauge, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { PlayStyle, SkillLevel } from "@/lib/types";

type StringChoice = {
  model: string;
  gauge: string;
  feel: "soft" | "medium" | "hard";
};

const STRINGS: Record<PlayStyle, StringChoice> = {
  attack: { model: "Yonex BG80 Power", gauge: "0.68 mm", feel: "hard" },
  "all-round": { model: "Yonex BG65", gauge: "0.70 mm", feel: "medium" },
  speed: { model: "Yonex Exbolt 63", gauge: "0.63 mm", feel: "medium" },
  defence: { model: "Yonex BG66 Ultimax", gauge: "0.65 mm", feel: "soft" },
  control: { model: "Yonex Aerobite", gauge: "0.67 / 0.61 mm", feel: "medium" },
};

const STRING_SLUGS: Record<PlayStyle, string> = {
  attack: "bg80-power",
  "all-round": "bg65",
  speed: "exbolt-63",
  defence: "bg66-ultimax",
  control: "aerobite",
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
    const string = STRINGS[style];
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
          <Link href={`/strings/yonex/${STRING_SLUGS[style]}`} className="mt-4 inline-flex min-h-11 items-center font-semibold no-underline hover:underline">
            {t("comparePrices")}
          </Link>
        </div>
      </div>
    </section>
  );
}
