import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// Setup is the institution's own page. With one institution in the workspace, go straight to it.
export default async function SetupPage() {
  const insts = await prisma.institution.findMany({ orderBy: { name: "asc" }, select: { id: true } });
  if (insts.length === 1) redirect(`/orgs/${insts[0].id}`);
  redirect("/orgs");
}
