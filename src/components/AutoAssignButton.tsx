"use client";
import { fmt } from "@/lib/format";

// One button, three steps (Phase 5): preview what auto-assign would do — calendarize, place
// clinicals on partner assets, staff every shift under workload policies, put every learner in
// sections and on their clinical shifts — then confirm, then undo if it was wrong. Shows exactly
// what it did and what it could not do, and records the change.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { autoAssignOffering, previewAutoAssign, undoChangeSet } from "@/lib/actions";
import type { AutoAssignSummary, AutoAssignPreview } from "@/lib/autoassign";

const n = (x: number) => fmt.num(x);
const pct = (x: number) => fmt.pct(x);

export function AutoAssignButton({ cohortId, programId, meetings, staffedShifts, studentShifts, students }: { cohortId: string; programId: string; meetings: number; staffedShifts: number; studentShifts: number; students: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [preview, setPreview] = useState<AutoAssignPreview | null>(null);
  const [override, setOverride] = useState(false);
  const [result, setResult] = useState<(AutoAssignSummary & { changeSetId: string | null }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const doPreview = () => start(async () => {
    setError(null); setResult(null);
    try { setPreview(await previewAutoAssign(cohortId)); setOverride(false); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  });
  const run = () => start(async () => {
    setError(null);
    try { const r = await autoAssignOffering(cohortId, programId); setResult(r); setPreview(null); router.refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  });
  const undo = (id: string) => start(async () => {
    setError(null);
    try { await undoChangeSet(id); setResult(null); router.refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  });
  const blocking = preview?.plan?.blockers.filter((b) => b.blocking) ?? [];
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-800">Auto-assign this offering</div>
          <div className="text-xs text-slate-500">
            Rooms, days &amp; times for every section · every clinical shift placed on a partner asset on its date and shift block ·
            faculty, support staff and preceptors on every shift under their workload policies · every learner in a section and on their clinical shifts.
            Fills gaps only — anything already assigned by hand stays. Now: {n(meetings)} bookings · {n(staffedShifts)} staffed shifts · {n(students)} learners with {n(studentShifts)} clinical shifts.
          </div>
        </div>
        {!preview && <button onClick={doPreview} disabled={pending} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60">{pending ? "Working…" : "Preview auto-assign →"}</button>}
      </div>
      {error && <p className="mt-2 text-xs text-rose-700">Could not finish: {error}</p>}
      {preview && (
        <div className="mt-3 rounded-lg border border-slate-300 bg-white p-3 text-xs">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">What auto-assign would do for {preview.offering}</div>
          <ul className="space-y-1 text-slate-700">
            <li><strong>Calendar:</strong> {preview.calendarize > 0 ? `create ${n(preview.calendarize)} weekly bookings (rooms, days, times; clinical sections at partner sites)` : `${n(preview.meetingsNow)} weekly bookings already in place — nothing to create`}</li>
            <li><strong>Clinical placement:</strong> {preview.plan ? <>{n(preview.plan.placedShifts)} of {n(preview.plan.demandShifts)} clinical shifts placed ({pct(preview.plan.placedShare)}) on {n(preview.plan.sitesUsed)} sites as {n(preview.plan.bookings)} asset bookings under {preview.plan.agreements} · ready to run: {n(preview.plan.readySeats)} of {n(preview.plan.demandSeats)} learner-shifts{preview.plan.unmet.length > 0 && <ul className="mt-0.5 space-y-0.5 text-amber-800">{preview.plan.unmet.map((u) => <li key={u.reason}>⚠ {n(u.shifts)} — {u.reason}{u.fixes.length ? <span className="text-slate-500"> · fix: {u.fixes.join("; ")}</span> : null}</li>)}</ul>}</> : "no dated clinical shifts to place"}</li>
            <li><strong>Staffing:</strong> up to {n(preview.staffing.shiftsNeedingStaff)} shifts still need someone{preview.staffing.alreadyStaffed ? ` · ${n(preview.staffing.alreadyStaffed)} already covered` : ""}</li>
            <li><strong>Learners:</strong> {n(preview.learners.students)} learners · {n(preview.learners.sectionSeatsMissing)} section seats and {n(preview.learners.shiftsMissing)} clinical shifts to create · {n(preview.learners.unpinnedShifts)} existing shifts to pin to an asset</li>
            {preview.notes.map((x, i) => <li key={i} className="text-slate-500">· {x}</li>)}
          </ul>
          {blocking.length > 0 && (
            <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-2">
              <div className="font-medium text-rose-800">Blocked: {blocking.map((b) => `${b.label} (${n(b.shifts)} shifts)`).join("; ")}.</div>
              <label className="mt-1 flex items-start gap-2 text-slate-700"><input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} className="mt-0.5" /><span>I understand — run anyway. The blockers are recorded on the change.</span></label>
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <button onClick={run} disabled={pending || (blocking.length > 0 && !override)} className="rounded-lg bg-emerald-600 px-3 py-1.5 font-medium text-white hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400">{pending ? "Assigning…" : "Confirm — auto-assign everything"}</button>
            <button onClick={() => setPreview(null)} disabled={pending} className="rounded-lg border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-50">Cancel</button>
          </div>
        </div>
      )}
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
                <strong>{n(result.plan.placedShifts)}</strong> of {n(result.plan.demandShifts)} clinical shifts placed ({pct(result.plan.placedShare)}) on {n(result.plan.sitesUsed)} sites · {n(result.plan.bookings)} asset bookings · {result.plan.agreements} · ready {n(result.plan.readySeats)} of {n(result.plan.demandSeats)} learner-shifts
                {result.plan.unmet.length > 0 && <ul className="mt-1 space-y-0.5 text-amber-800">{result.plan.unmet.map((u) => <li key={u.reason}>⚠ {n(u.shifts)} — {u.reason}{u.fixes.length ? <span className="text-slate-500"> · fix: {u.fixes.join("; ")}</span> : null}</li>)}</ul>}
                <Link href="/scheduler" className="mt-1 inline-block text-rose-700 hover:underline">open the clinical scheduler ↦</Link>
              </div>
            ) : <div className="mt-0.5 text-slate-500">No dated clinical shifts to place.</div>}
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
          <div className="md:col-span-2 xl:col-span-4 flex flex-wrap items-center gap-2">
            {result.changeSetId && <button onClick={() => undo(result.changeSetId!)} disabled={pending} className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50">Undo this auto-assign</button>}
            <span className="text-slate-500">Recorded as a change — everything it created is listed and can be put back.</span>
          </div>
          {result.notes.length > 0 && <ul className="md:col-span-2 xl:col-span-4 space-y-0.5 text-slate-600">{result.notes.map((x, i) => <li key={i}>· {x}</li>)}</ul>}
        </div>
      )}
    </div>
  );
}
