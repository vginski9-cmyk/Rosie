import { Suspense } from "react";
import { prisma } from "@/lib/db";
import { defaultInstitution } from "@/lib/queries";
import { InsightsTabs } from "@/components/InsightsTabs";

export const dynamic = "force-dynamic";

// Every analysis page shares one strip of tabs and one college picker, so Insights reads as one workspace.
export default async function InsightsLayout({ children }: { children: React.ReactNode }) {
  const [institutions, dflt] = await Promise.all([
    prisma.institution.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    defaultInstitution(),
  ]);
  return (
    <div>
      <Suspense fallback={null}>
        <InsightsTabs institutions={institutions} defaultInstitutionId={dflt?.id ?? null} />
      </Suspense>
      <div className="mt-6">{children}</div>
    </div>
  );
}
