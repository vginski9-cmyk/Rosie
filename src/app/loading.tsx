// The loading state every dynamic page streams behind (Phase 8): the shell paints at once,
// the page's own content replaces this skeleton when its queries finish.
export default function Loading() {
  return (
    <div className="space-y-6" role="status" aria-live="polite" aria-label="Loading">
      <div className="space-y-2">
        <div className="h-7 w-72 animate-pulse rounded bg-slate-200" />
        <div className="h-4 w-[36rem] max-w-full animate-pulse rounded bg-slate-100" />
      </div>
      <div className="h-16 animate-pulse rounded-xl border border-slate-200 bg-slate-50" />
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-20 animate-pulse rounded-lg bg-slate-100" />)}
      </div>
      <div className="h-64 animate-pulse rounded-2xl border border-slate-200 bg-white" />
      <p className="text-xs text-slate-500">Loading — reading the calendar, the sites and the roster…</p>
    </div>
  );
}
