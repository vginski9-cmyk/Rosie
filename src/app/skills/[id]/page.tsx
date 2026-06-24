import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getProficiencyScale } from "@/lib/queries";
import { updateSkill, duplicateSkill, deleteSkill, upsertDescriptor } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function SkillPage({ params }: { params: { id: string } }) {
  const skill = await prisma.skill.findUnique({
    where: { id: params.id },
    include: { descriptors: { orderBy: { level: "asc" } }, programSkills: { include: { program: true } } },
  });
  if (!skill) notFound();
  const scale = await getProficiencyScale(skill.institutionId);
  const descByLevel = new Map(skill.descriptors.map((d) => [d.level, d.descriptor]));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <Link href="/skills" className="text-sm text-slate-500 hover:text-slate-700">← Skill library</Link>
        <div className="flex gap-2">
          <form action={duplicateSkill.bind(null, skill.id)}><button className="btn-ghost">Duplicate</button></form>
          <form action={deleteSkill.bind(null, skill.id)}><button className="btn-ghost text-rose-600">Delete</button></form>
        </div>
      </div>

      {/* Edit core fields */}
      <form action={updateSkill.bind(null, skill.id)} className="card card-pad space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-sm font-medium">Name</span>
            <input name="name" defaultValue={skill.name} className="input" />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Type</span>
            <select name="type" defaultValue={skill.type} className="input">
              <option value="KNOWLEDGE">Knowledge</option>
              <option value="SKILL">Skill</option>
              <option value="ABILITY">Ability</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Category</span>
            <input name="category" defaultValue={skill.category ?? ""} className="input" />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-sm font-medium">Definition</span>
            <textarea name="definition" defaultValue={skill.definition ?? ""} rows={3} className="input" />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-sm font-medium">How the skill is used (context)</span>
            <textarea name="howUsed" defaultValue={skill.howUsed ?? ""} rows={3} className="input" />
          </label>
        </div>
        <div className="flex justify-end"><button className="btn-primary">Save skill</button></div>
      </form>

      {/* Proficiency descriptors per scale level */}
      <div className="card card-pad">
        <h2 className="text-lg font-semibold">Proficiency levels</h2>
        <p className="mb-4 text-sm text-slate-500">
          Describe what this skill looks like at each level of the{" "}
          <strong>{scale?.name ?? "proficiency scale"}</strong>. Leave a level blank if it doesn&apos;t apply.
        </p>
        <div className="space-y-3">
          {(scale?.levels ?? []).map((lvl) => (
            <form key={lvl.id} action={upsertDescriptor.bind(null, skill.id)} className="rounded-lg border border-slate-200 p-3">
              <input type="hidden" name="level" value={lvl.level} />
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm font-semibold">
                  L{lvl.level} · {lvl.label}
                </span>
                <button className="text-xs text-rose-700">Save</button>
              </div>
              <p className="mb-2 text-xs text-slate-400">{lvl.summary}</p>
              <textarea name="descriptor" defaultValue={descByLevel.get(lvl.level) ?? ""} rows={2} placeholder={`What does ${skill.name} look like at ${lvl.label}?`} className="input" />
            </form>
          ))}
        </div>
      </div>

      {skill.programSkills.length > 0 && (
        <div className="card card-pad">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Used as a graduate benchmark in</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {skill.programSkills.map((ps) => (
              <li key={ps.id}>
                <Link href={`/programs/${ps.programId}`} className="text-rose-700 hover:underline">{ps.program.name}</Link>
                <span className="text-slate-400"> — benchmark L{ps.targetLevel}{ps.priority ? ` · ${ps.priority}` : ""}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
