"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/Card";
import { useAuth } from "@/components/AuthProvider";

type Mode = "sign_in" | "sign_up";

const STATUS_LABELS: Record<string, string> = {
  approved: "✓ Approved",
  pending:  "⏳ Pending approval",
  rejected: "✗ Access denied",
};

export default function LoginPage() {
  const router = useRouter();
  const { signIn, signUp, signedIn, profile, signOut, approvalStatus } = useAuth();
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
      : await signUp(email, password, fullName);
    setBusy(false);
    if (r.error) { setMsg(r.error); return; }
    if (mode === "sign_in") {
      router.push("/");
    } else {
      setMsg("Account created. Check your email to confirm, then sign in here. Note: an admin must also approve your account before you can access BaxterOps.");
    }
  }

  return (
    <>
      <PageHeader title="Sign in" subtitle="BaxterOps internal · Supabase Auth" />

      {signedIn ? (
        <Card className="max-w-md">
          <CardHeader title="Signed in" subtitle={profile?.email ?? "—"} />
          <CardBody className="space-y-3">
            <div className="text-sm space-y-1">
              <div>Role: <strong>{profile?.role ?? "—"}</strong></div>
              <div>
                Status:{" "}
                <strong className={
                  approvalStatus === "approved" ? "text-emerald-700"
                  : approvalStatus === "rejected" ? "text-rose-700"
                  : "text-amber-700"
                }>
                  {STATUS_LABELS[approvalStatus ?? ""] ?? approvalStatus ?? "—"}
                </strong>
              </div>
              {approvalStatus !== "approved" && (
                <p className="text-xs text-amber-700 mt-1">
                  Your account is awaiting admin approval. Contact Bailey or Shane.
                </p>
              )}
            </div>
            <div className="flex gap-2">
              {approvalStatus === "approved" && (
                <button
                  onClick={() => router.push("/")}
                  className="px-3 py-1.5 rounded bg-slate-900 text-white text-sm"
                >
                  Go to dashboard
                </button>
              )}
              <button
                onClick={async () => { await signOut(); }}
                className="px-3 py-1.5 rounded border border-rose-300 text-rose-700 text-sm"
              >
                Sign out
              </button>
            </div>
          </CardBody>
        </Card>
      ) : (
        <Card className="max-w-md">
          <CardHeader
            title={mode === "sign_in" ? "Sign in" : "Create account"}
            subtitle="Internal SGD users only."
            action={
              <button
                onClick={() => { setMode(mode === "sign_in" ? "sign_up" : "sign_in"); setMsg(""); }}
                className="text-xs text-sky-700 underline"
              >
                {mode === "sign_in" ? "create account" : "sign in"}
              </button>
            }
          />
          <CardBody>
            <form onSubmit={submit} className="space-y-3 text-sm">
              {mode === "sign_up" && (
                <div>
                  <label className="text-xs text-slate-500">Full name</label>
                  <input
                    value={fullName}
                    onChange={e => setFullName(e.target.value)}
                    placeholder="Your name"
                    className="w-full border rounded px-3 py-2 mt-1"
                  />
                </div>
              )}
              <div>
                <label className="text-xs text-slate-500">Email</label>
                <input
                  type="email" required value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full border rounded px-3 py-2 mt-1"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500">Password</label>
                <input
                  type="password" required minLength={6} value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full border rounded px-3 py-2 mt-1"
                />
              </div>
              <button
                disabled={busy}
                className="w-full px-4 py-2 rounded bg-slate-900 text-white disabled:opacity-50"
              >
                {busy ? "…" : mode === "sign_in" ? "Sign in" : "Create account"}
              </button>
              {msg && (
                <div className={`text-xs mt-1 ${msg.startsWith("Account created") ? "text-emerald-700" : "text-rose-700"}`}>
                  {msg}
                </div>
              )}
            </form>
            {mode === "sign_up" && (
              <p className="text-[11px] text-slate-400 mt-4">
                New accounts require admin approval before accessing BaxterOps.
                Contact Bailey or Shane after signing up.
              </p>
            )}
          </CardBody>
        </Card>
      )}
    </>
  );
}
