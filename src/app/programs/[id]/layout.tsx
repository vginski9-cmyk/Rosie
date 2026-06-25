import Link from "next/link";
import { prisma } from "@/lib/db";
import { ProgramTabBar } from "@/components/ProgramTabBar";

// Shared chrome for every program page: the program identity (breadcrumb + name)
// once, then one tab bar — so the program reads as a single workspace and pages
// don't each re-state which program you're in. Pages keep their own facet titles.
export default async function ProgramLayout({ children, params }: { children: React.ReactNode; params: { id: string } }) {
  const program = await prisma.program.findUnique({
    where: { id: params.id },
    select: {
      name: true, status: true, credential: true, programType: true,
      institution: { select: { name: true } },
      family: { select: { id: true, name: true } },
      occupation: { select: { title: true, socCode: true } },
    },
  });

  return (
    <div>
      {program && (
        <div className="mb-4">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Link href="/" className="hover:text-slate-700">{program.institution.name}</Link>
            {program.family && (
              <>
                <span className="text-slate-300">/</span>
                <Link href={`/families/${program.family.id}`} className="hover:text-rose-700">{program.family.name} family</Link>
              </>
            )}
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {program.name}
            {program.status === "draft" && <span className="badge ml-2 align-middle bg-slate-200 text-slate-600">draft</span>}
          </h1>
          {(program.occupation || program.credential) && (
            <p className="text-sm text-slate-500">
              {program.occupation?.title}{program.occupation ? ` · SOC ${program.occupation.socCode}` : ""}
              {program.programType ? ` · ${program.programType}` : ""}{program.credential ? ` · ${program.credential}` : ""}
            </p>
          )}
        </div>
      )}
      <ProgramTabBar programId={params.id} />
      {children}
    </div>
  );
}
