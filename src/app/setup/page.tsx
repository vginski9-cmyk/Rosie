import Link from "next/link";
import { redirect } from "next/navigation";
import { getOrganizations } from "@/lib/queries";

export const dynamic = "force-dynamic";

// SETUP — the institution's own page. With one institution, go straight to it.
export default async function SetupPage() {
  const orgs = await getOrganizations();
  if (orgs.length === 1) redirect(`/orgs/${orgs[0].id}`);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Setup</h1>
          <p className="text-sm text-slate-500">Pick a college. Each one sets up its own calendar, campuses, clinical sites &amp; partners, people, assumptions and evidence.</p>
        </div>
        <Link href="/sites" className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50" title="every clinical site the platform knows, whichever colleges approach it">Site registry — all colleges →</Link>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {orgs.map((o) => (
          <div key={o.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-rose-300">
            <Link href={`/orgs/${o.id}`} className="block">
              <div className="text-base font-semibold text-slate-900 hover:text-rose-700">{o.name}</div>
              <div className="text-xs text-slate-500">{[o.kind, [o.city, o.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ") || "no basics yet"} · {o.counts.programs} programs · {o.counts.employers} sites · {o.counts.people} people</div>
            </Link>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
              <Link href={`/orgs/${o.id}#calendar`} className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700 hover:bg-slate-200">Calendar</Link>
              <Link href={`/orgs/${o.id}#rooms`} className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700 hover:bg-slate-200">Campuses &amp; rooms</Link>
              <Link href={`/orgs/${o.id}#sites`} className="rounded-full bg-indigo-50 px-2 py-0.5 font-medium text-indigo-800 ring-1 ring-indigo-200 hover:bg-indigo-100">Clinical sites &amp; partners ({o.counts.employers}) →</Link>
              <Link href={`/orgs/${o.id}#people`} className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700 hover:bg-slate-200">People &amp; policies</Link>
              <Link href={`/orgs/${o.id}/assumptions`} className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700 hover:bg-slate-200">Assumptions</Link>
            </div>
          </div>
        ))}
        {orgs.length === 0 && <p className="text-sm text-slate-400">No institution yet — add a North Star goal on the <Link href="/goals" className="text-rose-600 hover:underline">goals page</Link> to create one.</p>}
      </div>
    </div>
  );
}
