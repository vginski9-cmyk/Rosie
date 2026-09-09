// Geography (where every site is, how far from the main campus, which ring) and
// the credentialing / accrediting bodies' clinical requirement sets, per family.

import type { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { geocodeOffline, distanceFrom } from "../src/lib/geo";

/** Locate the main campus and every site offline (gazetteer), and code distance, drive time and ring. */
export async function seedGeography(prisma: PrismaClient, institutionId: string, campusAddress?: { address: string; city: string; state: string; zip: string }) {
  let campus = await prisma.campus.findFirst({ where: { institutionId }, orderBy: { createdAt: "asc" } });
  if (!campus) campus = await prisma.campus.create({ data: { institutionId, name: "Main Campus", ...(campusAddress ?? {}) } });
  if (campusAddress) campus = await prisma.campus.update({ where: { id: campus.id }, data: { ...campusAddress, isMain: true } });
  else {
    // No street address known: the campus sits in the institution's home town until someone types the address.
    const inst = await prisma.institution.findUnique({ where: { id: institutionId }, select: { city: true, state: true } });
    campus = await prisma.campus.update({ where: { id: campus.id }, data: { isMain: true, city: campus.city ?? inst?.city ?? null, state: campus.state ?? inst?.state ?? "NC" } });
  }
  const cLoc = geocodeOffline({ city: campus.city, state: campus.state });
  if (!cLoc) return { campus: campus.name, located: 0, sites: 0 };
  await prisma.campus.update({ where: { id: campus.id }, data: { lat: cLoc.lat, lng: cLoc.lng, geoSource: cLoc.source } });
  const inst = await prisma.institution.findUnique({ where: { id: institutionId }, select: { ringCoreMinutes: true, ringOneMinutes: true, ringTwoMinutes: true } });
  const bands = { coreMinutes: inst?.ringCoreMinutes ?? 30, oneMinutes: inst?.ringOneMinutes ?? 60, twoMinutes: inst?.ringTwoMinutes ?? 90 };
  const sites = await prisma.employer.findMany({ where: { institutionId }, select: { id: true, city: true, state: true, ringSource: true } });
  let located = 0;
  for (const s of sites) {
    const loc = geocodeOffline({ city: s.city, state: s.state ?? "NC" });
    if (!loc) continue;
    const d = distanceFrom(cLoc, loc, bands);
    await prisma.employer.update({ where: { id: s.id }, data: { lat: loc.lat, lng: loc.lng, geoSource: loc.source, distanceMiles: d.miles, driveMinutes: d.minutes, ...(s.ringSource === "manual" ? {} : { ring: d.ring }) } });
    located++;
  }
  return { campus: campus.name, located, sites: sites.length };
}

/** Attach each family its requirement set from the public standard (starter content, unverified). */
export async function seedRequirementSets(prisma: PrismaClient) {
  const files: { file: string; match: RegExp }[] = [
    { file: "radiography.json", match: /radiograph|imaging/i },
    { file: "surgical-technology.json", match: /surgical/i },
    { file: "nurse-aide.json", match: /nurse aide|cna/i },
  ];
  const families = await prisma.programFamily.findMany({ select: { id: true, name: true } });
  let sets = 0, items = 0;
  for (const f of families) {
    const t = files.find((x) => x.match.test(f.name));
    if (!t) continue;
    const j = JSON.parse(readFileSync(join(__dirname, "templates", "requirements", t.file), "utf8")) as { name: string; authority: string; edition: string; kind: string; sourceUrl: string; summary: string; rules: unknown[]; items: { category: string; name: string; mandatory: boolean; electiveGroup?: string; minCount?: number; role?: string; settingCodes: string; notes?: string }[] };
    const set = await prisma.clinicalRequirementSet.create({ data: { familyId: f.id, name: j.name, authority: j.authority, edition: j.edition, kind: j.kind, sourceUrl: j.sourceUrl, summary: j.summary, rules: JSON.stringify(j.rules), verified: false } });
    await prisma.clinicalRequirementItem.createMany({ data: j.items.map((it, i) => ({ setId: set.id, category: it.category, name: it.name, mandatory: it.mandatory, electiveGroup: it.electiveGroup ?? null, minCount: it.minCount ?? null, role: it.role ?? null, settingCodes: it.settingCodes, notes: it.notes ?? null, sortOrder: i })) });
    sets++; items += j.items.length;
  }
  return { sets, items };
}
