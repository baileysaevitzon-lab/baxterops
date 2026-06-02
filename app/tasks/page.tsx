"use client";
// Tasks — operational command center (Sprint 24).
//
// Manual-override layer: staff can create, assign, prioritise, schedule, and
// status tasks inline. All mutations go to Supabase (app_tasks) and local state
// is only updated AFTER Supabase confirms. Seed tasks are display-only and never
// masquerade as saved rows.

import { useEffect, useState } from "react";
import { Card, CardBody, CardHeader, PageHeader, Badge } from "@/components/Card";
import { InlineStatusSelect, type StatusOption } from "@/components/InlineStatusSelect";
import { InlineEditField } from "@/components/InlineEditField";
import { TASKS as SEED_TASKS } from "@/lib/seed";
import { MOCK_USERS } from "@/lib/auth";
import { loadAllTasks, createTask, upsertTask, updateTaskStatus, deleteTask } from "@/lib/services/appTasks";
import { BACKEND_MODE } from "@/lib/services/persistence";
import type { Task } from "@/lib/types";

const IS_LIVE = BACKEND_MODE === "supabase";

const STATUS_OPTIONS: StatusOption<Task["status"]>[] = [
  { value: "open", label: "Open", intent: "neutral" },
  { value: "in_progress", label: "In Progress", intent: "warn" },
  { value: "blocked", label: "Blocked", intent: "bad" },
  { value: "done", label: "Done", intent: "good" },
];

// Priority is an integer column; expose friendly labels mapped to 5/4/3/2.
const PRIORITY_OPTIONS: StatusOption<string>[] = [
  { value: "5", label: "Urgent", intent: "bad" },
  { value: "4", label: "High", intent: "warn" },
  { value: "3", label: "Medium", intent: "neutral" },
  { value: "2", label: "Low", intent: "neutral" },
];

const CATEGORY_OPTIONS: Task["category"][] = [
  "recertification", "tenant_outreach", "lahd", "hacla", "urban", "utility",
  "market_comp", "walkthrough", "pricing", "marketing", "leasing", "report", "data_cleanup",
];

const OWNERS = ["", ...MOCK_USERS.map(u => u.name)];

type RelatedType = "general" | "competitor" | "tenant" | "unit";

const blankForm = {
  title: "",
  owner: "",
  priority: "3",
  dueDate: "",
  category: "data_cleanup" as Task["category"],
  relatedType: "general" as RelatedType,
  relatedId: "",
  notes: "",
};

export default function Tasks() {
  const [filter, setFilter] = useState<"all" | Task["status"]>("all");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create-task form
  const [form, setForm] = useState({ ...blankForm });
  const [creating, setCreating] = useState(false);

  async function refresh() {
    setError(null);
    if (IS_LIVE) {
      try {
        const rows = await loadAllTasks();
        setTasks(rows);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } else {
      // No backend — show seed strictly for display (mutations are disabled).
      setTasks(SEED_TASKS);
    }
    setLoaded(true);
  }
  useEffect(() => { refresh(); }, []);

  function relatedField(type: RelatedType, id: string): Partial<Task> {
    if (!id.trim()) return {};
    if (type === "competitor") return { relatedCompetitorId: id.trim() };
    if (type === "tenant") return { relatedTenantId: id.trim() };
    if (type === "unit") return { relatedUnitId: id.trim() };
    return {};
  }

  async function handleCreate() {
    if (!form.title.trim()) { setError("Task title is required."); return; }
    setCreating(true); setError(null);
    try {
      const created = await createTask({
        title: form.title.trim(),
        owner: form.owner,
        priority: Number(form.priority) as Task["priority"],
        status: "open",
        category: form.category,
        dueDate: form.dueDate || undefined,
        notes: form.notes.trim() || undefined,
        ...relatedField(form.relatedType, form.relatedId),
      });
      setTasks(prev => [created, ...prev]);   // local state only AFTER Supabase confirms
      setForm({ ...blankForm });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this task?")) return;
    setError(null);
    try {
      await deleteTask(id);                   // throws on failure
      setTasks(prev => prev.filter(t => t.id !== id));  // remove only on success
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed — task kept.");
    }
  }

  const filtered = tasks.filter(t => filter === "all" || t.status === filter);
  const sorted = [...filtered].sort((a, b) => b.priority - a.priority);

  return (
    <>
      <PageHeader
        title="Tasks"
        subtitle={`Operational command center · Backend: ${BACKEND_MODE} · ${loaded ? `${tasks.length} loaded` : "loading…"}`}
        action={
          <div className="flex gap-2 text-xs">
            {(["all", "open", "in_progress", "blocked", "done"] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-md border ${filter === f ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-200"}`}
              >
                {f.replace("_", " ")}
              </button>
            ))}
          </div>
        }
      />

      {error && (
        <div className="mb-3 rounded-md border border-rose-300 bg-rose-50 px-4 py-2 text-sm text-rose-900">{error}</div>
      )}

      {!IS_LIVE && (
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          Supabase not configured — showing static seed for display only. Creating/editing is disabled until a backend is connected.
        </div>
      )}

      {/* Create task — compact inline form */}
      {IS_LIVE && (
        <Card className="mb-4">
          <CardHeader title="Create task" subtitle="Saves to Supabase app_tasks." />
          <CardBody>
            <div className="flex flex-wrap items-end gap-2 text-xs">
              <label className="flex flex-col gap-1 grow min-w-[220px]">
                <span className="text-slate-500">Title *</span>
                <input
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. Follow up on Unit 312 bank statement"
                  className="border rounded-md px-2 py-1.5"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-slate-500">Assignee</span>
                <select value={form.owner} onChange={e => setForm(f => ({ ...f, owner: e.target.value }))} className="border rounded-md px-2 py-1.5 bg-white">
                  {OWNERS.map(o => <option key={o || "unassigned"} value={o}>{o || "Unassigned"}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-slate-500">Priority</span>
                <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} className="border rounded-md px-2 py-1.5 bg-white">
                  {PRIORITY_OPTIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-slate-500">Due</span>
                <input type="date" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} className="border rounded-md px-2 py-1.5" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-slate-500">Category</span>
                <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value as Task["category"] }))} className="border rounded-md px-2 py-1.5 bg-white">
                  {CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-slate-500">Related</span>
                <select value={form.relatedType} onChange={e => setForm(f => ({ ...f, relatedType: e.target.value as RelatedType }))} className="border rounded-md px-2 py-1.5 bg-white">
                  <option value="general">General</option>
                  <option value="competitor">Competitor</option>
                  <option value="tenant">Tenant</option>
                  <option value="unit">Unit</option>
                </select>
              </label>
              {form.relatedType !== "general" && (
                <label className="flex flex-col gap-1">
                  <span className="text-slate-500">Related ID</span>
                  <input value={form.relatedId} onChange={e => setForm(f => ({ ...f, relatedId: e.target.value }))} placeholder="e.g. c-zen-hollywood" className="border rounded-md px-2 py-1.5" />
                </label>
              )}
              <button
                onClick={handleCreate}
                disabled={creating || !form.title.trim()}
                className="px-4 py-2 rounded bg-slate-900 text-white font-semibold disabled:bg-slate-300"
              >
                {creating ? "Adding…" : "Add task"}
              </button>
            </div>
            <p className="mt-2 text-[11px] text-slate-400">
              Note (optional):
              <input
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="short context"
                className="ml-2 border rounded-md px-2 py-1 text-xs w-80 align-middle"
              />
            </p>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader
          title={`${sorted.length} tasks`}
          subtitle={IS_LIVE ? "Live from Supabase. Edit inline — changes save immediately." : "Static seed (display only)."}
        />
        <CardBody className="p-0">
          <table className="bx">
            <thead>
              <tr>
                <th>Priority</th>
                <th>Title</th>
                <th>Category</th>
                <th>Owner</th>
                <th>Due</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr><td colSpan={7} className="py-8 text-center text-slate-400 text-sm">
                  {IS_LIVE ? "No tasks yet — create one above." : "No tasks."}
                </td></tr>
              )}
              {sorted.map(t => (
                <tr key={t.id}>
                  <td>
                    {IS_LIVE ? (
                      <InlineStatusSelect
                        value={String(t.priority)}
                        options={PRIORITY_OPTIONS}
                        onSave={async (next) => {
                          const updated = await upsertTask({ ...t, priority: Number(next) as Task["priority"] });
                          setTasks(prev => prev.map(x => (x.id === t.id ? updated : x)));
                        }}
                      />
                    ) : (
                      <Badge intent={t.priority >= 4 ? "bad" : t.priority === 3 ? "warn" : "neutral"}>P{t.priority}</Badge>
                    )}
                  </td>
                  <td className="font-medium max-w-sm">
                    {IS_LIVE ? (
                      <InlineEditField
                        value={t.title}
                        onSave={async (v) => {
                          if (!v.trim()) throw new Error("Title cannot be empty");
                          const updated = await upsertTask({ ...t, title: v.trim() });
                          setTasks(prev => prev.map(x => (x.id === t.id ? updated : x)));
                        }}
                      />
                    ) : t.title}
                    {t.notes && <div className="text-xs text-slate-500 mt-0.5">{t.notes}</div>}
                  </td>
                  <td className="text-xs text-slate-500">{t.category}</td>
                  <td>
                    {IS_LIVE ? (
                      <InlineEditField
                        value={t.owner}
                        placeholder="Unassigned"
                        onSave={async (v) => {
                          const updated = await upsertTask({ ...t, owner: v });
                          setTasks(prev => prev.map(x => (x.id === t.id ? updated : x)));
                        }}
                      />
                    ) : (t.owner || "—")}
                  </td>
                  <td className="text-xs">
                    {IS_LIVE ? (
                      <input
                        type="date"
                        value={t.dueDate ?? ""}
                        onChange={async (e) => {
                          const v = e.target.value || undefined;
                          try {
                            const updated = await upsertTask({ ...t, dueDate: v });
                            setTasks(prev => prev.map(x => (x.id === t.id ? updated : x)));
                          } catch (err) {
                            setError(err instanceof Error ? err.message : "Due date save failed");
                          }
                        }}
                        className="border rounded px-1.5 py-1 text-xs"
                      />
                    ) : (t.dueDate ?? "—")}
                  </td>
                  <td>
                    {IS_LIVE ? (
                      <InlineStatusSelect
                        value={t.status}
                        options={STATUS_OPTIONS}
                        onSave={async (next) => {
                          const updated = await updateTaskStatus(t, next);
                          setTasks(prev => prev.map(x => (x.id === t.id ? updated : x)));
                        }}
                      />
                    ) : (
                      <Badge intent={t.status === "done" ? "good" : t.status === "in_progress" ? "warn" : t.status === "blocked" ? "bad" : "neutral"}>
                        {t.status.replace("_", " ")}
                      </Badge>
                    )}
                  </td>
                  <td className="text-right whitespace-nowrap">
                    {IS_LIVE && (
                      <button onClick={() => handleDelete(t.id)} className="text-xs text-rose-700 underline">delete</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </>
  );
}
