import Link from "next/link";
import { fmt } from "@/lib/format";
import { ProvisionalDatesBanner } from "@/components/Evidence";
import type { CalendarProvenance } from "@/lib/evidence";

// One strip above every capacity, load, coverage, staffing and scheduler view saying what the
// numbers are (requirements, a proposed scenario, or the applied plan), whose enrollment they
// count, the date window, which constraints are enforced, and why a sibling view differs.
export function ScopeStrip({ shows, population, window, constraints, differs = [], computedAt = new Date(), provisional }: {
  shows: string; population: string; window: string; constraints: string[];
  /** Sibling views and the scope difference that explains their different totals. */
  differs?: [label: string, href: string, why: string][];
  computedAt?: Date;
  /** Where the dates come from — shows the provisional-dates line while no college calendar is imported (Phase 3). */
  provisional?: CalendarProvenance;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-2.5 text-xs text-slate-600">
      {provisional && <div className="mb-1.5"><ProvisionalDatesBanner provenance={provisional} compact /></div>}
      <div className="flex flex-wrap gap-x-6 gap-y-1">
        <span><span className="font-semibold uppercase tracking-wide text-slate-400">Shows</span> {shows}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1">
        <span><span className="font-semibold uppercase tracking-wide text-slate-400">Population</span> {population}</span>
        <span><span className="font-semibold uppercase tracking-wide text-slate-400">Window</span> {window}</span>
        <span><span className="font-semibold uppercase tracking-wide text-slate-400">Enforces</span> {constraints.join(" · ")}</span>
        <span className="text-slate-400">computed {fmt.dateTime(computedAt)}</span>
      </div>
      {differs.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1">
          <span className="font-semibold uppercase tracking-wide text-slate-400">Why other views differ</span>
          {differs.map(([label, href, why]) => <span key={href}><Link href={href} className="text-rose-700 hover:underline">{label}</Link> {why}</span>)}
        </div>
      )}
    </div>
  );
}
