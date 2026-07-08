import Link from "next/link";
import { notFound } from "next/navigation";
import { getFamilyAlignment } from "@/lib/queries";
import {
  cohortRollup, computeQuadrant, recommendModes, pairing,
  type Profile, type Tag,
} from "@/lib/alignment";
import { requestPlacement } from "@/lib/actions";

export const dynamic = "force-dynamic";

const QUAD_BADGE: Record<string, string> = { Q1: "bg-emerald-100 text-emerald-800", Q2: "bg-amber-100 text-amber-800", Q3: "bg-sky-100 text-sky-800", Q4: "bg-rose-100 text-rose-800" };
const TONE_BADGE: Record<string, string> = { good: "bg-emerald-100 text-emerald-800", workable: "bg-amber-100 text-amber-800", caution: "bg-rose-100 text-rose-800" };

const toProfile = (side: "LEARNER" | "EMPLOYER", tags: { layer: string; code: string; tier: number | null; binding: boolean; conditionalOn: string | null; note: string | null }[]): Profile => ({
  side,
  tags: tags.map((t): Tag => ({ layer: t.layer as Tag["layer"], code: t.code, tier: t.tier, binding: t.binding, conditionalOn: t.conditionalOn, note: t.note })),
});

export default async function FamilyWblStudioPage({ params }: { params: { id: string } }) {
  const data = await getFamilyAlignment(params.id);
  if (!data) notFound();
  const { family, learnerProfiles, employerProfiles, unprofiled } = data;

  const learners = learnerProfiles.filter((p) => p.student).map((p) => ({ profile: toProfile("LEARNER", p.tags), student: p.student! }));
  const employers = employerProfiles.filter((p) => p.employer).map((p) => ({ profile: toProfile("EMPLOYER", p.tags), employer: p.employer! }));
  const rollup = cohortRollup(learners.map((l) => l.profile));

  // Best pairing per learner: score = fewest gaps, prefer "good".
  const pairings = learners.map((l) => {
    const scored = employers.map((e) => ({ e, r: pairing(l.profile, e.profile) }))
      .sort((a, b) => a.r.gaps.length - b.r.gaps.length);
    return { l, best: scored[0] ?? null, alternatives: scored.slice(1, 3) };
  });

  return (
    <div className="space-y-8">
      <div>
        <Link href={`/families/${family.id}`} className="text-sm text-slate-500 hover:text-slate-700">← {family.name}</Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">WBL design studio — {family.name}</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          The cohort&apos;s motivations, constraints, and capacities put together — because the pooled picture is what
          drives clinical design, employer asks, and support services. Profiles come from the structured intakes on each
          learner and partner; everything below recomputes as intakes are added.
        </p>
      </div>

      {/* Cohort rollup */}
      <section className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-700">Cohort positioning</h2>
          <p className="text-[11px] text-slate-400">{rollup.n} learner{rollup.n === 1 ? "" : "s"} profiled · {employers.length} partner{employers.length === 1 ? "" : "s"} profiled</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {Object.entries(rollup.quadrants).sort().map(([q, n]) => (
              <span key={q} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${QUAD_BADGE[q]}`}>{q} × {n}</span>
            ))}
            {rollup.n === 0 && <span className="text-[12px] text-slate-400">No intakes yet — start from the worklist below.</span>}
          </div>
          {rollup.drivingByFamily.length > 0 && (
            <div className="mt-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">What&apos;s driving (Tier 1), by family</div>
              <div className="mt-1 space-y-1">
                {rollup.drivingByFamily.map((d) => (
                  <div key={d.family} className="flex items-center justify-between text-[12px]"><span className="text-slate-600">{d.label}</span><span className="tabular-nums font-medium text-slate-800">{d.count}</span></div>
                ))}
              </div>
            </div>
          )}
          {rollup.bindingCounts.length > 0 && (
            <div className="mt-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Binding constraints (count · share)</div>
              <div className="mt-1 space-y-1">
                {rollup.bindingCounts.slice(0, 8).map((b) => (
                  <div key={b.code} className="flex items-center justify-between gap-2 text-[12px]">
                    <span className="truncate text-slate-600">{b.label}</span>
                    <span className="shrink-0 tabular-nums text-slate-500">{b.count} · {Math.round(b.share * 100)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-700">Clinical design implications</h2>
          <p className="text-[11px] text-slate-400">what the pooled constraints demand of rotation design</p>
          <ul className="mt-2 space-y-2 text-[12px] text-slate-600">
            {rollup.clinicalDesign.map((c, i) => <li key={i} className="rounded-lg bg-slate-50 p-2">{c}</li>)}
            {rollup.clinicalDesign.length === 0 && <li className="text-slate-400">Profile learners to see design implications.</li>}
          </ul>
          <h3 className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Mode demand (top recommendation per learner)</h3>
          <div className="mt-1 space-y-1">
            {rollup.modeDemand.map((m) => (
              <div key={m.key} className="flex items-center justify-between text-[12px]"><span className="text-slate-600">{m.label}</span><span className="tabular-nums font-medium text-slate-800">{m.count}</span></div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-700">Employer asks &amp; support services</h2>
          <p className="text-[11px] text-slate-400">what to ask partners for · what to stand up in-house</p>
          <ul className="mt-2 space-y-2 text-[12px] text-slate-600">
            {rollup.employerAsks.map((a, i) => <li key={i} className="rounded-lg bg-rose-50/60 p-2">{a}</li>)}
          </ul>
          <div className="mt-3 space-y-1.5">
            {rollup.supportServices.map((s, i) => (
              <div key={i} className="rounded-lg bg-slate-50 p-2 text-[12px]">
                <span className="font-medium text-slate-700">{s.service}</span>
                <span className="text-slate-400"> — {s.count} learner{s.count === 1 ? "" : "s"} ({s.because})</span>
              </div>
            ))}
            {rollup.supportServices.length === 0 && <p className="text-[12px] text-slate-400">No binding constraints pooled yet.</p>}
          </div>
        </div>
      </section>

      {/* Profiled learners + best-fit pairings */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Learners &amp; best-fit placements</h2>
          <p className="text-sm text-slate-500">Each profiled learner with their computed position, top viable mode, and the partner pairing with the fewest structural gaps.</p>
        </div>
        <div className="space-y-2">
          {pairings.map(({ l, best }) => {
            const q = computeQuadrant(l.profile);
            const topMode = recommendModes(l.profile).find((m) => !m.struck && m.signals > 0);
            return (
              <div key={l.student.id} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/students/${l.student.id}/alignment`} className="text-sm font-semibold text-slate-800 hover:text-rose-700 hover:underline">{l.student.name}</Link>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${QUAD_BADGE[q.quadrant]}`}>{q.quadrant} · {q.name}</span>
                  {l.student.cohort && <span className="text-[11px] text-slate-400">{l.student.cohort.name}</span>}
                  {topMode && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">→ {topMode.mode.label}{topMode.variantNotes.length ? " (evening/weekend)" : ""}</span>}
                </div>
                {best && (
                  <div className="mt-1.5 text-[12px]">
                    <span className={`mr-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${TONE_BADGE[best.r.tone]}`}>{best.r.tone}</span>
                    <Link href={`/employers/${best.e.employer.id}/alignment`} className="font-medium text-slate-700 hover:text-rose-700 hover:underline">{best.e.employer.name}</Link>
                    <span className="text-slate-500"> — {best.r.headline}</span>
                    <form action={requestPlacement.bind(null, l.student.id, best.e.employer.id, family.id)} className="mt-1 inline-block">
                      <button className="rounded-full bg-rose-600 px-2.5 py-0.5 text-[10px] font-medium text-white hover:bg-rose-700" title="creates a PLANNED placement (the ask); the partner confirming it makes it secured">Request placement →</button>
                    </form>
                    {best.r.gaps.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {best.r.gaps.map((g, i) => <li key={i} className="text-[11px] text-amber-700">⚑ {g}</li>)}
                      </ul>
                    )}
                  </div>
                )}
                {!best && <p className="mt-1 text-[11px] text-slate-400">No partners profiled yet — run a partner intake to see pairings.</p>}
              </div>
            );
          })}
          {pairings.length === 0 && <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-400">No learner intakes yet.</p>}
        </div>
      </section>

      {/* Profiled partners */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Profiled partners</h2>
          <p className="text-sm text-slate-500">Each partner&apos;s computed position and what they can genuinely host.</p>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          {employers.map((e) => {
            const q = computeQuadrant(e.profile);
            const hostable = recommendModes(e.profile).filter((m) => !m.struck && m.signals > 0);
            return (
              <div key={e.employer.id} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/employers/${e.employer.id}/alignment`} className="text-sm font-semibold text-slate-800 hover:text-rose-700 hover:underline">{e.employer.name}</Link>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${QUAD_BADGE[q.quadrant]}`}>{q.quadrant} · {q.name}</span>
                </div>
                {e.employer.setting && <div className="text-[11px] text-slate-400">{e.employer.setting}</div>}
                <div className="mt-1 flex flex-wrap gap-1">
                  {hostable.map((m) => <span key={m.mode.key} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">{m.mode.label}</span>)}
                  {hostable.length === 0 && <span className="text-[11px] text-slate-400">no clear hosting signals yet</span>}
                </div>
              </div>
            );
          })}
          {employers.length === 0 && <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-400 md:col-span-2">No partner intakes yet — open a partner and run the alignment intake.</p>}
        </div>
      </section>

      {/* Intake worklist */}
      {unprofiled.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold">Intake worklist</h2>
            <p className="text-sm text-slate-500">Active learners in this family without an alignment intake yet.</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {unprofiled.map((s) => (
              <Link key={s.id} href={`/students/${s.id}/alignment`} className="rounded-full bg-white px-2.5 py-1 text-[12px] text-slate-600 ring-1 ring-slate-200 hover:text-rose-700 hover:ring-rose-200">
                {s.name}{s.cohort ? ` · ${s.cohort.name}` : ""}
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
