import Link from "next/link";
import { notFound } from "next/navigation";
import { getProgramFull, getProgramOfferings, getCalendarProvenance } from "@/lib/queries";
import { duplicateProgram, deleteProgram, createOffering } from "@/lib/actions";
import { fmt } from "@/lib/format";
import { ProvisionalDatesBanner } from "@/components/Evidence";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// OFFERINGS — every run of this program, one row each. Open a row for its dates, staffing,
// rotations and students.

const STATUS: Record<string, string> = { active: "bg-emerald-100 text-emerald-700", planned: "bg-sky-100 text-sky-700", completed: "bg-slate-200 text-slate-600", archived: "bg-slate-100 text-slate-400" };
const STATUS_LABEL: Record<string, string> = { active: "in program", planned: "planned", completed: "graduated", archived: "archived" };
const dateOf = (d: Date | null) => (d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—");

export default async function ProgramPage({ params }: { params: { id: string } }) {
  const program = await getProgramFull(params.id);
  if (!program) notFound();
  const [offerings, provenance, campuses] = await Promise.all([getProgramOfferings(params.id), getCalendarProvenance(program.institutionId), prisma.campus.findMany({ where: { institutionId: program.institutionId }, orderBy: [{ isMain: "desc" }, { name: "asc" }], select: { id: true, name: true, city: true, isMain: true } })]);
  const northStar = program.yearTargets.find((t) => t.credentialTarget != null);
  const defaultEnrollment = Math.round(program.defaultCohortSeats ?? northStar?.cohortCapacity ?? 40);

  return (
    <div className="space-y-6">
      <ProvisionalDatesBanner provenance={provenance.all} />
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
          <h2 className="text-lg font-semibold text-slate-900">Offerings <span className="text-sm font-normal text-slate-400">— each run of this program</span></h2>
          <div className="flex flex-wrap gap-2 text-xs">
            <a href={`/api/programs/${program.id}/export?enrollment=${defaultEnrollment}`} className="btn-ghost text-xs">Export Excel ↓</a>
            <form action={duplicateProgram.bind(null, program.id)}><button className="btn-ghost text-xs">Duplicate</button></form>
            <form action={deleteProgram.bind(null, program.id)}><button className="btn-ghost text-xs text-rose-600">Delete</button></form>
          </div>
        </div>
        {offerings.length === 0 ? (
          <p className="px-5 py-4 text-sm text-slate-400">No offerings yet — create one below, or lock one in from <Link href={`/programs/${program.id}/goal`} className="text-rose-700 hover:underline">Goal &amp; pipeline</Link>.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-2">Offering</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Starts</th><th className="px-3 py-2">Where</th><th className="px-3 py-2">Terms dated</th><th className="px-3 py-2 text-right">Goal</th><th className="px-3 py-2 text-right">Enrolled</th><th className="px-3 py-2" /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {offerings.map((o) => {
                const enrolled = o.stages.find((s) => s.stageKey === "enrolled");
                const productive = o.stages.find((s) => s.stageKey === "productive");
                return (
                  <tr key={o.id} className="hover:bg-slate-50/60">
                    <td className="px-5 py-2"><Link href={`/programs/${program.id}/offerings/${o.id}`} className="font-medium text-slate-800 hover:text-rose-700 hover:underline">{o.name}</Link></td>
                    <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS[o.status] ?? "bg-slate-100 text-slate-600"}`}>{STATUS_LABEL[o.status] ?? o.status}</span></td>
                    <td className="px-3 py-2 text-slate-600">{dateOf(o.startDate)}</td>
                    <td className="px-3 py-2 text-slate-600">{o.campus?.name ?? <span className="text-slate-300">—</span>}{o.locationNote ? <span className="block text-[10px] text-slate-400">{o.locationNote}</span> : null}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-600">{o.cohortTerms.length} of {program.terms.length}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700" title={fmt.calcTitle(productive?.targetNumber, fmt.atLeastPhrase(productive?.targetNumber))}>{fmt.num(productive?.targetNumber ?? 0)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700" title={fmt.calcTitle(enrolled?.targetNumber, `target ${fmt.atLeastPhrase(enrolled?.targetNumber)}`)}>{fmt.num(enrolled?.actualNumber ?? o._count.students)}</td>
                    <td className="px-3 py-2 text-right"><a href={`/api/offerings/${o.id}/rotations`} className="text-xs text-slate-500 hover:text-rose-700" title="every clinical course's rotation schedule as a workbook">rotations ↓</a></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <form action={createOffering.bind(null, program.id)} className="flex flex-wrap items-end gap-2 border-t border-slate-100 px-5 py-3">
          <label className="block"><span className="mb-0.5 block text-[10px] uppercase tracking-wide text-slate-400">Start date</span><input name="startDate" type="date" required className="input-sm w-40" /></label>
          <label className="block"><span className="mb-0.5 block text-[10px] uppercase tracking-wide text-slate-400">Where</span><select name="campusId" className="input-sm w-48"><option value="">— not set —</option>{campuses.map((c) => <option key={c.id} value={c.id}>{c.name}{c.city && !c.name.includes(c.city) ? ` · ${c.city}` : ""}</option>)}</select></label>
          <label className="block"><span className="mb-0.5 block text-[10px] uppercase tracking-wide text-slate-400">Building / room</span><input name="locationNote" placeholder="optional" className="input-sm w-40" /></label>
          <label className="block"><span className="mb-0.5 block text-[10px] uppercase tracking-wide text-slate-400">Name</span><input name="name" placeholder="blank = named for you" className="input-sm w-44" /></label>
          <button className="btn-primary text-sm">+ Create offering</button>
        </form>
      </section>
      <p className="text-xs text-slate-500"><Link href={`/programs/${program.id}/structure`} className="text-rose-700 hover:underline">Design &amp; sequence</Link> holds the template these offerings run: {program.terms.length} term{program.terms.length === 1 ? "" : "s"}, {program.terms.reduce((n, t) => n + t.courses.length, 0)} courses.</p>
    </div>
  );
}
