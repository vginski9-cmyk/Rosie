"use client";

// WHO teaches and precepts — next to how many are needed. Every booked section
// with the instructor or preceptor on it, every person with their load, the
// sections still unstaffed with a pick-list to fill them, and a quick add for
// someone not yet in the directory.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { moveMeeting, createPerson } from "@/lib/actions";
import type { RosterMeeting, RosterPerson } from "@/lib/roster";

const KIND_LABEL: Record<string, string> = { CLASS: "Class", LAB: "Lab", CLINICAL: "Clinical" };
const KIND_BADGE: Record<string, string> = { CLASS: "bg-sky-100 text-sky-700", LAB: "bg-violet-100 text-violet-700", CLINICAL: "bg-rose-100 text-rose-700" };
const fmtT = (t: string) => { const [h, m] = t.split(":").map(Number); const ap = h >= 12 ? "p" : "a"; const hh = h % 12 || 12; return m ? `${hh}:${String(m).padStart(2, "0")}${ap}` : `${hh}${ap}`; };
const n1 = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 1 });

export function StaffRoster({ institutionId, people, meetings, showCohort = false }: {
  institutionId: string; people: RosterPerson[]; meetings: RosterMeeting[]; showCohort?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState<"instructor" | "preceptor" | null>(null);

  const instructors = people.filter((p) => p.role !== "preceptor");
  const preceptors = people.filter((p) => p.role === "preceptor");
  const facSections = meetings.filter((m) => m.kind !== "CLINICAL");
  const preSections = meetings.filter((m) => m.kind === "CLINICAL");
  const unstaffedFac = facSections.filter((m) => !m.staffPersonId);
  const unstaffedPre = preSections.filter((m) => !m.staffPersonId);

  const byPerson = useMemo(() => {
    const m = new Map<string, RosterMeeting[]>();
    for (const x of meetings) if (x.staffPersonId) { const l = m.get(x.staffPersonId) ?? []; l.push(x); m.set(x.staffPersonId, l); }
    return m;
  }, [meetings]);

  const assign = (meetingId: string, personId: string | null) => startTransition(async () => { await moveMeeting(meetingId, { staffPersonId: personId }); router.refresh(); });

  const Chip = ({ m }: { m: RosterMeeting }) => (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700" title={`${m.program} · ${m.cohort}${m.loc ? ` · ${m.loc}` : ""}`}>
      <span className={`rounded-full px-1.5 text-[9px] font-semibold ${KIND_BADGE[m.kind]}`}>{KIND_LABEL[m.kind]}{m.sectionCount > 1 ? ` §${m.sectionIndex}` : ""}</span>
      <span className="font-medium">{m.courseCode ?? m.courseTitle}</span>
      <span className="tabular-nums text-slate-500">{m.dayOfWeek} {fmtT(m.startTime)} · {m.lengthHours}h</span>
      {showCohort && <span className="text-slate-400">· {m.cohort}</span>}
    </span>
  );

  const Column = ({ title, role, pool, sections, unstaffed }: { title: string; role: "instructor" | "preceptor"; pool: RosterPerson[]; sections: RosterMeeting[]; unstaffed: RosterMeeting[] }) => (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        <span className="text-xs text-slate-500">{sections.length} booked section{sections.length === 1 ? "" : "s"} · <strong className={unstaffed.length ? "text-amber-700" : "text-emerald-700"}>{unstaffed.length} unstaffed</strong> · {pool.length} on the roster</span>
      </div>

      {/* Who — and what each carries */}
      <ul className="mt-3 divide-y divide-slate-100">
        {pool.map((p) => {
          const mine = (byPerson.get(p.id) ?? []).filter((m) => (role === "preceptor") === (m.kind === "CLINICAL"));
          const weekly = mine.reduce((n, m) => n + m.lengthHours, 0);
          return (
            <li key={p.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2">
              <span className="w-44 shrink-0">
                <span className="block text-sm font-medium text-slate-800">{p.name}</span>
                <span className="block text-[11px] text-slate-500">{p.role}{mine.length ? ` · ${mine.length} section${mine.length === 1 ? "" : "s"} · ${n1(weekly)} h/wk` : " · nothing assigned"}</span>
              </span>
              <span className="flex min-w-0 flex-1 flex-wrap gap-1">
                {mine.map((m) => (
                  <span key={m.id} className="inline-flex items-center gap-0.5">
                    <Chip m={m} />
                    <button onClick={() => assign(m.id, null)} className="rounded px-1 text-[11px] text-slate-300 hover:bg-rose-100 hover:text-rose-700" title="unassign">×</button>
                  </span>
                ))}
              </span>
            </li>
          );
        })}
        {pool.length === 0 && <li className="py-2 text-xs text-slate-400">Nobody on the roster yet — add {role === "preceptor" ? "a preceptor" : "an instructor"} below or in the People directory.</li>}
      </ul>

      {/* Add someone */}
      {adding === role ? (
        <form action={async (fd) => { await createPerson(fd); setAdding(null); router.refresh(); }} className="mt-2 flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-2 text-xs">
          <input type="hidden" name="institutionId" value={institutionId} />
          <input type="hidden" name="role" value={role} />
          <input type="hidden" name="active" value="on" />
          <label className="block"><span className="block text-[10px] uppercase tracking-wide text-slate-400">Name</span><input name="name" required autoFocus className="rounded border border-slate-300 px-2 py-1" /></label>
          <label className="block"><span className="block text-[10px] uppercase tracking-wide text-slate-400">Title</span><input name="title" placeholder={role === "preceptor" ? "RN, Med-Surg" : "Instructor"} className="rounded border border-slate-300 px-2 py-1" /></label>
          <label className="block"><span className="block text-[10px] uppercase tracking-wide text-slate-400">Employment</span>
            <select name="employmentType" className="rounded border border-slate-300 px-2 py-1"><option value="full-time">full-time</option><option value="part-time">part-time</option><option value="adjunct">adjunct</option><option value="contract">contract</option><option value="preceptor">preceptor (site staff)</option></select>
          </label>
          <label className="block"><span className="block text-[10px] uppercase tracking-wide text-slate-400">Email</span><input name="email" type="email" className="rounded border border-slate-300 px-2 py-1" /></label>
          <button className="rounded bg-rose-600 px-2.5 py-1 font-medium text-white">Add {role}</button>
          <button type="button" onClick={() => setAdding(null)} className="text-slate-500">cancel</button>
        </form>
      ) : (
        <button onClick={() => setAdding(role)} className="mt-2 text-xs font-medium text-rose-700 hover:underline">+ Add {role === "preceptor" ? "a preceptor" : "an instructor"}</button>
      )}

      {/* Unstaffed — fill each one */}
      {unstaffed.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/50 p-3">
          <div className="text-xs font-semibold text-amber-800">Needs {role === "preceptor" ? "a preceptor" : "an instructor"} — {unstaffed.length} section{unstaffed.length === 1 ? "" : "s"}</div>
          <ul className="mt-1.5 space-y-1">
            {unstaffed.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-2">
                <Chip m={m} />
                {m.loc && <span className="text-[11px] text-slate-500">{m.loc}</span>}
                <select defaultValue="" onChange={(e) => { if (e.target.value) assign(m.id, e.target.value); }} disabled={pending} className="rounded border border-amber-300 bg-white px-1.5 py-0.5 text-[11px]">
                  <option value="">assign…</option>
                  {pool.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-700">
        <strong>{facSections.length}</strong> class / lab section{facSections.length === 1 ? "" : "s"} need an instructor
        {unstaffedFac.length ? <> — <strong className="text-amber-700">{unstaffedFac.length} still unstaffed</strong></> : <> — <span className="text-emerald-700">all staffed</span></>}.{" "}
        <strong>{preSections.length}</strong> clinical section{preSections.length === 1 ? "" : "s"} need a preceptor
        {unstaffedPre.length ? <> — <strong className="text-amber-700">{unstaffedPre.length} still unstaffed</strong></> : preSections.length ? <> — <span className="text-emerald-700">all staffed</span></> : null}.
        {meetings.length === 0 && " Calendarize the offering to create its sections first."}
      </p>
      <div className="grid gap-3 lg:grid-cols-2">
        <Column title="Instructors" role="instructor" pool={instructors} sections={facSections} unstaffed={unstaffedFac} />
        <Column title="Preceptors" role="preceptor" pool={preceptors} sections={preSections} unstaffed={unstaffedPre} />
      </div>
    </div>
  );
}
