import Link from "next/link";
import type { ExceptionItem, ExceptionSeverity } from "@/lib/exceptions";
import { fmt } from "@/lib/format";

// The exception queue (Phase 7): blockers first, then warnings; informational items folded away.
// Every line says what is wrong, where, and what the reader will do on the linked screen.

const TONE: Record<ExceptionSeverity, { row: string; chip: string; label: string }> = {
  blocker: { row: "border-rose-200 bg-rose-50/60", chip: "bg-rose-600 text-white", label: "blocker" },
  warning: { row: "border-amber-200 bg-amber-50/50", chip: "bg-amber-500 text-white", label: "warning" },
  info: { row: "border-slate-200 bg-white", chip: "bg-slate-200 text-slate-700", label: "note" },
};

function Item({ x }: { x: ExceptionItem }) {
  const t = TONE[x.severity];
  return (
    <li className={`rounded-lg border px-3 py-2 ${t.row}`}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${t.chip}`}>{t.label}</span>
        <span className="text-sm font-medium text-slate-800">{x.title}</span>
        <span className="text-[11px] text-slate-500">{[x.institution, x.family].filter(Boolean).join(" · ")}</span>
        <Link href={x.href} className="ml-auto whitespace-nowrap rounded-lg bg-white px-2.5 py-1 text-xs font-medium text-rose-700 ring-1 ring-rose-200 hover:bg-rose-50" title={x.fix}>fix: {x.fix} →</Link>
      </div>
      <div className="mt-0.5 text-xs text-slate-600">{x.detail}</div>
    </li>
  );
}

export function ExceptionQueue({ items }: { items: ExceptionItem[] }) {
  const blockers = items.filter((x) => x.severity === "blocker");
  const warnings = items.filter((x) => x.severity === "warning");
  const notes = items.filter((x) => x.severity === "info");
  return (
    <section id="exceptions" className="scroll-mt-16 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-900">What needs fixing first</h2>
        <span className="text-xs text-slate-500">{fmt.num(blockers.length)} blocker{blockers.length === 1 ? "" : "s"} · {fmt.num(warnings.length)} warning{warnings.length === 1 ? "" : "s"} · {fmt.num(notes.length)} note{notes.length === 1 ? "" : "s"} — worst first, each linking to where it gets fixed</span>
      </div>
      {items.length === 0 && <p className="mt-2 text-sm text-emerald-700">Nothing outstanding — no over-capacity sites, unsecured placements, holiday sessions, unprecepted students, calendar conflicts or coverage gaps.</p>}
      {blockers.length > 0 && <ul className="mt-3 space-y-1.5">{blockers.slice(0, 10).map((x) => <Item key={x.id} x={x} />)}</ul>}
      {blockers.length > 10 && (
        <details className="mt-1.5 text-xs">
          <summary className="cursor-pointer text-rose-700 hover:underline">{fmt.num(blockers.length - 10)} more blocker{blockers.length - 10 === 1 ? "" : "s"}</summary>
          <ul className="mt-1.5 space-y-1.5">{blockers.slice(10).map((x) => <Item key={x.id} x={x} />)}</ul>
        </details>
      )}
      {warnings.length > 0 && <ul className="mt-2 space-y-1.5">{warnings.map((x) => <Item key={x.id} x={x} />)}</ul>}
      {notes.length > 0 && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-slate-500 hover:text-slate-700">{fmt.num(notes.length)} note{notes.length === 1 ? "" : "s"} — unverified inputs that do not block anything yet</summary>
          <ul className="mt-1.5 space-y-1.5">{notes.map((x) => <Item key={x.id} x={x} />)}</ul>
        </details>
      )}
    </section>
  );
}
