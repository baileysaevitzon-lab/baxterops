"use client";
import Link from "next/link";
import { RoleSwitcher, useRole } from "./RoleProvider";
import { useAuth } from "./AuthProvider";

export default function TopBar() {
  const { user } = useRole();
  const { signedIn, profile, signOut, authUser } = useAuth();
  return (
    <div className="border-b border-slate-200 bg-white px-8 py-3 flex flex-wrap justify-between items-center gap-3">
      <div className="text-xs text-slate-500 flex items-center gap-3">
        {signedIn ? (
          <span>
            Signed in as <strong className="text-slate-700">{profile?.email ?? authUser?.email}</strong>{" "}
            <span className="ml-1 px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[10px] font-medium">{profile?.role ?? "no profile yet"}</span>
          </span>
        ) : (
          <Link href="/login" className="text-sky-700 underline">Sign in →</Link>
        )}
        <span className="text-slate-300">|</span>
        <span title="Mock role switcher; UI-only preview. Does NOT change Supabase RLS.">
          UI preview as <span className="font-medium text-slate-700">{user.name}</span> ({user.role})
        </span>
      </div>
      <div className="flex items-center gap-3">
        <RoleSwitcher compact />
        {signedIn && (
          <button onClick={() => signOut()} className="text-xs px-2 py-1 rounded border border-rose-200 text-rose-700 hover:bg-rose-50">
            Sign out
          </button>
        )}
      </div>
    </div>
  );
}
