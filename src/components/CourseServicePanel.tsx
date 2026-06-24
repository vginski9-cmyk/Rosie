"use client";

import { useMemo, useState } from "react";
import { courseService, DEFAULT_SERVICE, type ServiceSession } from "@/lib/service";

export interface PanelSession extends ServiceSession {
  number: number;
  supportStaffNeeded?: number;
}

const num = (n: number, d = 0) => n.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: 0 });

const KINDS: { key: "CLASS" | "LAB" | "CLINICAL"; label: string; accent: string; bar: string }[] = [
  { key: "CLASS", label: "Class sessions", accent: "text-sky-700", bar: "bg-sky-500" },
  { key: "LAB", label: "Lab sessions", accent: "text-violet-700", bar: "bg-violet-500" },
  { key: "CLINICAL", label: "Clinical sessions", accent: "text-rose-700", bar: "bg-rose-500" },
];

export function CourseServicePanel({ sessions, defaultEnrollment }: { sessions: PanelSession[]; defaultEnrollment: number }) {
  const [enrollment, setEnrollment] = useState(Math.max(1, Math.round(defaultEnrollment) || 40));
  const result = useMemo(() => courseService(sessions, enrollment, DEFAULT_SERVICE), [sessions, enrollment]);
  const t = result.totals;

  return (
    <div className="space-y-8">
      {/* Enrollment driver */}
      <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-rose-50/60 to-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-6">
          <div>
            <div className="text-sm font-semibold text-slate-700">Cohort enrollment drives everything below</div>
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-slate-500">
              Sections = <span className="font-mono">ROUNDUP(enrollment ÷ max students per section)</span>. Space, faculty,
              and preceptor hours all scale from there — exactly the FTEs &amp; Clinicals formula chain.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <input type="range" min={1} max={150} value={enrollment} onChange={(e) => setEnrollment(Number(e.target.value))} className="h-2 w-56 accent-rose-600" />
            <div className="text-right">
              <input type="number" min={1} value={enrollment} onChange={(e) => setEnrollment(Math.max(1, Number(e.target.value)))} className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-right text-2xl font-semibold" />
              <div className="text-[11px] uppercase tracking-wide text-slate-400">students enrolled</div>
            </div>
          </div>
        </div>
      </div>

      {/* Service & FTE requirement cards */}
      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Service &amp; FTE requirements at {num(enrollment)} students</h3>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
          <BigStat label="Sections needed" value={num(t.sections)} sub={`${num(t.classSections)} class · ${num(t.labSections)} lab · ${num(t.clinicalSections)} clinical`} />
          <BigStat label="Space / service hours" value={num(t.spaceHours)} sub="sections × session length" />
          <BigStat label="Faculty contact hours" value={num(t.facultyContactHours, 1)} sub="per term, all sections" />
          <BigStat label="Faculty FTE" value={num(t.facultyFte, 2)} sub="contact hrs ÷ 288" accent />
          <BigStat label="Preceptor contact hours" value={num(t.preceptorContactHours, 1)} sub="per term, all sections" />
          <BigStat label="Preceptor FTE" value={num(t.preceptorFte, 2)} sub="contact hrs ÷ 640" accent />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-4 text-[11px] text-slate-400 md:grid-cols-3 xl:grid-cols-6">
          <span className="col-start-3">Faculty weekly: {num(t.facultyWeeklyHours, 1)} hrs</span>
          <span className="col-start-5">Preceptor weekly: {num(t.preceptorWeeklyFte, 1)} units</span>
        </div>
      </div>

      {/* Per-kind, per-session spacious tables */}
      {KINDS.map((kind) => {
        const rows = result.perSession.filter((p) => p.session.kind === kind.key);
        if (rows.length === 0) return null;
        const isClinical = kind.key === "CLINICAL";
        return (
          <section key={kind.key}>
            <div className="mb-3 flex items-center gap-2">
              <span className={`h-3 w-3 rounded ${kind.bar}`} />
              <h3 className={`text-base font-semibold ${kind.accent}`}>{kind.label}</h3>
              <span className="text-sm text-slate-400">· {rows.length} required of each student</span>
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-3 font-semibold">#</th>
                    <th className="px-4 py-3 font-semibold">Session</th>
                    <th className="px-4 py-3 text-center font-semibold">Week</th>
                    <th className="px-4 py-3 text-center font-semibold">Day</th>
                    <th className="px-4 py-3 text-right font-semibold">Length</th>
                    <th className="px-4 py-3 text-center font-semibold">Cap / sec</th>
                    <th className="px-4 py-3">Location</th>
                    {isClinical ? <th className="px-4 py-3">Rotation &amp; mode</th> : <th className="px-4 py-3">Staffing</th>}
                    <th className="border-l border-slate-200 bg-rose-50/40 px-4 py-3 text-right font-semibold text-rose-700">Sections</th>
                    <th className="bg-rose-50/40 px-4 py-3 text-right font-semibold text-rose-700">Space hrs</th>
                    <th className="bg-rose-50/40 px-4 py-3 text-right font-semibold text-rose-700">{isClinical ? "Preceptor hrs" : "Faculty hrs"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {rows.map((p) => {
                    const s = p.session as PanelSession;
                    return (
                      <tr key={s.id} className="align-top hover:bg-slate-50/50">
                        <td className="px-4 py-3.5 text-slate-400">{s.number}</td>
                        <td className="px-4 py-3.5 font-medium leading-snug text-slate-800">{s.title}</td>
                        <td className="px-4 py-3.5 text-center text-slate-600">{s.week ?? "—"}</td>
                        <td className="px-4 py-3.5 text-center text-slate-600">{s.dayOfWeek ?? "—"}</td>
                        <td className="px-4 py-3.5 text-right tabular-nums text-slate-600">{num(s.lengthHours, 1)} h</td>
                        <td className="px-4 py-3.5 text-center tabular-nums text-slate-600">{num(s.maxStudents)}</td>
                        <td className="px-4 py-3.5 leading-snug text-slate-500">{s.location ?? "—"}</td>
                        <td className="px-4 py-3.5 leading-snug text-slate-500">
                          {isClinical ? (
                            <span>{s.rotationType ?? "—"}{s.clinicalMode ? <span className="text-slate-400"> · {s.clinicalMode}</span> : null}{s.preceptorsNeeded ? <span className="text-slate-400"> · {num(s.preceptorsNeeded)} preceptor</span> : null}</span>
                          ) : (
                            <span>{num(s.facultyNeeded, 2)} faculty{s.supportStaffNeeded ? <span className="text-slate-400"> · {num(s.supportStaffNeeded)} support</span> : null}</span>
                          )}
                        </td>
                        <td className="border-l border-slate-200 bg-rose-50/30 px-4 py-3.5 text-right font-semibold tabular-nums text-rose-700">{num(p.sections)}</td>
                        <td className="bg-rose-50/30 px-4 py-3.5 text-right tabular-nums text-slate-700">{num(p.spaceHours, 1)}</td>
                        <td className="bg-rose-50/30 px-4 py-3.5 text-right tabular-nums text-slate-700">{num(isClinical ? p.preceptorContactHours : p.facultyContactHours, 1)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function BigStat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl border bg-white p-4 ${accent ? "border-rose-200 ring-1 ring-rose-100" : "border-slate-200"}`}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-3xl font-semibold tabular-nums ${accent ? "text-rose-700" : "text-slate-900"}`}>{value}</div>
      {sub && <div className="mt-1 text-[11px] leading-tight text-slate-400">{sub}</div>}
    </div>
  );
}
