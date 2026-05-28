// Sprint 17: typed-signature generation.
//
// Takes a tenant's typed name and renders it in a cursive web font into a
// canvas, returning a PNG data URL. Same pipeline is used for initials
// (smaller, all caps). The output is visually distinct from a wet-ink
// signature (clearly stylized cursive) so consumers know it was typed +
// generated. The recert_packet_signatures row stores both the typed name
// and the PNG so the audit trail is unambiguous.
//
// Safety posture: callers must record explicit tenant consent BEFORE
// invoking this. The function itself does not check consent — it only
// renders pixels. UI components and API routes that use the output are
// responsible for capturing + auditing tenant authorization.

"use client";

export interface SignatureOptions {
  /** Width of the output PNG in CSS pixels. Default 480. */
  width?: number;
  /** Height of the output PNG in CSS pixels. Default 120. */
  height?: number;
  /** Font family for the typed signature. Default a cursive stack. */
  fontFamily?: string;
  /** Font weight. Default 400. */
  fontWeight?: number;
  /** Pixel color of the ink. Default near-black. */
  inkColor?: string;
  /** Render style — "signature" is large flowing cursive; "initials" is smaller all-caps cursive. */
  variant?: "signature" | "initials";
}

const DEFAULT_FONT_STACK = '"Dancing Script", "Brush Script MT", "Apple Chancery", "Lucida Handwriting", cursive';

/**
 * Render the typed text to an offscreen canvas in cursive and return as PNG data URL.
 * Returns null on SSR (no canvas available) or empty input.
 */
export function textToSignatureDataUrl(text: string, opts: SignatureOptions = {}): string | null {
  if (typeof document === "undefined") return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  const width  = opts.width  ?? 480;
  const height = opts.height ?? 120;
  const family = opts.fontFamily ?? DEFAULT_FONT_STACK;
  const weight = opts.fontWeight ?? 400;
  const ink    = opts.inkColor ?? "#0f172a";
  const variant = opts.variant ?? "signature";

  const ratio = window.devicePixelRatio || 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(ratio, ratio);
  ctx.fillStyle = ink;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";

  // Pick a font size that fills the canvas comfortably for the given text.
  // Initials variant is smaller + uppercase.
  const renderText = variant === "initials" ? trimmed.toUpperCase() : trimmed;
  let fontSize = variant === "initials" ? 56 : 64;
  ctx.font = `${weight} ${fontSize}px ${family}`;

  // Shrink the font until the text fits with a small horizontal margin.
  const maxWidth = width * 0.92;
  let metrics = ctx.measureText(renderText);
  while (metrics.width > maxWidth && fontSize > 18) {
    fontSize -= 2;
    ctx.font = `${weight} ${fontSize}px ${family}`;
    metrics = ctx.measureText(renderText);
  }

  // Slight upward bias because cursive descenders look fine and the
  // visual center is above the geometric baseline.
  ctx.fillText(renderText, width / 2, height / 2);

  return canvas.toDataURL("image/png");
}

/**
 * Derive initials from a person's full name. Defaults: first letter of each
 * whitespace-separated word, uppercase, no punctuation. "Jose Humberto
 * Ocaranza-Garcia" → "JHO" (hyphenated last names treated as one word).
 */
export function deriveInitials(fullName: string): string {
  const cleaned = fullName.trim();
  if (!cleaned) return "";
  // Treat hyphen as one name component (Ocaranza-Garcia is one surname).
  return cleaned
    .split(/\s+/)
    .map(part => part.charAt(0).toUpperCase())
    .filter(c => /[A-Z]/.test(c))
    .join("");
}

/**
 * Preload the cursive font so the first render doesn't fall back to system fonts.
 * No-op on SSR. Returns a promise that resolves when fonts are loaded (or after a timeout).
 */
export async function ensureSignatureFontReady(): Promise<void> {
  if (typeof document === "undefined") return;
  if (!document.fonts || typeof document.fonts.load !== "function") return;
  try {
    // Trigger load of the highest-priority font in the stack.
    await Promise.race([
      document.fonts.load('64px "Dancing Script"'),
      new Promise(resolve => setTimeout(resolve, 800)),
    ]);
  } catch {
    /* fall through to system cursive */
  }
}
