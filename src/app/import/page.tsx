import { prisma } from "@/lib/db";
import { Importer } from "@/components/Importer";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const institutions = await prisma.institution.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Import data</h1>
        <p className="text-sm text-slate-500">
          Stage 1 of every Rosie data flow: land a spreadsheet, auto-detect what it is, preview it, then load it. This is
          the entry point for the ETL pipeline (Lightcast demand exports, the program-planning template, term &amp; block
          calendars).
        </p>
      </div>
      <Importer institutions={institutions} />
    </div>
  );
}
