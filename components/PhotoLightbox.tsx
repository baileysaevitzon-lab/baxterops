"use client";
// Sprint 28 (Phase 2) — shared photo lightbox.
// Renders ONE full-resolution image at a time (the active index). It does not
// preload the whole gallery — thumbnails keep using thumbUrl() in the grids,
// and only the opened image fetches its full-size publicUrl here.
import { useCallback, useEffect } from "react";
import type { PhotoEvidenceRecord } from "@/lib/types";

export function PhotoLightbox({
  photos,
  index,
  onClose,
  onIndex,
}: {
  photos: PhotoEvidenceRecord[];
  index: number | null;
  onClose: () => void;
  onIndex: (i: number) => void;
}) {
  const open = index !== null && index >= 0 && index < photos.length;

  const go = useCallback(
    (delta: number) => {
      if (index === null) return;
      const n = photos.length;
      if (n === 0) return;
      onIndex((index + delta + n) % n);
    },
    [index, photos.length, onIndex],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // prevent background scroll
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, go, onClose]);

  if (!open) return null;
  const p = photos[index!];
  const meta = [p.sourceLabel, p.sourceDate].filter(Boolean).join(" · ");

  return (
    <div
      className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Photo viewer"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        aria-label="Close (Esc)"
        className="absolute top-3 right-4 text-white/80 hover:text-white text-3xl leading-none"
      >
        ×
      </button>

      {photos.length > 1 && (
        <button
          onClick={e => { e.stopPropagation(); go(-1); }}
          aria-label="Previous (←)"
          className="absolute left-2 md:left-6 text-white/70 hover:text-white text-4xl px-2 select-none"
        >
          ‹
        </button>
      )}

      <figure
        className="max-w-5xl w-full flex flex-col items-center"
        onClick={e => e.stopPropagation()}
      >
        {p.publicUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={p.publicUrl}
            alt={p.caption || p.originalFilename}
            className="max-h-[78vh] max-w-full object-contain rounded shadow-2xl bg-white"
          />
        ) : (
          <div className="text-white/70 p-16 border border-white/20 rounded">
            No image attached for #{p.photoOrder} ({p.originalFilename})
          </div>
        )}
        <figcaption className="mt-3 w-full max-w-3xl text-white text-sm bg-black/40 rounded px-4 py-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-1.5 py-0.5 rounded bg-white/15 text-[11px] uppercase tracking-wide">{p.category}</span>
            <span className="font-medium">{p.competitorName}</span>
            {meta && <span className="text-white/60">· {meta}</span>}
            <span className="text-white/40 ml-auto">{index! + 1} / {photos.length}</span>
          </div>
          {p.caption && <div className="mt-1 text-white/85">{p.caption}</div>}
          {(p.relatedUnitNumber || p.relatedAmenity) && (
            <div className="mt-1 text-white/55 text-xs">
              {p.relatedUnitNumber && <span className="mr-3">unit {p.relatedUnitNumber}</span>}
              {p.relatedAmenity && <span>{p.relatedAmenity}</span>}
            </div>
          )}
        </figcaption>
      </figure>

      {photos.length > 1 && (
        <button
          onClick={e => { e.stopPropagation(); go(1); }}
          aria-label="Next (→)"
          className="absolute right-2 md:right-6 text-white/70 hover:text-white text-4xl px-2 select-none"
        >
          ›
        </button>
      )}
    </div>
  );
}
