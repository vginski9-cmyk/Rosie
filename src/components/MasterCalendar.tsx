"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { moveMeeting } from "@/lib/actions";
import type { CalOccurrence, CalRosterDay } from "@/lib/queries";

/** A block on the week grid: a weekly pattern, or — for clinicals the plan or a move has dated — the shift as it actually happens. */
type CalBlock = CalMeeting & { occ?: CalOccurrence };

export interface CalMeeting {
  id: string;
  cohortId: string; cohortName: string;
  programId: string; programName: string; family: string | null;
  courseId: string; courseCode: string | null; courseName: string;
  kind: string; sectionIndex: number; sectionCount: number; seats: number;
  dayOfWeek: string; startTime: string; endTime: string; lengthHours: number;
  facilityId: string | null; facilityName: string | null; facilityKind: string | null;
  employerId: string | null; employerName: string | null;
  staffPersonId: string | null; staffName: string | null;
  termIndex: number; weekStartMs: number; weekEndMs: number; startLabel: string; endLabel: string;
  sessionTitles: { week: number | null; title: string | null }[];
}
export interface CalEmployer { id: string; name: string; setting: string | null }
export interface CalRoom { facilityId: string; name: string; kind: string; capacity: number | null; building: string | null; utilization: number; bookedHoursPeakWeek: number; openHoursPerWeek: number; meetingCount: number; distinctDays: number }
export interface CalConflict { kind: string; aId: string; bId: string; dayOfWeek: string; key: string; detail: string }
export interface RoomOpt { id: string; name: string; kind: string; capacity: number | null }
export interface CalPerson { id: string; name: string; role: string }

const ALL_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const KIND_COLOR: Record<string, string> = { CLASS: "#0284c7", LAB: "#7c3aed", CLINICAL: "#e11d48" };
/** A stable, distinct color per location: golden-angle hues over the sorted list of locations. */
const locationColor = (index: number) => `hsl(${Math.round((index * 137.508) % 360)} 62% 42%)`;
type ColorBy = "program" | "kind" | "location";
const DAY_FULL: Record<string, string> = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };
const START_HOUR = 8, END_HOUR = 20, HOUR_PX = 44;
const PALETTE = ["bg-rose-500", "bg-sky-500", "bg-emerald-500", "bg-violet-500", "bg-amber-500", "bg-teal-500", "bg-fuchsia-500", "bg-indigo-500", "bg-orange-500", "bg-cyan-500"];
const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return (h || 0) * 60 + (m || 0); };
const fmtTime = (t: string) => { const [h, m] = t.split(":").map(Number); const ap = h >= 12 ? "p" : "a"; const hh = h % 12 || 12; return m ? `${hh}:${String(m).padStart(2, "0")}${ap}` : `${hh}${ap}`; };
const KIND_LABEL: Record<string, string> = { CLASS: "Lecture", LAB: "Lab", CLINICAL: "Clinical" };

export function MasterCalendar({
  institutions, institutionId, rooms, people = [], employers = [], meetings, conflicts, weeks, currentWeekMs, programs, summary, occurrences = [], roster = [],
}: {
  institutions: { id: string; name: string }[]; institutionId: string;
  rooms: CalRoom[]; people?: CalPerson[]; employers?: CalEmployer[]; meetings: CalMeeting[]; conflicts: CalConflict[];
  weeks: { ms: number; label: string }[]; currentWeekMs: number | null;
  programs: { id: string; name: string }[]; summary: { roomed: number; unroomed: number; clinical: number; peakUtil: number };
  /** The displayed week's clinical shifts as they actually happen, and who is where each day. */
  occurrences?: CalOccurrence[]; roster?: CalRosterDay[];
}) {
  const router = useRouter();
  // The week is chosen on the server (it loads that week's real shifts), so moving weeks is a navigation.
  const weekMs = currentWeekMs ?? weeks[0]?.ms ?? 0;
  const [navPending, startNav] = useTransition();
  const goWeek = (ms: number) => startNav(() => router.push(`/calendar?inst=${institutionId}&week=${ms}`));
  const [fProgram, setFProgram] = useState("");
  const [fRoom, setFRoom] = useState("");
  const [fKind, setFKind] = useState("");
  const [conflictsOnly, setConflictsOnly] = useState(false);
  const [colorBy, setColorBy] = useState<ColorBy>("location");
  const [editing, setEditing] = useState<CalMeeting | null>(null);

  const programColor = useMemo(() => {
    const m = new Map<string, string>();
    programs.forEach((p, i) => m.set(p.id, PALETTE[i % PALETTE.length]));
    return m;
  }, [programs]);
  // One color per location (room or partner site) across the whole calendar,
  // so two blocks in the same place always match and different places never do.
  const locationKey = (m: CalMeeting) => (m.kind === "CLINICAL" ? (m.employerId ? `site:${m.employerId}` : "site:tbd") : (m.facilityId ? `room:${m.facilityId}` : "room:none"));
  const locationName = (m: CalMeeting) => (m.kind === "CLINICAL" ? (m.employerName ? `@ ${m.employerName}` : "@ site TBD") : (m.facilityName ?? "no room"));
  const locationColors = useMemo(() => {
    const names = new Map<string, string>();
    for (const m of meetings) names.set(locationKey(m), locationName(m));
    const keys = [...names.keys()].sort((a, b) => names.get(a)!.localeCompare(names.get(b)!));
    const colors = new Map<string, { color: string; name: string }>();
    keys.forEach((k, i) => colors.set(k, { color: k === "room:none" || k === "site:tbd" ? "#94a3b8" : locationColor(i), name: names.get(k)! }));
    return colors;
  }, [meetings]);
  const blockStyle = (m: CalMeeting): { className: string; style?: React.CSSProperties } => {
    if (colorBy === "program") return { className: programColor.get(m.programId) ?? "bg-slate-500" };
    if (colorBy === "kind") return { className: "", style: { backgroundColor: KIND_COLOR[m.kind] ?? "#64748b" } };
    return { className: "", style: { backgroundColor: locationColors.get(locationKey(m))?.color ?? "#64748b" } };
  };

  const conflictIds = useMemo(() => { const s = new Set<string>(); for (const c of conflicts) { s.add(c.aId); s.add(c.bId); } return s; }, [conflicts]);
  const weekIdx = weeks.findIndex((w) => w.ms === weekMs);

  // Meetings active in the selected week, after filters. Clinicals are off-campus
  // (shown in a separate strip, they don't compete for rooms).
  const inWeek = useMemo(() => meetings.filter((m) => m.weekStartMs && m.weekStartMs <= weekMs && weekMs < m.weekEndMs), [meetings, weekMs]);
  // Clinical shifts the week actually has stand in for their weekly-pattern blocks: on the day they
  // landed, at the site booked, with the preceptors and students on them. Patterns nothing is
  // known about yet stay as they are.
  const blocks: CalBlock[] = useMemo(() => {
    const replaced = new Set(occurrences.map((o) => o.meetingId).filter((id): id is string => !!id));
    const byId = new Map(meetings.map((m) => [m.id, m]));
    const WK = 7 * 24 * 3600 * 1000;
    const occBlocks: CalBlock[] = occurrences.map((o) => {
      const p = o.meetingId ? byId.get(o.meetingId) : undefined;
      const base: CalMeeting = p ?? {
        id: `occ:${o.key}`, cohortId: o.cohortId, cohortName: o.cohortName, programId: o.programId, programName: o.programName, family: null,
        courseId: o.courseId, courseCode: o.courseCode, courseName: o.courseName, kind: "CLINICAL", sectionIndex: o.sectionIndex, sectionCount: o.sectionCount, seats: o.students.length,
        dayOfWeek: o.dayOfWeek, startTime: o.startTime, endTime: o.endTime, lengthHours: o.lengthHours, facilityId: null, facilityName: null, facilityKind: null,
        employerId: o.employerId, employerName: o.employerName, staffPersonId: null, staffName: null, termIndex: 0, weekStartMs: weekMs, weekEndMs: weekMs + WK, startLabel: "", endLabel: "", sessionTitles: [],
      };
      return { ...base, id: `occ:${o.key}`, dayOfWeek: o.dayOfWeek, startTime: o.startTime, endTime: o.endTime, lengthHours: o.lengthHours, employerId: o.employerId, employerName: o.employerName, staffName: o.preceptors.length ? (o.preceptors.length > 1 ? `${o.preceptors[0]} +${o.preceptors.length - 1}` : o.preceptors[0]) : base.staffName, seats: o.students.length || base.seats, occ: o };
    });
    return [...inWeek.filter((m) => !replaced.has(m.id)), ...occBlocks];
  }, [inWeek, occurrences, meetings, weekMs]);
  const filtered = useMemo(() => blocks.filter((m) => {
    if (fProgram && m.programId !== fProgram) return false;
    if (fRoom && m.facilityId !== fRoom) return false;
    if (fKind && m.kind !== fKind) return false;
    if (conflictsOnly && !conflictIds.has(m.id)) return false;
    return true;
  }), [blocks, fProgram, fRoom, fKind, conflictsOnly, conflictIds]);

  const campus = filtered.filter((m) => m.kind !== "CLINICAL");
  const clinical = filtered.filter((m) => m.kind === "CLINICAL");
  // Every week shows all seven days — weekends included, booked or not.
  const DAYS = ALL_DAYS;
  // Legend for the current coloring, limited to what is on screen this week.
  const legend = useMemo(() => {
    if (colorBy === "kind") return [["Lecture", KIND_COLOR.CLASS], ["Lab", KIND_COLOR.LAB], ["Clinical", KIND_COLOR.CLINICAL]] as [string, string][];
    if (colorBy === "program") return [] as [string, string][];
    const keys = [...new Set(filtered.map(locationKey))];
    return keys.map((k) => [locationColors.get(k)?.name ?? k, locationColors.get(k)?.color ?? "#64748b"] as [string, string]).sort((a, b) => a[0].localeCompare(b[0]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorBy, filtered, locationColors]);

  // Per-day lane packing so overlapping blocks sit side by side. EVERYTHING is
  // on the one master calendar — campus classes/labs AND clinical rotations
  // (hosted at partner sites, or "site TBD" until one is assigned).
  // One block per SESSION slot: the sections of a course × kind that meet at the
  // same day and time travel together (a precepted clinical is one student per
  // section, so 18 students at 6 sites is one block, not eighteen). Click a
  // block with several sections to see and edit each one.
  const dayLayout = (day: string) => {
    const byKey = new Map<string, CalBlock[]>();
    for (const m of filtered.filter((x) => x.dayOfWeek === day)) { const k = `${m.courseId}|${m.kind}|${m.startTime}|${m.lengthHours}|${m.cohortId}|${m.occ ? "occ" : "pat"}`; const l = byKey.get(k) ?? []; l.push(m); byKey.set(k, l); }
    const items = [...byKey.values()].map((members) => ({ m: members.sort((a, b) => a.sectionIndex - b.sectionIndex)[0], members })).sort((a, b) => toMin(a.m.startTime) - toMin(b.m.startTime));
    const laneEnds: number[] = [];
    const placed = items.map(({ m, members }) => {
      const s = toMin(m.startTime), e = s + m.lengthHours * 60;
      let lane = laneEnds.findIndex((end) => end <= s);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(e); } else laneEnds[lane] = e;
      return { m, members, s, e, lane };
    });
    return { placed, lanes: Math.max(1, laneEnds.length) };
  };
  const [group, setGroup] = useState<CalBlock[] | null>(null);
  const groupWhere = (members: CalBlock[]) => {
    const m = members[0];
    if (m.kind === "CLINICAL") { const sites = new Set(members.filter((x) => x.employerId).map((x) => x.employerName)); const tbd = members.filter((x) => !x.employerId).length; return sites.size === 0 ? "@ site TBD" : sites.size === 1 ? `@ ${[...sites][0]}${tbd ? ` · ${tbd} TBD` : ""}` : `@ ${sites.size} sites${tbd ? ` · ${tbd} TBD` : ""}`; }
    const rooms = [...new Set(members.map((x) => x.facilityName).filter(Boolean))]; const none = members.filter((x) => !x.facilityId).length;
    return rooms.length === 0 ? "⚠ no room" : rooms.length === 1 ? `${rooms[0]}${none ? ` · ${none} unroomed` : ""}` : `${rooms.slice(0, 2).join(", ")}${rooms.length > 2 ? ` +${rooms.length - 2}` : ""}`;
  };
  const groupStudents = (members: CalBlock[]) => members.reduce((n, x) => n + x.seats, 0);
  const groupMoved = (members: CalBlock[]) => { const from = [...new Set(members.filter((x) => x.occ?.moved).map((x) => x.occ!.originalDay))]; return from.length ? `moved from ${from.join("/")}` : null; };
  const groupUnbooked = (members: CalBlock[]) => members.filter((x) => x.occ && !x.occ.booked && x.occ.source === "pattern").length;
  const dayDate = (day: string) => { const i = ALL_DAYS.indexOf(day); const d = new Date(weekMs + i * 24 * 3600 * 1000); return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }); };

  const gridHeight = (END_HOUR - START_HOUR) * HOUR_PX;
  const conflictsForWeek = conflicts.filter((c) => { const a = meetings.find((m) => m.id === c.aId); return a && a.weekStartMs <= weekMs && weekMs < a.weekEndMs; });

  const save = (patch: Parameters<typeof moveMeeting>[1]) => {
    if (!editing) return;
    const id = editing.id;
    setEditing(null);
    startMove(id, patch);
  };
  const [pending, startTransition] = useTransition();
  const startMove = (id: string, patch: Parameters<typeof moveMeeting>[1]) => {
    startTransition(async () => { await moveMeeting(id, patch); router.refresh(); });
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Institution</span>
          <select value={institutionId} onChange={(e) => router.push(`/calendar?inst=${e.target.value}`)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
            {institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Program</span>
          <select value={fProgram} onChange={(e) => setFProgram(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
            <option value="">All programs</option>
            {programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Room</span>
          <select value={fRoom} onChange={(e) => setFRoom(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
            <option value="">All rooms</option>
            {rooms.map((r) => <option key={r.facilityId} value={r.facilityId}>{r.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Type</span>
          <select value={fKind} onChange={(e) => setFKind(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
            <option value="">All</option>
            <option value="CLASS">Lecture</option><option value="LAB">Lab</option><option value="CLINICAL">Clinical</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 pb-1.5 text-xs text-slate-600">
          <input type="checkbox" checked={conflictsOnly} onChange={(e) => setConflictsOnly(e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300" />
          Conflicts only
        </label>
        {(fProgram || fRoom || fKind || conflictsOnly) && <button onClick={() => { setFProgram(""); setFRoom(""); setFKind(""); setConflictsOnly(false); }} className="pb-1.5 text-xs text-slate-400 hover:text-rose-600">clear</button>}
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Color by</span>
          <div className="inline-flex overflow-hidden rounded-lg border border-slate-300 text-xs">
            {([["location", "Location"], ["kind", "Type"], ["program", "Program"]] as [ColorBy, string][]).map(([k, l]) => <button key={k} onClick={() => setColorBy(k)} className={`px-2.5 py-1.5 ${colorBy === k ? "bg-rose-600 font-medium text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`} title={k === "location" ? "same color = same room or site" : k === "kind" ? "lecture / lab / clinical" : "one color per program"}>{l}</button>)}
          </div>
        </label>
        <div className="ml-auto flex items-center gap-2">
          <button disabled={weekIdx <= 0 || navPending} onClick={() => goWeek(weeks[weekIdx - 1].ms)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm disabled:opacity-30">←</button>
          <select value={weekMs} disabled={navPending} onChange={(e) => goWeek(Number(e.target.value))} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
            {weeks.map((w) => <option key={w.ms} value={w.ms}>Week of {w.label}</option>)}
          </select>
          <button disabled={weekIdx >= weeks.length - 1 || navPending} onClick={() => goWeek(weeks[weekIdx + 1].ms)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm disabled:opacity-30">→</button>
          {navPending && <span className="text-xs text-slate-400">loading…</span>}
        </div>
      </div>

      {/* Summary */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span className="rounded-full bg-slate-100 px-2 py-0.5">{new Set(campus.map((m) => `${m.courseId}|${m.kind}|${m.dayOfWeek}|${m.startTime}|${m.cohortId}`)).size} campus sessions this week ({campus.length} sections)</span>
        <span className="rounded-full bg-orange-100 px-2 py-0.5 text-orange-700">{new Set(clinical.map((m) => `${m.courseId}|${m.dayOfWeek}|${m.startTime}|${m.cohortId}`)).size} clinical sessions · {clinical.reduce((n, m) => n + m.seats, 0)} student shifts{clinical.some((m) => !m.employerId) ? ` · ${clinical.filter((m) => !m.employerId).length} need a site` : ""}{clinical.some((m) => m.occ?.moved) ? ` · ${clinical.filter((m) => m.occ?.moved).length} moved by the plan` : ""}</span>
        {clinical.some((m) => m.occ) && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700">{new Set(clinical.filter((m) => m.occ?.employerId).map((m) => m.occ!.employerId)).size} sites hosting · {new Set(clinical.flatMap((m) => m.occ?.preceptors ?? [])).size} preceptors named</span>}
        {summary.unroomed > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">{summary.unroomed} unroomed — needs space</span>}
        {conflictsForWeek.length > 0
          ? <span className="rounded-full bg-rose-600 px-2 py-0.5 font-medium text-white">{conflictsForWeek.length} conflicts this week</span>
          : <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700">no conflicts this week</span>}
        {pending && <span className="text-slate-400">saving…</span>}
      </div>
      {/* Legend — what the colors mean this week */}
      {(legend.length > 0 || colorBy === "program") && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600">
          <span className="text-slate-400">{colorBy === "location" ? "same color = same room or site:" : colorBy === "kind" ? "session type:" : "program:"}</span>
          {colorBy === "program"
            ? programs.map((p) => <span key={p.id} className="inline-flex items-center gap-1"><span className={`inline-block h-2.5 w-2.5 rounded-sm ${programColor.get(p.id)}`} />{p.name}</span>)
            : legend.map(([name, color]) => <span key={name} className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />{name}</span>)}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_240px]">
        {/* Timetable */}
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-3">
          <div className="flex min-w-[840px]">
            {/* time gutter */}
            <div className="w-12 shrink-0 pt-7">
              {Array.from({ length: END_HOUR - START_HOUR }, (_, i) => (
                <div key={i} style={{ height: HOUR_PX }} className="relative -top-2 text-right text-[10px] text-slate-400">{fmtTime(`${START_HOUR + i}:00`)}</div>
              ))}
            </div>
            {/* day columns */}
            {DAYS.map((day) => {
              const { placed, lanes } = dayLayout(day);
              return (
                <div key={day} className="flex-1 border-l border-slate-100">
                  <div className="sticky top-0 mb-1 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500">{day} <span className="font-normal normal-case text-slate-400">{dayDate(day)}</span></div>
                  <div className="relative" style={{ height: gridHeight }}>
                    {Array.from({ length: END_HOUR - START_HOUR }, (_, i) => (
                      <div key={i} style={{ top: i * HOUR_PX, height: HOUR_PX }} className="absolute inset-x-0 border-t border-slate-50" />
                    ))}
                    {placed.map(({ m, members, s, lane }) => {
                      const top = ((s - START_HOUR * 60) / 60) * HOUR_PX;
                      const height = Math.max(18, m.lengthHours * HOUR_PX - 2);
                      const bs = blockStyle(m);
                      const conflict = members.some((x) => conflictIds.has(x.id));
                      const w = 100 / lanes;
                      const many = members.length > 1;
                      const moved = groupMoved(members);
                      const unbooked = groupUnbooked(members);
                      const names = members.flatMap((x) => x.occ?.students.map((s) => s.name) ?? []);
                      return (
                        <button key={m.id} onClick={() => (many || m.occ ? setGroup(members) : setEditing(m))}
                          style={{ top, height, left: `${lane * w}%`, width: `calc(${w}% - 2px)`, ...(bs.style ?? {}) }}
                          title={`${m.courseCode ?? m.courseName} ${KIND_LABEL[m.kind] ?? m.kind} · ${fmtTime(m.startTime)}–${fmtTime(m.endTime)} · ${many ? `${members.length} sections · ${groupStudents(members)} students` : `${m.seats} students`} · ${groupWhere(members)} · ${m.cohortName}${moved ? ` · ${moved}` : ""}${names.length ? ` · ${names.slice(0, 12).join(", ")}${names.length > 12 ? "…" : ""}` : ""}`}
                          className={`absolute overflow-hidden rounded-md px-1 py-0.5 text-left text-white ${bs.className} ${m.kind === "CLINICAL" ? "border-2 border-dashed border-white/70" : ""} ${conflict ? "ring-2 ring-rose-600 ring-offset-1" : ""} hover:brightness-110`}>
                          <span className="block truncate text-[10px] font-semibold leading-tight">{m.courseCode ?? m.courseName}{many ? ` · ${members.length} ${m.kind === "CLINICAL" ? "placements" : "sections"}` : m.sectionCount > 1 ? ` §${m.sectionIndex}` : ""}{m.kind === "CLINICAL" ? " ⚕" : ""}{moved ? <span className="ml-1 rounded bg-white/90 px-1 text-[8px] font-semibold text-amber-700">{moved}</span> : null}{unbooked ? <span className="ml-1 rounded bg-white/90 px-1 text-[8px] font-semibold text-rose-700" title={`${unbooked} of these sections have no booking yet — the scheduler could not place them, or no plan is applied`}>{unbooked === members.length ? "not booked" : `${unbooked} not booked`}</span> : null}</span>
                          <span className="block truncate text-[9px] leading-tight opacity-90">{groupWhere(members)}</span>
                          <span className="block truncate text-[9px] leading-tight opacity-75">{fmtTime(m.startTime)} · {groupStudents(members)} stu · {m.cohortName}</span>
                          {names.length > 0 && <span className="block truncate text-[9px] leading-tight opacity-75">{names.join(", ")}</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Room utilization rail */}
        <div className="space-y-2">
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Room utilization (peak week)</h3>
            <div className="space-y-2">
              {rooms.map((r) => {
                const pct = Math.round(r.utilization * 100);
                const bar = pct >= 85 ? "bg-rose-500" : pct >= 50 ? "bg-amber-500" : pct > 0 ? "bg-emerald-500" : "bg-slate-200";
                return (
                  <button key={r.facilityId} onClick={() => setFRoom(fRoom === r.facilityId ? "" : r.facilityId)} className={`block w-full text-left ${fRoom === r.facilityId ? "rounded-lg ring-1 ring-rose-300" : ""}`}>
                    <span className="flex items-center justify-between text-[11px]">
                      <span className="truncate font-medium text-slate-700">{r.name}</span>
                      <span className="tabular-nums text-slate-400">{pct}%</span>
                    </span>
                    <span className="mt-0.5 block h-1.5 w-full overflow-hidden rounded-full bg-slate-100"><span className={`block h-full ${bar}`} style={{ width: `${pct}%` }} /></span>
                    <span className="block text-[9px] text-slate-400">{r.kind.toLowerCase()} · cap {r.capacity ?? "—"} · {r.bookedHoursPeakWeek}/{r.openHoursPerWeek}h · {r.meetingCount} mtgs</span>
                  </button>
                );
              })}
              {rooms.every((r) => r.utilization === 0) && <p className="text-[11px] text-slate-400">No campus bookings.</p>}
            </div>
          </div>
        </div>
      </div>

      {/* Who is where — every student and preceptor at every site, day by day */}
      {roster.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-800">Who is where this week <span className="text-xs font-normal text-slate-500">· every clinical site with the students and preceptors on it, from the applied plan</span></h3>
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="text-left text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-2 py-1">Day</th><th className="px-2 py-1">Site</th><th className="px-2 py-1 text-right">Students</th><th className="px-2 py-1">Who</th><th className="px-2 py-1">Preceptors</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {roster.filter((d) => !fProgram || d.sites.some((s) => s.students.length)).flatMap((d) => d.sites.map((s, i) => (
                  <tr key={`${d.date}|${s.employerId ?? "tbd"}`} className="align-top">
                    <td className="whitespace-nowrap px-2 py-1 font-medium text-slate-700">{i === 0 ? `${DAY_FULL[d.dayOfWeek] ?? d.dayOfWeek} ${new Date(d.date + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}` : ""}</td>
                    <td className="px-2 py-1">{s.employerId ? <Link href={`/employers/${s.employerId}`} className="whitespace-nowrap text-slate-800 hover:text-rose-700 hover:underline">{s.name}</Link> : <span className="text-amber-700">{s.name}</span>}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{s.students.length}</td>
                    <td className="px-2 py-1"><div className="flex flex-wrap gap-1">{s.students.map((st, j) => <span key={j} className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700" title={`${st.cohort} · ${st.course}${st.preceptor ? ` · with ${st.preceptor}` : ""}`}>{st.name}</span>)}</div></td>
                    <td className="px-2 py-1 text-slate-600">{s.preceptors.length ? s.preceptors.join(", ") : s.employerId ? <span className="text-amber-700">none named</span> : <span className="text-slate-400">—</span>}</td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Conflicts panel */}
      {conflictsForWeek.length > 0 && (
        <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-4">
          <h3 className="text-sm font-semibold text-rose-700">{conflictsForWeek.length} scheduling conflicts this week</h3>
          <div className="mt-2 space-y-1">
            {conflictsForWeek.slice(0, 30).map((c, i) => {
              const a = meetings.find((m) => m.id === c.aId), b = meetings.find((m) => m.id === c.bId);
              if (!a || !b) return null;
              return (
                <div key={i} className="flex flex-wrap items-center gap-2 text-[12px]">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${c.kind === "room" ? "bg-rose-200 text-rose-800" : c.kind === "staff" ? "bg-violet-200 text-violet-800" : "bg-amber-200 text-amber-800"}`}>{c.kind}</span>
                  <button onClick={() => setEditing(a)} className="text-slate-700 hover:text-rose-700 hover:underline">{a.courseCode ?? a.courseName} ({a.cohortName})</button>
                  <span className="text-slate-400">↔</span>
                  <button onClick={() => setEditing(b)} className="text-slate-700 hover:text-rose-700 hover:underline">{b.courseCode ?? b.courseName} ({b.cohortName})</button>
                  <span className="text-slate-400">{c.detail}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {group && !editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4" onClick={() => setGroup(null)}>
          <div className="max-h-[80vh] w-full max-w-2xl overflow-auto rounded-xl border border-slate-200 bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-800">{group[0].courseCode ? `${group[0].courseCode} · ` : ""}{group[0].courseName} <span className="font-normal text-slate-500">· {KIND_LABEL[group[0].kind] ?? group[0].kind}</span></h3>
                <p className="text-xs text-slate-500">{DAY_FULL[group[0].dayOfWeek] ?? group[0].dayOfWeek} {dayDate(group[0].dayOfWeek)} {fmtTime(group[0].startTime)}–{fmtTime(group[0].endTime)} · {group.length} {group[0].kind === "CLINICAL" ? "placements" : "sections"} · {groupStudents(group)} students · {group[0].cohortName}{group[0].startLabel ? ` · ${group[0].startLabel} → ${group[0].endLabel}` : ""}{groupMoved(group) ? ` · ${groupMoved(group)} by the scheduler's plan` : ""}</p>
              </div>
              <button onClick={() => setGroup(null)} className="text-xs text-slate-500 hover:text-rose-700">close</button>
            </div>
            <table className="mt-3 w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-2 py-1 text-left">Section</th><th className="px-2 py-1 text-left">{group[0].kind === "CLINICAL" ? "Clinical site" : "Room"}</th><th className="px-2 py-1 text-left">{group[0].kind === "CLINICAL" ? "Preceptor" : "Instructor"}</th>{group.some((x) => x.occ) && <th className="px-2 py-1 text-left">Who is there</th>}<th className="px-2 py-1 text-right">Students</th><th className="px-2 py-1"></th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {group.map((x) => {
                  const pattern = x.occ?.meetingId ? meetings.find((m) => m.id === x.occ!.meetingId) : x.occ ? null : x;
                  return (
                    <tr key={x.id} className={conflictIds.has(x.id) ? "bg-rose-50" : ""}>
                      <td className="px-2 py-1 font-medium text-slate-800">§{x.sectionIndex}{x.occ?.moved ? <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-800" title={`the weekly pattern has it on ${DAY_FULL[x.occ.originalDay] ?? x.occ.originalDay}`}>from {x.occ.originalDay}</span> : null}{x.occ?.changedBlock ? <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-800">other shift</span> : null}</td>
                      <td className="px-2 py-1 text-slate-700">{x.kind === "CLINICAL" ? (x.employerName ?? <span className="text-amber-700">site TBD</span>) : (x.facilityName ?? <span className="text-amber-700">no room</span>)}{x.occ?.assets.length ? <span className="text-slate-400"> · {x.occ.assets.join(", ")}</span> : null}{x.occ && !x.occ.booked && x.occ.source === "pattern" ? <span className="ml-1 rounded bg-rose-100 px-1 text-[10px] text-rose-800" title="the section's weekly site — nothing is booked for this date">not booked</span> : null}</td>
                      <td className="px-2 py-1 text-slate-700">{x.occ ? (x.occ.preceptors.length ? x.occ.preceptors.join(", ") : <span className="text-amber-700">none named</span>) : (x.staffName ?? <span className="text-amber-700">unassigned</span>)}{x.occ?.instructor ? <span className="text-slate-400"> · {x.occ.instructor} (instructor)</span> : null}</td>
                      {group.some((y) => y.occ) && <td className="px-2 py-1"><div className="flex flex-wrap gap-1">{x.occ?.students.map((s) => <span key={s.id} className={`rounded px-1.5 py-0.5 ${s.status === "scheduled" ? "bg-slate-100 text-slate-700" : s.status === "completed" ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`} title={`${s.status}${s.preceptor ? ` · with ${s.preceptor}` : ""}`}>{s.name}</span>)}{x.occ && !x.occ.students.length && <span className="text-slate-400">no students on the roster yet</span>}</div></td>}
                      <td className="px-2 py-1 text-right tabular-nums">{x.seats}</td>
                      <td className="px-2 py-1 text-right">{pattern ? <button onClick={() => { setEditing(pattern); }} className="text-rose-700 hover:underline" title="edit the weekly pattern this shift belongs to">edit</button> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {editing && <MoveEditor meeting={editing} weekMs={weekMs} rooms={rooms} people={people} employers={employers} onClose={() => setEditing(null)} onSave={save} />}
    </div>
  );
}

function MoveEditor({ meeting, weekMs, rooms, people, employers, onClose, onSave }: { meeting: CalMeeting; weekMs: number; rooms: CalRoom[]; people: CalPerson[]; employers: CalEmployer[]; onClose: () => void; onSave: (p: { dayOfWeek?: string; startTime?: string; facilityId?: string | null; staffPersonId?: string | null; employerId?: string | null }) => void }) {
  const [day, setDay] = useState(meeting.dayOfWeek);
  const [time, setTime] = useState(meeting.startTime);
  const [room, setRoom] = useState(meeting.facilityId ?? "");
  const [site, setSite] = useState(meeting.employerId ?? "");
  const [staff, setStaff] = useState(meeting.staffPersonId ?? "");
  const offCampus = meeting.kind === "CLINICAL";
  const staffPool = offCampus ? people.filter((p) => p.role === "preceptor") : people.filter((p) => p.role !== "preceptor");
  const eligible = rooms.filter((r) => (meeting.kind === "LAB" ? r.kind === "LAB" || r.kind === "SIM" : r.kind === "CLASSROOM" || r.kind === "OTHER"));
  const location = offCampus ? (meeting.employerName ?? "site TBD") : (meeting.facilityName ?? "unroomed");
  // What happens on THIS day: the selected calendar week → the week-of-term →
  // that week's session(s) for this course + kind. Not the whole curriculum.
  const WK = 7 * 24 * 3600 * 1000;
  const weekOfTerm = meeting.weekStartMs ? Math.floor((weekMs - meeting.weekStartMs) / WK) + 1 : null;
  const thisWeek = weekOfTerm != null ? meeting.sessionTitles.filter((x) => x.week === weekOfTerm && x.title) : [];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-800">
              {meeting.courseCode ? <span>{meeting.courseCode} · </span> : null}{meeting.courseName}
              {meeting.sectionCount > 1 ? <span className="text-slate-400"> · section {meeting.sectionIndex}/{meeting.sectionCount}</span> : null}
            </h3>
            <p className="text-xs text-slate-500">{KIND_LABEL[meeting.kind] ?? meeting.kind} · {meeting.cohortName} · {meeting.programName}</p>
          </div>
          <Link href={`/programs/${meeting.programId}/offerings/${meeting.cohortId}`} className="text-xs text-rose-600 hover:underline">offering ↦</Link>
        </div>

        {/* What this booking IS — full detail */}
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-slate-50 px-3 py-2 text-xs">
          <div><dt className="text-slate-400">Location</dt><dd className="font-medium text-slate-700">{location}</dd></div>
          <div><dt className="text-slate-400">{offCampus ? "Preceptor" : "Instructor"}</dt><dd className={`font-medium ${meeting.staffName ? "text-slate-700" : "text-amber-600"}`}>{meeting.staffName ?? "unstaffed"}</dd></div>
          <div><dt className="text-slate-400">When</dt><dd className="font-medium text-slate-700">{DAY_FULL[meeting.dayOfWeek] ?? meeting.dayOfWeek} {fmtTime(meeting.startTime)}–{fmtTime(meeting.endTime)} ({meeting.lengthHours}h)</dd></div>
          <div><dt className="text-slate-400">Runs</dt><dd className="font-medium text-slate-700">{meeting.startLabel} → {meeting.endLabel}</dd></div>
          <div><dt className="text-slate-400">Students</dt><dd className="font-medium text-slate-700">{meeting.seats}</dd></div>
          <div><dt className="text-slate-400">Term</dt><dd className="font-medium text-slate-700">Term {meeting.termIndex}</dd></div>
        </dl>

        {/* What happens on THIS day (the selected week) — not the whole curriculum */}
        <div className="mt-2 rounded-lg bg-rose-50/60 px-3 py-2 ring-1 ring-rose-100">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-rose-500">
            This day{weekOfTerm != null ? ` · week ${weekOfTerm} of the term` : ""}
          </div>
          {thisWeek.length > 0 ? (
            <div className="mt-0.5 space-y-0.5">
              {thisWeek.map((x, i) => (
                <div key={i} className="text-[12px] font-medium text-slate-800">{x.title}</div>
              ))}
            </div>
          ) : (
            <div className="mt-0.5 text-[11px] text-slate-500">
              {weekOfTerm != null && weekOfTerm >= 1 ? `Untitled ${KIND_LABEL[meeting.kind]?.toLowerCase() ?? "session"} — week ${weekOfTerm}` : "Outside this booking's term window"}
            </div>
          )}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Day</span>
            <select value={day} onChange={(e) => setDay(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
              {ALL_DAYS.map((d) => <option key={d} value={d}>{DAY_FULL[d]}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Start time</span>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
          </label>
          {!offCampus ? (
            <label className="col-span-2 block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Room</span>
              <select value={room} onChange={(e) => setRoom(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
                <option value="">— unroomed —</option>
                {eligible.map((r) => <option key={r.facilityId} value={r.facilityId} disabled={r.capacity != null && meeting.seats > r.capacity}>{r.name} (cap {r.capacity ?? "—"}){r.capacity != null && meeting.seats > r.capacity ? " — too small" : ""}</option>)}
              </select>
            </label>
          ) : (
            <label className="col-span-2 block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Clinical site (partner)</span>
              <select value={site} onChange={(e) => setSite(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
                <option value="">— site TBD —</option>
                {employers.map((emp) => <option key={emp.id} value={emp.id}>{emp.name}{emp.setting ? ` (${emp.setting})` : ""}</option>)}
              </select>
            </label>
          )}
          <label className="col-span-2 block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">{offCampus ? "Preceptor" : "Instructor"}</span>
            <select value={staff} onChange={(e) => setStaff(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
              <option value="">— unstaffed —</option>
              {staffPool.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <button onClick={() => onSave({ dayOfWeek: day, startTime: time, facilityId: offCampus ? undefined : (room || null), employerId: offCampus ? (site || null) : undefined, staffPersonId: staff || null })} className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700">Save</button>
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">Cancel</button>
        </div>
      </div>
    </div>
  );
}
