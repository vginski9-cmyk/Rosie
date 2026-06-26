import Link from "next/link";
import { getNorthStarHome, getInstitutionsLite } from "@/lib/queries";
import { deleteNorthStarGoal } from "@/lib/actions";
import { NewGoalForm } from "@/components/NewGoalForm";
import { fmt } from "@/lib/format";

export const dynamic = "force-dynamic";

const CRED_BADGE: Record<string, string> = {
  AAS: "bg-rose-100 text-rose-700", Diploma: "bg-violet-100 text-violet-700",
  Certificate: "bg-sky-100 text-sky-700", Cert: "bg-sky-100 text-sky-700", Other: "bg-slate-100 text-slate-600",
};

export default async function HomePage() {
  const [jobs, institutions] = await Promise.all([getNorthStarHome(), getInstitutionsLite()]);
  const thisYear = jobs[0]?.thisYear ?? new Date().getUTCFullYear();
  const lastYear = thisYear - 1;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">North Star goals</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            For every target job: the fully-productive workers the region needs this year ({thisYear}), what was delivered last
            year ({lastYear}), and progress toward the goal. Open a job to see the program families delivering toward it.
          </p>
        </div>
        <NewGoalForm institutions={institutions} />
      </div>

      {jobs.length === 0 && <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-400">No jobs with goals yet.</p>}

      <div className="grid gap-5 lg:grid-cols-2">
        {jobs.map((j) => {
          const pct = j.progress != null ? Math.min(1, j.progress) : null;
          const onTrack = j.progress != null && j.progress >= 0.9;
          return (
            <div key={j.familyId} className="card card-pad space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Link href={`/families/${j.familyId}`} className="text-lg font-semibold text-slate-800 hover:text-rose-700 hover:underline">{j.job} ↦</Link>
                  <p className="text-xs text-slate-500">{j.socCode ? `SOC ${j.socCode} · ` : ""}{j.institution}</p>
                </div>
                <div className="flex items-start gap-2">
                  <div className="text-right">
                    <div className="text-3xl font-bold tabular-nums text-slate-900">{fmt.num(j.thisYearGoal)}</div>
                    <div className="text-[11px] uppercase tracking-wide text-slate-400">{thisYear} goal · productive</div>
                  </div>
                  <form action={deleteNorthStarGoal.bind(null, j.familyId)}>
                    <button className="rounded p-1 text-xs text-slate-300 hover:text-rose-600" title="delete this North Star goal">✕</button>
                  </form>
                </div>
              </div>

              {/* Progress: last year's delivery toward this year's goal */}
              <div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">{lastYear} delivered: <strong className="text-slate-700">{fmt.num(j.lastYearActual)}</strong></span>
                  <span className={onTrack ? "font-medium text-emerald-600" : "font-medium text-amber-600"}>
                    {j.progress != null ? `${Math.round(j.progress * 100)}% of ${thisYear} goal` : "—"}
                  </span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className={`h-full rounded-full ${onTrack ? "bg-emerald-500" : "bg-rose-400"}`} style={{ width: `${pct != null ? pct * 100 : 0}%` }} />
                </div>
              </div>

              {/* Credential breakdown — who delivers toward the job */}
              <div className="space-y-1.5 border-t border-slate-100 pt-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Delivered by</div>
                {j.credentials.map((c) => (
                  <div key={c.credential} className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${CRED_BADGE[c.credential] ?? CRED_BADGE.Other}`}>{c.credential}</span>
                      <span className="text-slate-400">{c.programs.length} template{c.programs.length === 1 ? "" : "s"} · {c.instantiations} running</span>
                    </span>
                    <span className="tabular-nums text-slate-600"><strong className="text-slate-800">{fmt.num(c.expected)}</strong> / yr</span>
                  </div>
                ))}
                {j.credentials.length === 0 && <p className="text-xs text-slate-400">No credentials configured.</p>}
              </div>

              <Link href={`/families/${j.familyId}`} className="block text-xs text-rose-600 hover:underline">open job →</Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}
