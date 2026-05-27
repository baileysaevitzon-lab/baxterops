// Browser-safe Supabase client. Uses the publishable / anon key only.
// Server / service-role operations belong in scripts/* with SUPABASE_SERVICE_ROLE_KEY,
// never in code that ships to the browser.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const hasSupabaseEnv = Boolean(url) && Boolean(key);

let cached: SupabaseClient | null = null;

/**
 * Get (or create) the singleton browser Supabase client.
 * Returns null if env vars are missing — callers must handle that path.
 */
export function getSupabase(): SupabaseClient | null {
  if (!hasSupabaseEnv) return null;
  if (cached) return cached;
  cached = createClient(url!, key!, {
    auth: { persistSession: false },
  });
  return cached;
}

export const SUPABASE_PROJECT_URL = url ?? null;
