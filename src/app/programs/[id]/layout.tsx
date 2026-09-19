import Link from "next/link";
import { prisma } from "@/lib/db";
import { ProgramTabBar } from "@/components/ProgramTabBar";

// Shared chrome for every program page: the program's name once, then one tab bar.
export default async function ProgramLayout({ children, params }: { children: React.ReactNode; params: { id: string } }) {
  const program = await prisma.program.findUnique({
    where: { id: params.id },
    select: { name: true, status: true, credential: true, programType: true, institutionId: true, familyId: true, institution: { select: { name: true } }, occupation: { select: { title: true, socCode: true } } },
  });

  return (
    <div>
      {program && (
        <div className="mb-4">
          <nav className="flex flex-wrap gap-1 text-xs text-slate-500"><Link href="/programs" className="hover:text-slate-800">Programs</Link><span>›</span><Link href={`/programs?inst=${program.institutionId}`} className="hover:text-slate-800">{program.institution.name}</Link>{program.familyId && program.occupation && <><span>›</span><Link href={`/programs?inst=${program.institutionId}&family=${program.familyId}`} className="hover:text-slate-800">{program.occupation.title}</Link></>}</nav>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {program.name}
            {program.status === "draft" && <span className="badge ml-2 align-middle bg-slate-200 text-slate-600">draft</span>}
          </h1>
          <p className="text-sm text-slate-500">{[program.institution.name, program.occupation ? `${program.occupation.title} · SOC ${program.occupation.socCode}` : null, program.credential, program.programType].filter(Boolean).join(" · ")}</p>
        </div>
      )}
      <ProgramTabBar programId={params.id} />
      {children}
    </div>
  );
}
