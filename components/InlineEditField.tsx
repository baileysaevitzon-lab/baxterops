"use client";
// Sprint 11 — Reusable inline pencil-edit field.
//
// Shows a value with a pencil icon. On click, renders an input/textarea.
// On save, calls the provided onSave(newValue) async callback.
// The parent is responsible for persisting — this component only handles UI state.
//
// Usage:
//   <InlineEditField
//     value={currentValue}
//     placeholder="Add notes..."
//     multiline
//     onSave={async (v) => { await myService.updateNote(id, v); }}
//   />

import { useState, useRef, useEffect } from "react";

interface Props {
  value: string | undefined | null;
  placeholder?: string;
  multiline?: boolean;
  label?: string;
  className?: string;
  /** Called when user saves. Should throw on failure. */
  onSave: (newValue: string) => Promise<void>;
}

export function InlineEditField({ value, placeholder = "—", multiline = false, label, className = "", onSave }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  // Sync if parent value changes (e.g. after Supabase realtime update)
  useEffect(() => {
    if (!editing) setDraft(value ?? "");
  }, [value, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  async function handleSave() {
    if (draft === (value ?? "")) { setEditing(false); return; }
    setSaving(true); setError(null);
    try {
      await onSave(draft);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { setDraft(value ?? ""); setEditing(false); }
    if (e.key === "Enter" && !multiline) { e.preventDefault(); handleSave(); }
    if (e.key === "Enter" && multiline && e.metaKey) { e.preventDefault(); handleSave(); }
  }

  if (!editing) {
    return (
      <span className={`group relative inline-flex items-start gap-1 ${className}`}>
        {label && <span className="text-xs text-slate-500 mr-1">{label}</span>}
        <span className={value ? "" : "text-slate-400 italic"}>{value || placeholder}</span>
        <button
          onClick={() => { setDraft(value ?? ""); setEditing(true); }}
          className="opacity-0 group-hover:opacity-100 transition-opacity ml-1 text-slate-400 hover:text-slate-700 shrink-0"
          title="Edit"
          aria-label="Edit"
        >
          ✏️
        </button>
      </span>
    );
  }

  return (
    <span className={`inline-flex flex-col gap-1 w-full ${className}`}>
      {label && <span className="text-xs text-slate-500">{label}</span>}
      {multiline ? (
        <textarea
          ref={inputRef as React.RefObject<HTMLTextAreaElement>}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={3}
          placeholder={placeholder}
          className="w-full border border-sky-400 rounded-md px-2 py-1 text-sm resize-none outline-none focus:ring-2 focus:ring-sky-300"
        />
      ) : (
        <input
          ref={inputRef as React.RefObject<HTMLInputElement>}
          type="text"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full border border-sky-400 rounded-md px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-sky-300"
        />
      )}
      <div className="flex items-center gap-2 text-xs">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-2.5 py-1 rounded bg-sky-700 text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          onClick={() => { setDraft(value ?? ""); setEditing(false); setError(null); }}
          className="px-2.5 py-1 rounded border border-slate-200 text-slate-600"
        >
          Cancel
        </button>
        {multiline && <span className="text-slate-400">⌘↵ to save</span>}
        {error && <span className="text-rose-700">⚠ {error}</span>}
      </div>
    </span>
  );
}
