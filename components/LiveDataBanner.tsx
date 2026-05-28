"use client";
// Sprint 11 — Static fallback banner.
//
// Shown when the user is not authenticated with Supabase. Without a session,
// all RLS-protected tables return empty results, so pages silently show only
// static seed data. This banner makes that state visible and prompts sign-in.
//
// Usage:
//   import { LiveDataBanner } from "@/components/LiveDataBanner";
//   ...
//   <LiveDataBanner />
//
// The banner is a no-op if the user is signed in or Supabase is not configured.

import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { hasSupabaseEnv } from "@/lib/supabase/client";

export function LiveDataBanner() {
  const { signedIn, loading } = useAuth();

  // Don't show while auth state is loading (prevents flash)
  if (loading) return null;

  // If Supabase is not configured at all, show a different message
  if (!hasSupabaseEnv) {
    return (
      <div className="mb-4 rounded-md border border-slate-300 bg-slate-50 px-4 py-2.5 text-xs text-slate-600 flex items-center justify-between">
        <span>
          <strong>Supabase not configured.</strong> Showing static seed data only. Add{" "}
          <code>NEXT_PUBLIC_SUPABASE_URL</code> + <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to{" "}
          <code>.env.local</code> to enable live data.
        </span>
      </div>
    );
  }

  // Signed in — no banner needed
  if (signedIn) return null;

  return (
    <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs text-amber-800 flex items-center justify-between gap-4">
      <span>
        <strong>Viewing static snapshot data.</strong> Live Supabase intelligence (tours, scores, photos,
        field observations) requires authentication. Data edited on another device will not appear until you sign in.
      </span>
      <Link
        href="/login"
        className="shrink-0 px-3 py-1.5 rounded-md bg-amber-700 text-white font-medium hover:bg-amber-800"
      >
        Sign in →
      </Link>
    </div>
  );
}
