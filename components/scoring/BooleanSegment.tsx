"use client";
// Yes / No / Unknown segmented control. One click.

interface Props {
  value: boolean | null | undefined;
  onChange: (v: boolean | undefined) => void;
  trueLabel?: string;
  falseLabel?: string;
  unknownLabel?: string;
  allowUnknown?: boolean;
  disabled?: boolean;
}

export function BooleanSegment({
  value,
  onChange,
  trueLabel = "Yes",
  falseLabel = "No",
  unknownLabel = "Unknown",
  allowUnknown = true,
  disabled = false,
}: Props) {
  const v: boolean | undefined = value === null ? undefined : value;
  const opts: Array<{ val: boolean | undefined; label: string; activeBg: string }> = [
    { val: true, label: trueLabel, activeBg: "bg-emerald-600" },
    { val: false, label: falseLabel, activeBg: "bg-rose-600" },
  ];
  if (allowUnknown) opts.push({ val: undefined, label: unknownLabel, activeBg: "bg-slate-700" });

  return (
    <div className="inline-flex rounded-md border border-slate-200 overflow-hidden">
      {opts.map(opt => {
        const active = v === opt.val;
        return (
          <button
            key={String(opt.val)}
            type="button"
            disabled={disabled}
            onClick={() => onChange(opt.val)}
            className={`px-4 h-10 text-sm font-medium transition-colors ${
              active ? `${opt.activeBg} text-white` : "bg-white text-slate-600 hover:bg-slate-50"
            } ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
