import Link from "next/link";
import { notFound } from "next/navigation";
import { getAlignmentSubject } from "@/lib/queries";
import { AlignmentIntake } from "@/components/AlignmentIntake";

export const dynamic = "force-dynamic";

export default async function StudentAlignmentPage({ params }: { params: { id: string } }) {
  const data = await getAlignmentSubject("student", params.id);
  if (!data || data.kind !== "student") notFound();
  const s = data.subject as { id: string; name: string; status: string; program: { id: string; name: string; family: { id: string; name: string } | null }; cohort: { id: string; name: string } | null };

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/students/${s.id}`} className="text-sm text-slate-500 hover:text-slate-700">← {s.name}</Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Alignment intake — {s.name}</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          Structured intake on what&apos;s actually operating: motivations (tiered), constraints (design parameters, not
          deficits), and capacities (including what the credentialing system doesn&apos;t count). The panel on the right
          computes the positioning, recommended WBL modes, configuration, and required intake depth live as you tag.
          {" "}{s.program.name}{s.cohort ? <> · {s.cohort.name}</> : null} · {s.status}
        </p>
      </div>
      <AlignmentIntake side="LEARNER" studentId={s.id} subjectName={s.name} existing={data.profiles as never} />
    </div>
  );
}
