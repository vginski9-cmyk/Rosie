import type { PrismaClient } from "@prisma/client";

// EVERY SITE'S EXPERIENCES, CONFIRMED. The seeded colleges are taken as fully set up: each partner
// site has confirmed with the college which required experiences it provides — every item whose
// settings the site has an asset for — so nothing in the scheduler reads "inferred only".
// (A real college records these one by one on the program's site setup page; this is the seed's shortcut.)
export async function confirmSiteExperiences(prisma: PrismaClient): Promise<{ provisions: number }> {
  const sets = await prisma.clinicalRequirementSet.findMany({ select: { id: true, family: { select: { id: true, institutionId: true } }, items: { select: { id: true, settingCodes: true } } } });
  const now = new Date();
  let n = 0;
  for (const set of sets) {
    const sites = await prisma.employer.findMany({ where: { institutionId: set.family.institutionId, status: { not: "archived" } }, select: { id: true, assets: { where: { status: { not: "archived" } }, select: { settingCode: true } } } });
    for (const item of set.items) {
      const codes = new Set(item.settingCodes.split(",").map((s) => s.trim()).filter(Boolean));
      if (!codes.size) continue;
      for (const site of sites) {
        if (!site.assets.some((a) => codes.has(a.settingCode))) continue;
        await prisma.siteRequirementProvision.upsert({
          where: { employerId_itemId: { employerId: site.id, itemId: item.id } },
          update: { status: "provides", source: "VERIFIED", evidenceOwner: "clinical coordinator", verifiedAt: now },
          create: { employerId: site.id, itemId: item.id, status: "provides", source: "VERIFIED", evidenceOwner: "clinical coordinator", verifiedAt: now },
        });
        n++;
      }
    }
  }
  return { provisions: n };
}
