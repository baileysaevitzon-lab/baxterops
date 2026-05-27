"use client";
// Big-tap-target star rating. Click any star to set value.
// Click the active star again to clear back to undefined.

interface Props {
  value: number | undefined;
  max?: number;
  onChange: (v: number | undefined) => void;
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  showValue?: boolean;
  labels?: Record<number, string>;
}

export function RatingStars({
  value,
  max = 5,
  onChange,
  size = "md",
  disabled = false,
  showValue = true,
  labels,
}: Props) {
  const dims = size === "sm" ? "w-6 h-6 text-lg" : size === "lg" ? "w-12 h-12 text-3xl" : "w-9 h-9 text-2xl";
  return (
    <div className="flex items-center gap-1">
      <div className="flex gap-0.5">
        {Array.from({ length: max }).map((_, i) => {
          const n = i + 1;
          const active = typeof value === "number" && n <= value;
          return (
            <button
              key={n}
              type="button"
              disabled={disabled}
              onClick={() => onChange(value === n ? undefined : n)}
              aria-label={`Rate ${n} of ${max}${labels?.[n] ? ` (${labels[n]})` : ""}`}
              title={labels?.[n] ?? `${n}/${max}`}
              className={`${dims} flex items-center justify-center rounded-md transition-transform active:scale-95 ${
                active ? "text-amber-400 hover:text-amber-500" : "text-slate-200 hover:text-slate-300"
              } ${disabled ? "opacity-40" : "cursor-pointer"}`}
            >
              {active ? "★" : "☆"}
            </button>
          );
        })}
      </div>
      {showValue && (
        <span className={`text-sm font-medium tabular-nums ml-2 ${value ? "text-slate-700" : "text-slate-300"}`}>
          {value ?? "—"} / {max}
        </span>
      )}
    </div>
  );
}
