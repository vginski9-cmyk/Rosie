import Link from "next/link";
import { getSemesterView } from "@/lib/queries";
import { InsightsTabs } from "@/components/InsightsTabs";
import { fmt } from "@/lib/format";

export const dynamic = "force-dynamic";

const SEM_BADGE: Record<string, string> = {
  Spring: "bg-emerald-100 text-emerald-700",
  Summer: "bg-amber-100 text-amber-700",
  Fall: "bg-orange-100 text-orange-700",
};

export default async function SemesterPage({ searchParams }: { searchParams: { sem?: string; year?: string } }) {
  const { options, selected, offerings } = await getSemesterView(searchParams.sem, searchParams.year ? Number(searchParams.year) : undefined);

  // Group the selected semester's offerings by institution → family.
  const byInst = new Map<string, Map<string, typeof offerings>>();
  for (const o of offerings) {
    if (!byInst.has(o.institution)) byInst.set(o.institution, new Map());
    const fam = o.family ?? "Other programs";
    const m = byInst.get(o.institution)!;
    if (!m.has(fam)) m.set(fam, []);
    m.get(fam)!.push(o);
  }

  const totals = offerings.reduce(
    (acc, o) => ({ fac: acc.fac + o.facultyFte, prec: acc.prec + o.preceptorFte, seats: acc.seats + o.enrollment, sections: acc.sections + o.sections }),
    { fac: 0, prec: 0, seats: 0, sections: 0 },
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Insights</h1>
        <p className="text-sm text-slate-500">Aggregate or disaggregate every program&apos;s pipeline and delivery — explore the full table, or zoom into one term.</p>
      </div>
      <InsightsTabs />
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Semester</h2>
        <p className="max-w-3xl text-sm text-slate-500">
          Zoom into one term and see <strong>every offering running across all programs side by side</strong> — what&apos;s in
          session, how many seats, and the combined staffing footprint. Pick a semester to compare the load.
        </p>
      </div>

      {/* Semester selector */}
      <div className="flex flex-wrap gap-1.5">
        {options.length === 0 && <p className="text-sm text-slate-400">No dated offerings yet.</p>}
        {options.map((o) => {
          const active = selected?.sem === o.sem && selected?.year === o.year;
          return (
            <Link
              key={`${o.year}-${o.sem}`}
              href={`/semester?sem=${o.sem}&year=${o.year}`}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ${active ? "bg-rose-600 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"}`}
            >
              {o.sem} {o.year} <span className={active ? "text-rose-100" : "text-slate-400"}>· {o.count}</span>
            </Link>
          );
        })}
      </div>

      {selected && (
        <>
          {/* Semester totals */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Offerings in session" value={String(offerings.length)} />
            <Stat label="Seats" value={fmt.num(totals.seats)} />
            <Stat label="Faculty FTE" value={totals.fac.toFixed(2)} hint="combined across all programs" />
            <Stat label="Preceptor FTE" value={totals.prec.toFixed(2)} hint={`${totals.sections} sections`} />
          </div>

          {/* Offerings grouped by institution → family */}
          {[...byInst.entries()].map(([inst, fams]) => (
            <section key={inst} className="space-y-3">
              <h2 className="text-lg font-semibold">{inst}</h2>
              {[...fams.entries()].map(([fam, list]) => {
                const famId = list[0]?.familyId;
                return (
                  <div key={fam} className="rounded-xl border border-slate-200 bg-slate-50/40 p-4">
                    <div className="mb-2 flex items-center gap-2">
                      {famId ? (
                        <Link href={`/families/${famId}`} className="font-semibold text-slate-800 hover:text-rose-700 hover:underline">{fam} ↦</Link>
                      ) : <span className="font-semibold text-slate-500">{fam}</span>}
                      <span className="text-xs text-slate-400">{list.length} offering{list.length === 1 ? "" : "s"} in session</span>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {list.map((o) => (
                        <div key={o.cohortId + o.termName} className="rounded-lg border border-slate-200 bg-white p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <Link href={`/programs/${o.programId}/offerings/${o.cohortId}`} className="text-sm font-semibold text-slate-800 hover:text-rose-700 hover:underline">{o.cohortName}</Link>
                              <div className="text-[11px] text-slate-500">{o.programName}</div>
                            </div>
                            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${SEM_BADGE[selected.sem]}`}>{o.termName}</span>
                          </div>
                          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                            <Mini label="Seats" value={String(o.enrollment)} />
                            <Mini label="Fac FTE" value={o.facultyFte.toFixed(2)} />
                            <Mini label="Prec FTE" value={o.preceptorFte.toFixed(2)} />
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {o.courses.map((c) => (
                              <Link key={c.id} href={`/courses/${c.id}`} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-rose-100 hover:text-rose-700" title={`${c.sessions} sessions`}>{c.name}</Link>
                            ))}
                          </div>
                          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                            <span>{o.sections} sections · {fmt.num(o.spaceHours)} space hrs</span>
                            <Link href={`/programs/${o.programId}/offerings/${o.cohortId}/schedule`} className="text-rose-600 hover:underline">schedule →</Link>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </section>
          ))}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{value}</div>
      {hint && <div className="text-[11px] text-slate-400">{hint}</div>}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-slate-50 py-1">
      <div className="text-sm font-semibold tabular-nums text-slate-800">{value}</div>
      <div className="text-[9px] uppercase tracking-wide text-slate-400">{label}</div>
    </div>
  );
}
