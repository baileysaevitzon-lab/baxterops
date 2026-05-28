// Sprint 13: shared Toured-Only toggle button with count badge.
// Drop-in on any page that has a competitor list.

"use client";

interface Props {
  on: boolean;
  onToggle: (next: boolean) => void;
  touredCount: number;
  totalCount: number;
  className?: string;
}

export function TouredOnlyToggle({ on, onToggle, touredCount, totalCount, className }: Props) {
  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      <button
        onClick={() => onToggle(!on)}
        className={`px-3 py-1.5 rounded-md text-xs border transition-colors ${
          on
            ? "bg-emerald-700 text-white border-emerald-700 hover:bg-emerald-800"
            : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
        }`}
        aria-pressed={on}
        title={
          on
            ? `Showing only the ${touredCount} field-toured properties`
            : `Toggle to filter the list to ${touredCount} field-toured properties`
        }
      >
        {on ? "★ Toured Only" : "All comps"}
      </button>
      <span className="text-[11px] text-slate-500 whitespace-nowrap">
        {on
          ? `${touredCount} toured ${touredCount === 1 ? "property" : "properties"} shown`
          : `${totalCount} total · ${touredCount} toured`}
      </span>
    </div>
  );
}
