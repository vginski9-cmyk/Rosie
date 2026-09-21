"use client";

import { useState } from "react";
import { REASON_LABEL, type Plan, type Policy } from "@/lib/scheduler";
import { fmt, dec } from "@/lib/format";

// THE ANSWER IN ONE GLANCE — the share of clinical shifts the plan placed, as the headline; the
// three rings beside it (found a seat → a preceptor named → passes every check); then, only when
// something is short, "why not 100%": each reason with its count and the fix that recovers the most.
// Seats across the window are a footnote here — they are not the same as a seat on the day.

const n0 = (v: number) => dec(v);
const pct = (v: number | null) => (v == null ? "—" : fmt.pct(v));
// The three rings: fixed hues, never reassigned (validated categorical slots 1–3).
const RING = { placed: "#2a78d6", staffed: "#eb6834", ready: "#1baf7a" } as const;
const TRACK = "#e8ecf1";

function Rings({ placed, staffed, ready }: { placed: number; staffed: number; ready: number }) {
  const size = 168, stroke = 16, gap = 5;
  const c = size / 2;
  const rings = [
    { key: "placed", share: placed, r: c - stroke / 2, color: RING.placed },
    { key: "staffed", share: staffed, r: c - stroke * 1.5 - gap, color: RING.staffed },
    { key: "ready", share: ready, r: c - stroke * 2.5 - gap * 2, color: RING.ready },
  ];
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Found a seat ${pct(placed)}, preceptor named ${pct(staffed)}, ready ${pct(ready)}`}>
      {rings.map((r) => { const circ = 2 * Math.PI * r.r; const on = Math.max(0, Math.min(1, r.share)) * circ; return (
        <g key={r.key} transform={`rotate(-90 ${c} ${c})`}>
          <circle cx={c} cy={c} r={r.r} fill="none" stroke={TRACK} strokeWidth={stroke} />
          <circle cx={c} cy={c} r={r.r} fill="none" stroke={r.color} strokeWidth={stroke} strokeDasharray={`${on} ${circ - on}`} strokeLinecap="butt" style={{ transition: "stroke-dasharray 500ms ease" }} />
        </g>); })}
      <text x={c} y={c + 2} textAnchor="middle" dominantBaseline="middle" className="fill-slate-900" style={{ fontSize: 22, fontWeight: 700 }}>{pct(ready)}</text>
      <text x={c} y={c + 22} textAnchor="middle" className="fill-slate-500" style={{ fontSize: 9.5, letterSpacing: 0.4 }}>READY TO RUN</text>
    </svg>
  );
}

function Bar({ label, value, demand, max, color, note }: { label: string; value: number; demand: number; max: number; color: string; note: string }) {
  const w = (v: number) => `${Math.max(0, Math.min(100, (v / Math.max(1, max)) * 100))}%`;
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs"><span className="font-medium text-slate-700">{label}</span><span className="tabular-nums text-slate-600">{n0(value)} seats · {demand > 0 ? `${fmt.mult(value / demand)}×` : "—"} what you need</span></div>
      <div className="relative mt-1 h-3 w-full rounded bg-slate-100">
        <div className="h-3 rounded" style={{ width: w(value), background: color, transition: "width 400ms ease" }} />
        <div className="absolute top-[-3px] h-[18px] w-[2px] bg-slate-900" style={{ left: w(demand) }} aria-hidden />
      </div>
      <div className="mt-0.5 text-[10px] text-slate-500">{note}</div>
    </div>
  );
}

const fmtMY = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

export function SchedulerCapacity({ plan, policy, window, computing, onShowBottlenecks, onOpenLevers }: { plan: Plan; policy: Policy; window: { from: string; to: string }; computing?: boolean; onShowBottlenecks: () => void; onOpenLevers?: () => void }) {
  const s = plan.summary; const c = s.capacity; const rd = s.readiness;
  const [seats, setSeats] = useState(false);
  const need = c.demandSeats;
  const have = Math.max(0, c.supplySeatsOnDemandDays - c.supplySeatsBooked);
  const everySite = c.supplySeatsPhysicalOnDemandDays;
  const staffable = Math.min(have, c.supplySeatsStaffableOnDemandDays);
  const max = Math.max(need, have, everySite, staffable, 1) * 1.08;
  const staffedShare = need ? (s.preceptorsAssigned / Math.max(1, s.preceptorShifts)) * s.placedShare : 0;
  const unstaffed = Math.max(0, s.preceptorShifts - s.preceptorsAssigned);

  // What the plan left unplaced, by reason, with the fix that recovers the most learner-shifts for each.
  const reasons = (() => {
    const m = new Map<string, { seats: number; shifts: number; fixes: Map<string, number> }>();
    for (const u of plan.unmet) { const r = m.get(u.reason) ?? { seats: 0, shifts: 0, fixes: new Map() }; r.seats += u.unit.seats; r.shifts++; for (const f of u.fixes) r.fixes.set(f, (r.fixes.get(f) ?? 0) + u.unit.seats); m.set(u.reason, r); }
    return [...m.entries()].map(([reason, r]) => ({ reason, ...r, bestFix: [...r.fixes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null })).sort((a, b) => b.seats - a.seats);
  })();
  const unmetSeats = reasons.reduce((n, r) => n + r.seats, 0);
  const blocking = plan.blockers.filter((b) => b.blocking);
  const warnings = plan.blockers.filter((b) => !b.blocking);
  const tone = need === 0 ? "text-slate-400" : s.placedShare >= 0.999 ? "text-emerald-700" : s.placedShare >= 0.95 ? "text-amber-700" : "text-rose-700";

  return (
    <div className="space-y-3">
      <div className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ${computing ? "opacity-60" : ""}`}>
        <div className="grid gap-5 md:grid-cols-[168px_1fr] md:items-center">
          <Rings placed={s.placedShare} staffed={staffedShare} ready={rd.readyShare} />
          <div>
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className={`text-5xl font-bold leading-none tabular-nums ${tone}`}>{need === 0 ? "—" : pct(s.placedShare)}</span>
              <span className="text-lg font-semibold text-slate-800">of clinical shifts placed</span>
            </div>
            <p className="mt-1 text-sm text-slate-600">{n0(s.placedSeats)} of {n0(need)} learner-shifts · {fmtMY(window.from)} → {fmtMY(window.to)} · one learner on one shift{policy.requirePreceptor ? " · a shift counts only with a free preceptor" : ""}</p>
            <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
              <li className="flex items-center gap-2"><span className="inline-block h-3 w-3 rounded-full" style={{ background: RING.placed }} /><span className="text-slate-700"><strong className="tabular-nums">{pct(s.placedShare)}</strong> found a seat</span></li>
              <li className="flex items-center gap-2"><span className="inline-block h-3 w-3 rounded-full" style={{ background: RING.staffed }} /><span className="text-slate-700"><strong className="tabular-nums">{pct(s.preceptorShifts ? s.preceptorsAssigned / s.preceptorShifts : null)}</strong> have a preceptor named{unstaffed ? <span className="text-slate-500"> · {n0(unstaffed)} without</span> : null}</span></li>
              <li className="flex items-center gap-2"><span className="inline-block h-3 w-3 rounded-full" style={{ background: RING.ready }} /><span className="text-slate-700"><strong className="tabular-nums">{pct(rd.readyShare)}</strong> ready to run <span className="text-slate-500">— secured site, staffed by name, experience confirmed, no conflicts</span></span></li>
            </ul>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700" title="seats at the sites that count under your levers, on the dates and shift blocks your sections fall on, summed across the window">Seats across the window: <strong className="tabular-nums">{need > 0 ? `${fmt.mult(have / need)}×` : "—"}</strong> what you need</span>
              {c.settingsWithoutSupply.length > 0 && <span className="rounded-full bg-rose-100 px-2.5 py-1 font-medium text-rose-800">No site that counts offers {c.settingsWithoutSupply.join(", ")}</span>}
              <button type="button" onClick={() => setSeats((v) => !v)} className="text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline">{seats ? "hide" : "where the seats come from"}</button>
            </div>
          </div>
        </div>
        {seats && (
          <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
            <Bar label="At the sites that count under your levers" value={have} demand={need} max={max} color={RING.placed} note={`every open asset-shift on the dates and shift blocks your sections fall on, at sites allowed by the Sites and Drive-time levers, × learners per shift${c.supplySeatsBooked ? `, less ${n0(c.supplySeatsBooked)} seats hand-made bookings already take` : ""}. The black line is what you need.`} />
            <Bar label="…that a preceptor on the roster could cover" value={staffable} demand={need} max={max} color={RING.staffed} note={`the same seats, capped per site and shift by the preceptors on its roster × ${policy.studentsPerPreceptor ? `${policy.studentsPerPreceptor} students each` : "each asset's own students-per-preceptor ratio"}`} />
            <Bar label="If every site counted" value={everySite} demand={need} max={max} color="#94a3b8" note="the same dates and shift blocks at every live site, whatever its agreement or drive time — the most the levers could ever unlock" />
            <p className="text-[11px] text-slate-500">Totals across five years hide timing: spare seats in March do not help a Tuesday in September. The list below is what actually binds.</p>
          </div>
        )}
      </div>

      {(unmetSeats > 0 || blocking.length > 0) && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50/40 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">Why not 100%</h3>
            <span className="text-xs text-slate-500">{unmetSeats > 0 ? `${n0(unmetSeats)} learner-shifts unplaced` : "every shift placed"}{blocking.length ? ` · ${n0(blocking.reduce((n, b) => n + b.shifts, 0))} placed shifts would stop an apply` : ""}</span>
          </div>
          <ul className="mt-2 space-y-1.5">
            {reasons.map((r) => (
              <li key={r.reason} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-rose-100">
                <strong className="w-16 shrink-0 tabular-nums text-rose-700">{n0(r.seats)}</strong>
                <span className="text-slate-800">{REASON_LABEL[r.reason as keyof typeof REASON_LABEL]?.split(" — ")[0] ?? r.reason}</span>
                {r.bestFix && <span className="text-xs text-slate-600"><span className="text-slate-400">fix:</span> {r.bestFix}</span>}
                <button type="button" onClick={onShowBottlenecks} className="ml-auto text-xs font-medium text-rose-700 hover:underline">which weeks →</button>
              </li>
            ))}
            {blocking.map((b) => (
              <li key={b.kind} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-rose-200">
                <strong className="w-16 shrink-0 tabular-nums text-rose-700">{n0(b.shifts)}</strong>
                <span className="text-slate-800">{b.label}</span>
                <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-semibold text-white">would stop an apply</span>
                {b.kind === "unprecepted" && <span className="text-xs text-slate-600"><span className="text-slate-400">fix:</span> add preceptors to those sites&apos; rosters{policy.requirePreceptor ? "" : ", or turn the Preceptors lever on to place only what is staffable"}</span>}
                {b.kind === "unsecured-site" && <span className="text-xs text-slate-600"><span className="text-slate-400">fix:</span> secure the agreement, or set Sites that count to secured only</span>}
                {b.kind === "holiday" && <span className="text-xs text-slate-600"><span className="text-slate-400">fix:</span> set Holidays to never on a holiday, or move the shift on Design &amp; sequence</span>}
                {b.examples.length > 0 && <span className="basis-full text-[11px] text-slate-500">e.g. {b.examples.slice(0, 2).join(" · ")}</span>}
              </li>
            ))}
          </ul>
          {warnings.length > 0 && <p className="mt-2 text-[11px] text-slate-500">Noted, not blocking: {warnings.map((b) => `${b.label} (${n0(b.shifts)} shifts)`).join(" · ")}.</p>}
        </div>
      )}
      {unmetSeats === 0 && blocking.length === 0 && need > 0 && (
        <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Every clinical shift is placed, staffed by name, and passes every check under these levers.</p>
      )}
    </div>
  );
}
