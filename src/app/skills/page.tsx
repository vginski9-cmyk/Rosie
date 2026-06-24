import Link from "next/link";
import { prisma } from "@/lib/db";
import { createSkill } from "@/lib/actions";

export const dynamic = "force-dynamic";

const TYPE_COLOR: Record<string, string> = {
  KNOWLEDGE: "bg-sky-100 text-sky-700",
  SKILL: "bg-violet-100 text-violet-700",
  ABILITY: "bg-amber-100 text-amber-700",
};

export default async function SkillsPage() {
  const [skills, institutions] = await Promise.all([
    prisma.skill.findMany({
      orderBy: [{ category: "asc" }, { name: "asc" }],
      include: { institution: { select: { name: true, shortName: true } }, descriptors: true, _count: { select: { programSkills: true, courseSkills: true } } },
    }),
    prisma.institution.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const byCategory = new Map<string, typeof skills>();
  for (const s of skills) {
    const key = s.category ?? "Uncategorized";
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key)!.push(s);
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Skill library (KSAs)</h1>
        <p className="mt-1 text-sm text-slate-500">
          {skills.length} Knowledge / Skills / Abilities. Each has a definition, a context-of-use, and per-level
          proficiency descriptors on the shared scale. Map them to programs and courses to set graduate benchmarks.
        </p>
      </div>

      <details className="card card-pad">
        <summary className="cursor-pointer text-sm font-medium text-rose-700">+ Add a new skill</summary>
        <form action={createSkill.bind(null, institutions[0]?.id ?? "")} className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-1">
            <span className="mb-1 block text-sm font-medium">Name</span>
            <input name="name" required placeholder="e.g. Agile Methodology" className="input" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Type</span>
              <select name="type" defaultValue="SKILL" className="input">
                <option value="KNOWLEDGE">Knowledge</option>
                <option value="SKILL">Skill</option>
                <option value="ABILITY">Ability</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Category</span>
              <input name="category" placeholder="Technical" className="input" />
            </label>
          </div>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-sm font-medium">Definition</span>
            <textarea name="definition" rows={2} className="input" />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-sm font-medium">How the skill is used (context)</span>
            <textarea name="howUsed" rows={2} className="input" />
          </label>
          <div className="sm:col-span-2">
            <button type="submit" className="btn-primary">Create skill</button>
          </div>
        </form>
      </details>

      {[...byCategory.entries()].map(([category, list]) => (
        <section key={category} className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{category}</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {list.map((s) => (
              <Link key={s.id} href={`/skills/${s.id}`} className="card card-pad block transition-shadow hover:shadow-md">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold leading-tight">{s.name}</h3>
                  <span className={`badge ${TYPE_COLOR[s.type] ?? "bg-slate-100 text-slate-600"}`}>{s.type}</span>
                </div>
                {s.definition && <p className="mt-2 line-clamp-3 text-xs text-slate-500">{s.definition}</p>}
                <div className="mt-3 flex gap-3 text-[11px] text-slate-400">
                  <span>{s.descriptors.length} levels defined</span>
                  <span>{s._count.programSkills} programs</span>
                  <span>{s._count.courseSkills} courses</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
