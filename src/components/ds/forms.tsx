import type { ComponentProps, ReactNode } from "react";
import { Icon, cx, type IconName } from "./primitives";

/** Control heights are fixed: 28 / 38 / 48px. An input, a select and a button
 *  always line up in a filter bar. */
const FIELD_SIZE = {
  sm: "h-11 text-[12px] px-2.5 lg:h-7",
  md: "h-11 text-[13.5px] px-3 lg:h-[38px]",
  lg: "h-12 text-[15px] px-3.5",
} as const;

const FIELD_BASE =
  "w-full rounded-md border border-line-strong bg-card text-primary " +
  "placeholder:text-[var(--text-disabled)] " +
  "transition-[border-color,box-shadow] duration-[90ms] ease-out " +
  "hover:border-line-heavy focus:border-line-heavy";

export function Input({
  size = "md",
  iconLeft,
  prefix,
  mono,
  className,
  ...props
}: Omit<ComponentProps<"input">, "size" | "prefix"> & {
  size?: keyof typeof FIELD_SIZE;
  iconLeft?: IconName;
  prefix?: string;
  mono?: boolean;
}) {
  const hasAdornment = Boolean(iconLeft || prefix);
  return (
    <div className="relative w-full">
      {iconLeft && (
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-tertiary">
          <Icon name={iconLeft} size="sm" />
        </span>
      )}
      {prefix && !iconLeft && (
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 font-mono text-[12px] text-tertiary">
          {prefix}
        </span>
      )}
      <input
        className={cx(
          FIELD_BASE,
          FIELD_SIZE[size],
          hasAdornment && "pl-8",
          mono && "font-mono tracking-[-0.01em]",
          className,
        )}
        {...props}
      />
    </div>
  );
}

export function Select({
  size = "md",
  options,
  className,
  ...props
}: Omit<ComponentProps<"select">, "size"> & {
  size?: keyof typeof FIELD_SIZE;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="relative w-full">
      <select
        className={cx(
          FIELD_BASE,
          FIELD_SIZE[size],
          "cursor-pointer appearance-none pr-8",
          className,
        )}
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-tertiary">
        <Icon name="ChevronDown" size="sm" />
      </span>
    </div>
  );
}

export function Textarea({
  className,
  ...props
}: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cx(
        FIELD_BASE,
        "min-h-28 resize-y px-3.5 py-3 text-[14px] leading-6",
        className,
      )}
      {...props}
    />
  );
}

export function Checkbox({
  label,
  count,
  className,
  ...props
}: Omit<ComponentProps<"input">, "type"> & {
  label: ReactNode;
  count?: number;
}) {
  return (
    <label
      className={cx(
        "flex min-h-11 cursor-pointer items-center gap-2.5 text-body-sm text-primary lg:min-h-[24px]",
        props.disabled && "cursor-not-allowed text-[var(--text-disabled)]",
        className,
      )}
    >
      <input
        type="checkbox"
        className="peer size-4 shrink-0 cursor-pointer appearance-none rounded-[4px] border border-line-heavy bg-card
          checked:border-line-brand checked:bg-[var(--green-700)]
          checked:bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22 fill=%22none%22 stroke=%22white%22 stroke-width=%222.2%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22><path d=%22M3.5 8.5l3 3 6-6%22/></svg>')]
          bg-center bg-no-repeat transition-colors duration-[90ms]"
        {...props}
      />
      <span className="min-w-0 flex-1">{label}</span>
      {count !== undefined && (
        <span className="font-mono text-[11px] text-tertiary tabular-nums">
          {count}
        </span>
      )}
    </label>
  );
}

export function Radio({
  label,
  hint,
  className,
  ...props
}: Omit<ComponentProps<"input">, "type"> & {
  label: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <label
      className={cx(
        "flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-line bg-card px-4 py-3",
        "transition-colors duration-[90ms] ease-out hover:border-line-strong",
        "has-[:checked]:border-line-brand has-[:checked]:bg-brand-soft",
        className,
      )}
    >
      <input
        type="radio"
        className="peer mt-0.5 size-4 shrink-0 cursor-pointer appearance-none rounded-full border border-line-heavy bg-card
          checked:border-[6px] checked:border-[var(--green-700)] transition-[border] duration-[90ms]"
        {...props}
      />
      <span className="min-w-0">
        <span className="block text-body-sm font-semibold text-primary">
          {label}
        </span>
        {hint && (
          <span className="mt-0.5 block text-caption text-tertiary">{hint}</span>
        )}
      </span>
    </label>
  );
}

export function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={htmlFor}
        className="text-[13.5px] font-semibold leading-none text-primary"
      >
        {label}
      </label>
      {children}
      {hint && <span className="text-caption text-tertiary">{hint}</span>}
    </div>
  );
}
