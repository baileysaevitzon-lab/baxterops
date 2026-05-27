import { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-xl border border-slate-200 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {subtitle && <div className="text-xs text-slate-500 mt-0.5">{subtitle}</div>}
      </div>
      {action}
    </div>
  );
}

export function CardBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`p-5 ${className}`}>{children}</div>;
}

export function Stat({
  label,
  value,
  delta,
  intent = "neutral",
  sub,
  source,
}: {
  label: string;
  value: string;
  delta?: string;
  intent?: "good" | "bad" | "neutral" | "warn";
  sub?: string;
  source?: ReactNode;
}) {
  const intentClass =
    intent === "good"
      ? "text-emerald-600"
      : intent === "bad"
      ? "text-rose-600"
      : intent === "warn"
      ? "text-amber-600"
      : "text-slate-500";
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      <div className="flex items-center gap-2 mt-1">
        {delta && <span className={`text-xs font-medium ${intentClass}`}>{delta}</span>}
        {sub && <span className="text-xs text-slate-400">{sub}</span>}
      </div>
      {source && <div className="mt-2">{source}</div>}
    </div>
  );
}

export function Badge({ children, intent = "neutral" }: { children: ReactNode; intent?: "good" | "bad" | "neutral" | "warn" | "info" }) {
  const styles =
    intent === "good"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : intent === "bad"
      ? "bg-rose-50 text-rose-700 border-rose-200"
      : intent === "warn"
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : intent === "info"
      ? "bg-sky-50 text-sky-700 border-sky-200"
      : "bg-slate-100 text-slate-700 border-slate-200";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs rounded-full border ${styles}`}>
      {children}
    </span>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex items-start justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <div className="text-sm text-slate-500 mt-1 max-w-2xl">{subtitle}</div>}
      </div>
      {action}
    </div>
  );
}
