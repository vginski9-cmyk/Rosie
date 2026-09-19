"use client";

import { useState } from "react";
import type { Plan, Policy } from "@/lib/scheduler";
import { fmt, dec } from "@/lib/format";

// THE CAPACITY PICTURE (Phase 13) — the scheduler's answer in one glance, in plain words:
//   • the rings: of the clinical learner-shifts you need, how many the plan found a seat for, how many
//     also have a preceptor named, and how many pass every check (the headline);
//   • the bars: how many seats you HAVE under the current levers, next to how many you need, so the
//     spare capacity — or the shortage — is a length you can see, and two what-ifs beside it:
//     the seats that would count if every site counted, and the seats a preceptor on the roster
//     could actually cover.
// Everything here recomputes as the levers change; the line under the bars says which levers move it.

const n0 = (v: number) => dec(v);
const pct = (v: number | null) => (v == null ? "—" : fmt.pct(v));
const signed = (v: number) => (v > 0 ? `+${dec(v)}` : v < 0 ? `−${dec(Math.abs(v))}` : "0");
// The three rings: fixed hues, never reassigned (validated categorical slots 1–3).
const RING = { placed: "#2a78d6", staffed: "#eb6834", ready: "#1baf7a" } as const;
const TRACK = "#e8ecf1";

function Rings({ placed, staffed, ready }: { placed: number; staffed: number; ready: number }) {
  const size = 200, stroke = 18, gap = 6;
  const c = size / 2;
  const rings = [
    { key: "placed", share: placed, r: c - stroke / 2, color: RING.placed },
    { key: "staffed", share: staffed, r: c - stroke * 1.5 - gap, color: RING.staffed },
    { key: "ready", share: ready, r: c - stroke * 2.5 - gap * 2, color: RING.ready },
  ];
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Placed ${pct(placed)}, staffed ${pct(staffed)}, ready ${pct(ready)} of the learner-shifts needed`}>
      {rings.map((x) => {
        const len = 2 * Math.PI * x.r;
        const v = Math.max(0, Math.min(1, x.share));
        return (
          <g key={x.key}>
            <circle cx={c} cy={c} r={x.r} fill="none" stroke={TRACK} strokeWidth={stroke} />
            <circle cx={c} cy={c} r={x.r} fill="none" stroke={x.color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${len * v} ${len}`} transform={`rotate(-90 ${c} ${c})`} style={{ transition: "stroke-dasharray 400ms ease" }} />
          </g>
        );
      })}
      <text x={c} y={c - 4} textAnchor="middle" fontSize="30" fontWeight="700" fill="#0f172a">{pct(ready)}</text>
      <text x={c} y={c + 16} textAnchor="middle" fontSize="11" fill="#64748b">ready to run</text>
    </svg>
  );
}

function Bar({ label, value, demand, max, color, note, estimate }: { label: string; value: number; demand: number; max: number; color: string; note: string; estimate?: boolean }) {
  const w = (v: number) => `${Math.max(0, Math.min(100, (v / Math.max(1, max)) * 100))}%`;
  const spare = value - demand;
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs">
        <span className="font-medium text-slate-800">{label}{estimate && <span className="ml-1 rounded bg-amber-50 px-1 text-[10px] font-normal text-amber-800">estimate</span>}</span>
        <span className="tabular-nums text-slate-700"><strong>{n0(value)}</strong> seats · <span className={spare < 0 ? "font-semibold text-rose-700" : "font-semibold text-emerald-700"}>{spare < 0 ? `${n0(-spare)} short` : `${n0(spare)} spare`}</span>{demand > 0 && <span className="text-slate-400"> · {fmt.mult(value / demand)}× what you need</span>}</span>
      </div>
      <div className="relative mt-1 h-4 w-full rounded bg-slate-100" title={note}>
        <div className="h-4 rounded" style={{ width: w(value), background: color, transition: "width 400ms ease" }} />
        {/* The demand line: what you need. */}
        <div className="absolute top-[-3px] h-[22px] w-[2px] bg-slate-900" style={{ left: w(demand) }} aria-hidden />
      </div>
      <div className="mt-0.5 text-[10px] text-slate-500">{note}</div>
    </div>
  );
}

export function SchedulerCapacity({ plan, policy, window, onOpenLevers }: { plan: Plan; policy: Policy; window: { from: string; to: string }; onOpenLevers: () => void }) {
  const s = plan.summary; const c = s.capacity; const rd = s.readiness;
  const [explain, setExplain] = useState(false);
  const need = c.demandSeats;
  const have = Math.max(0, c.supplySeatsOnDemandDays - c.supplySeatsBooked);
  const everySite = c.supplySeatsPhysicalOnDemandDays;
  const staffable = Math.min(have, c.supplySeatsStaffableOnDemandDays);
  const max = Math.max(need, have, everySite, staffable, 1) * 1.08;
  const agreements = policy.agreements === "secured" ? "secured agreements only" : policy.agreements === "secured+asked" ? "secured or asked" : "any agreement";
  const ring = policy.maxRing === "any" ? "any drive ring" : `drive ring up to ${policy.maxRing}`;
  const days = policy.flexibleDays ? `±${policy.flexibleDays} day${policy.flexibleDays === 1 ? "" : "s"}` : "exact dates";
  const shift = policy.flexibleShift ? "any shift block" : "the session's shift block";
  const verdict = need === 0 ? "Nothing is scheduled in this window." : have >= need && staffable >= need ? `You have enough seats and enough preceptors for every shift — ${n0(have - need)} seats to spare.` : have >= need ? `You have enough seats (${n0(have - need)} to spare) but not enough preceptors on the rosters to staff them all — about ${n0(need - staffable)} learner-shifts would go unstaffed.` : `You are ${n0(need - have)} seats short on the days you need them, before staffing is even considered.`;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900">Can these clinical shifts be placed?</h2>
        <span className="text-xs text-slate-500">{window.from} → {window.to} · one learner-shift = one learner on one shift</span>
      </div>
      <p className="mt-1 text-2xl font-semibold leading-tight text-slate-900">You need <span className="text-slate-900">{n0(need)}</span> learner-shifts.</p>
      <p className="mt-1 text-sm text-slate-700">{verdict}</p>

      <div className="mt-4 grid gap-6 lg:grid-cols-[220px_1fr]">
        {/* The rings */}
        <div className="flex items-start gap-4 lg:block">
          <Rings placed={s.placedShare} staffed={need ? s.preceptorsAssigned / Math.max(1, s.preceptorShifts) * s.placedShare : 0} ready={rd.readyShare} />
          <ul className="mt-2 space-y-1 text-xs">
            <li className="flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: RING.placed }} /><span className="text-slate-700"><strong>Found a seat</strong> · {n0(s.placedSeats)} of {n0(need)} ({pct(s.placedShare)})</span></li>
            <li className="flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: RING.staffed }} /><span className="text-slate-700"><strong>…and a preceptor named</strong> · {n0(s.preceptorsAssigned)} of {n0(s.preceptorShifts)} preceptor-shifts</span></li>
            <li className="flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: RING.ready }} /><span className="text-slate-700"><strong>…and passes every check</strong> · {n0(rd.ready)} ({pct(rd.readyShare)}) — secured agreement, staffed by name, experience confirmed by the site, no conflicts</span></li>
          </ul>
        </div>

        {/* The bars: what you have next to what you need */}
        <div className="space-y-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Seats on the days you need them <span className="font-normal normal-case text-slate-400">— the black line is what you need ({n0(need)})</span></div>
          <Bar label="At the sites that count under your levers" value={have} demand={need} max={max} color={RING.placed} note={`every open asset-shift on the dates and shift blocks your sections fall on (${days}, ${shift}), at sites with ${agreements} within ${ring}, × learners per shift${c.supplySeatsBooked ? `, less ${n0(c.supplySeatsBooked)} seats hand-made bookings already take` : ""}`} />
          <Bar label="…that a preceptor on the roster could cover" value={staffable} demand={need} max={max} color={RING.staffed} estimate note={`the same seats, capped per site and shift by the preceptors on its roster × ${policy.studentsPerPreceptor ? `${policy.studentsPerPreceptor} students each (your Students-per-preceptor lever)` : "each asset's own students-per-preceptor ratio"}`} />
          <Bar label="If every site counted (ignore agreement and drive-ring levers)" value={everySite} demand={need} max={max} color="#94a3b8" note="the same dates and shift blocks at every live site, whatever its agreement or ring — the most the levers could ever unlock" />
          <p className="text-[11px] text-slate-600">
            <strong>What moves these numbers:</strong> <button type="button" onClick={onOpenLevers} className="text-rose-700 underline-offset-2 hover:underline">Sites that count</button> ({agreements}) · <button type="button" onClick={onOpenLevers} className="text-rose-700 hover:underline">Drive ring</button> ({ring}) · <button type="button" onClick={onOpenLevers} className="text-rose-700 hover:underline">Day</button> ({days}) · <button type="button" onClick={onOpenLevers} className="text-rose-700 hover:underline">Shift</button> ({shift}) · <button type="button" onClick={onOpenLevers} className="text-rose-700 hover:underline">Students per preceptor</button> · the window and the offerings chosen. Continuity, balance and variety change <em>where</em> shifts go, not how many seats exist.
            {c.settingsWithoutSupply.length > 0 && <span className="text-rose-700"> No site that counts offers {c.settingsWithoutSupply.join(", ")} at all — those shifts cannot be placed whatever the totals say.</span>}
          </p>
        </div>
      </div>

      {/* What is left over */}
      <div className="mt-4 grid gap-2 text-xs sm:grid-cols-3">
        <div className={`rounded-lg px-3 py-2 ${s.unmetShifts ? "bg-rose-50 text-rose-900" : "bg-emerald-50 text-emerald-900"}`}><div className="text-[10px] uppercase tracking-wide opacity-70">Shifts with no seat</div><div className="text-lg font-bold">{n0(s.unmetShifts)}</div><div className="opacity-80">{s.unmetShifts ? `${signed(c.headroomOnDemandDays)} seats overall — a shortage on particular days, settings or sites; the bottlenecks tab says which` : "every shift found a seat"}</div></div>
        <div className={`rounded-lg px-3 py-2 ${s.preceptorShifts > s.preceptorsAssigned ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-900"}`}><div className="text-[10px] uppercase tracking-wide opacity-70">Placed but nobody to precept</div><div className="text-lg font-bold">{n0(Math.max(0, s.preceptorShifts - s.preceptorsAssigned))}</div><div className="opacity-80">preceptor-shifts with no named preceptor{!policy.requirePreceptor ? " (the Preceptors lever is off, so seats count without one)" : ""}</div></div>
        <div className={`rounded-lg px-3 py-2 ${plan.blockers.some((b) => b.blocking) ? "bg-rose-50 text-rose-900" : "bg-emerald-50 text-emerald-900"}`}><div className="text-[10px] uppercase tracking-wide opacity-70">Would stop an apply</div><div className="text-lg font-bold">{n0(plan.blockers.filter((b) => b.blocking).reduce((n, b) => n + b.shifts, 0))}</div><div className="opacity-80">{plan.blockers.filter((b) => b.blocking).map((b) => b.kind.replace(/-/g, " ")).join(", ") || "nothing"}</div></div>
      </div>

      <button type="button" onClick={() => setExplain((v) => !v)} className="mt-3 text-xs text-slate-500 hover:text-slate-800">{explain ? "▾" : "▸"} How to read this</button>
      {explain && (
        <div className="mt-1 space-y-1 rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
          <p><strong>Learner-shift.</strong> One learner on one clinical shift. A section of 8 students on a Tuesday day shift is 8 learner-shifts. <strong>What you need</strong> is every dated clinical shift of every planned or running offering in the window, at each term&apos;s enrollment target.</p>
          <p><strong>Seat.</strong> A place for one learner on one asset (a unit, a room, a machine) on one shift. A hall that takes 10 learners on Day and Evening, Monday to Friday, offers 100 seats a week.</p>
          <p><strong>Seats on the days you need them.</strong> Seats on days nobody is scheduled cannot be used, so the bars count only the dates and shift blocks your sections fall on. Loosening the Day and Shift levers lets a section land on more of them, so the bar grows.</p>
          <p><strong>The rings</strong> are the plan the engine actually built, as shares of what you need: found a seat → also has a preceptor named → also passes every check. They shrink from outside in; the inner ring is the number that matters.</p>
          <p><strong>Why the bars can say “spare” while the rings say “short”.</strong> Totals hide timing: 1,200 spare seats across the window do not help if 40 students all need a general radiography seat on the same Tuesday. The bottlenecks tab lists exactly which week, setting and site runs out.</p>
        </div>
      )}
    </div>
  );
}
