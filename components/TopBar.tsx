"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "./AuthProvider";

export default function TopBar() {
  // Sprint 27: TopBar shows the real signed-in identity only. The mock role
  // switcher (developer preview) now lives in Settings, clearly labeled.
  const { signedIn, profile, signOut, authUser } = useAuth();
  const pathname = usePathname();
  // Sprint 25: hide the workspace top bar on the public SGD Operations Portal.
  if (pathname === "/") return null;
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
      </div>
      <div className="flex items-center gap-3">
        {signedIn && (
          <button onClick={() => signOut()} className="text-xs px-2 py-1 rounded border border-rose-200 text-rose-700 hover:bg-rose-50">
            Sign out
          </button>
        )}
      </div>
    </div>
  );
}
