// Sprint 14: iPad-friendly signature pad for the recertification HTML packet.
//
// Captures touch + pen + mouse strokes on a canvas, exports a PNG data URL,
// and exposes Clear / Save buttons. Designed for finger/stylus on iPad —
// canvas is at least 300x120 CSS px and uses devicePixelRatio scaling for
// crisp ink on retina displays.
//
// This is NOT an officially recognized e-signature system (no DocuSign-level
// audit chain). The /packet UI must always show a "manager review required"
// banner alongside.

"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  label: string;
  signerName?: string;
  role: "tenant" | "manager" | "owner";
  required?: boolean;
  /** Existing signature data URL (PNG). When present the pad shows "Signed" with the date and a Re-sign button. */
  existingSignatureDataUrl?: string;
  existingSignedAt?: string;
  /** Called when the user clicks Save. Receives the PNG data URL. Should persist + return success. */
  onSave: (dataUrl: string) => Promise<boolean>;
  /** Called when the user clicks Clear on an existing signature. Should delete + return success. */
  onClear?: () => Promise<boolean>;
  width?: number;
  height?: number;
}

export function SignaturePad({
  label,
  signerName,
  role,
  required = false,
  existingSignatureDataUrl,
  existingSignedAt,
  onSave,
  onClear,
  width = 360,
  height = 140,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [hasInk, setHasInk] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showSigned, setShowSigned] = useState(!!existingSignatureDataUrl);
  const [resigning, setResigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Set up canvas with devicePixelRatio scaling on mount.
  useEffect(() => {
    if (showSigned) return;
    const c = canvasRef.current;
    if (!c) return;
    const ratio = window.devicePixelRatio || 1;
    c.width = width * ratio;
    c.height = height * ratio;
    c.style.width = `${width}px`;
    c.style.height = `${height}px`;
    const ctx = c.getContext("2d");
    if (ctx) {
      ctx.scale(ratio, ratio);
      ctx.lineWidth = 2.2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#0f172a";
    }
  }, [showSigned, width, height, resigning]);

  function pointerPos(evt: React.PointerEvent<HTMLCanvasElement>) {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const c = canvasRef.current!;
    c.setPointerCapture(e.pointerId);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const { x, y } = pointerPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    setDrawing(true);
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing) return;
    const c = canvasRef.current!;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const { x, y } = pointerPos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasInk(true);
  }

  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing) return;
    setDrawing(false);
    try {
      canvasRef.current?.releasePointerCapture(e.pointerId);
    } catch { /* ignore */ }
  }

  function clearLocal() {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    setHasInk(false);
  }

  async function save() {
    const c = canvasRef.current;
    if (!c || !hasInk) return;
    setSaving(true);
    setError(null);
    try {
      const dataUrl = c.toDataURL("image/png");
      const ok = await onSave(dataUrl);
      if (!ok) throw new Error("Save failed");
      setShowSigned(true);
      setResigning(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function clearExisting() {
    if (!onClear) {
      setShowSigned(false);
      setResigning(true);
      return;
    }
    setSaving(true);
    try {
      const ok = await onClear();
      if (ok) {
        setShowSigned(false);
        setResigning(true);
      }
    } finally {
      setSaving(false);
    }
  }

  const roleStyle: Record<Props["role"], { bg: string; ring: string; label: string }> = {
    tenant: { bg: "bg-emerald-50", ring: "ring-emerald-300", label: "Tenant" },
    manager: { bg: "bg-blue-50", ring: "ring-blue-300", label: "Manager / Owner Agent" },
    owner: { bg: "bg-violet-50", ring: "ring-violet-300", label: "Owner" },
  };
  const r = roleStyle[role];

  return (
    <div className={`rounded-lg border border-slate-200 ${r.bg} p-3 mb-3`}>
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <div>
          <div className="text-xs font-semibold text-slate-700">
            {label}
            {required && <span className="ml-1 text-rose-600">*</span>}
          </div>
          <div className="text-[10px] text-slate-500">
            {r.label}
            {signerName ? ` · ${signerName}` : ""}
          </div>
        </div>
        {showSigned && existingSignedAt && (
          <div className="text-[10px] text-emerald-700 font-mono">
            ✓ signed {existingSignedAt.slice(0, 10)}
          </div>
        )}
      </div>

      {showSigned && existingSignatureDataUrl ? (
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={existingSignatureDataUrl} alt={`${signerName ?? label} signature`} className="bg-white rounded border border-slate-200" style={{ width, maxHeight: height + 20 }} />
          <button
            onClick={clearExisting}
            disabled={saving}
            className="mt-2 px-3 py-1.5 rounded-md bg-white border border-slate-300 text-xs text-slate-700 hover:bg-slate-50"
          >
            {saving ? "…" : "Re-sign"}
          </button>
        </div>
      ) : (
        <div>
          <canvas
            ref={canvasRef}
            className={`bg-white rounded border-2 ${r.ring} ring-1 touch-none`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={onPointerUp}
          />
          <div className="flex gap-2 mt-2 items-center">
            <button
              onClick={save}
              disabled={!hasInk || saving}
              className="px-3 py-1.5 rounded-md text-xs text-white bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed hover:bg-emerald-800"
            >
              {saving ? "Saving…" : "Save signature"}
            </button>
            <button
              onClick={clearLocal}
              disabled={!hasInk || saving}
              className="px-3 py-1.5 rounded-md text-xs bg-white border border-slate-300 text-slate-700 disabled:opacity-50 hover:bg-slate-50"
            >
              Clear
            </button>
            <span className="text-[10px] text-slate-500">
              {hasInk ? "Tap Save when done." : "Sign with finger or stylus."}
            </span>
            {error && <span className="text-[11px] text-rose-700">{error}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
