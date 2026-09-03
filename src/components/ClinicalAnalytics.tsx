"use client";

// Clinical analytics block for a design & sequence page — template or
// instantiation. Top line first (one sentence, then four tiles), then the
// breakdowns (settings · modes · shifts · days · delivery), then the specifics:
// a course × setting hours matrix and a per-course table. Everything is read
// from the session rows on the page, at the enrollment the page is using.

import { useMemo, useState } from "react";
import { clinicalProfile, courseProfiles, settingMatrix, clinicalStatement, sessionsOf, NOT_SET, type AnalyticsCourse, type Slice } from "@/lib/clinicalanalytics";

const n0 = (v: number) => Math.round(v).toLocaleString();
const n1 = (v: number) => (Math.round(v * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 });
const pct = (v: number) => `${Math.round(v * 100)}%`;
const fmtT = (t: string) => { const [h, m] = t.split(":").map(Number); const ap = h >= 12 ? "p" : "a"; const hh = h % 12 || 12; return m ? `${hh}:${String(m).padStart(2, "0")}${ap}` : `${hh}${ap}`; };

export interface AnalyticsSite { courseId: string; siteName: string; sections: number }

export function ClinicalAnalytics({ subject, courses, enrollment, sites = [], accent = "rose" }: {
  /** "Radiography (template)" or the offering's name — used in the statement. */
  subject: string;
  courses: AnalyticsCourse[];
  enrollment: number;
  /** Instantiation only: which partner sites host each course's clinical sections. */
  sites?: AnalyticsSite[];
  accent?: "rose" | "sky";
}) {
  const [showAll, setShowAll] = useState(false);
  const all = useMemo(() => clinicalProfile(sessionsOf(courses), enrollment), [courses, enrollment]);
  const perCourse = useMemo(() => courseProfiles(courses, enrollment), [courses, enrollment]);
  const matrix = useMemo(() => settingMatrix(courses), [courses]);
  const clinicalCourses = perCourse.filter((c) => showAll || c.clinicalSessions > 0);
  const sitesFor = (courseId: string) => sites.filter((s) => s.courseId === courseId);
  const ring = accent === "rose" ? "border-rose-200 ring-rose-100" : "border-sky-200 ring-sky-100";
  const head = accent === "rose" ? "text-rose-600" : "text-sky-700";

  return (
    <section className={`rounded-xl border bg-white p-4 ring-1 ${ring}`} id="clinical-analytics">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className={`text-sm font-semibold uppercase tracking-wide ${head}`}>Clinical analytics — settings, modes, shifts, days</h3>
        <span className="text-[11px] text-slate-400">read live from the session rows below · at {n0(enrollment)} students</span>
      </div>

      {/* Top line */}
      <p className="mt-2 max-w-4xl text-sm leading-relaxed text-slate-800">{clinicalStatement(all, subject)}</p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="Clinical hours / student" v={`${n0(all.clinicalHours)}h`} sub={`${pct(all.clinicalShare)} of ${n0(all.totalHours)}h`} strong />
        <Tile label="Clinical sessions" v={n0(all.clinicalSessions)} sub={`${all.weeksWithClinical} clinical weeks · peak ${n1(all.peakWeekHours)}h${all.peakWeek ? ` (${all.peakWeek})` : ""}`} />
        <Tile label="Settings" v={n0(all.settings.filter((s) => s.key !== NOT_SET).length)} sub={all.settings.filter((s) => s.key !== NOT_SET).slice(0, 3).map((s) => s.key).join(" · ") || "none set"} />
        <Tile label="Shift length" v={`${n1(all.avgShiftHours)}h avg`} sub={all.clinicalSessions ? `${n1(all.shortestShiftHours)}–${n1(all.longestShiftHours)}h · ${all.shifts.filter((s) => s.key !== NOT_SET).map((s) => `${s.key} ${pct(s.share)}`).join(" · ") || "no start times"}` : "—"} />
        <Tile label={`Student-hours @ ${n0(enrollment)}`} v={n0(all.studentHoursAtEnrollment)} sub={`${n0(all.sectionsAtEnrollment)} clinical sections`} />
        <Tile label={`Preceptor-shifts @ ${n0(enrollment)}`} v={n0(all.preceptorShiftsAtEnrollment)} sub={`${n1(all.facultyShiftsAtEnrollment)} faculty-shifts`} />
      </div>

      {/* Breakdowns */}
      {all.clinicalSessions > 0 && (
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <Breakdown title="By setting" note="rotation type on each clinical row" slices={all.settings} color="bg-rose-400" />
          <Breakdown title="By clinical mode" note="instructor-led · preceptor-led · …" slices={all.modes} color="bg-violet-400" />
          <Breakdown title="By shift" note="from start time: day 07–15 · evening 15–23 · night" slices={all.shifts} color="bg-amber-400" showStarts />
          <Breakdown title="By day of week" note="which weekdays clinicals land on" slices={all.days} color="bg-emerald-400" />
          <Breakdown title="Delivery mode (all sessions)" note="class, lab and clinical hours by delivery mode" slices={all.delivery} color="bg-sky-400" />
        </div>
      )}

      {/* Which settings, for which courses, how many hours */}
      {matrix.rows.length > 0 && (
        <div className="mt-4">
          <div className="mb-1 text-xs font-semibold text-slate-700">Hours per student by course × setting <span className="font-normal text-slate-400">· which settings each course needs and for how long</span></div>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-[11px]">
              <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-2 py-1.5 font-semibold">Course</th><th className="px-2 py-1.5 font-semibold">Term</th>{matrix.settings.map((k) => <th key={k} className="px-2 py-1.5 text-right font-semibold">{k}</th>)}<th className="px-2 py-1.5 text-right font-semibold">Total</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {matrix.rows.map((r) => (
                  <tr key={r.courseId}>
                    <td className="whitespace-nowrap px-2 py-1"><span className="font-mono text-slate-700">{r.code ?? ""}</span> <span className="text-slate-600">{r.name}</span></td>
                    <td className="whitespace-nowrap px-2 py-1 text-slate-500">{r.termName}</td>
                    {matrix.settings.map((k) => { const h = r.hours[k] ?? 0; return <td key={k} className={`px-2 py-1 text-right tabular-nums ${h ? "bg-rose-50/60 font-medium text-rose-900" : "text-slate-300"}`}>{h ? n1(h) : "·"}</td>; })}
                    <td className="px-2 py-1 text-right font-semibold tabular-nums">{n1(r.total)}</td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-semibold"><td className="px-2 py-1" colSpan={2}>Program total per student</td>{matrix.settings.map((k) => <td key={k} className="px-2 py-1 text-right tabular-nums">{n1(matrix.totals[k] ?? 0)}</td>)}<td className="px-2 py-1 text-right tabular-nums">{n1(all.clinicalHours)}</td></tr>
                <tr className="bg-slate-50 text-slate-600"><td className="px-2 py-1" colSpan={2}>× {n0(enrollment)} students = student-hours per cohort</td>{matrix.settings.map((k) => <td key={k} className="px-2 py-1 text-right tabular-nums">{n0((matrix.totals[k] ?? 0) * enrollment)}</td>)}<td className="px-2 py-1 text-right tabular-nums">{n0(all.clinicalHours * enrollment)}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Per course */}
      <div className="mt-4">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-xs font-semibold text-slate-700">Course by course <span className="font-normal text-slate-400">· clinical hours, settings, modes, shifts, days{sites.length ? ", booked sites" : ""}</span></div>
          <label className="flex items-center gap-1 text-[11px] text-slate-500"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> include courses with no clinicals</label>
        </div>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-[11px]">
            <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
              <tr><th className="px-2 py-1.5 font-semibold">Course</th><th className="px-2 py-1.5 font-semibold">Term</th><th className="px-2 py-1.5 text-right font-semibold">Clinical h / student</th><th className="px-2 py-1.5 text-right font-semibold">h / wk</th><th className="px-2 py-1.5 text-right font-semibold">Sessions</th><th className="px-2 py-1.5 font-semibold">Settings</th><th className="px-2 py-1.5 font-semibold">Modes</th><th className="px-2 py-1.5 font-semibold">Shifts</th><th className="px-2 py-1.5 font-semibold">Days</th><th className="px-2 py-1.5 text-right font-semibold">Sections @ {n0(enrollment)}</th><th className="px-2 py-1.5 text-right font-semibold">Preceptor-shifts</th>{sites.length > 0 && <th className="px-2 py-1.5 font-semibold">Booked sites</th>}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {clinicalCourses.length === 0 && <tr><td colSpan={12} className="px-3 py-3 text-slate-500">No clinical sessions in this design yet. Add CLINICAL rows to a course and set each one&apos;s setting, mode, day and start time.</td></tr>}
              {clinicalCourses.map((c) => (
                <tr key={c.courseId} className={c.clinicalSessions === 0 ? "text-slate-400" : ""}>
                  <td className="whitespace-nowrap px-2 py-1.5"><span className="font-mono text-slate-700">{c.code ?? ""}</span> <span className="text-slate-600">{c.name}</span></td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-slate-500">{c.termName} · {c.weeks} wk</td>
                  <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{n1(c.clinicalHours)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{n1(c.hoursPerWeek)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{n0(c.clinicalSessions)}{c.unscheduled ? <span title={`${c.unscheduled} without a start time`} className="ml-1 text-amber-600">⚠{c.unscheduled}</span> : null}</td>
                  <td className="px-2 py-1.5"><Chips slices={c.settings} tone="rose" /></td>
                  <td className="px-2 py-1.5"><Chips slices={c.modes} tone="violet" /></td>
                  <td className="px-2 py-1.5"><Chips slices={c.shifts} tone="amber" showStarts /></td>
                  <td className="px-2 py-1.5"><Chips slices={c.days} tone="emerald" compact /></td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{n0(c.sectionsAtEnrollment)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{n0(c.preceptorShiftsAtEnrollment)}</td>
                  {sites.length > 0 && <td className="px-2 py-1.5 text-slate-600">{sitesFor(c.courseId).length ? sitesFor(c.courseId).map((s) => `${s.siteName} (${s.sections})`).join(" · ") : <span className="text-slate-300">not booked</span>}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function Tile({ label, v, sub, strong }: { label: string; v: string; sub?: string; strong?: boolean }) {
  return (
    <div className={`rounded-lg p-2.5 ${strong ? "bg-slate-800 text-white" : "bg-slate-50"}`}>
      <div className={`text-[10px] uppercase tracking-wide ${strong ? "text-slate-300" : "text-slate-400"}`}>{label}</div>
      <div className="text-xl font-bold tabular-nums leading-tight">{v}</div>
      {sub && <div className={`truncate text-[10px] ${strong ? "text-slate-300" : "text-slate-500"}`} title={sub}>{sub}</div>}
    </div>
  );
}

function Breakdown({ title, note, slices, color, showStarts }: { title: string; note: string; slices: Slice[]; color: string; showStarts?: boolean }) {
  const max = Math.max(1, ...slices.map((s) => s.hours));
  return (
    <div className="rounded-lg border border-slate-200 p-2.5">
      <div className="text-xs font-semibold text-slate-700">{title}</div>
      <div className="text-[10px] text-slate-400">{note}</div>
      <div className="mt-1.5 space-y-1">
        {slices.length === 0 && <div className="text-[11px] text-slate-400">—</div>}
        {slices.map((s) => (
          <div key={s.key} className="text-[11px]">
            <div className="flex items-baseline justify-between gap-2">
              <span className={`truncate ${s.key === NOT_SET ? "italic text-amber-700" : "text-slate-700"}`} title={s.key}>{s.key}{showStarts && s.starts.length > 0 && <span className="ml-1 text-slate-400">{s.starts.map(fmtT).join(", ")}</span>}</span>
              <span className="whitespace-nowrap tabular-nums text-slate-600"><strong>{n1(s.hours)}h</strong> · {pct(s.share)} · {s.sessions} sess</span>
            </div>
            <div className="h-1.5 w-full rounded bg-slate-100"><div className={`h-1.5 rounded ${s.key === NOT_SET ? "bg-amber-300" : color}`} style={{ width: `${Math.max(2, (s.hours / max) * 100)}%` }} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}

const TONE: Record<string, string> = { rose: "bg-rose-50 text-rose-800 border-rose-200", violet: "bg-violet-50 text-violet-800 border-violet-200", amber: "bg-amber-50 text-amber-800 border-amber-200", emerald: "bg-emerald-50 text-emerald-800 border-emerald-200" };
function Chips({ slices, tone, showStarts, compact }: { slices: Slice[]; tone: string; showStarts?: boolean; compact?: boolean }) {
  if (slices.length === 0) return <span className="text-slate-300">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {slices.map((s) => (
        <span key={s.key} className={`whitespace-nowrap rounded border px-1 py-px text-[10px] ${s.key === NOT_SET ? "border-amber-300 bg-amber-50 italic text-amber-800" : TONE[tone]}`} title={`${s.key}: ${n1(s.hours)}h over ${s.sessions} session(s)${s.starts.length ? ` · starts ${s.starts.map(fmtT).join(", ")}` : ""}`}>
          {s.key}{compact ? ` ${s.sessions}` : ` ${n1(s.hours)}h`}{showStarts && s.starts.length > 0 ? ` @${s.starts.map(fmtT).join("/")}` : ""}
        </span>
      ))}
    </div>
  );
}
