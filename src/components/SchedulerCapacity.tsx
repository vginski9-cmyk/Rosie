"use client";

import { REASON_LABEL, type Plan, type Policy } from "@/lib/scheduler";
import { fmt, dec } from "@/lib/format";

// THE ANSWER IN ONE GLANCE — an estimate of clinical supply against demand under the levers. Nothing
// is placed by looking: the engine tries every shift against every site's seats to find out how many
// COULD be placed. The headline is that share; the rings beside it (a seat available → a preceptor
// available → ready to run); demand against supply drawn as bars, always in view; then, only when
// something is short, "why not 100%": each reason with its count and the fix that recovers the most.

const n0 = (v: number) => dec(v);
const pct = (v: number | null) => (v == null ? "—" : fmt.pct(v));
// The three rings: fixed hues, never reassigned (validated categorical slots 1–3).
const RING = { placed: "#2a78d6", staffed: "#eb6834", ready: "#1baf7a" } as const;
const TRACK = "#e8ecf1";

function Rings({ placed, staffed, ready }: { placed: number; staffed: number; ready: number }) {
  const size = 232, stroke = 20, gap = 6;
  const c = size / 2;
  const rings = [
    { key: "placed", share: placed, r: c - stroke / 2, color: RING.placed },
    { key: "staffed", share: staffed, r: c - stroke * 1.5 - gap, color: RING.staffed },
    { key: "ready", share: ready, r: c - stroke * 2.5 - gap * 2, color: RING.ready },
  ];
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`A seat available ${pct(placed)}, a preceptor available ${pct(staffed)}, ready to run ${pct(ready)}`}>
      {rings.map((r) => { const circ = 2 * Math.PI * r.r; const on = Math.max(0, Math.min(1, r.share)) * circ; return (
        <g key={r.key} transform={`rotate(-90 ${c} ${c})`}>
          <circle cx={c} cy={c} r={r.r} fill="none" stroke={TRACK} strokeWidth={stroke} />
          <circle cx={c} cy={c} r={r.r} fill="none" stroke={r.color} strokeWidth={stroke} strokeDasharray={`${on} ${circ - on}`} strokeLinecap="butt" style={{ transition: "stroke-dasharray 500ms ease" }} />
        </g>); })}
      <text x={c} y={c - 2} textAnchor="middle" dominantBaseline="middle" className="fill-slate-900" style={{ fontSize: 26, fontWeight: 700, letterSpacing: -0.5 }}>{pct(ready)}</text>
      <text x={c} y={c + 20} textAnchor="middle" className="fill-slate-500" style={{ fontSize: 10, letterSpacing: 0.6 }}>READY TO RUN</text>
    </svg>
  );
}

/** Demand against supply, as lengths: the demand bar is the yardstick, each supply bar is read against it. */
function SupplyChart({ need, rows }: { need: number; rows: { label: string; value: number; color: string; note: string }[] }) {
  const max = Math.max(need, ...rows.map((r) => r.value), 1);
  const w = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
  return (
    <div className="space-y-2">
      <div>
        <div className="flex items-baseline justify-between text-xs"><span className="font-semibold text-slate-900">Demand — clinical learner-shifts to place</span><span className="tabular-nums font-semibold text-slate-900">{n0(need)}</span></div>
        <div className="relative mt-1 h-3.5 w-full rounded bg-slate-100"><div className="h-3.5 rounded bg-slate-900" style={{ width: w(need), transition: "width 400ms ease" }} /></div>
      </div>
      {rows.map((r) => (
        <div key={r.label}>
          <div className="flex items-baseline justify-between text-xs"><span className="font-medium text-slate-700" title={r.note}>{r.label}</span><span className="tabular-nums text-slate-700">{n0(r.value)} <span className="text-slate-500">· {need > 0 ? `${fmt.mult(r.value / need)}×` : "—"}</span></span></div>
          <div className="relative mt-1 h-3.5 w-full rounded bg-slate-100">
            <div className="h-3.5 rounded" style={{ width: w(r.value), background: r.color, transition: "width 400ms ease" }} />
            <div className="absolute top-[-3px] h-[20px] w-[2px] bg-slate-900" style={{ left: w(need) }} aria-hidden title="demand" />
          </div>
        </div>
      ))}
      <p className="text-[10px] leading-snug text-slate-500">Seats on the dates and shift blocks the sections fall on, summed over the window. A total above demand does not mean every day fits — the share on the left is what does.</p>
    </div>
  );
}

const fmtMY = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

export function SchedulerCapacity({ plan, policy, window, computing, mode = "diagnostic", onShowBottlenecks, onOpenLevers }: { plan: Plan; policy: Policy; window: { from: string; to: string }; computing?: boolean; /** diagnostic: a supply estimate, nothing is written; operational: the plan can be applied. */ mode?: "diagnostic" | "operational"; onShowBottlenecks: () => void; onOpenLevers?: () => void }) {
  const s = plan.summary; const c = s.capacity; const rd = s.readiness;
  const need = c.demandSeats;
  const have = Math.max(0, c.supplySeatsOnDemandDays - c.supplySeatsBooked);
  const everySite = c.supplySeatsPhysicalOnDemandDays;
  const staffable = Math.min(have, c.supplySeatsStaffableOnDemandDays);
  const staffedShare = need ? (s.preceptorsAssigned / Math.max(1, s.preceptorShifts)) * s.placedShare : 0;
  const unstaffed = Math.max(0, s.preceptorShifts - s.preceptorsAssigned);

  // What could not be placed, by reason, with the fix that recovers the most learner-shifts for each.
  const reasons = (() => {
    const m = new Map<string, { seats: number; shifts: number; fixes: Map<string, number> }>();
    for (const u of plan.unmet) { const r = m.get(u.reason) ?? { seats: 0, shifts: 0, fixes: new Map() }; r.seats += u.unit.seats; r.shifts++; for (const f of u.fixes) r.fixes.set(f, (r.fixes.get(f) ?? 0) + u.unit.seats); m.set(u.reason, r); }
    return [...m.entries()].map(([reason, r]) => ({ reason, ...r, bestFix: [...r.fixes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null })).sort((a, b) => b.seats - a.seats);
  })();
  const unmetSeats = reasons.reduce((n, r) => n + r.seats, 0);
  const blocking = plan.blockers.filter((b) => b.blocking);
  // Which supervision roles the placed and unplaced sessions actually require — the remedy names those roles only.
  const rolesNeeded = { instructor: [...plan.assignments.map((x) => x.unit), ...plan.unmet.map((u) => u.unit)].some((u) => u.facultyNeeded >= 1), preceptor: [...plan.assignments.map((x) => x.unit), ...plan.unmet.map((u) => u.unit)].some((u) => u.preceptorsNeeded > 0) };
  const warnings = plan.blockers.filter((b) => !b.blocking);
  const tone = need === 0 ? "text-slate-400" : s.placedShare >= 0.999 ? "text-emerald-700" : s.placedShare >= 0.95 ? "text-amber-700" : "text-rose-700";
  const notReady = mode === "operational" ? "would stop an apply" : "not ready to run";

  return (
    <div className="space-y-3">
      <div className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ${computing ? "opacity-60" : ""}`}>
        <div className="grid gap-6 lg:grid-cols-[232px_1fr_minmax(280px,38%)] lg:items-center">
          <Rings placed={s.placedShare} staffed={staffedShare} ready={rd.readyShare} />
          <div>
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className={`text-6xl font-bold leading-none tabular-nums ${tone}`}>{need === 0 ? "—" : pct(s.placedShare)}</span>
            </div>
            <div className="mt-1 text-xl font-semibold text-slate-800">of clinical shifts can be placed</div>
            <p className="mt-1 text-sm text-slate-600">{n0(s.placedSeats)} of {n0(need)} learner-shifts have a seat under these levers · {fmtMY(window.from)} → {fmtMY(window.to)}. An estimate of clinical supply; nothing is written.</p>
            <ul className="mt-3 space-y-1.5 text-sm">
              <li className="flex items-center gap-2"><span className="inline-block h-3 w-3 shrink-0 rounded-full" style={{ background: RING.placed }} /><span className="text-slate-700"><strong className="tabular-nums">{pct(s.placedShare)}</strong> have a seat available</span></li>
              <li className="flex items-center gap-2"><span className="inline-block h-3 w-3 shrink-0 rounded-full" style={{ background: RING.staffed }} /><span className="text-slate-700"><strong className="tabular-nums">{pct(s.preceptorShifts ? s.preceptorsAssigned / s.preceptorShifts : null)}</strong> of those also have a preceptor available{unstaffed ? <span className="text-slate-500"> · {n0(unstaffed)} do not</span> : null}</span></li>
              <li className="flex items-center gap-2"><span className="inline-block h-3 w-3 shrink-0 rounded-full" style={{ background: RING.ready }} /><span className="text-slate-700"><strong className="tabular-nums">{pct(rd.readyShare)}</strong> ready to run <span className="text-slate-500">— secured site, preceptor named, experience confirmed, no conflicts</span></span></li>
            </ul>
          </div>
          <SupplyChart need={need} rows={[
            { label: "Supply at the sites that count", value: have, color: RING.placed, note: "every open asset-shift on the dates and shift blocks the sections fall on, at sites allowed by the Sites and Drive-time levers, × learners per shift" },
            { label: "…that a preceptor could cover", value: staffable, color: RING.staffed, note: `the same seats, capped per site and shift by the preceptors on its roster × ${policy.studentsPerPreceptor ? `${policy.studentsPerPreceptor} students each` : "each asset's own students-per-preceptor ratio"}` },
            { label: "Supply if every site counted", value: everySite, color: "#94a3b8", note: "the same dates and shift blocks at every live site, whatever its agreement or drive time — the most the levers could ever unlock" },
          ]} />
        </div>
        {c.settingsWithoutSupply.length > 0 && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800">No site that counts offers {c.settingsWithoutSupply.join(", ")} — those shifts cannot be placed whatever the totals say.</p>}
      </div>

      {(unmetSeats > 0 || blocking.length > 0) && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50/40 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">Why not 100%</h3>
            <span className="text-xs text-slate-500">{unmetSeats > 0 ? `${n0(unmetSeats)} learner-shifts have no seat` : "every shift has a seat"}{blocking.length ? ` · ${n0(blocking.reduce((n, b) => n + b.shifts, 0))} seated shifts ${notReady}` : ""}</span>
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
              <li key={b.kind} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-amber-200">
                <strong className="w-16 shrink-0 tabular-nums text-amber-700">{n0(b.shifts)}</strong>
                <span className="text-slate-800">{b.label.replace(/^placed /, "seated ")}</span>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">{notReady}</span>
                {b.kind === "unprecepted" && <span className="text-xs text-slate-600"><span className="text-slate-400">fix:</span> {rolesNeeded.instructor && !rolesNeeded.preceptor ? "assign a qualified college instructor to each clinical group (Staffing)" : rolesNeeded.preceptor && !rolesNeeded.instructor ? `add preceptors to those sites' rosters${policy.requirePreceptor ? "" : ", or turn the Preceptors lever on to count only what is staffable"}` : `assign college instructors to instructor-led groups and add preceptors to sites for precepted sessions${policy.requirePreceptor ? "" : " (the Preceptors lever counts only what is staffable)"}`}{onOpenLevers && <> · <button type="button" onClick={onOpenLevers} className="font-medium text-amber-700 hover:underline">levers ↑</button></>}</span>}
                {b.kind === "unsecured-site" && <span className="text-xs text-slate-600"><span className="text-slate-400">fix:</span> secure the agreement, or set Sites that count to secured only</span>}
                {b.kind === "holiday" && <span className="text-xs text-slate-600"><span className="text-slate-400">fix:</span> set Holidays to never on a holiday, or move the shift on Design &amp; sequence</span>}
                {b.kind === "requirement-unreviewed" && <span className="text-xs text-slate-600"><span className="text-slate-400">fix:</span> review the rotation&apos;s setting rule (Clinical site capacity → rotations) — the placements are conditional until a person confirms the interpretation</span>}
                {b.kind === "setting-rule-unmet" && <span className="text-xs text-slate-600"><span className="text-slate-400">fix:</span> the rotation&apos;s minimum, no-mixing or one-site rule is not met by these placements — add seats in the required setting or confirm the rule</span>}
                {b.examples.length > 0 && <span className="basis-full text-[11px] text-slate-500">e.g. {b.examples.slice(0, 2).join(" · ")}</span>}
              </li>
            ))}
          </ul>
          {warnings.length > 0 && <p className="mt-2 text-[11px] text-slate-500">Noted, not blocking: {warnings.map((b) => `${b.label} (${n0(b.shifts)} shifts)`).join(" · ")}.</p>}
        </div>
      )}
      {unmetSeats === 0 && blocking.length === 0 && need > 0 && (
        <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Every clinical shift has a seat, {rolesNeeded.preceptor ? "a preceptor" : "an instructor"}, and passes every check under these levers.</p>
      )}
      {need > 0 && <EvaluationPanel ev={plan.evaluation} />}
    </div>
  );
}

const KIND_CHIP: Record<string, { label: string; cls: string }> = { conflict: { label: "conflict", cls: "bg-rose-100 text-rose-800" }, gap: { label: "evidence gap", cls: "bg-amber-100 text-amber-800" }, assumption: { label: "assumption", cls: "bg-sky-100 text-sky-800" } };

/** THE SAME JUDGEMENT EVERY VIEW READS — pass / fail / unknown per placement with reason codes, counted by unique
 *  placement and by occurrence, conflicts apart from evidence gaps, and the assumptions the run was made under. */
function EvaluationPanel({ ev }: { ev: Plan["evaluation"] }) {
  const s = ev.summary; const c = ev.contract;
  return (
    <details className="rounded-2xl border border-slate-200 bg-white p-4">
      <summary className="cursor-pointer text-sm font-semibold text-slate-900">Every check, one judgement <span className="font-normal text-slate-500">— {n0(s.placements)} placements: {n0(s.pass)} pass · {n0(s.conflictPlacements)} with a conflict · {n0(s.gapOnlyPlacements)} waiting on evidence only{s.notApplicable ? ` · ${n0(s.notApplicable)} not applicable` : ""}</span></summary>
      <p className="mt-1 text-[11px] text-slate-500">Each placement is judged on requirement, setting, capability, access, capacity, availability, supervision and readiness — pass, fail, unknown or not applicable. Any fail → fail; else any unknown → unknown. A conflict is demonstrated; an evidence gap is not a proof either way. Counts: unique placements first, occurrences (one placement can carry several reasons) second.</p>
      {s.byCode.length > 0 && (
        <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200 text-xs">
          {s.byCode.slice(0, 12).map((t) => (
            <li key={t.code} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-1.5">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${KIND_CHIP[t.kind].cls}`}>{KIND_CHIP[t.kind].label}</span>
              <span className="font-mono text-[10px] text-slate-400">{t.code}</span>
              <span className="text-slate-800">{t.text}</span>
              <span className="ml-auto tabular-nums text-slate-600">{n0(t.placements)} placement{t.placements === 1 ? "" : "s"} · {n0(t.occurrences)} occurrence{t.occurrences === 1 ? "" : "s"}</span>
              {t.remediation && <span className="basis-full text-[11px] text-slate-600"><span className="text-slate-400">fix:</span> {t.remediation.href ? <a href={t.remediation.href} className="text-rose-700 hover:underline">{t.remediation.label}</a> : t.remediation.label}{t.examples[0] ? <span className="text-slate-400"> · e.g. {t.examples[0]}</span> : null}</span>}
            </li>
          ))}
          {s.byCode.length > 12 && <li className="px-3 py-1 text-[11px] text-slate-400">and {n0(s.byCode.length - 12)} more codes</li>}
        </ul>
      )}
      {ev.recommendations.length > 0 && (
        <div className="mt-2 text-xs">
          <div className="font-semibold text-slate-800">In order of the binding constraint</div>
          <ol className="mt-0.5 list-decimal space-y-0.5 pl-5 text-slate-700">{ev.recommendations.slice(0, 6).map((r, i) => <li key={i}>{r.label} <span className="text-slate-500">— {r.because}{r.proven ? "" : " (a recommendation, not a proof)"}</span></li>)}</ol>
        </div>
      )}
      <p className="mt-2 text-[11px] text-slate-500"><span className="font-semibold text-slate-600">Assumptions this run was made under:</span> {c.assumptions.join(" · ")}. <span className="font-semibold text-slate-600">Rules read:</span> {c.requirementVersions.length ? c.requirementVersions.join("; ") : "none"}. <span className="font-semibold text-slate-600">Inputs:</span> {c.inputVersion}. <span className="font-semibold text-slate-600">Counting:</span> {c.unit}; {c.population}. {c.complete ? "The evaluation finished." : "The evaluation did not finish — nothing here is a proof."}</p>
    </details>
  );
}
