"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Button, Eyebrow, Icon } from "@/components/ds/primitives";
import { Radio } from "@/components/ds/forms";
import { FINDER_KEYS } from "@/lib/finder";
import { beginNavigation } from "@/components/navigation-progress";

interface Question {
  key: (typeof FINDER_KEYS)[number];
  prompt: string;
  note?: string;
  options: { value: string; label: string }[];
}

/** Five questions, one per screen. Nothing is submitted until the last one,
 *  and every answer is visible in the URL afterwards so a result is shareable. */
export function FinderQuiz() {
  const t = useTranslations("finder");
  const tc = useTranslations("common");
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const questions: Question[] = [
    {
      key: "experience",
      prompt: t("q1"),
      options: [
        { value: "under1", label: t("q1a") },
        { value: "1to3", label: t("q1b") },
        { value: "over3", label: t("q1c") },
      ],
    },
    {
      key: "format",
      prompt: t("q2"),
      options: [
        { value: "singles", label: t("q2a") },
        { value: "doubles", label: t("q2b") },
        { value: "both", label: t("q2c") },
      ],
    },
    {
      key: "position",
      prompt: t("q3"),
      options: [
        { value: "net", label: t("q3a") },
        { value: "mid", label: t("q3b") },
        { value: "rear", label: t("q3c") },
      ],
    },
    {
      key: "injury",
      prompt: t("q4"),
      note: t("q4note"),
      options: [
        { value: "none", label: t("q4a") },
        { value: "sometimes", label: t("q4b") },
        { value: "ongoing", label: t("q4c") },
      ],
    },
    {
      key: "budget",
      prompt: t("q5"),
      options: [
        { value: "u15", label: t("q5a") },
        { value: "15to25", label: t("q5b") },
        { value: "25to35", label: t("q5c") },
        { value: "o35", label: t("q5d") },
      ],
    },
  ];

  const question = questions[step];
  const chosen = answers[question.key];
  const isLast = step === questions.length - 1;

  const [, startTransition] = useTransition();

  const advance = () => {
    if (!chosen) return;
    if (isLast) {
      beginNavigation();
      startTransition(() => {
        router.push({ pathname: "/finder", query: answers });
      });
      return;
    }
    setStep((current) => current + 1);
  };

  return (
    <div className="mx-auto max-w-[560px]">
      <div className="mb-2 flex items-center gap-3">
        <Eyebrow>{t("step", { current: step + 1, total: questions.length })}</Eyebrow>
        <div className="ml-auto flex gap-1">
          {questions.map((q, index) => (
            <span
              key={q.key}
              className={
                "h-1 w-6 rounded-full " +
                (index <= step ? "bg-[var(--green-700)]" : "bg-ink-200")
              }
            />
          ))}
        </div>
      </div>

      <h2 className="font-display text-h2 font-bold text-primary">
        {question.prompt}
      </h2>
      {question.note && (
        <p className="mt-2 text-body-sm text-tertiary">{question.note}</p>
      )}

      <div className="mt-5 flex flex-col gap-2.5">
        {question.options.map((option) => (
          <Radio
            key={option.value}
            name={question.key}
            value={option.value}
            label={option.label}
            checked={chosen === option.value}
            onChange={() =>
              setAnswers((current) => ({
                ...current,
                [question.key]: option.value,
              }))
            }
          />
        ))}
      </div>

      <div className="mt-6 flex items-center gap-3">
        {step > 0 && (
          <Button
            size="lg"
            variant="ghost"
            iconLeft="ArrowLeft"
            onClick={() => setStep((current) => current - 1)}
          >
            {tc("back")}
          </Button>
        )}
        <Button
          size="lg"
          variant="primary"
          disabled={!chosen}
          onClick={advance}
          className="ml-auto"
        >
          {isLast ? t("title") : tc("next")}
          <Icon name="ArrowRight" size="md" />
        </Button>
      </div>
    </div>
  );
}
