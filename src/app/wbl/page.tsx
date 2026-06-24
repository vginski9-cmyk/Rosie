import Link from "next/link";
import { prisma } from "@/lib/db";
import { createWblProfile } from "@/lib/actions";
import { alignProfiles, type WblProfileInput, type WblLayer } from "@/lib/wbl";
import { fmt } from "@/lib/format";

export const dynamic = "force-dynamic";

const LAYERS: WblLayer[] = ["MOTIVATION", "CONSTRAINT", "CAPACITY"];

export default async function WblPage() {
  const profiles = await prisma.wblProfile.findMany({
    orderBy: [{ subjectType: "asc" }, { name: "asc" }],
    include: { factors: true, institution: { select: { id: true, name: true } } },
  });
  const institutions = await prisma.institution.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });

  const learners = profiles.filter((p) => p.subjectType === "LEARNER");
  const employers = profiles.filter((p) => p.subjectType === "EMPLOYER");

  const toInput = (p: (typeof profiles)[number]): WblProfileInput => ({
    id: p.id,
    subjectType: p.subjectType as "LEARNER" | "EMPLOYER",
    name: p.name,
    factors: p.factors.map((f) => ({ layer: f.layer as WblLayer, label: f.label, detail: f.detail, weight: f.weight, binding: f.binding, disclosure: f.disclosure, matchKey: f.matchKey })),
  });

  // Compute the alignment matrix (within the same institution).
  const pairs = learners.flatMap((l) =>
    employers
      .filter((e) => e.institutionId === l.institutionId)
      .map((e) => ({ learner: l, employer: e, result: alignProfiles(toInput(l), toInput(e)) })),
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">WBL Alignment Engine</h1>
        <p className="mt-1 text-sm text-slate-500">
          Profiles both sides of a work-based-learning relationship across three layers — <strong>motivations</strong>,{" "}
          <strong>constraints</strong>, and <strong>capacities</strong> — and scores how well each learner cohort aligns
          with each employer/clinical partner. Binding constraints that have no counterpart are hard-flagged.
        </p>
      </div>

      {/* Alignment matrix */}
      {pairs.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Alignment</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {pairs
              .sort((a, b) => b.result.score - a.result.score)
              .map(({ learner, employer, result }) => (
                <div key={learner.id + employer.id} className="card card-pad">
                  <div className="flex items-start justify-between">
                    <div className="text-sm">
                      <Link href={`/wbl/${learner.id}`} className="font-semibold text-rose-700 hover:underline">{learner.name}</Link>
                      <span className="text-slate-400"> × </span>
                      <Link href={`/wbl/${employer.id}`} className="font-semibold text-rose-700 hover:underline">{employer.name}</Link>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-semibold">{fmt.pct(result.score)}</div>
                      <span className={`badge ${result.feasible ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>
                        {result.feasible ? "Feasible" : "Blocked"}
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-2">
                    {LAYERS.map((layer) => (
                      <div key={layer} className="rounded-lg bg-slate-50 p-2 text-center">
                        <div className="text-[10px] uppercase tracking-wide text-slate-400">{layer.toLowerCase()}</div>
                        <div className="text-lg font-semibold">{fmt.pct(result.layers[layer].score)}</div>
                        <div className="text-[10px] text-slate-400">{result.layers[layer].matched.length} matched</div>
                      </div>
                    ))}
                  </div>

                  {result.unmetBinding.length > 0 && (
                    <div className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">
                      <strong>Dealbreaker:</strong>{" "}
                      {result.unmetBinding.map((u) => `${u.side === "LEARNER" ? "Learner" : "Employer"} needs "${u.factor.label}"`).join("; ")} — no counterpart on the other side.
                    </div>
                  )}

                  {result.layers.MOTIVATION.matched.length > 0 && (
                    <div className="mt-3 text-xs text-slate-500">
                      <span className="font-medium text-slate-600">Aligned wants:</span>{" "}
                      {result.layers.MOTIVATION.matched.map((m) => m.learner.label).join(", ")}
                    </div>
                  )}
                </div>
              ))}
          </div>
        </section>
      )}

      {/* Profiles + create */}
      <section className="grid gap-6 lg:grid-cols-2">
        <ProfileColumn title="Learner profiles" profiles={learners} />
        <ProfileColumn title="Employer profiles" profiles={employers} />
      </section>

      <details className="card card-pad">
        <summary className="cursor-pointer text-sm font-medium text-rose-700">+ Add a profile</summary>
        <form action={createWblProfile.bind(null, institutions[0]?.id ?? "")} className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Side</span>
            <select name="subjectType" className="input">
              <option value="LEARNER">Learner</option>
              <option value="EMPLOYER">Employer</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Name</span>
            <input name="name" required placeholder="e.g. Surgical Tech Cohort 2029" className="input" />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-sm font-medium">Summary</span>
            <input name="summary" className="input" />
          </label>
          <div className="sm:col-span-2"><button className="btn-primary">Create profile</button></div>
        </form>
      </details>
    </div>
  );
}

function ProfileColumn({ title, profiles }: { title: string; profiles: { id: string; name: string; tier: string | null; factors: unknown[] }[] }) {
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      {profiles.map((p) => (
        <Link key={p.id} href={`/wbl/${p.id}`} className="card card-pad block transition-shadow hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="font-medium">{p.name}</span>
            <span className="text-xs text-slate-400">{p.factors.length} factors</span>
          </div>
          {p.tier && <div className="text-xs text-slate-500">{p.tier}</div>}
        </Link>
      ))}
      {profiles.length === 0 && <p className="text-sm text-slate-400">None yet.</p>}
    </div>
  );
}
