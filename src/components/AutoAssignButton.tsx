"use client";

// One button: calendarize, place clinicals on partner assets, staff every
// shift under workload policies, and put every learner in sections and on
// their clinical shifts. Shows exactly what it did and what it could not do.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { autoAssignOffering } from "@/lib/actions";
import type { AutoAssignSummary } from "@/lib/autoassign";

const n = (x: number) => x.toLocaleString();
const pct = (x: number) => `${Math.round(x * 100)}%`;

export function AutoAssignButton({ cohortId, programId, meetings, staffedShifts, studentShifts, students }: { cohortId: string; programId: string; meetings: number; staffedShifts: number; studentShifts: number; students: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<AutoAssignSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = () => start(async () => {
    setError(null);
    try { const r = await autoAssignOffering(cohortId, programId); setResult(r); router.refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  });
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-800">Auto-assign this offering</div>
          <div className="text-xs text-slate-500">
            One click: rooms, days &amp; times for every section · every clinical section placed on a partner asset on its date and shift ·
            faculty, support staff and preceptors on every shift under their workload policies · every learner in a section and on their clinical shifts.
            Fills gaps only — anything already assigned by hand stays. Now: {n(meetings)} bookings · {n(staffedShifts)} staffed shifts · {n(students)} learners with {n(studentShifts)} clinical shifts.
          </div>
        </div>
        <button onClick={run} disabled={pending} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60">{pending ? "Assigning…" : "Auto-assign everything →"}</button>
      </div>
      {error && <p className="mt-2 text-xs text-rose-700">Could not finish: {error}</p>}
      {result && (
        <div className="mt-3 grid gap-2 text-xs md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-white p-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Calendar</div>
            <div className="mt-0.5 text-slate-800">{result.calendarized ? <>Calendarized — <strong>{n(result.meetings)}</strong> weekly bookings created</> : <><strong>{n(result.meetings)}</strong> weekly bookings already in place</>}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Clinical placement</div>
            {result.plan ? (
              <div className="mt-0.5 text-slate-800">
                <strong>{n(result.plan.placedShifts)}</strong> of {n(result.plan.demandShifts)} section-shifts placed ({pct(result.plan.placedShare)}) on {n(result.plan.sitesUsed)} sites · {n(result.plan.bookings)} asset bookings · {result.plan.agreements}
                {result.plan.unmet.length > 0 && <ul className="mt-1 space-y-0.5 text-amber-800">{result.plan.unmet.map((u) => <li key={u.reason}>⚠ {n(u.shifts)} — {u.reason}{u.fixes.length ? <span className="text-slate-500"> · fix: {u.fixes.join("; ")}</span> : null}</li>)}</ul>}
                <Link href="/scheduler" className="mt-1 inline-block text-rose-700 hover:underline">open the clinical scheduler ↦</Link>
              </div>
            ) : <div className="mt-0.5 text-slate-500">No dated clinical sections to place.</div>}
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Staffing</div>
            <div className="mt-0.5 text-slate-800">
              <strong>{n(result.staff.facultyShifts)}</strong> faculty · <strong>{n(result.staff.clinicalFacultyShifts)}</strong> clinical faculty · <strong>{n(result.staff.preceptorShifts)}</strong> preceptor · <strong>{n(result.staff.supportShifts)}</strong> support shift assignments across {n(result.staff.people)} people{result.staff.alreadyCovered ? ` · ${n(result.staff.alreadyCovered)} shifts were already covered` : ""}
              {result.staff.overCap > 0 && <div className="text-amber-800">⚠ {n(result.staff.overCap)} assignments had to exceed someone&apos;s weekly cap (nobody else was free) — check loads on the People page.</div>}
              {result.staff.uncovered.length > 0 && <ul className="mt-1 space-y-0.5 text-amber-800">{result.staff.uncovered.map((u) => <li key={u.kind}>⚠ {n(u.shifts)} {u.kind} shifts uncovered — {u.why}</li>)}</ul>}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Learners</div>
            <div className="mt-0.5 text-slate-800"><strong>{n(result.learners.students)}</strong> learners · {n(result.learners.sections)} new section seats · {n(result.learners.shifts)} new clinical shifts ({n(result.learners.shiftsOnAssets)} pinned to a booked asset)</div>
          </div>
          {result.notes.length > 0 && <ul className="md:col-span-2 xl:col-span-4 space-y-0.5 text-slate-600">{result.notes.map((x, i) => <li key={i}>· {x}</li>)}</ul>}
        </div>
      )}
    </div>
  );
}
