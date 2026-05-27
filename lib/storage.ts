// localStorage adapters for client-side persistence (walkthrough tours, partnerships, data flags).
// MVP only — replace with Supabase or SQLite in v2.

import type { DataQualityFlag, LocalPartnership, WalkthroughTourRecord } from "./types";

const KEYS = {
  walkthroughs: "baxter-ops.walkthroughs",
  partnerships: "baxter-ops.partnerships",
  flags: "baxter-ops.flags",
} as const;

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

// ---- Walkthrough records ----
export function loadTours(seed: WalkthroughTourRecord[] = []): WalkthroughTourRecord[] {
  return read<WalkthroughTourRecord[]>(KEYS.walkthroughs, seed);
}
export function saveTours(tours: WalkthroughTourRecord[]): void {
  write(KEYS.walkthroughs, tours);
}
export function upsertTour(t: WalkthroughTourRecord): WalkthroughTourRecord[] {
  const all = loadTours();
  const idx = all.findIndex(x => x.id === t.id);
  if (idx >= 0) all[idx] = t;
  else all.unshift(t);
  saveTours(all);
  return all;
}
export function deleteTour(id: string): WalkthroughTourRecord[] {
  const next = loadTours().filter(t => t.id !== id);
  saveTours(next);
  return next;
}

// ---- Local partnerships ----
export function loadPartnerships(seed: LocalPartnership[] = []): LocalPartnership[] {
  return read<LocalPartnership[]>(KEYS.partnerships, seed);
}
export function savePartnerships(ps: LocalPartnership[]): void {
  write(KEYS.partnerships, ps);
}
export function upsertPartnership(p: LocalPartnership): LocalPartnership[] {
  const all = loadPartnerships();
  const idx = all.findIndex(x => x.id === p.id);
  if (idx >= 0) all[idx] = p;
  else all.unshift(p);
  savePartnerships(all);
  return all;
}
export function deletePartnership(id: string): LocalPartnership[] {
  const next = loadPartnerships().filter(p => p.id !== id);
  savePartnerships(next);
  return next;
}

// ---- Data quality flags (persisted status overrides) ----
export function loadFlagStatuses(): Record<string, { status: DataQualityFlag["status"]; notes?: string }> {
  return read<Record<string, { status: DataQualityFlag["status"]; notes?: string }>>(KEYS.flags, {});
}
export function saveFlagStatus(id: string, status: DataQualityFlag["status"], notes?: string): void {
  const all = loadFlagStatuses();
  all[id] = { status, notes };
  write(KEYS.flags, all);
}

export function compositeScore(parts: Array<number | undefined>): number {
  const v = parts.filter((x): x is number => typeof x === "number" && !Number.isNaN(x));
  if (!v.length) return 0;
  return Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10;
}

export function compositeBand(score: number): string {
  if (score >= 4.5) return "Excellent";
  if (score >= 3.5) return "Strong";
  if (score >= 2.5) return "Average";
  if (score >= 1.5) return "Weak";
  return "Poor";
}
