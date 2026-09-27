import type { ComponentProps, ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Bell,
  BellRing,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  ClipboardCheck,
  Copy,
  GitCompare,
  House,
  Info,
  Languages,
  LayoutGrid,
  LogOut,
  Maximize2,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  UserRound,
  X,
} from "lucide-react";

/**
 * Shuttlecraft primitives.
 *
 * Hairlines separate, shadow floats. Radii are small. Colour carries meaning,
 * never decoration. Every rule here comes from the design system readme, so
 * changes belong there first.
 */

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/* ------------------------------------------------------------------ Icon */

/**
 * The icons the design uses, named one by one.
 *
 * This was `import { icons } from "lucide-react"`, which is a single export
 * holding roughly 1500 glyphs — so the whole set landed in the client bundle
 * and `optimizePackageImports` could do nothing about it. That option rewrites
 * named imports to deep paths; a barrel object referencing everything defeats
 * it by construction.
 *
 * Naming them also makes `IconName` a closed union of what actually exists in
 * the design rather than of everything lucide ships, so a typo is a type error
 * instead of a silently missing glyph. Adding an icon means adding a line here.
 */
const ICONS = {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Bell,
  BellRing,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  ClipboardCheck,
  Copy,
  GitCompare,
  House,
  Info,
  Languages,
  LayoutGrid,
  LogOut,
  Maximize2,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  UserRound,
  X,
} as const;

export type IconName = keyof typeof ICONS;

const ICON_PX = { sm: 16, md: 20, lg: 24 } as const;

export function Icon({
  name,
  size = "md",
  className,
}: {
  name: IconName;
  size?: keyof typeof ICON_PX;
  className?: string;
}) {
  const Glyph = ICONS[name];
  if (!Glyph) return null;
  const px = ICON_PX[size];
  return (
    <Glyph
      width={px}
      height={px}
      strokeWidth={1.75}
      aria-hidden
      className={cx("shrink-0", className)}
    />
  );
}

/* --------------------------------------------------------------- Eyebrow */

export function Eyebrow({
  children,
  className,
  as: Tag = "span",
}: {
  children: ReactNode;
  className?: string;
  as?: "span" | "h1" | "h2" | "h3" | "div";
}) {
  return <Tag className={cx("eyebrow", className)}>{children}</Tag>;
}

/* ---------------------------------------------------------------- Button */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ControlSize = "sm" | "md" | "lg";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-md font-ui font-semibold " +
  "transition-[background-color,border-color,color,box-shadow,transform] duration-[90ms] " +
  "ease-out cursor-pointer select-none disabled:cursor-not-allowed " +
  "active:translate-y-px motion-reduce:active:translate-y-0";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--action-primary-bg)] text-[var(--text-on-brand)] border border-transparent " +
    "hover:bg-[var(--action-primary-bg-hover)] active:bg-[var(--action-primary-bg-active)] " +
    "disabled:bg-[var(--action-disabled-bg)] disabled:text-[var(--text-disabled)]",
  secondary:
    "bg-[var(--action-secondary-bg)] text-primary border border-line-strong " +
    "hover:bg-[var(--action-secondary-bg-hover)] " +
    "disabled:bg-[var(--action-disabled-bg)] disabled:text-[var(--text-disabled)]",
  ghost:
    "bg-transparent text-primary border border-transparent " +
    "hover:bg-[var(--action-ghost-bg-hover)] disabled:text-[var(--text-disabled)]",
  danger:
    "bg-[var(--action-danger-bg)] text-white border border-transparent hover:opacity-90",
};

/**
 * Control heights are fixed so buttons, inputs and selects align in a row —
 * 28 / 38 / 48 on desktop. Below `lg` everything smaller than 44px is raised
 * to 44px: SEA buying happens on a phone, and nothing tappable goes below the
 * touch minimum, web included.
 */
const BUTTON_SIZE: Record<ControlSize, string> = {
  sm: "h-11 px-2.5 text-[12px] lg:h-7",
  md: "h-11 px-3.5 text-[13.5px] lg:h-[38px]",
  lg: "h-12 px-5 text-[15px]",
};

export function Button({
  variant = "secondary",
  size = "md",
  iconLeft,
  iconRight,
  fullWidth,
  className,
  children,
  ...props
}: ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: ControlSize;
  iconLeft?: IconName;
  iconRight?: IconName;
  fullWidth?: boolean;
}) {
  return (
    <button
      className={cx(
        BUTTON_BASE,
        BUTTON_VARIANT[variant],
        BUTTON_SIZE[size],
        fullWidth && "w-full",
        className,
      )}
      {...props}
    >
      {iconLeft && <Icon name={iconLeft} size={size === "lg" ? "md" : "sm"} />}
      {children}
      {iconRight && <Icon name={iconRight} size={size === "lg" ? "md" : "sm"} />}
    </button>
  );
}

/** Anchor styled as a button — same geometry, different element. */
export function ButtonLinkStyle({
  variant = "secondary",
  size = "md",
  fullWidth,
}: {
  variant?: ButtonVariant;
  size?: ControlSize;
  fullWidth?: boolean;
}) {
  return cx(
    BUTTON_BASE,
    BUTTON_VARIANT[variant],
    BUTTON_SIZE[size],
    fullWidth && "w-full",
    "no-underline",
  );
}

/* ------------------------------------------------------------ IconButton */

/** Icon-only controls are allowed in toolbars and dense rows — never alone in
 *  a primary action, and always with an accessible label. */
export function IconButton({
  icon,
  label,
  variant = "ghost",
  size = "lg",
  active,
  className,
  ...props
}: ComponentProps<"button"> & {
  icon: IconName;
  label: string;
  variant?: ButtonVariant;
  size?: ControlSize;
  active?: boolean;
}) {
  const box =
    size === "sm"
      ? "size-11 lg:size-7"
      : size === "md"
        ? "size-11 lg:size-[38px]"
        : "size-11";
  return (
    <button
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cx(
        BUTTON_BASE,
        BUTTON_VARIANT[variant],
        box,
        "p-0",
        active && "bg-brand-soft text-brand border-line-brand",
        className,
      )}
      {...props}
    >
      <Icon name={icon} size={size === "sm" ? "sm" : "md"} />
    </button>
  );
}

/* ------------------------------------------------------------------ Card */

export function Card({
  children,
  className,
  padding = "md",
  selected,
  interactive,
  tone = "default",
  ...props
}: ComponentProps<"div"> & {
  padding?: "none" | "sm" | "md" | "lg";
  selected?: boolean;
  interactive?: boolean;
  tone?: "default" | "used" | "brand";
}) {
  const pad = { none: "", sm: "p-3", md: "p-4", lg: "p-6" }[padding];
  const toneClass = {
    default: "bg-card border-line",
    used: "bg-used border-cork-100",
    brand: "bg-brand-soft border-green-200",
  }[tone];

  return (
    <div
      className={cx(
        "rounded-md border transition-[border-color,transform] duration-[90ms] ease-out",
        toneClass,
        pad,
        interactive &&
          "hover:border-line-strong hover:-translate-y-px motion-reduce:hover:translate-y-0",
        selected && "border-line-brand shadow-[inset_0_0_0_1px_var(--green-700)]",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/* ----------------------------------------------------------------- Badge */

type BadgeTone = "neutral" | "brand" | "used" | "risk" | "caution" | "data";

const BADGE_TONE: Record<BadgeTone, string> = {
  neutral: "bg-sunken text-secondary border-line",
  brand: "bg-brand-soft text-brand border-green-200",
  used: "bg-used text-cork-600 border-cork-200",
  risk: "bg-risk-bg text-risk border-[color-mix(in_srgb,var(--signal-risk)_28%,transparent)]",
  caution:
    "bg-caution-bg text-caution border-[color-mix(in_srgb,var(--signal-caution)_28%,transparent)]",
  data: "bg-accent-soft text-cyan-700 border-cyan-200",
};

export function Badge({
  children,
  tone = "neutral",
  icon,
  className,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  icon?: IconName;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-pill border px-2 py-0.5 text-[12px] font-semibold leading-4",
        BADGE_TONE[tone],
        className,
      )}
    >
      {icon && <Icon name={icon} size="sm" className="size-3.5" />}
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------- Tag */

export function Tag({
  children,
  mono,
  selected,
  className,
}: {
  children: ReactNode;
  mono?: boolean;
  selected?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-1 text-[12px] leading-4",
        mono ? "font-mono tracking-[-0.01em]" : "font-medium",
        selected
          ? "border-line-brand bg-brand-soft text-brand"
          : "border-line bg-card text-secondary",
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------ TrustBadge */

/** Status is colour + icon, never colour alone — screenshots of these get
 *  pasted into Facebook buying groups, where colour alone does not survive. */
export function TrustBadge({
  state,
  label,
  title,
}: {
  state: "verified" | "authorised" | "unverified" | "risk";
  label: string;
  title?: string;
}) {
  const config = {
    authorised: { tone: "brand" as const, icon: "BadgeCheck" as IconName },
    verified: { tone: "brand" as const, icon: "CircleCheck" as IconName },
    unverified: { tone: "caution" as const, icon: "CircleAlert" as IconName },
    risk: { tone: "risk" as const, icon: "TriangleAlert" as IconName },
  }[state];

  return (
    <span title={title}>
      <Badge tone={config.tone} icon={config.icon}>
        {label}
      </Badge>
    </span>
  );
}

/* -------------------------------------------------------------- Skeleton */

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cx("animate-pulse rounded-md bg-sunken", className)}
      aria-hidden
    />
  );
}

/* ----------------------------------------------------------- EmptyState */

/** Empty states say what to do next, with a number where one exists. */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-md border border-line bg-card px-6 py-12 text-center">
      <p className="font-display text-h4 font-semibold text-primary">{title}</p>
      <p className="mx-auto mt-2 max-w-[52ch] text-body-sm text-secondary">
        {body}
      </p>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}
