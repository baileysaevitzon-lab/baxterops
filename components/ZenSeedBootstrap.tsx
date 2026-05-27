"use client";
// Idempotent client-side seed for Zen Hollywood field-tour data.
// Runs once per browser (gated by a localStorage flag) and is safe to re-mount.

import { useEffect } from "react";
import { ensureZenSeeded } from "@/lib/zen";

export default function ZenSeedBootstrap() {
  useEffect(() => {
    ensureZenSeeded();
  }, []);
  return null;
}
