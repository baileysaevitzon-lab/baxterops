"use client";

interface Props {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  options: string[];
  disabled?: boolean;
}

export function EnumSegment({ value, onChange, options, disabled = false }: Props) {
  return (
    <div className="inline-flex rounded-md border border-slate-200 overflow-hidden">
      {options.map(o => {
        const active = value === o;
        return (
          <button
            key={o}
            type="button"
            disabled={disabled}
            onClick={() => onChange(active ? undefined : o)}
            className={`px-4 h-10 text-sm font-medium capitalize transition-colors ${
              active ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >{o}</button>
        );
      })}
    </div>
  );
}
