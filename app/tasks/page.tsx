"use client";
import { useEffect, useState } from "react";
import { Card, CardBody, CardHeader, PageHeader, Badge } from "@/components/Card";
import { TASKS as SEED_TASKS } from "@/lib/seed";
import { loadAllTasks, upsertTask, deleteTask } from "@/lib/services/appTasks";
import { BACKEND_MODE } from "@/lib/services/persistence";
import type { Task } from "@/lib/types";

export default function Tasks() {
  const [filter, setFilter] = useState<"all" | "open" | "in_progress" | "done">("all");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loaded, setLoaded] = useState(false);

  async function refresh() {
    if (BACKEND_MODE === "supabase") {
      const rows = await loadAllTasks();
      setTasks(rows.length > 0 ? rows : SEED_TASKS);
    } else {
      setTasks(SEED_TASKS);
    }
    setLoaded(true);
  }
  useEffect(() => { refresh(); }, []);

  async function cycleStatus(t: Task) {
    const next: Task["status"] = t.status === "open" ? "in_progress" : t.status === "in_progress" ? "done" : "open";
    const updated: Task = { ...t, status: next };
    setTasks(prev => prev.map(x => x.id === t.id ? updated : x));
    try {
      if (BACKEND_MODE === "supabase") await upsertTask(updated);
    } catch (e) {
      console.warn(e);
      await refresh(); // rollback
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this task?")) return;
    setTasks(prev => prev.filter(t => t.id !== id));
    try { if (BACKEND_MODE === "supabase") await deleteTask(id); }
    catch (e) { console.warn(e); await refresh(); }
  }

  const filtered = tasks.filter(t => filter === "all" || t.status === filter);

  return (
    <>
      <PageHeader
        title="Tasks"
        subtitle={`Cross-module task manager · Backend: ${BACKEND_MODE} · ${loaded ? `${tasks.length} loaded` : "loading…"}`}
        action={
          <div className="flex gap-2 text-xs">
            {(["all", "open", "in_progress", "done"] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-md border ${filter === f ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-200"}`}
              >
                {f}
              </button>
            ))}
          </div>
        }
      />
      <Card>
        <CardHeader title={`${filtered.length} tasks`} subtitle={BACKEND_MODE === "supabase" ? "Live from Supabase. Click status badge to advance." : "Falling back to static seed because Supabase env is missing."} />
        <CardBody className="p-0">
          <table className="bx">
            <thead>
              <tr>
                <th>Pri</th>
                <th>Title</th>
                <th>Category</th>
                <th>Owner</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.sort((a, b) => b.priority - a.priority).map(t => (
                <tr key={t.id}>
                  <td><Badge intent={t.priority >= 4 ? "bad" : t.priority === 3 ? "warn" : "neutral"}>P{t.priority}</Badge></td>
                  <td className="font-medium">{t.title}{t.notes && <div className="text-xs text-slate-500 mt-0.5">{t.notes}</div>}</td>
                  <td className="text-xs text-slate-500">{t.category}</td>
                  <td>{t.owner}</td>
                  <td>
                    <button onClick={() => cycleStatus(t)} disabled={BACKEND_MODE !== "supabase"} className="hover:opacity-80 disabled:opacity-50">
                      <Badge intent={t.status === "done" ? "good" : t.status === "in_progress" ? "warn" : "neutral"}>
                        {t.status.replace("_", " ")}
                      </Badge>
                    </button>
                  </td>
                  <td className="text-right whitespace-nowrap">
                    {BACKEND_MODE === "supabase" && (
                      <button onClick={() => remove(t.id)} className="text-xs text-rose-700 underline">delete</button>
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
