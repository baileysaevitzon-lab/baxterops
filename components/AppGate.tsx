"use client";
// Sprint 22: Route-level auth + approval gate.
//
// Wraps {children} in the root layout's <main> area. Shows:
//   - loading spinner while auth state resolves
//   - sign-in prompt for unauthenticated visitors
//   - pending-approval screen for signed-in but unapproved users
//   - access-denied screen for rejected accounts
//   - children for approved users
//
// PUBLIC_PATHS and PUBLIC_PREFIXES bypass the gate entirely (login + public
// tenant form from Sprint 21).
//
// Security note: the actual data-access enforcement is RLS. This component
// is the UX layer — it blocks the UI before any data query fires.

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useAuth } from "./AuthProvider";

// Paths that do NOT require auth
const PUBLIC_PATHS = ["/login"];
const PUBLIC_PREFIXES = ["/recertification/tenant/"];

export default function AppGate({ children }: { children: ReactNode }) {
  const { loading, signedIn, isApproved, approvalStatus, profile, signOut } = useAuth();
  const pathname = usePathname();

  // Public paths bypass the gate
  const isPublic =
    PUBLIC_PATHS.includes(pathname ?? "") ||
    PUBLIC_PREFIXES.some(p => pathname?.startsWith(p));
  if (isPublic) return <>{children}</>;

  // Resolving auth state
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <span className="text-sm text-slate-500">Loading…</span>
      </div>
    );
  }

  // Visitor is not signed in at all
  if (!signedIn) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="max-w-sm text-center space-y-4 px-4">
          <div className="text-3xl">🔒</div>
          <h1 className="text-xl font-bold text-slate-900">Sign in required</h1>
          <p className="text-sm text-slate-600">
            BaxterOps is only accessible to authorized SGD Property Management team members.
          </p>
          <Link
            href="/login"
            className="inline-block px-5 py-2.5 rounded-lg bg-slate-900 text-white text-sm font-semibold"
          >
            Sign in →
          </Link>
        </div>
      </div>
    );
  }

  // Signed in but waiting for admin approval
  if (!isApproved && approvalStatus === "pending") {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="max-w-sm text-center space-y-4 px-4">
          <div className="w-14 h-14 bg-amber-100 rounded-full flex items-center justify-center mx-auto text-2xl">
            ⏳
          </div>
          <h1 className="text-xl font-bold text-slate-900">Waiting for approval</h1>
          <p className="text-sm text-slate-600">
            Your account (<strong>{profile?.email}</strong>) has been created and is waiting
            for admin approval. Contact Bailey or Shane to get approved.
          </p>
          <p className="text-xs text-slate-400 mt-2">
            Once approved you will be able to access BaxterOps on your next sign-in.
          </p>
          <button
            onClick={() => signOut()}
            className="text-xs text-rose-700 underline mt-4"
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  // Signed in but account was rejected
  if (!isApproved && approvalStatus === "rejected") {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="max-w-sm text-center space-y-4 px-4">
          <div className="text-3xl">🚫</div>
          <h1 className="text-xl font-bold text-slate-900">Access denied</h1>
          <p className="text-sm text-slate-600">
            Your account (<strong>{profile?.email}</strong>) has been deactivated.
            Contact Bailey or Shane if you believe this is an error.
          </p>
          <button
            onClick={() => signOut()}
            className="text-xs text-rose-700 underline mt-4"
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  // Signed in but profile hasn't loaded yet (unlikely race, handled gracefully)
  if (signedIn && !profile) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <span className="text-sm text-slate-500">Setting up your account…</span>
      </div>
    );
  }

  // Approved user — render the app
  return <>{children}</>;
}
