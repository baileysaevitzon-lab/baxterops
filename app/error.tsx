"use client";
// Sprint 27 — route-segment error boundary. Prevents a crash in any page
// (e.g. a photo/gallery render error) from white-screening the workspace.

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="max-w-lg mx-auto mt-16 text-center space-y-4 px-4">
      <div className="text-4xl">⚠️</div>
      <h1 className="text-xl font-bold text-slate-900">Something went wrong on this page</h1>
      <p className="text-sm text-slate-600">
        An unexpected error occurred while rendering this page. Your data is safe — nothing was lost.
        Try again, or head back to the dashboard.
      </p>
      {error?.message && (
        <p className="text-xs text-slate-400 font-mono break-words bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
          {error.message}
        </p>
      )}
      <div className="flex gap-2 justify-center pt-2">
        <button onClick={() => reset()} className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-700">
          Try again
        </button>
        <a href="/baxter" className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50">
          Back to dashboard
        </a>
      </div>
    </div>
  );
}
