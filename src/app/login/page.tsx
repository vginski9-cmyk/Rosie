// The one door into the site: the shared password, nothing else.

export const dynamic = "force-dynamic";

export default function LoginPage({ searchParams }: { searchParams: { next?: string; error?: string } }) {
  const next = searchParams.next && searchParams.next.startsWith("/") ? searchParams.next : "/";
  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <form method="POST" action="/api/login" className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-rose-600 text-sm font-bold text-white">R</span>
            <span className="text-lg font-semibold text-slate-900">Rosie</span>
          </div>
          <p className="mt-2 text-sm text-slate-500">Enter the password to open the site.</p>
        </div>
        <input type="hidden" name="next" value={next} />
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Password</span>
          <input name="password" type="password" autoFocus required autoComplete="current-password" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-rose-400 focus:outline-none" />
        </label>
        {searchParams.error && <p className="text-sm font-medium text-rose-700">That password isn&apos;t right — try again.</p>}
        <button className="w-full rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700">Open Rosie</button>
      </form>
    </div>
  );
}
