import Link from "next/link";
import { notFound } from "next/navigation";
import { getFamily, getFamilyInterventions } from "@/lib/queries";
import { createFamilyProgram, duplicateProgram } from "@/lib/actions";
import { InterventionBoard } from "@/components/InterventionBoard";

export const dynamic = "force-dynamic";

const CRED_BADGE: Record<string, string> = { AAS: "bg-rose-100 text-rose-700", Diploma: "bg-violet-100 text-violet-700", Certificate: "bg-sky-100 text-sky-700", Cert: "bg-sky-100 text-sky-700", Other: "bg-slate-100 text-slate-600" };
const STATUS_BADGE: Record<string, string> = { active: "bg-emerald-100 text-emerald-700", planned: "bg-sky-100 text-sky-700", completed: "bg-slate-200 text-slate-600", archived: "bg-slate-100 text-slate-400" };
const gradYearOf = (name: string): number => { const m = name.match(/(20\d{2})/); return m ? Number(m[1]) : 0; };

export default async function FamilyDesignPage({ params }: { params: { id: string } }) {
  const [data, iv] = await Promise.all([getFamily(params.id), getFamilyInterventions(params.id)]);
  if (!data || !iv) notFound();
  const { family } = data;
  const homeYear = new Date().getUTCFullYear();
  const targetFor = (p: (typeof family.programs)[number], y: number) => p.yearTargets.find((t) => t.year === y)?.credentialTarget ?? 0;

  const credGroups = (() => {
    const m = new Map<string, { credential: string; expected: number; programs: { p: (typeof family.programs)[number]; running: number; expected: number }[] }>();
    for (const p of family.programs) {
      const cred = p.credential || "Other";
      const running = p.cohorts.filter((c) => c.status === "active" || c.status === "planned").length;
      const e = m.get(cred) ?? { credential: cred, expected: 0, programs: [] };
      e.expected += targetFor(p, homeYear);
      e.programs.push({ p, running, expected: targetFor(p, homeYear) });
      m.set(cred, e);
    }
    return [...m.values()].sort((a, b) => b.expected - a.expected || a.credential.localeCompare(b.credential));
  })();

  return (
    <div className="space-y-8">
      <div>
        <Link href={`/families/${family.id}`} className="text-sm text-slate-500 hover:text-slate-700">← {family.name}</Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Program design &amp; pathways</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          How this family delivers toward {family.occupation?.title ?? family.name}: the delivery models (credential + term
          structures) people move through, and the pipeline interventions — sequenced per partner lane and target
          population — that fill them. Design the structures, then design who gets into them and how.
        </p>
      </div>

      {/* New delivery model */}
      <section className="rounded-xl border border-rose-200 bg-rose-50/40 p-4">
        <h2 className="text-sm font-semibold text-slate-700">+ New delivery model</h2>
        <p className="text-[11px] text-slate-400">Creates a template (a credential + N-term structure) under this goal, then opens its designer to plan courses &amp; sessions.</p>
        <form action={createFamilyProgram.bind(null, family.id)} className="mt-2 flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Name</span>
            <input name="name" required placeholder="e.g. Evening Track" className="w-52 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Credential</span>
            <select name="credential" className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
              <option>AAS</option><option>Diploma</option><option>Certificate</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Program type</span>
            <input name="programType" defaultValue="Traditional Full Time" className="w-44 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Terms</span>
            <input name="terms" type="number" min={1} max={12} defaultValue={4} className="w-16 rounded-lg border border-slate-300 px-2.5 py-1.5 text-right text-sm tabular-nums" />
          </label>
          <button className="rounded-lg bg-rose-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-rose-700">Create delivery model</button>
        </form>
      </section>

      {credGroups.map((g) => (
        <section key={g.credential} className="rounded-xl border border-slate-200 bg-slate-50/40 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${CRED_BADGE[g.credential] ?? CRED_BADGE.Other}`}>{g.credential}</span>
              <span className="text-xs text-slate-500">{g.programs.length} delivery model{g.programs.length === 1 ? "" : "s"}</span>
            </div>
            <span className="text-sm tabular-nums text-slate-600"><strong className="text-slate-800">{g.expected}</strong> productive / yr expected</span>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {g.programs.map(({ p, running, expected }) => (
              <div key={p.id} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <Link href={`/programs/${p.id}`} className="font-semibold text-slate-800 hover:text-rose-700 hover:underline">{p.name}</Link>
                    <div className="text-xs text-slate-500">{p._count.terms}-term structure · {expected} productive/yr · {running} running · {p.cohorts.length} total offerings</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Link href={`/programs/${p.id}/structure`} className="rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-medium text-rose-700 hover:bg-rose-100">Design ↦</Link>
                    <form action={duplicateProgram.bind(null, p.id)}><button className="rounded-full border border-slate-200 px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-50" title="duplicate this delivery model">Duplicate</button></form>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {p.cohorts.sort((a, b) => gradYearOf(a.name) - gradYearOf(b.name)).map((co) => (
                    <Link key={co.id} href={`/programs/${p.id}/offerings/${co.id}`} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_BADGE[co.status] ?? "bg-slate-100 text-slate-600"}`}>{co.name}</Link>
                  ))}
                  {p.cohorts.length === 0 && <span className="text-[11px] text-slate-400">no instantiations yet</span>}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      {/* Pathways in: pipeline interventions per target population */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Pipeline interventions — by partner lane &amp; target population</h2>
          <p className="max-w-3xl text-sm text-slate-500">
            The pathways INTO these delivery models: awareness → readiness → application → WBL → supports → retention,
            sequenced per lane with named owners, priority populations, and cost bands. Stage columns show the live funnel
            count each column is trying to move.
          </p>
        </div>
        <InterventionBoard
          familyId={family.id}
          interventions={iv.interventions.map((i) => ({
            id: i.id, lane: i.lane, stage: i.stage, title: i.title, description: i.description,
            populations: i.populations, owner: i.owner, status: i.status, sequence: i.sequence,
            estCostLow: i.estCostLow, estCostHigh: i.estCostHigh, targetStageKey: i.targetStageKey,
          }))}
          funnel={iv.funnel}
          funnelTarget={iv.funnelTarget}
        />
      </section>
    </div>
  );
}
