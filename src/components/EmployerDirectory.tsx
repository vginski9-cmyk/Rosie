"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createEmployer } from "@/lib/actions";
import { dec } from "@/lib/format";

export interface HostPeriod { year: number; season: string; sections: number; students: number }
export interface DirEmployer {
  id: string;
  name: string;
  setting: string | null;
  city: string | null;
  address?: string | null; state?: string | null; zip?: string | null;
  status: string;
  contactName: string | null;
  institution: { id: string; name: string };
  _count: { people: number; units?: number; meetings?: number };
  /** What the site hosts on the calendar: clinical sections and the students in them, by semester and by program family, plus family agreements. */
  hosting: { sections: number; students: number; periods: HostPeriod[]; families: { family: string; sections: number; students: number }[]; agreements: { family: string; status: string }[] };
  // clinical asset map
  organization?: string | null; facilityType?: string | null; county?: string | null; ring?: string | null;
  licensedBeds?: number | null; nursingHomeBeds?: number | null; adultCareBeds?: number | null; operatingRooms?: number | null;
  agreementStatus?: string;
  units?: { unitCategory: string; studentsPerShift: number; shiftsPerDay: number; days: string; status: string }[];
  /** Auto-coded location: coordinates + their source, distance and drive time from the main campus, and whether the ring was overridden. */
  geo?: { lat: number | null; lng: number | null; source: string | null; distanceMiles: number | null; driveMinutes: number | null; ringSource: string };
}
const RING_TONE: Record<string, string> = { Core: "bg-emerald-100 text-emerald-800", "Ring 1": "bg-sky-100 text-sky-800", "Ring 2": "bg-amber-100 text-amber-800", "Ring 3": "bg-rose-100 text-rose-800" };
const AGREEMENT_BADGE: Record<string, string> = { none: "bg-slate-100 text-slate-500", prospect: "bg-sky-100 text-sky-700", asked: "bg-amber-100 text-amber-700", secured: "bg-emerald-100 text-emerald-700", declined: "bg-rose-100 text-rose-700" };
export interface InstLite { id: string; name: string }

const STATUSES = ["prospect", "active", "paused", "archived"];
const STATUS_BADGE: Record<string, string> = {
  prospect: "bg-sky-100 text-sky-700", active: "bg-emerald-100 text-emerald-700",
  paused: "bg-amber-100 text-amber-700", archived: "bg-slate-100 text-slate-400",
};
const SEASONS = ["Fall", "Spring", "Summer"];

export function EmployerDirectory({ employers, institutions }: { employers: DirEmployer[]; institutions: InstLite[] }) {
  const [q, setQ] = useState("");
  const [fInst, setFInst] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fYear, setFYear] = useState("");
  const [fSeason, setFSeason] = useState("");
  const [fCounty, setFCounty] = useState("");
  const [fRing, setFRing] = useState("");
  const [fType, setFType] = useState("");
  const [fAgree, setFAgree] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const counties = useMemo(() => [...new Set(employers.map((e) => e.county).filter((x): x is string => !!x))].sort(), [employers]);
  const rings = useMemo(() => [...new Set(employers.map((e) => e.ring).filter((x): x is string => !!x))].sort(), [employers]);
  const types = useMemo(() => [...new Set(employers.map((e) => e.facilityType).filter((x): x is string => !!x))].sort(), [employers]);

  const years = useMemo(() => {
    const s = new Set<number>();
    for (const e of employers) for (const p of e.hosting.periods) s.add(p.year);
    return [...s].sort((a, b) => b - a);
  }, [employers]);

  const periodActive = fYear !== "" || fSeason !== "";
  // Sections / students hosted by a site, scoped to the selected semester (or all-time).
  const scoped = (e: DirEmployer): { sections: number; students: number } => {
    if (!periodActive) return { sections: e.hosting.sections, students: e.hosting.students };
    let sections = 0, students = 0;
    for (const p of e.hosting.periods) {
      if (fYear && String(p.year) !== fYear) continue;
      if (fSeason && p.season !== fSeason) continue;
      sections += p.sections; students += p.students;
    }
    return { sections, students };
  };
  const bestAgreement = (e: DirEmployer): string => {
    const order = ["secured", "asked", "prospect", "none", "declined"];
    const all = [e.agreementStatus ?? "none", ...e.hosting.agreements.map((a) => a.status)];
    return order.find((o) => all.includes(o)) ?? "none";
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return employers.filter((e) => {
      if (fInst && e.institution.id !== fInst) return false;
      if (fStatus && e.status !== fStatus) return false;
      if (fCounty && e.county !== fCounty) return false;
      if (fRing && e.ring !== fRing) return false;
      if (fType && e.facilityType !== fType) return false;
      if (fAgree && bestAgreement(e) !== fAgree) return false;
      if (needle && !(e.name.toLowerCase().includes(needle) || (e.city ?? "").toLowerCase().includes(needle) || (e.address ?? "").toLowerCase().includes(needle) || (e.zip ?? "").includes(needle) || (e.setting ?? "").toLowerCase().includes(needle))) return false;
      return true;
    });
  }, [employers, q, fInst, fStatus, fCounty, fRing, fType, fAgree]);

  const totals = filtered.reduce((acc, e) => { const s = scoped(e); return { sections: acc.sections + s.sections, students: acc.students + s.students, hosting: acc.hosting + (s.sections ? 1 : 0), secured: acc.secured + (bestAgreement(e) === "secured" ? 1 : 0) }; }, { sections: 0, students: 0, hosting: 0, secured: 0 });
  const unsecuredHosting = filtered.filter((e) => scoped(e).sections > 0 && bestAgreement(e) !== "secured").length;
  const periodLabel = periodActive ? `${fSeason || "all"} ${fYear || "years"}`.trim() : "all-time";
  const anyFilter = q || fInst || fStatus || periodActive || fCounty || fRing || fType || fAgree;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Search</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="name, address, city, setting…" className="w-52 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Institution</span>
          <select value={fInst} onChange={(e) => setFInst(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
            <option value="">All</option>
            {institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Status</span>
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
            <option value="">All</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Year</span>
          <select value={fYear} onChange={(e) => setFYear(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
            <option value="">All</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Semester</span>
          <select value={fSeason} onChange={(e) => setFSeason(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
            <option value="">All</option>
            {SEASONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Facility type</span>
          <select value={fType} onChange={(e) => setFType(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"><option value="">All</option>{types.map((t) => <option key={t} value={t}>{t}</option>)}</select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">County</span>
          <select value={fCounty} onChange={(e) => setFCounty(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"><option value="">All</option>{counties.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Ring</span>
          <select value={fRing} onChange={(e) => setFRing(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"><option value="">All</option>{rings.map((r) => <option key={r} value={r}>{r}</option>)}</select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Agreement</span>
          <select value={fAgree} onChange={(e) => setFAgree(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"><option value="">All</option>{["none", "prospect", "asked", "secured", "declined"].map((a) => <option key={a} value={a}>{a}</option>)}</select>
        </label>
        {anyFilter && <button onClick={() => { setQ(""); setFInst(""); setFStatus(""); setFYear(""); setFSeason(""); setFCounty(""); setFRing(""); setFType(""); setFAgree(""); }} className="pb-1.5 text-xs text-slate-400 hover:text-rose-600">clear</button>}
        <button onClick={() => setShowAdd((v) => !v)} className="ml-auto rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700">{showAdd ? "Close" : "+ Add partner"}</button>
      </div>

      {showAdd && <AddForm institutions={institutions} onDone={() => setShowAdd(false)} />}

      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
        <span><span className="font-medium text-slate-700">{filtered.length}</span> partners</span>
        <span className="text-slate-300">·</span>
        <span>Hosting ({periodLabel}): <span className="font-medium text-slate-700 tabular-nums">{totals.sections}</span> clinical sections · <span className="font-medium text-slate-700 tabular-nums">{totals.students}</span> student placements at <span className="font-medium text-slate-700 tabular-nums">{totals.hosting}</span> sites</span>
        <span className="text-slate-300">·</span>
        <span><span className="font-medium text-slate-700 tabular-nums">{totals.secured}</span> with a secured agreement</span>
        {unsecuredHosting > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-700">⚠ {unsecuredHosting} site{unsecuredHosting === 1 ? "" : "s"} on the calendar without a secured agreement</span>}
        <span className="text-slate-400">placements come from the calendarized sections, not a static slot count</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2 text-left font-semibold">Site</th>
              <th className="px-3 py-2 text-left font-semibold">Type · county</th>
              <th className="px-3 py-2 text-left font-semibold">Ring · drive from campus</th>
              <th className="px-3 py-2 text-right font-semibold">Beds / ORs</th>
              <th className="px-3 py-2 text-left font-semibold">Units · students / shift</th>
              <th className="px-3 py-2 text-left font-semibold">Agreement</th>
              <th className="px-3 py-2 text-left font-semibold">Hosting · sections / students</th>
              <th className="px-3 py-2 text-left font-semibold">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((e) => {
              const s = scoped(e);
              const agreement = bestAgreement(e);
              const gap = s.sections > 0 && agreement !== "secured";
              return (
                <tr key={e.id} className="hover:bg-slate-50/60">
                  <td className="px-3 py-2">
                    <Link href={`/employers/${e.id}`} className="font-medium text-slate-800 hover:text-rose-700 hover:underline">{e.name}</Link>
                    <span className="block text-[11px] text-slate-400">{e.organization}</span>
                    <span className="block text-[11px] text-slate-500">{[e.address, [e.city, e.state].filter(Boolean).join(", "), e.zip].filter(Boolean).join(" · ") || <span className="text-amber-600">no address</span>}</span>
                  </td>
                  <td className="px-3 py-2 text-slate-500">{[e.facilityType ?? e.setting, e.county].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {e.ring ? <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${RING_TONE[e.ring] ?? "bg-slate-100 text-slate-600"}`}>{e.ring}{e.geo?.ringSource === "manual" ? " ✎" : ""}</span> : <span className="text-slate-300">not located</span>}
                    {e.geo?.driveMinutes != null && <span className="block text-[10px] tabular-nums text-slate-500">≈ {Math.round(e.geo.driveMinutes)} min · {e.geo.distanceMiles != null ? `${dec(e.geo.distanceMiles, 1)} mi` : ""}{e.geo.source === "gazetteer" ? " · town centre" : e.geo.source === "manual" ? " · pinned" : ""}</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">{e.licensedBeds ?? e.nursingHomeBeds ?? "—"}{e.operatingRooms ? ` / ${e.operatingRooms} OR` : ""}</td>
                  <td className="px-3 py-2 text-slate-600">{(() => {
                    const byCat = new Map<string, number>();
                    for (const u of e.units ?? []) if (u.status === "active") byCat.set(u.unitCategory, (byCat.get(u.unitCategory) ?? 0) + u.studentsPerShift);
                    return byCat.size ? [...byCat.entries()].map(([c, n]) => `${c} ${n}`).join(" · ") : <span className="text-slate-300">no units</span>;
                  })()}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${AGREEMENT_BADGE[agreement]}`}>{agreement}</span>
                    {e.hosting.agreements.length > 0 && <span className="block text-[10px] text-slate-400">{e.hosting.agreements.map((a) => `${a.family}: ${a.status}`).join(" · ")}</span>}
                  </td>
                  <td className={`px-3 py-2 tabular-nums ${gap ? "font-semibold text-amber-600" : s.sections ? "text-emerald-700" : "text-slate-400"}`}>
                    {s.sections ? `${s.sections} / ${s.students}` : "—"}
                    {s.sections > 0 && e.hosting.families.length > 0 && <span className="block text-[10px] font-normal text-slate-400">{e.hosting.families.map((f) => `${f.family} ${f.students}`).join(" · ")}</span>}
                    {gap && <span className="block text-[10px] font-normal text-amber-600">no secured agreement</span>}
                  </td>
                  <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_BADGE[e.status] ?? "bg-slate-100 text-slate-600"}`}>{e.status}</span></td>
                </tr>
              );
            })}
            {filtered.length === 0 && <tr><td colSpan={8} className="px-3 py-8 text-center text-sm text-slate-400">No sites match these filters.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AddForm({ institutions, onDone }: { institutions: InstLite[]; onDone: () => void }) {
  return (
    <form action={async (fd) => { await createEmployer(fd); onDone(); }} className="grid gap-3 rounded-xl border border-rose-200 bg-rose-50/40 p-4 sm:grid-cols-2 lg:grid-cols-4">
      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Institution</span>
        <select name="institutionId" required defaultValue={institutions[0]?.id} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
          {institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Partner name</span>
        <input name="name" required placeholder="Cape Fear Valley Medical Center" className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
      </label>
      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Setting</span>
        <input name="setting" placeholder="acute-care hospital" className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
      </label>
      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">City</span>
        <input name="city" placeholder="Fayetteville" className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
      </label>
      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Street address</span>
        <input name="address" placeholder="1638 Owen Dr" className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
      </label>
      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">State · ZIP</span>
        <div className="flex gap-1"><input name="state" placeholder="NC" defaultValue="NC" className="w-14 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" /><input name="zip" placeholder="28304" className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" /></div>
      </label>
      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Students / day (clinical capacity)</span>
        <input name="wblSlots" type="number" min={0} placeholder="e.g. 12" className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
      </label>
      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Status</span>
        <select name="status" defaultValue="prospect" className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Contact name</span>
        <input name="contactName" placeholder="Clinical coordinator" className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
      </label>
      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Contact email</span>
        <input name="contactEmail" type="email" placeholder="coordinator@partner.org" className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
      </label>
      <div className="flex items-end gap-2 lg:col-span-4">
        <button className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700">Add partner</button>
        <button type="button" onClick={onDone} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-500 hover:bg-white">Cancel</button>
      </div>
    </form>
  );
}
