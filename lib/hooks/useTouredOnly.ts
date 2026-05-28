// Sprint 13: shared Toured-Only toggle hook.
// Persists user preference to localStorage so it survives navigation/refresh
// and is consistent across /competitors, /competitor-intelligence,
// /comp-matching, and the dashboard.

"use client";

import { useCallback, useEffect, useState } from "react";

const KEY = "baxter:touredOnly";

export function useTouredOnly(defaultValue = false): [boolean, (next: boolean) => void] {
  const [on, setOn] = useState<boolean>(defaultValue);

  // Hydrate from localStorage on mount. SSR-safe: only touches window in effect.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw != null) setOn(raw === "1");
    } catch {
      /* localStorage unavailable (private mode, etc.) — keep default */
    }
  }, []);

  const set = useCallback((next: boolean) => {
    setOn(next);
    try {
      window.localStorage.setItem(KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  return [on, set];
}
