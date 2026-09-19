import Link from "next/link";
import { getInstitutionsHome, getInstitutionsLite } from "@/lib/queries";
import { getExecutiveSummary, type TargetAtRisk, type TargetStatus } from "@/lib/executive";
import { deleteNorthStarGoal } from "@/lib/actions";
import { NewGoalForm } from "@/components/NewGoalForm";
import { fmt } from "@/lib/format";

export const dynamic = "force-dynamic";

// HOME (Phase 13) — the executive view. Six questions, each answered from the saved scenarios and
// the workforce targets: which targets are at risk, the expected shortfall, what binds, which
// interventions are worth the most, which evidence gaps weaken confidence, and what changed. The
// operational blocker queue lives under Setup → Exceptions; only its count shows here.

const STATUS: Record<TargetStatus, { label: string; chip: string; hint: string }> = {
  "at-risk": { label: "at risk", chip: "bg-rose-600 text-white", hint: "the current plan falls short of the target and no recommended scenario closes the gap in time" },
  unassessed: { label: "not assessed", chip: "bg-amber-100 text-amber-800", hint: "no scenario has been evaluated for this target — the shortfall is unknown, not zero" },
  covered: { label: "covered by a scenario", chip: "bg-sky-100 text-sky-800", hint: "the recommended scenario closes the gap by the target year, if it is done" },
  "no-target": { label: "no target", chip: "bg-slate-100 text-slate-600", hint: "no North Star goal is set for the target year" },
  "on-track": { label: "on track", chip: "bg-emerald-100 text-emerald-800", hint: "the current plan meets the target" },
};
const money = (v: number | null | undefined) => (v == null ? "—" : `$${fmt.num(v)}`);
const dateOf = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const CRED_BADGE: Record<string, string> = {
  AAS: "bg-rose-100 text-rose-700", BSN: "bg-fuchsia-100 text-fuchsia-700", Diploma: "bg-violet-100 text-violet-700",
  Certificate: "bg-sky-100 text-sky-700", Cert: "bg-sky-100 text-sky-700", Other: "bg-slate-100 text-slate-600",
};

function TargetRow({ t }: { t: TargetAtRisk }) {
  const s = STATUS[t.status];
  const href = t.programId ? `/programs/${t.programId}/expand` : "/scenarios";
  return (
    <tr className="align-top">
      <td className="px-3 py-2">
        <Link href={t.programId ? `/programs/${t.programId}/goal` : "/programs"} className="font-medium text-slate-800 hover:text-rose-700 hover:underline">{t.job}</Link>
        <div className="text-[11px] text-slate-500">{t.institution}{t.program ? ` · ${t.program}` : ""}</div>
      </td>
      <td className="px-3 py-2 text-right tabular-nums">{t.target != null ? fmt.num(t.target) : <span className="text-slate-400">—</span>}</td>
      <td className="px-3 py-2 text-right tabular-nums" title="productive workers from the offerings already planned or running whose cohort graduates in the target year, as the expansion engine measured them — 0 means no planned cohort graduates that year">{t.baseline != null ? fmt.num(t.baseline) : <span className="text-slate-400" title="not measured — evaluate a scenario">?</span>}</td>
      <td className="px-3 py-2 text-right tabular-nums">{t.expectedShortfall != null ? <span className={t.expectedShortfall > 0 ? "font-semibold text-rose-700" : "text-emerald-700"}>{fmt.num(t.expectedShortfall)}</span> : <span className="text-slate-400" title="unknown until a scenario is evaluated">?</span>}</td>
      <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${s.chip}`} title={s.hint}>{s.label}</span></td>
      <td className="px-3 py-2 text-xs text-slate-600">
        {t.chosen?.evaluated ? (
          <>
            <Link href={href} className="font-medium text-slate-800 hover:text-rose-700 hover:underline">{t.chosen.name}</Link>
            <span className="text-slate-400"> · {t.chosen.kindLabel}{t.chosen.status === "recommended" ? " · recommended" : ""}</span>
            <div>{t.chosen.binding ? <>binds on <strong>{t.chosen.binding.label.toLowerCase()}</strong>{t.chosen.binding.shortfall != null ? ` — ${fmt.dec(t.chosen.binding.shortfall)} ${t.chosen.binding.unit} short` : ""}</> : t.chosen.feasibleInTime ? "nothing binds — feasible in time" : "feasible, but not by the target year"}{t.shortfallAfter != null && t.shortfallAfter > 0 ? <span className="text-rose-700"> · {fmt.num(t.shortfallAfter)} still short after it</span> : null}</div>
          </>
        ) : t.scenarios > 0 ? <Link href={href} className="text-rose-700 hover:underline">{fmt.num(t.scenarios)} scenario{t.scenarios === 1 ? "" : "s"} saved, none evaluated →</Link>
          : t.programId ? <Link href={href} className="text-rose-700 hover:underline">open a scenario →</Link> : <span className="text-slate-400">no program yet</span>}
      </td>
    </tr>
  );
}

export default async function HomePage() {
  const [x, institutions, lite] = await Promise.all([getExecutiveSummary(), getInstitutionsHome(), getInstitutionsLite()]);
  const thisYear = new Date().getUTCFullYear();
  const atRisk = x.targets.filter((t) => t.status === "at-risk").length;
  const unassessed = x.targets.filter((t) => t.status === "unassessed").length;
  const shortfall = x.targets.reduce((n, t) => n + (t.expectedShortfall ?? 0), 0);
  const measured = x.targets.filter((t) => t.expectedShortfall != null).length;
  const exceptionsTotal = x.exceptions.blockers + x.exceptions.warnings + x.exceptions.notes;
  const years = [thisYear, thisYear + 1, thisYear + 2, thisYear + 3];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Workforce targets, {x.targetYear}</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            Can each program meet its workforce target? What binds, what would it cost to lift, and how sure are we. Answers come from the saved scenarios; a target without an evaluated scenario is <em>not assessed</em>, never assumed fine.
          </p>
        </div>
        <NewGoalForm institutions={lite} />
      </div>

      {/* The headline tiles */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-3"><div className="text-[10px] font-semibold uppercase tracking-wide text-rose-800">Targets at risk</div><div className="text-2xl font-bold tabular-nums text-rose-800">{fmt.num(atRisk)}</div><div className="text-[11px] text-rose-900/70">of {fmt.num(x.targets.length)} targets · {fmt.num(unassessed)} not assessed</div></div>
        <div className="rounded-xl border border-slate-200 bg-white p-3"><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Expected shortfall</div><div className="text-2xl font-bold tabular-nums text-slate-900">{measured ? fmt.num(shortfall) : "?"}</div><div className="text-[11px] text-slate-500">productive workers a year, across the {fmt.num(measured)} measured target{measured === 1 ? "" : "s"}</div></div>
        <div className="rounded-xl border border-slate-200 bg-white p-3"><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Binding constraints</div><div className="text-2xl font-bold tabular-nums text-slate-900">{fmt.num(x.binding.length)}</div><div className="text-[11px] text-slate-500">{x.binding[0] ? `most often: ${x.binding[0].label.split(" — ")[0].toLowerCase()}` : "none measured yet"}</div></div>
        <div className="rounded-xl border border-slate-200 bg-white p-3"><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Scenarios</div><div className="text-2xl font-bold tabular-nums text-slate-900">{fmt.num(x.scenarios.evaluated)}</div><div className="text-[11px] text-slate-500">evaluated of {fmt.num(x.scenarios.total)} saved · {fmt.num(x.scenarios.recommended)} recommended · <Link href="/scenarios" className="text-rose-700 hover:underline">all →</Link></div></div>
        <div className="rounded-xl border border-slate-200 bg-white p-3"><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Operational exceptions</div><div className="text-2xl font-bold tabular-nums text-slate-900">{fmt.num(exceptionsTotal)}</div><div className="text-[11px] text-slate-500">{fmt.num(x.exceptions.blockers)} blockers · {fmt.num(x.exceptions.warnings)} warnings · <Link href="/setup/exceptions" className="text-rose-700 hover:underline">Setup → Exceptions →</Link></div></div>
      </div>

      {/* 1 + 2 · Targets at risk and the expected shortfall */}
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-5 py-3">
          <h2 className="text-lg font-semibold text-slate-900">Targets and expected shortfall</h2>
          <span className="text-xs text-slate-500">productive workers a year by {x.targetYear} · the baseline is what the offerings already planned yield in that year (0 = none planned to graduate then) · the shortfall is target − baseline</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2">Job · program</th><th className="px-3 py-2 text-right">Target</th><th className="px-3 py-2 text-right">Baseline</th><th className="px-3 py-2 text-right">Shortfall</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">The answer rests on</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{x.targets.map((t) => <TargetRow key={t.familyId} t={t} />)}</tbody>
          </table>
          {x.targets.length === 0 && <p className="px-5 py-4 text-sm text-slate-400">No workforce targets yet — add a North Star goal above.</p>}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* 3 · Binding constraints */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">What binds</h2>
          <p className="text-xs text-slate-500">The first thing that runs out in each program&apos;s chosen scenario — the root constraint, not the operational rows beneath it.</p>
          {x.binding.length === 0 ? <p className="mt-3 text-sm text-slate-400">Nothing measured yet — evaluate a scenario for each program.</p> : (
            <ul className="mt-3 space-y-2">
              {x.binding.map((b) => (
                <li key={b.kind} className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
                  <div className="flex items-baseline justify-between gap-2"><span className="text-sm font-medium text-slate-800">{b.label}</span><span className="text-xs tabular-nums text-slate-500">{fmt.num(b.programs.length)} program{b.programs.length === 1 ? "" : "s"}</span></div>
                  <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                    {b.programs.map((p) => <li key={p.programId + p.scenario}><Link href={`/programs/${p.programId}/expand`} className="font-medium text-slate-700 hover:text-rose-700 hover:underline">{p.program}</Link> <span className="text-slate-400">({p.institution})</span>{p.shortfall != null ? <> — <span className="tabular-nums">{fmt.dec(p.shortfall)} {p.unit}</span> short{p.where ? ` ${p.where}` : ""}</> : null}{p.fix ? <span className="text-slate-500"> · fix: {p.fix}</span> : null}{p.evidence !== "verified" ? <span className="ml-1 rounded bg-amber-50 px-1 text-[10px] text-amber-800">{p.evidence}</span> : null}</li>)}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 4 · Highest-value interventions */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Highest-value interventions</h2>
          <p className="text-xs text-slate-500">Feasible scenarios, cheapest per additional placed worker first. Costs are registry figures; an amber share means unverified assumptions behind it.</p>
          {x.interventions.length === 0 ? <p className="mt-3 text-sm text-slate-400">No feasible scenario evaluated yet.</p> : (
            <table className="mt-3 w-full text-xs">
              <thead className="text-left text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="py-1">Scenario</th><th className="py-1 text-right">+ workers / yr</th><th className="py-1 text-right">$ / placed</th><th className="py-1 text-right">Recurring / yr</th><th className="py-1 text-right">Confidence</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {x.interventions.map((s) => (
                  <tr key={s.id}>
                    <td className="py-1.5"><Link href={`/programs/${s.programId}/expand`} className="font-medium text-slate-800 hover:text-rose-700 hover:underline">{s.name}</Link><div className="text-[11px] text-slate-500">{s.program} · {s.institution} · {s.kindLabel}{s.status === "recommended" ? " · recommended" : ""}{s.feasibleInTime === false ? " · not by the target year" : ""}</div></td>
                    <td className="py-1.5 text-right tabular-nums">{fmt.num(s.additionalAnnualProductive)}</td>
                    <td className="py-1.5 text-right tabular-nums">{money(s.perAdditionalPlaced)}</td>
                    <td className="py-1.5 text-right tabular-nums">{money(s.recurring)}</td>
                    <td className="py-1.5 text-right tabular-nums"><span className={s.unverified.length ? "text-amber-700" : "text-emerald-700"}>{fmt.pct(s.confidenceShare)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* 5 · Evidence gaps */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Evidence gaps affecting confidence</h2>
          <p className="text-xs text-slate-500">Unverified assumptions, provisional calendars and estimated site figures behind the answers above.</p>
          {x.evidence.length === 0 ? <p className="mt-3 text-sm text-emerald-700">Every input behind the chosen scenarios is verified.</p> : (
            <ul className="mt-3 space-y-1 text-xs">
              {x.evidence.slice(0, 12).map((g, i) => <li key={i} className="flex flex-wrap items-baseline gap-x-2 rounded-lg border border-slate-100 px-2.5 py-1.5"><span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${g.kind === "stale" ? "bg-rose-100 text-rose-800" : g.kind === "risk" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"}`}>{g.kind}</span><Link href={g.href} className="font-medium text-slate-800 hover:text-rose-700 hover:underline">{g.label}</Link><span className="text-slate-500">{g.detail}</span></li>)}
              {x.evidence.length > 12 && <li className="text-slate-500">{fmt.num(x.evidence.length - 12)} more under <Link href="/setup" className="text-rose-700 hover:underline">Setup → Evidence review</Link>.</li>}
            </ul>
          )}
        </section>

        {/* 6 · Recent material changes */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Recent material changes</h2>
          <p className="text-xs text-slate-500">Scenarios saved or evaluated, assumptions changed, plans applied, program designs edited — the last 60 days.</p>
          {x.recent.length === 0 ? <p className="mt-3 text-sm text-slate-400">Nothing in the last 60 days.</p> : (
            <ul className="mt-3 space-y-1 text-xs">
              {x.recent.map((c, i) => <li key={i} className="flex flex-wrap items-baseline gap-x-2"><span className="tabular-nums text-slate-400">{dateOf(c.when)}</span><Link href={c.href} className="font-medium text-slate-800 hover:text-rose-700 hover:underline">{c.what}</Link>{c.where && <span className="text-slate-500">{c.where}</span>}</li>)}
            </ul>
          )}
        </section>
      </div>

      {/* The goals themselves, by college — the targets the table above is measured against. */}
      <section className="rounded-2xl border border-slate-200 bg-slate-50/60 p-5">
        <h2 className="text-sm font-semibold text-slate-700">North Star goals by college</h2>
        <p className="text-xs text-slate-500">Fully productive workers wanted each year, per target job; the programs delivering toward each.</p>
        <div className="mt-3 space-y-3">
          {institutions.map((inst) => (
            <div key={inst.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="font-semibold text-slate-900">{inst.name}</h3><span className="text-xs text-slate-500">{fmt.num(inst.thisYearGoal)} as the {thisYear} goal · {inst.families.length} target job{inst.families.length === 1 ? "" : "s"} · {inst.programs} program{inst.programs === 1 ? "" : "s"} · <Link href={`/orgs/${inst.id}`} className="text-rose-600 hover:underline">setup →</Link></span></div>
              {inst.families.length === 0 && <p className="mt-2 text-xs text-slate-400">No target jobs yet — add a North Star goal above.</p>}
              <div className="mt-2 divide-y divide-slate-100">
                {inst.families.map((f) => (
                  <div key={f.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-xs">
                    <div className="min-w-[200px]"><Link href={f.programs[0] ? `/programs/${f.programs[0].id}/goal` : "/programs"} className="text-sm font-medium text-slate-800 hover:text-rose-700 hover:underline">{f.job}</Link><div className="text-[11px] text-slate-500">{f.name}{f.socCode ? ` · SOC ${f.socCode}` : ""}</div></div>
                    <div className="flex items-end gap-1">{years.map((y) => <div key={y} className={`rounded px-1.5 py-0.5 text-center ${y === thisYear ? "bg-slate-800 text-white" : "bg-slate-50 text-slate-700"}`}><div className="text-sm font-bold tabular-nums leading-tight">{fmt.num(f.goalsByYear[y] ?? 0)}</div><div className="text-[9px] opacity-70">{y}</div></div>)}</div>
                    <div className="flex flex-wrap gap-1">{f.programs.map((p) => <Link key={p.id} href={`/programs/${p.id}`} className="rounded-full bg-slate-50 px-2 py-0.5 ring-1 ring-slate-200 hover:ring-rose-300"><span className="font-medium text-slate-700">{p.name}</span> <span className={`rounded px-1 text-[9px] ${CRED_BADGE[p.credential ?? "Other"] ?? CRED_BADGE.Other}`}>{p.credential ?? "—"}</span></Link>)}</div>
                    <form action={deleteNorthStarGoal.bind(null, f.id)} className="ml-auto"><button className="rounded p-1 text-slate-300 hover:text-rose-600" title="clear this North Star goal (the job family, its sites and records stay)">✕</button></form>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
