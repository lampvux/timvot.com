"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Button, Icon, cx } from "@/components/ds/primitives";
import { Field, Input, Radio, Select } from "@/components/ds/forms";
import { beginNavigation } from "@/components/navigation-progress";
import { parsePriceVnd, type CheckInput } from "@/lib/listing-check/input";
import { searchTokens, type RacketCandidate } from "@/lib/listing-check/match";
import { formatDong, variantCode } from "@/lib/format";
import { LISTING_CONDITIONS, type ListingCondition } from "@/lib/price-context";

type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; candidates: RacketCandidate[] }
  | { status: "error" };

const CONDITION_LABEL: Record<ListingCondition, string> = {
  new: "conditionNew",
  "open-box": "conditionOpenBox",
  used: "conditionUsed",
  unknown: "conditionUnknown",
};

/**
 * The listing check's form. Everything it collects goes into the URL of the
 * result page and nowhere else; the server validates it all again.
 *
 * The model field is a combobox over `/api/rackets/search`: debounced,
 * aborted on the next keystroke, and never guessing. The buyer confirms a
 * model or explicitly continues without one.
 */
export function CheckForm({
  initial,
  initialModel,
}: {
  initial: CheckInput;
  initialModel: RacketCandidate | null;
}) {
  const t = useTranslations("checkForm");
  const tf = useTranslations("finder");
  const router = useRouter();
  const [, startTransition] = useTransition();
  const ids = useId();

  const [text, setText] = useState(
    initialModel ? `${initialModel.brandName} ${initialModel.name}` : initial.query,
  );
  const [selected, setSelected] = useState<RacketCandidate | null>(initialModel);
  const [search, setSearch] = useState<SearchState>({ status: "idle" });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [variantId, setVariantId] = useState(initial.variantId ?? "");
  const [priceText, setPriceText] = useState(
    initial.priceVnd === null ? "" : formatDong(initial.priceVnd).replace("₫", ""),
  );
  const [condition, setCondition] = useState<ListingCondition>(initial.condition);
  const [profile, setProfile] = useState({
    exp: initial.profile.experience ?? "",
    fmt: initial.profile.format ?? "",
    pos: initial.profile.position ?? "",
  });
  const [submitted, setSubmitted] = useState(false);
  // Open once if the buyer already answered; after that the buyer owns it.
  const [profileOpen] = useState(Boolean(profile.exp || profile.fmt || profile.pos));
  const cacheRef = useRef(new Map<string, RacketCandidate[]>());

  const tokens = selected ? null : searchTokens(text);
  const tokenKey = tokens?.join(" ") ?? "";

  useEffect(() => {
    if (!tokenKey) {
      setSearch({ status: "idle" });
      return;
    }
    const cached = cacheRef.current.get(tokenKey);
    if (cached) {
      setSearch({ status: "done", candidates: cached });
      return;
    }

    const controller = new AbortController();
    setSearch({ status: "loading" });
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/rackets/search?q=${encodeURIComponent(tokenKey)}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as { candidates: RacketCandidate[] };
        cacheRef.current.set(tokenKey, body.candidates);
        setSearch({ status: "done", candidates: body.candidates });
        setActive(-1);
      } catch {
        if (!controller.signal.aborted) setSearch({ status: "error" });
      }
    }, 220);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [tokenKey]);

  const candidates = search.status === "done" ? search.candidates : [];
  const listOpen = open && !selected && candidates.length > 0;
  const priceVnd = priceText.trim() ? parsePriceVnd(priceText) : null;
  const priceInvalid = priceText.trim() !== "" && priceVnd === null;
  const canContinueUnconfirmed = !selected && Boolean(tokens) && search.status !== "loading";

  const choose = (candidate: RacketCandidate) => {
    setSelected(candidate);
    setText(`${candidate.brandName} ${candidate.name}`);
    setVariantId(candidate.variants.length === 1 ? candidate.variants[0].id : "");
    setOpen(false);
  };

  const clearModel = () => {
    setSelected(null);
    setVariantId("");
    setOpen(true);
  };

  const submit = (unconfirmed = false) => {
    setSubmitted(true);
    if (priceInvalid || (!selected && !unconfirmed)) return;

    const query: Record<string, string> = {};
    if (selected) query.model = `${selected.brandSlug}/${selected.slug}`;
    else query.q = text.trim();
    if (selected && variantId) query.variant = variantId;
    if (priceVnd !== null) query.price = String(priceVnd);
    if (condition !== "unknown") query.condition = condition;
    for (const [key, value] of Object.entries(profile)) if (value) query[key] = value;

    beginNavigation();
    startTransition(() => router.push({ pathname: "/check", query }));
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && candidates.length) {
      event.preventDefault();
      setOpen(true);
      setActive((index) => (index + 1) % candidates.length);
    } else if (event.key === "ArrowUp" && candidates.length) {
      event.preventDefault();
      setActive((index) => (index <= 0 ? candidates.length - 1 : index - 1));
    } else if (event.key === "Enter" && listOpen && active >= 0) {
      event.preventDefault();
      choose(candidates[active]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  };

  const status =
    selected
      ? ""
      : search.status === "loading"
        ? t("searching")
        : search.status === "error"
          ? t("searchError")
          : search.status === "done"
            ? candidates.length
              ? t("suggestions", { count: candidates.length })
              : t("noMatch")
            : "";

  const listId = `${ids}-models`;
  const optionId = (index: number) => `${ids}-model-${index}`;

  return (
    <form
      className="mx-auto flex max-w-[560px] flex-col gap-6"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {/* Model */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${ids}-model`} className="text-[13.5px] font-semibold leading-none text-primary">
          {t("modelLabel")}
        </label>
        <div className="relative">
          <Input
            id={`${ids}-model`}
            size="lg"
            iconLeft="Search"
            role="combobox"
            autoComplete="off"
            spellCheck={false}
            maxLength={60}
            placeholder={t("modelPlaceholder")}
            aria-autocomplete="list"
            aria-expanded={listOpen}
            aria-controls={listId}
            aria-activedescendant={listOpen && active >= 0 ? optionId(active) : undefined}
            aria-describedby={`${ids}-model-hint ${ids}-model-status`}
            aria-invalid={submitted && !selected && !canContinueUnconfirmed}
            value={text}
            readOnly={Boolean(selected)}
            onChange={(event) => {
              setText(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={onKeyDown}
            className={selected ? "pr-20" : undefined}
          />
          {selected && (
            <button
              type="button"
              onClick={clearModel}
              className="absolute right-1.5 top-1/2 h-9 -translate-y-1/2 rounded-md px-3 text-[13.5px] font-semibold text-brand hover:bg-[var(--action-ghost-bg-hover)]"
            >
              {t("changeModel")}
            </button>
          )}
          <ul
            id={listId}
            role="listbox"
            aria-label={t("modelLabel")}
            hidden={!listOpen}
            className="absolute inset-x-0 top-full z-20 mt-1 max-h-[360px] overflow-y-auto rounded-md border border-line-strong bg-card py-1 shadow-lg"
          >
            {candidates.map((candidate, index) => (
              <li
                key={candidate.id}
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                // mousedown, not click: the input's blur would close the list first.
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(candidate);
                }}
                className={cx(
                  "flex min-h-12 cursor-pointer items-center gap-3 px-3 py-2",
                  index === active ? "bg-brand-soft" : "hover:bg-sunken",
                )}
              >
                <span className="relative size-10 shrink-0 overflow-hidden rounded bg-sunken">
                  {candidate.thumbUrl ? (
                    <Image src={candidate.thumbUrl} alt="" fill unoptimized sizes="40px" className="object-contain p-0.5" />
                  ) : (
                    <span className="flex size-full items-center justify-center font-mono text-[11px] text-tertiary">
                      {candidate.brandName.slice(0, 2).toUpperCase()}
                    </span>
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-body-sm font-semibold text-primary">
                    {candidate.name}
                  </span>
                  <span className="block font-mono text-[11px] text-tertiary">
                    {candidate.brandName} · {candidate.releaseYear}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <span id={`${ids}-model-hint`} className="text-caption text-tertiary">
          {t("modelHint")}
        </span>
        <span
          id={`${ids}-model-status`}
          role="status"
          className={cx(
            "text-caption",
            search.status === "error" ? "text-risk" : "text-secondary",
          )}
        >
          {status}
        </span>
        {submitted && !selected && (
          <span className="text-caption text-risk">{t("modelRequired")}</span>
        )}
        {canContinueUnconfirmed && (search.status === "done" || search.status === "error") && (
          <button
            type="button"
            onClick={() => submit(true)}
            className="self-start text-body-sm font-semibold text-brand underline-offset-2 hover:underline"
          >
            {t("continueUnconfirmed")}
          </button>
        )}
      </div>

      {/* Variant */}
      {selected && selected.variants.length > 0 && (
        <Field label={t("variantLabel")} htmlFor={`${ids}-variant`} hint={t("variantHint")}>
          <Select
            id={`${ids}-variant`}
            size="lg"
            value={variantId}
            onChange={(event) => setVariantId(event.target.value)}
            options={[
              { value: "", label: t("variantUnsure") },
              ...selected.variants.map((variant) => ({
                value: variant.id,
                label: [variantCode(variant.weightClass, variant.gripSize), variant.colourway]
                  .filter(Boolean)
                  .join(" · "),
              })),
            ]}
          />
        </Field>
      )}

      {/* Price */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${ids}-price`} className="text-[13.5px] font-semibold leading-none text-primary">
          {t("priceLabel")}
        </label>
        <Input
          id={`${ids}-price`}
          size="lg"
          prefix="₫"
          mono
          inputMode="decimal"
          autoComplete="off"
          maxLength={16}
          placeholder={t("pricePlaceholder")}
          aria-invalid={priceInvalid}
          aria-describedby={`${ids}-price-hint`}
          value={priceText}
          onChange={(event) => setPriceText(event.target.value)}
        />
        <span
          id={`${ids}-price-hint`}
          className={cx("text-caption", priceInvalid && submitted ? "text-risk" : "text-tertiary")}
        >
          {priceInvalid && submitted
            ? t("priceError")
            : priceVnd !== null
              ? formatDong(priceVnd)
              : t("priceHint")}
        </span>
      </div>

      {/* Condition */}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-[13.5px] font-semibold leading-none text-primary">
          {t("conditionLabel")}
        </legend>
        <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
          {LISTING_CONDITIONS.map((value) => (
            <Radio
              key={value}
              name="condition"
              value={value}
              label={t(CONDITION_LABEL[value])}
              checked={condition === value}
              onChange={() => setCondition(value)}
            />
          ))}
        </div>
      </fieldset>

      {/* Profile, optional */}
      <details className="group rounded-md border border-line bg-card" open={profileOpen}>
        <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 py-3 text-body-sm font-semibold text-primary">
          {t("profileLabel")}
          <Icon name="ChevronDown" size="sm" className="ml-auto transition-transform group-open:rotate-180" />
        </summary>
        <div className="flex flex-col gap-4 border-t border-line px-4 py-4">
          <p className="text-caption text-tertiary">{t("profileHint")}</p>
          {(
            [
              ["exp", tf("q1"), [["under1", tf("q1a")], ["1to3", tf("q1b")], ["over3", tf("q1c")]]],
              ["fmt", tf("q2"), [["singles", tf("q2a")], ["doubles", tf("q2b")], ["both", tf("q2c")]]],
              ["pos", tf("q3"), [["net", tf("q3a")], ["mid", tf("q3b")], ["rear", tf("q3c")]]],
            ] as const
          ).map(([key, label, options]) => (
            <Field key={key} label={label} htmlFor={`${ids}-${key}`}>
              <Select
                id={`${ids}-${key}`}
                size="lg"
                value={profile[key]}
                onChange={(event) => setProfile((current) => ({ ...current, [key]: event.target.value }))}
                options={[
                  { value: "", label: t("profileSkip") },
                  ...options.map(([value, text]) => ({ value, label: text })),
                ]}
              />
            </Field>
          ))}
        </div>
      </details>

      <Button type="submit" size="lg" variant="primary" fullWidth iconRight="ArrowRight">
        {t("submit")}
      </Button>
    </form>
  );
}
