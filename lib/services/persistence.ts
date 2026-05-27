// Persistence adapter. Real Supabase implementation since Sprint 4.
//
// Mode resolution:
//   1. supabase     — if NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY are set,
//                     reads/writes against Supabase tables in lib/db/schema.sql.
//   2. localStorage — only when env vars are missing (dev/offline fallback).
//
// Domain types are camelCase; Postgres columns are snake_case.
// We do not maintain a per-field mapping table — instead a generic
// snakeKeys / camelKeys converter handles it. Cheap and stable.

import { hasSupabaseEnv, getSupabase } from "@/lib/supabase/client";

export type BackendMode = "supabase" | "localStorage";

export const BACKEND_MODE: BackendMode = hasSupabaseEnv ? "supabase" : "localStorage";

const PREFIX = "baxter-ops.tbl";

interface Row { id: string }

// ---------- key transformers ----------
function toSnake(k: string): string {
  return k.replace(/[A-Z]/g, m => "_" + m.toLowerCase());
}
function toCamel(k: string): string {
  return k.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}
function snakeKeys<T extends object>(row: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[toSnake(k)] = v;
  return out;
}
function camelKeys<T = Record<string, unknown>>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[toCamel(k)] = v;
  return out as T;
}

// ---------- localStorage helpers (fallback only) ----------
function lsRead<T extends Row>(table: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(`${PREFIX}.${table}`);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch { return []; }
}
function lsWrite<T extends Row>(table: string, rows: T[]): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(`${PREFIX}.${table}`, JSON.stringify(rows)); } catch {}
}

// ---------- public API ----------

export async function list<T extends Row>(table: string): Promise<T[]> {
  if (BACKEND_MODE === "supabase") {
    const sb = getSupabase()!;
    const { data, error } = await sb.from(table).select("*").order("created_at", { ascending: false });
    if (error) {
      console.error(`[persistence.list ${table}]`, error.message);
      return [];
    }
    return (data ?? []).map(r => camelKeys<T>(r));
  }
  return lsRead<T>(table);
}

export async function upsert<T extends Row>(table: string, row: T): Promise<T> {
  if (BACKEND_MODE === "supabase") {
    const sb = getSupabase()!;
    const payload = snakeKeys({ ...row, updatedAt: new Date().toISOString() });
    const { data, error } = await sb.from(table).upsert(payload).select().single();
    if (error) {
      console.error(`[persistence.upsert ${table}]`, error.message);
      throw new Error(`Supabase upsert failed (${table}): ${error.message}`);
    }
    return camelKeys<T>(data);
  }
  const all = lsRead<T>(table);
  const idx = all.findIndex(r => r.id === row.id);
  if (idx >= 0) all[idx] = row;
  else all.unshift(row);
  lsWrite(table, all);
  return row;
}

export async function upsertMany<T extends Row>(table: string, rows: T[]): Promise<T[]> {
  if (!rows.length) return [];
  if (BACKEND_MODE === "supabase") {
    const sb = getSupabase()!;
    const now = new Date().toISOString();
    const payload = rows.map(r => snakeKeys({ ...r, updatedAt: now }));
    const { data, error } = await sb.from(table).upsert(payload).select();
    if (error) {
      console.error(`[persistence.upsertMany ${table}]`, error.message);
      throw new Error(`Supabase upsertMany failed (${table}): ${error.message}`);
    }
    return (data ?? []).map(r => camelKeys<T>(r));
  }
  const all = lsRead<T>(table);
  for (const row of rows) {
    const idx = all.findIndex(r => r.id === row.id);
    if (idx >= 0) all[idx] = row;
    else all.unshift(row);
  }
  lsWrite(table, all);
  return rows;
}

export async function remove(table: string, id: string): Promise<void> {
  if (BACKEND_MODE === "supabase") {
    const sb = getSupabase()!;
    const { error } = await sb.from(table).delete().eq("id", id);
    if (error) {
      console.error(`[persistence.remove ${table}]`, error.message);
      throw new Error(`Supabase delete failed (${table}): ${error.message}`);
    }
    return;
  }
  const all = lsRead<Row>(table);
  lsWrite(table, all.filter(r => r.id !== id));
}

export async function where<T extends Row>(table: string, predicate: (row: T) => boolean): Promise<T[]> {
  const all = await list<T>(table);
  return all.filter(predicate);
}

export async function findById<T extends Row>(table: string, id: string): Promise<T | undefined> {
  if (BACKEND_MODE === "supabase") {
    const sb = getSupabase()!;
    const { data, error } = await sb.from(table).select("*").eq("id", id).maybeSingle();
    if (error) {
      console.error(`[persistence.findById ${table}]`, error.message);
      return undefined;
    }
    return data ? camelKeys<T>(data) : undefined;
  }
  const all = lsRead<T>(table);
  return all.find(r => r.id === id);
}

/**
 * Migrate any leftover Sprint-3 localStorage data into Supabase.
 * Called from the /settings admin panel — never automatic.
 */
export async function syncLocalFallbackToSupabase(tables: string[]): Promise<{ table: string; copied: number }[]> {
  if (BACKEND_MODE !== "supabase") {
    throw new Error("syncLocalFallbackToSupabase requires Supabase mode.");
  }
  const sb = getSupabase()!;
  const results: { table: string; copied: number }[] = [];
  for (const table of tables) {
    const rows = lsRead<Row>(table);
    if (!rows.length) { results.push({ table, copied: 0 }); continue; }
    const payload = rows.map(r => snakeKeys(r));
    const { error } = await sb.from(table).upsert(payload);
    if (error) {
      console.error(`[syncLocalFallbackToSupabase ${table}]`, error.message);
      results.push({ table, copied: -1 });
    } else {
      results.push({ table, copied: rows.length });
    }
  }
  return results;
}

/** Count rows in a table. Used by /settings validation. */
export async function count(table: string): Promise<number> {
  if (BACKEND_MODE !== "supabase") return lsRead(table).length;
  const sb = getSupabase()!;
  const { count: n, error } = await sb.from(table).select("*", { count: "exact", head: true });
  if (error) {
    console.error(`[persistence.count ${table}]`, error.message);
    return -1;
  }
  return n ?? 0;
}
