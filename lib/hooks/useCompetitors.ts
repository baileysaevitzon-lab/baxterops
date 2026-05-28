// Sprint 12: useCompetitors hook.
// Replaces direct imports of `COMPETITORS` from lib/seed.ts on UI pages.
// Returns a live, Supabase-backed list that updates via realtime when
// any device inserts/updates/deletes a competitor.
//
// Fallback policy: if Supabase returns empty (unauthenticated or env unset),
// the seed array is returned so the page never renders blank.

"use client";

import { useEffect, useState } from "react";
import { loadAllCompetitors } from "@/lib/services/competitors";
import { getSupabase } from "@/lib/supabase/client";
import type { CompetitorProperty } from "@/lib/types";
import { COMPETITORS as SEED_COMPETITORS } from "@/lib/seed";

interface UseCompetitorsResult {
  competitors: CompetitorProperty[];
  loading: boolean;
  /** True when reading from Supabase (and at least one row returned). False = seed fallback. */
  isLive: boolean;
  /** Force a refetch (used after writes that should bypass realtime). */
  refresh: () => Promise<void>;
}

export function useCompetitors(): UseCompetitorsResult {
  // Start with seed so first render never blanks.
  const [competitors, setCompetitors] = useState<CompetitorProperty[]>(SEED_COMPETITORS);
  const [loading, setLoading] = useState(true);
  const [isLive, setIsLive] = useState(false);

  async function refresh() {
    const next = await loadAllCompetitors();
    // Detect whether we got Supabase data (different reference than seed)
    // by comparing identity. loadAllCompetitors returns seed by reference
    // on fallback paths.
    const fromSupabase = next !== SEED_COMPETITORS;
    setCompetitors(next);
    setIsLive(fromSupabase);
    setLoading(false);
  }

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<NonNullable<ReturnType<typeof getSupabase>>["channel"]> | null = null;

    // Unique channel name per mount — prevents "cannot add postgres_changes callbacks
    // after subscribe()" errors caused by React StrictMode double-mounting.
    const channelName = `competitors-live-${Math.random().toString(36).slice(2)}`;

    (async () => {
      await refresh();
      if (cancelled) return;

      // Subscribe to realtime so other devices' edits land here.
      const sb = getSupabase();
      if (sb) {
        channel = sb
          .channel(channelName)
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "competitors" },
            () => {
              if (!cancelled) refresh().catch(() => {});
            },
          )
          .subscribe();
      }
    })();

    return () => {
      cancelled = true;
      const sb = getSupabase();
      if (channel && sb) {
        sb.removeChannel(channel);
      }
    };
  }, []);

  return { competitors, loading, isLive, refresh };
}
