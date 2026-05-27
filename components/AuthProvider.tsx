"use client";
// Sprint 7 — real Supabase Auth.
//
// Wraps the app. Tracks the current Supabase session and the user's
// role from public.user_profiles. Exposes:
//   - authUser: session user or null
//   - profile: user_profiles row or null
//   - signedIn: boolean
//   - signIn(email, password)
//   - signUp(email, password, full_name)
//   - signOut()
//   - dbRole(): "admin" | "manager" | "leasing" | "analyst" | "viewer" | null
//
// The OLD `<RoleProvider>` mock switcher still exists and continues to drive UI
// preview only. Real RBAC for Supabase RLS comes from this AuthProvider.

import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";
import { getSupabase } from "@/lib/supabase/client";
import type { Session, User } from "@supabase/supabase-js";

export type DbRole = "admin" | "manager" | "leasing" | "analyst" | "viewer";

interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  role: DbRole;
  is_active: boolean;
}

interface Ctx {
  authUser: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signedIn: boolean;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  dbRole: () => DbRole | null;
}

const AuthCtx = createContext<Ctx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshProfile = useCallback(async (userId: string) => {
    const sb = getSupabase();
    if (!sb) return;
    const { data, error } = await sb.from("user_profiles").select("*").eq("id", userId).maybeSingle();
    if (error) { console.warn("[Auth] profile load:", error.message); setProfile(null); return; }
    setProfile(data as Profile | null);
  }, []);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) { setLoading(false); return; }
    sb.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session?.user) refreshProfile(data.session.user.id);
      setLoading(false);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_evt, sess) => {
      setSession(sess);
      if (sess?.user) refreshProfile(sess.user.id);
      else setProfile(null);
    });
    return () => { sub.subscription.unsubscribe(); };
  }, [refreshProfile]);

  const signIn: Ctx["signIn"] = useCallback(async (email, password) => {
    const sb = getSupabase();
    if (!sb) return { error: "Supabase not configured" };
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    return {};
  }, []);

  const signUp: Ctx["signUp"] = useCallback(async (email, password, fullName) => {
    const sb = getSupabase();
    if (!sb) return { error: "Supabase not configured" };
    const { error } = await sb.auth.signUp({ email, password, options: { data: { full_name: fullName } } });
    if (error) return { error: error.message };
    return {};
  }, []);

  const signOut = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    await sb.auth.signOut();
    setProfile(null);
  }, []);

  const dbRole = useCallback(() => profile?.role ?? null, [profile]);

  return (
    <AuthCtx.Provider value={{
      authUser: session?.user ?? null,
      session,
      profile,
      loading,
      signedIn: Boolean(session?.user),
      signIn, signUp, signOut, dbRole,
    }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth(): Ctx {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
