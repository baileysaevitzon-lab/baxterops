"use client";
// Sprint 7 — real Supabase Auth.
// Sprint 22 — added approval_status gating: new accounts are pending/inactive
//             until an admin sets approval_status='approved' and is_active=true.
//
// Wraps the app. Tracks the current Supabase session and the user's
// role + approval status from public.user_profiles. Exposes:
//   - authUser: session user or null
//   - profile: user_profiles row or null
//   - signedIn: boolean
//   - isApproved: boolean (approved + active profile)
//   - approvalStatus: "pending" | "approved" | "rejected" | null
//   - signIn(email, password)
//   - signUp(email, password, full_name)
//   - signOut()
//   - dbRole(): "admin" | "manager" | "leasing" | "analyst" | "viewer" | null
//
// The <RoleProvider> mock switcher still exists for UI preview only.
// Real RBAC + approval gating come from this AuthProvider.

import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";
import { getSupabase } from "@/lib/supabase/client";
import type { Session, User } from "@supabase/supabase-js";

export type DbRole = "admin" | "manager" | "leasing" | "analyst" | "viewer";
export type ApprovalStatus = "pending" | "approved" | "rejected";

interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  role: DbRole;
  is_active: boolean;
  approval_status: ApprovalStatus;
}

interface Ctx {
  authUser: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signedIn: boolean;
  isApproved: boolean;
  approvalStatus: ApprovalStatus | null;
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
    const { data, error } = await sb
      .from("user_profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    if (error) { console.warn("[Auth] profile load:", error.message); setProfile(null); return; }
    if (data) { setProfile(data as Profile); return; }

    // No profile row found — create one (trigger should have done this, but
    // this is a client-side fallback for existing users who predate the trigger).
    const { data: userData } = await sb.auth.getUser();
    if (userData?.user) {
      const { data: newProfile, error: insErr } = await sb
        .from("user_profiles")
        .insert({
          id: userId,
          email: userData.user.email ?? "",
          full_name: null,
          role: "viewer",
          is_active: false,
          approval_status: "pending",
        })
        .select("*")
        .maybeSingle();
      if (!insErr && newProfile) setProfile(newProfile as Profile);
    }
  }, []);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) { setLoading(false); return; }
    sb.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session?.user) refreshProfile(data.session.user.id);
      if (data.session?.access_token) {
        sb.realtime.setAuth(data.session.access_token);
      }
      setLoading(false);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_evt, sess) => {
      setSession(sess);
      if (sess?.user) refreshProfile(sess.user.id);
      else setProfile(null);
      if (sb.realtime && sess?.access_token) {
        sb.realtime.setAuth(sess.access_token);
      }
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
    const trimmedName = fullName.trim() || null;
    const { error } = await sb.auth.signUp({
      email,
      password,
      options: { data: { full_name: trimmedName } },
    });
    if (error) return { error: error.message };
    // The DB trigger (handle_new_user) auto-creates the profile row with
    // role='viewer', is_active=false, approval_status='pending'.
    // No further action needed here.
    return {};
  }, []);

  const signOut = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    await sb.auth.signOut();
    setProfile(null);
  }, []);

  const dbRole = useCallback(() => profile?.role ?? null, [profile]);

  const isApproved = Boolean(
    profile?.is_active && profile?.approval_status === "approved"
  );
  const approvalStatus: ApprovalStatus | null = profile?.approval_status ?? null;

  return (
    <AuthCtx.Provider value={{
      authUser: session?.user ?? null,
      session,
      profile,
      loading,
      signedIn: Boolean(session?.user),
      isApproved,
      approvalStatus,
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
