"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/Card";
import { useAuth } from "@/components/AuthProvider";

type Mode = "sign_in" | "sign_up";

export default function LoginPage() {
  const router = useRouter();
  const { signIn, signUp, signedIn, profile, signOut } = useAuth();
  const [mode, setMode] = useState<Mode>("sign_in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg("");
    const r = mode === "sign_in"
      ? await signIn(email, password)
      : await signUp(email, password, fullName || email);
    setBusy(false);
    if (r.error) { setMsg(r.error); return; }
    if (mode === "sign_in") {
      router.push("/");
    } else {
      setMsg("Check your email to confirm. After confirming, sign in here.");
    }
  }

  return (
    <>
      <PageHeader title="Sign in" subtitle="BaxterOps internal · Supabase Auth" />

      {signedIn ? (
        <Card className="max-w-md">
          <CardHeader title="Already signed in" subtitle={profile?.email ?? "—"} />
          <CardBody className="space-y-3">
            <div className="text-sm">Role: <strong>{profile?.role ?? "—"}</strong> · Active: {profile?.is_active ? "yes" : "no"}</div>
            <div className="flex gap-2">
              <button onClick={() => router.push("/")} className="px-3 py-1.5 rounded bg-slate-900 text-white text-sm">Go to dashboard</button>
              <button onClick={async () => { await signOut(); }} className="px-3 py-1.5 rounded border border-rose-300 text-rose-700 text-sm">Sign out</button>
            </div>
          </CardBody>
        </Card>
      ) : (
        <Card className="max-w-md">
          <CardHeader
            title={mode === "sign_in" ? "Sign in" : "Create account"}
            subtitle="Internal SGD users only. Talk to Bailey before signing up."
            action={
              <button
                onClick={() => setMode(mode === "sign_in" ? "sign_up" : "sign_in")}
                className="text-xs text-sky-700 underline"
              >{mode === "sign_in" ? "create account" : "sign in"}</button>
            }
          />
          <CardBody>
            <form onSubmit={submit} className="space-y-3 text-sm">
              {mode === "sign_up" && (
                <div>
                  <label className="text-xs text-slate-500">Full name</label>
                  <input value={fullName} onChange={e => setFullName(e.target.value)} className="w-full border rounded px-3 py-2 mt-1" />
                </div>
              )}
              <div>
                <label className="text-xs text-slate-500">Email</label>
                <input type="email" required value={email} onChange={e => setEmail(e.target.value)} className="w-full border rounded px-3 py-2 mt-1" />
              </div>
              <div>
                <label className="text-xs text-slate-500">Password</label>
                <input type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)} className="w-full border rounded px-3 py-2 mt-1" />
              </div>
              <button disabled={busy} className="w-full px-4 py-2 rounded bg-slate-900 text-white disabled:opacity-50">
                {busy ? "…" : mode === "sign_in" ? "Sign in" : "Create account"}
              </button>
              {msg && <div className="text-xs text-rose-700 mt-1">{msg}</div>}
            </form>
            <p className="text-[11px] text-slate-400 mt-4">
              New accounts default to <strong>viewer</strong> role. An admin must promote you in <code>user_profiles</code> before you can edit data.
            </p>
          </CardBody>
        </Card>
      )}
    </>
  );
}
