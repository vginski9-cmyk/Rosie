import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { addWblFactor, deleteWblFactor, deleteWblProfile } from "@/lib/actions";
import type { WblLayer } from "@/lib/wbl";

export const dynamic = "force-dynamic";

const LAYERS: { key: WblLayer; label: string; hint: string }[] = [
  { key: "MOTIVATION", label: "Motivations", hint: "What this side wants out of the relationship." },
  { key: "CONSTRAINT", label: "Constraints", hint: "What is binding / non-negotiable. Mark binding constraints." },
  { key: "CAPACITY", label: "Capacities", hint: "What this side brings or can offer." },
];

const DISCLOSURE_COLOR: Record<string, string> = {
  STATED: "bg-emerald-100 text-emerald-700",
  INFERRED: "bg-amber-100 text-amber-700",
  HIDDEN: "bg-slate-200 text-slate-600",
  UNKNOWN: "bg-slate-100 text-slate-500",
};

export default async function WblProfilePage({ params }: { params: { id: string } }) {
  const profile = await prisma.wblProfile.findUnique({ where: { id: params.id }, include: { factors: true } });
  if (!profile) notFound();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <Link href="/wbl" className="text-sm text-slate-500 hover:text-slate-700">← WBL alignment</Link>
        <form action={deleteWblProfile.bind(null, profile.id)}><button className="btn-ghost text-rose-600">Delete profile</button></form>
      </div>

      <div>
        <span className={`badge ${profile.subjectType === "LEARNER" ? "bg-sky-100 text-sky-700" : "bg-violet-100 text-violet-700"}`}>{profile.subjectType}</span>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{profile.name}</h1>
        {profile.summary && <p className="text-sm text-slate-500">{profile.summary}</p>}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {LAYERS.map((layer) => {
          const factors = profile.factors.filter((f) => f.layer === layer.key);
          return (
            <div key={layer.key} className="card card-pad">
              <h2 className="font-semibold">{layer.label}</h2>
              <p className="mb-3 text-xs text-slate-400">{layer.hint}</p>
              <div className="space-y-2">
                {factors.map((f) => (
                  <div key={f.id} className="rounded-lg border border-slate-200 p-2">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium">{f.label}</span>
                      <form action={deleteWblFactor.bind(null, f.id, profile.id)}>
                        <button className="text-xs text-slate-300 hover:text-rose-600">✕</button>
                      </form>
                    </div>
                    {f.detail && <p className="text-xs text-slate-500">{f.detail}</p>}
                    <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px]">
                      <span className="text-slate-400">w{f.weight}</span>
                      {f.binding && <span className="badge bg-rose-100 text-rose-700">binding</span>}
                      <span className={`badge ${DISCLOSURE_COLOR[f.disclosure] ?? ""}`}>{f.disclosure.toLowerCase()}</span>
                      {f.matchKey && <span className="text-slate-400">↔ {f.matchKey}</span>}
                    </div>
                  </div>
                ))}
                {factors.length === 0 && <p className="text-xs text-slate-400">None yet.</p>}
              </div>

              {/* Add factor */}
              <form action={addWblFactor.bind(null, profile.id)} className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                <input type="hidden" name="layer" value={layer.key} />
                <input name="label" required placeholder="Factor" className="input-sm" />
                <input name="detail" placeholder="Detail (optional)" className="input-sm" />
                <div className="flex gap-2">
                  <input name="weight" type="number" step="0.1" min="0" defaultValue="1" className="input-sm w-16" title="weight" />
                  <input name="matchKey" placeholder="match key" className="input-sm" title="match key links to the other side" />
                </div>
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-1 text-xs text-slate-500">
                    <input type="checkbox" name="binding" className="accent-rose-600" /> binding
                  </label>
                  <select name="disclosure" className="input-sm w-24">
                    <option value="STATED">stated</option>
                    <option value="INFERRED">inferred</option>
                    <option value="HIDDEN">hidden</option>
                    <option value="UNKNOWN">unknown</option>
                  </select>
                  <button className="btn-primary px-2 py-1 text-xs">Add</button>
                </div>
              </form>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-slate-400">
        Tip: give a learner factor and an employer factor the same <strong>match key</strong> (e.g. <code>daytime hours</code>)
        so the engine pairs them. A binding factor with no counterpart on the other side flags the match as blocked.
      </p>
    </div>
  );
}
