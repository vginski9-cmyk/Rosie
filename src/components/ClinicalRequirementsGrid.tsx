"use client";

// The DEMAND side of clinicals, inside program design: how this job's
// clinicals are administered, the settings (service areas) its clinicals
// happen in, and — course by course — how many hours (and cases) each
// student must log in each setting. From these inputs the program's
// clinical demand follows: which settings, for which courses, how many
// hours per student, and how many hours per week while a course runs.
// Supply (sites, assets, shifts) is mapped separately on the family's
// clinical supply map; the two are not matched here.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { requirementTotals } from "@/lib/clinicalmodel";
import { updateFamilyClinicalModel, upsertServiceArea, deleteServiceArea, saveCourseRequirements } from "@/lib/actions";

const n0 = (v: number) => Math.round(v).toLocaleString();
const n1 = (v: number) => (Math.round(v * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 });
const MODEL: Record<string, string> = {
  hours: "Hours-based — each student logs set hours in set settings",
  competency: "Competency / case-based — cases and check-offs, hours follow",
  mixed: "Mixed — hour floors plus competencies",
};

export interface ReqArea { id: string; code: string; name: string; settingCodes: string[]; unitCategories: string[]; notes: string | null }
export interface ReqCourse {
  id: string; code: string | null; name: string; termName: string; termIndex: number; weeks: number; weeklyClinicalHours: number;
  requirements: { serviceAreaId: string; hoursPerStudent: number; casesPerStudent: number | null }[];
}

export function ClinicalRequirementsGrid({ programName, family, areas, courses, enrollment }: {
  programName: string;
  family: { id: string; name: string; clinicalModel: string; clinicalNotes: string | null };
  areas: ReqArea[];
  courses: ReqCourse[];
  enrollment: number;
}) {
  const router = useRouter();
  const refresh = () => router.refresh();
  const [showAll, setShowAll] = useState(false);
  const [addingArea, setAddingArea] = useState(false);

  const clinicalCourses = useMemo(() => {
    const isClinical = (c: ReqCourse) => c.weeklyClinicalHours > 0 || c.requirements.length > 0 || /clinic|practicum|extern|field/i.test(c.name);
    return showAll ? courses : courses.filter(isClinical);
  }, [courses, showAll]);

  const totals = useMemo(
    () => requirementTotals(
      clinicalCourses.flatMap((c) => c.requirements.map((r) => ({ courseId: c.id, serviceAreaId: r.serviceAreaId, hoursPerStudent: r.hoursPerStudent }))),
      clinicalCourses.map((c) => ({ id: c.id, weeks: c.weeks })),
    ),
    [clinicalCourses],
  );
  const byArea = useMemo(() => areas.map((a) => ({
    area: a,
    hours: clinicalCourses.reduce((n, c) => n + (c.requirements.find((r) => r.serviceAreaId === a.id)?.hoursPerStudent ?? 0), 0),
    cases: clinicalCourses.reduce((n, c) => n + (c.requirements.find((r) => r.serviceAreaId === a.id)?.casesPerStudent ?? 0), 0),
    courses: clinicalCourses.filter((c) => (c.requirements.find((r) => r.serviceAreaId === a.id)?.hoursPerStudent ?? 0) > 0).length,
  })), [areas, clinicalCourses]);
  const used = byArea.filter((b) => b.hours > 0 || b.cases > 0);
  const showCases = family.clinicalModel !== "hours";

  return (
    <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" id="clinical-requirements">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Clinical requirements — what each course needs, by setting</h2>
          <p className="max-w-3xl text-sm text-slate-500">
            The demand side of clinicals for <strong>{programName}</strong>. Set how {family.name} administers clinicals, name the settings its clinicals happen in, and enter the hours (and cases) each student must log per course in each setting. The supply side — sites, assets and shifts — is mapped on the <Link href={`/families/${family.id}/clinical`} className="text-rose-700 hover:underline">clinical supply map</Link>.
          </p>
        </div>
      </div>

      {/* Statement: what this program demands, in plain terms */}
      <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-4 text-sm text-sky-950">
        {used.length === 0 ? (
          <p>No clinical hours entered yet. Add a setting below, then fill in hours per student for each clinical course.</p>
        ) : (
          <>
            <p>
              Each student in <strong>{programName}</strong> logs <strong>{n0(totals.perStudent)} clinical hours</strong> across {clinicalCourses.filter((c) => c.requirements.some((r) => r.hoursPerStudent > 0)).length} course{clinicalCourses.filter((c) => c.requirements.some((r) => r.hoursPerStudent > 0)).length === 1 ? "" : "s"} in {used.length} setting{used.length === 1 ? "" : "s"}, about <strong>{n1(totals.weeklyPerStudent)} h/week</strong> while in clinicals. At {enrollment} students per cohort that is <strong>{n0(totals.perStudent * enrollment)} student-hours</strong> per cohort.
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {used.map((b) => (
                <div key={b.area.id} className="rounded-lg border border-sky-200 bg-white px-3 py-2 text-xs">
                  <div className="font-semibold text-slate-800"><span className="font-mono text-slate-400">{b.area.code}</span> {b.area.name}</div>
                  <div className="text-slate-600"><strong>{n0(b.hours)} h</strong> per student{showCases && b.cases > 0 ? ` · ${n0(b.cases)} cases` : ""} · {b.courses} course{b.courses === 1 ? "" : "s"} · {n0(b.hours * enrollment)} student-hours / cohort</div>
                  {b.area.settingCodes.length > 0 && <div className="mt-0.5 text-[11px] text-slate-500">Served by asset settings: {b.area.settingCodes.join(", ")}</div>}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* How clinicals are administered */}
      <form action={async (fd) => { await updateFamilyClinicalModel(family.id, fd); refresh(); }} className="grid gap-2 rounded-xl border border-slate-200 p-3 sm:grid-cols-[minmax(14rem,20rem)_1fr_auto]">
        <label className="block text-xs"><span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">How {family.name} administers clinicals</span><select name="clinicalModel" defaultValue={family.clinicalModel} className="w-full rounded border border-slate-300 px-2 py-1">{Object.entries(MODEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="block text-xs"><span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">The rule, in this job&apos;s own terms</span><input name="clinicalNotes" defaultValue={family.clinicalNotes ?? ""} placeholder="e.g. 1,200 supervised hours across general, fluoro, portable and ED before the registry exam" className="w-full rounded border border-slate-300 px-2 py-1" /></label>
        <button className="self-end rounded bg-slate-800 px-3 py-1.5 text-xs font-medium text-white">Save</button>
      </form>

      {/* Settings the clinicals happen in */}
      <div>
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-sm font-semibold text-slate-800">Settings these clinicals happen in <span className="text-xs font-normal text-slate-500">· shared by every {family.name} program · each becomes a column in the grid</span></div>
          <button type="button" onClick={() => setAddingArea((v) => !v)} className="rounded border border-rose-300 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-100">{addingArea ? "Cancel" : "+ Add a setting"}</button>
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-2 py-2 font-semibold">Code</th><th className="px-2 py-2 font-semibold">Setting</th><th className="px-2 py-2 font-semibold">Which asset settings serve it</th><th className="px-2 py-2 font-semibold">Unit categories</th><th className="px-2 py-2 font-semibold">Notes</th><th className="px-2 py-2" /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {areas.length === 0 && !addingArea && <tr><td colSpan={6} className="px-3 py-3 text-slate-500">No settings yet. Add one — e.g. GEN General radiography, FLU Fluoroscopy, ED Emergency, OR Surgery — and it becomes a column below.</td></tr>}
              {[...areas, ...(addingArea ? [null] : [])].map((a) => { const fid = a ? `area-${a.id}` : "area-new"; return (
                <tr key={a?.id ?? "new"} className={a ? "" : "bg-rose-50/30"}>
                  <td className="px-2 py-1.5"><input form={fid} name="code" defaultValue={a?.code ?? ""} placeholder="GEN" readOnly={!!a} autoFocus={!a} className="w-20 rounded border border-slate-300 px-1.5 py-1 font-mono uppercase" /></td>
                  <td className="px-2 py-1.5"><input form={fid} name="name" defaultValue={a?.name ?? ""} placeholder="General fixed-room radiography" className="w-64 rounded border border-slate-300 px-1.5 py-1" /></td>
                  <td className="px-2 py-1.5"><input form={fid} name="settingCodes" defaultValue={a?.settingCodes.join(", ") ?? ""} placeholder="GEN (comma-separated codes from the supply map)" className="w-56 rounded border border-slate-300 px-1.5 py-1 font-mono" /></td>
                  <td className="px-2 py-1.5"><input form={fid} name="unitCategories" defaultValue={a?.unitCategories.join(", ") ?? ""} placeholder="Imaging" className="w-36 rounded border border-slate-300 px-1.5 py-1" /></td>
                  <td className="px-2 py-1.5"><input form={fid} name="notes" defaultValue={a?.notes ?? ""} className="w-44 rounded border border-slate-300 px-1.5 py-1" /></td>
                  <td className="whitespace-nowrap px-2 py-1.5">
                    <form id={fid} action={async (fd) => { await upsertServiceArea(family.id, fd); setAddingArea(false); refresh(); }}><button className={`rounded px-2 py-1 font-medium text-white ${a ? "bg-slate-800" : "bg-rose-600"}`}>{a ? "Save" : "Add setting"}</button></form>
                    {a && <button type="button" title="Remove this setting" onClick={() => { if (confirm(`Remove setting ${a.code}? The hours entered for it go with it.`)) deleteServiceArea(a.id, family.id).then(refresh); }} className="ml-1 text-slate-300 hover:text-rose-700">✕</button>}
                  </td>
                </tr>
              ); })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Course × setting grid */}
      <div>
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-sm font-semibold text-slate-800">Hours per student, by course × setting <span className="text-xs font-normal text-slate-500">· {showCases ? "hours, and cases where they are the rule" : "hours"} · blue cells are inputs</span></div>
          <label className="flex items-center gap-1 text-xs text-slate-600"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> show every course, not just clinical ones</label>
        </div>
        {areas.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 p-3 text-xs text-slate-500">Add at least one setting above to start entering hours.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-2 py-2 font-semibold">Course</th><th className="px-2 py-2 font-semibold">Term · weeks</th>{areas.map((a) => <th key={a.id} className="px-2 py-2 text-right font-semibold" title={a.name}>{a.code}<div className="text-[9px] font-normal normal-case tracking-normal text-slate-400">{a.name}</div></th>)}<th className="px-2 py-2 text-right font-semibold">Total / student</th><th className="px-2 py-2 text-right font-semibold">h / wk / student</th><th className="px-2 py-2" /></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {clinicalCourses.length === 0 && <tr><td colSpan={areas.length + 5} className="px-3 py-3 text-slate-500">No clinical courses found in this template. Tick &ldquo;show every course&rdquo; to enter hours on any course.</td></tr>}
                {clinicalCourses.map((c) => { const fid = `req-${c.id}`; const tot = c.requirements.reduce((n, r) => n + r.hoursPerStudent, 0); return (
                  <tr key={c.id}>
                    <td className="whitespace-nowrap px-2 py-1.5"><span className="font-mono text-slate-700">{c.code ?? ""}</span> <span className="text-slate-600">{c.name}</span></td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-slate-500">{c.termName} · {c.weeks} wk</td>
                    {areas.map((a) => { const r = c.requirements.find((x) => x.serviceAreaId === a.id); return (
                      <td key={a.id} className="px-1 py-1.5 text-right">
                        <input form={fid} name={`req_${a.id}`} type="number" min={0} step="any" defaultValue={r?.hoursPerStudent || ""} placeholder="h" aria-label={`${c.name} hours in ${a.name}`} className={`w-16 rounded border px-1 py-0.5 text-right ${r?.hoursPerStudent ? "border-blue-200 bg-blue-50/70 text-blue-900" : "border-slate-200 text-slate-400"}`} />
                        {showCases && <input form={fid} name={`cases_${a.id}`} type="number" min={0} step="any" defaultValue={r?.casesPerStudent ?? ""} placeholder="cases" aria-label={`${c.name} cases in ${a.name}`} className="mt-0.5 w-16 rounded border border-violet-200 bg-violet-50/60 px-1 py-0.5 text-right text-violet-900" />}
                      </td>
                    ); })}
                    <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{n0(tot)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{n1(tot / Math.max(1, c.weeks))}</td>
                    <td className="px-2 py-1.5"><form id={fid} action={async (fd) => { await saveCourseRequirements(c.id, family.id, fd); refresh(); }}><button className="rounded bg-slate-800 px-2 py-1 text-[11px] font-medium text-white">Save</button></form></td>
                  </tr>
                ); })}
                <tr className="bg-slate-50 font-semibold"><td className="px-2 py-1.5" colSpan={2}>Program total per student</td>{byArea.map((b) => <td key={b.area.id} className="px-2 py-1.5 text-right tabular-nums">{n0(b.hours)}</td>)}<td className="px-2 py-1.5 text-right tabular-nums">{n0(totals.perStudent)}</td><td className="px-2 py-1.5 text-right tabular-nums">{n1(totals.weeklyPerStudent)}</td><td /></tr>
                <tr className="bg-slate-50 text-slate-600"><td className="px-2 py-1.5" colSpan={2}>× {enrollment} students = student-hours per cohort</td>{byArea.map((b) => <td key={b.area.id} className="px-2 py-1.5 text-right tabular-nums">{n0(b.hours * enrollment)}</td>)}<td className="px-2 py-1.5 text-right tabular-nums">{n0(totals.perStudent * enrollment)}</td><td /><td /></tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
