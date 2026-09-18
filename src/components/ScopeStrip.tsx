import Link from "next/link";
import { fmt } from "@/lib/format";
import { ProvisionalDatesBanner } from "@/components/Evidence";
import type { CalendarProvenance } from "@/lib/evidence";

export interface BridgeItem { label: string; href: string; value: number; unit: string; why: string }

// One strip above every capacity, load, coverage, staffing and scheduler view saying what the
// numbers are (requirements, a proposed scenario, or the applied plan), whose enrollment they
// count, the date window, which constraints are enforced, and why a sibling view differs.
export function ScopeStrip({ shows, population, window, constraints, differs = [], computedAt = new Date(), provisional, bridge, self }: {
  shows: string; population: string; window: string; constraints: string[];
  /** Sibling views and the scope difference that explains their different totals. */
  differs?: [label: string, href: string, why: string][];
  computedAt?: Date;
  /** Where the dates come from — shows the provisional-dates line while no college calendar is imported (Phase 3). */
  provisional?: CalendarProvenance;
  /** The three capacity views' totals for this scope, side by side (Phase 4). */
  bridge?: { from: string; to: string; scheduler: BridgeItem; capacity: BridgeItem; load: BridgeItem } | null;
  /** Which of the bridge's views this page is. */
  self?: "scheduler" | "capacity" | "load";
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-2.5 text-xs text-slate-600">
      {provisional && <div className="mb-1.5"><ProvisionalDatesBanner provenance={provisional} compact /></div>}
      <div className="flex flex-wrap gap-x-6 gap-y-1">
        <span><span className="font-semibold uppercase tracking-wide text-slate-500">Shows</span> {shows}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1">
        <span><span className="font-semibold uppercase tracking-wide text-slate-500">Population</span> {population}</span>
        <span><span className="font-semibold uppercase tracking-wide text-slate-500">Window</span> {window}</span>
        <span><span className="font-semibold uppercase tracking-wide text-slate-500">Enforces</span> {constraints.join(" · ")}</span>
        <span className="text-slate-500">computed {fmt.dateTime(computedAt)}</span>
      </div>
      {bridge && (
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-lg bg-white px-2.5 py-1.5 ring-1 ring-slate-200">
          <span className="font-semibold uppercase tracking-wide text-slate-500">Same scope, three views ({bridge.from} → {bridge.to})</span>
          {(["scheduler", "capacity", "load"] as const).map((k) => { const b = bridge[k]; const me = self === k; return <span key={k} className={me ? "font-semibold text-slate-800" : ""} title={b.why}>{me ? b.label : <Link href={b.href} className="text-rose-700 hover:underline">{b.label}</Link>} <span className="tabular-nums">{fmt.num(b.value)}</span> {b.unit}</span>; })}
          <span className="basis-full text-[11px] text-slate-500">{bridge.scheduler.value === bridge.capacity.value ? "Scheduler and site capacity agree — one definition of demand." : `Scheduler and site capacity differ by ${fmt.num(Math.abs(bridge.scheduler.value - bridge.capacity.value))} learner-shifts: ${bridge.scheduler.why}.`} Site load is a different population: {bridge.load.why}.</span>
        </div>
      )}
      {differs.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1">
          <span className="font-semibold uppercase tracking-wide text-slate-500">Why other views differ</span>
          {differs.map(([label, href, why]) => <span key={href}><Link href={href} className="text-rose-700 hover:underline">{label}</Link> {why}</span>)}
        </div>
      )}
    </div>
  );
}
