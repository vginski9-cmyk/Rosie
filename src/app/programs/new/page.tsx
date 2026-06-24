import Link from "next/link";
import { getInstitutions } from "@/lib/queries";
import { createProgram } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function NewProgramPage() {
  const institutions = await getInstitutions();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link href="/" className="text-sm text-slate-500 hover:text-slate-700">← Dashboard</Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">New program</h1>
        <p className="text-sm text-slate-500">
          Create a program shell — a first term and a talent-pipeline cohort are scaffolded automatically. Works for
          short-term certificates and multi-year degrees alike. Everything is editable afterward.
        </p>
      </div>

      <form action={createProgram} className="card card-pad space-y-4">
        <Field label="Institution">
          <select name="institutionId" required className="input">
            {institutions.map((i) => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Program name">
          <input name="name" required placeholder="e.g. Phlebotomy Certificate" className="input" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Program type">
            <input name="programType" defaultValue="Traditional Full Time" className="input" />
          </Field>
          <Field label="Credential">
            <input name="credential" placeholder="AAS / Diploma / Certificate" className="input" />
          </Field>
        </div>
        <Field label="Months to full productivity (optional)">
          <input name="monthsToFullProductivity" type="number" min={0} placeholder="6" className="input" />
        </Field>
        <div className="flex justify-end gap-2">
          <Link href="/" className="btn-ghost">Cancel</Link>
          <button type="submit" className="btn-primary">Create program</button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}
