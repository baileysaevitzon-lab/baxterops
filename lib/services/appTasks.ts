// app_tasks service. Supabase-backed when env is present.

import { BACKEND_MODE } from "./persistence";
import { getSupabase } from "@/lib/supabase/client";
import { TABLES } from "./tables";
import type { Task } from "@/lib/types";

const TABLE = TABLES.appTasks;

interface Row {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  owner: string | null;
  priority: number | null;
  due_date: string | null;
  status: "open" | "in_progress" | "done";
  related_property: string | null;
  related_unit_id: string | null;
  related_tenant_id: string | null;
  related_competitor_id: string | null;
  notes: string | null;
  created_at?: string;
  updated_at?: string;
}

function toTask(r: Row): Task {
  return {
    id: r.id,
    title: r.title,
    description: r.description ?? undefined,
    category: (r.category ?? "data_cleanup") as Task["category"],
    owner: r.owner ?? "",
    priority: (r.priority ?? 3) as Task["priority"],
    dueDate: r.due_date ?? undefined,
    status: r.status,
    relatedUnitId: r.related_unit_id ?? undefined,
    relatedTenantId: r.related_tenant_id ?? undefined,
    relatedCompetitorId: r.related_competitor_id ?? undefined,
    notes: r.notes ?? undefined,
  };
}

function toRow(t: Task): Row {
  return {
    id: t.id,
    title: t.title,
    description: t.description ?? null,
    category: t.category ?? null,
    owner: t.owner,
    priority: t.priority,
    due_date: t.dueDate ?? null,
    status: t.status,
    related_property: null,
    related_unit_id: t.relatedUnitId ?? null,
    related_tenant_id: t.relatedTenantId ?? null,
    related_competitor_id: t.relatedCompetitorId ?? null,
    notes: t.notes ?? null,
  };
}

export async function loadAllTasks(): Promise<Task[]> {
  if (BACKEND_MODE === "supabase") {
    const sb = getSupabase();
    if (sb) {
      const { data, error } = await sb.from(TABLE).select("*").order("priority", { ascending: false });
      if (error) {
        console.warn("[appTasks.load]", error.message);
        return [];
      }
      return (data ?? []).map(r => toTask(r as Row));
    }
  }
  return [];
}

export async function upsertTask(t: Task): Promise<Task> {
  if (BACKEND_MODE === "supabase") {
    const sb = getSupabase();
    if (sb) {
      const { data, error } = await sb.from(TABLE).upsert({ ...toRow(t), updated_at: new Date().toISOString() }).select().single();
      if (error) {
        console.warn("[appTasks.upsert]", error.message);
        throw new Error(error.message);
      }
      return toTask(data as Row);
    }
  }
  return t;
}

export async function deleteTask(id: string): Promise<void> {
  if (BACKEND_MODE === "supabase") {
    const sb = getSupabase();
    if (sb) {
      const { error } = await sb.from(TABLE).delete().eq("id", id);
      if (error) console.warn("[appTasks.delete]", error.message);
    }
  }
}

export async function seedTasksIfEmpty(seed: Task[]): Promise<{ inserted: number; existing: number }> {
  if (BACKEND_MODE !== "supabase") return { inserted: 0, existing: 0 };
  const sb = getSupabase();
  if (!sb) return { inserted: 0, existing: 0 };
  const { count, error: countErr } = await sb.from(TABLE).select("*", { count: "exact", head: true });
  if (countErr) {
    console.warn("[appTasks.seed.count]", countErr.message);
    return { inserted: 0, existing: 0 };
  }
  if ((count ?? 0) > 0) return { inserted: 0, existing: count ?? 0 };
  const rows = seed.map(t => ({ ...toRow(t), created_at: new Date().toISOString(), updated_at: new Date().toISOString() }));
  const { error } = await sb.from(TABLE).insert(rows);
  if (error) {
    console.warn("[appTasks.seed.insert]", error.message);
    return { inserted: 0, existing: 0 };
  }
  return { inserted: rows.length, existing: 0 };
}
