// Which partner sites can host a program's clinical sections — by the SETTING
// the rotation needs (an operating-room rotation goes to sites with OR assets,
// never to a nursing home), ranked by the family's agreement with the site,
// weighted by how many learners its assets take per shift.

import { prisma } from "./db";
import type { RotationCode } from "./assetmap";

export interface HostLite {
  employerId: string; name: string;
  /** Learners per shift the site's active assets take, by setting code. */
  capacity: Record<string, number>;
  /** 0 secured · 1 asked · 2 prospect · 3 none (the family's agreement, else the institution's). */
  rank: number;
}
const RANK: Record<string, number> = { secured: 0, asked: 1, prospect: 2, none: 3, declined: 9 };

export async function clinicalHostsFor(institutionId: string, familyId: string | null): Promise<{ hosts: HostLite[]; rotations: RotationCode[] }> {
  const [employers, familySites, rotationRows] = await Promise.all([
    prisma.employer.findMany({ where: { institutionId, status: "active" }, select: { id: true, name: true, agreementStatus: true, assets: { where: { status: { not: "archived" } }, select: { settingCode: true, learnersPerShift: true } } } }),
    familyId ? prisma.familySite.findMany({ where: { familyId }, select: { employerId: true, agreementStatus: true } }) : Promise.resolve([] as { employerId: string; agreementStatus: string }[]),
    prisma.rotationSetting.findMany({ where: { institutionId }, select: { rotationType: true, settingCode: true } }),
  ]);
  const famAgreement = new Map(familySites.map((f) => [f.employerId, f.agreementStatus]));
  const hosts: HostLite[] = employers.filter((e) => e.assets.length).map((e) => {
    const capacity: Record<string, number> = {};
    for (const a of e.assets) capacity[a.settingCode] = (capacity[a.settingCode] ?? 0) + Math.max(0, a.learnersPerShift);
    const status = famAgreement.get(e.id) ?? e.agreementStatus ?? "none";
    return { employerId: e.id, name: e.name, capacity, rank: RANK[status] ?? 3 };
  }).filter((h) => h.rank < 9);
  return { hosts, rotations: rotationRows.map((r) => ({ rotationType: r.rotationType, settingCode: r.settingCode })) };
}

/** Sites that can host a rotation of these settings (listed primary first), best first:
 *  secured before asked before prospect; sites with the PRIMARY setting (an OR for a
 *  surgical course) before sites that only have a secondary one; then the most capacity. */
export function hostsForSettings(hosts: HostLite[], settingCodes: string[]): HostLite[] {
  const want = new Set(settingCodes);
  const primary = settingCodes[0];
  return hosts
    .map((h) => ({ h, cap: Object.entries(h.capacity).filter(([code]) => want.has(code)).reduce((n, [, v]) => n + v, 0), hasPrimary: primary ? (h.capacity[primary] ?? 0) > 0 : true }))
    .filter((x) => x.cap > 0)
    .sort((a, b) => a.h.rank - b.h.rank || Number(b.hasPrimary) - Number(a.hasPrimary) || b.cap - a.cap)
    .map((x) => x.h);
}
/** Site per section, dealt round-robin across the best sites (each site up to the learners
 *  its assets take per shift), so a cohort spreads across its secured partners instead of
 *  filling one clinic first. Returns one employer id per slot, in dealing order. */
export function hostSlots(hosts: HostLite[], settingCodes: string[]): string[] {
  const want = new Set(settingCodes);
  const ranked = hostsForSettings(hosts, settingCodes).map((h) => ({ id: h.employerId, rank: h.rank, left: Math.max(1, Math.round(Object.entries(h.capacity).filter(([code]) => want.has(code)).reduce((n, [, v]) => n + v, 0))) }));
  const out: string[] = [];
  // Deal within the best agreement tier first, one section per site per pass, until that tier is full; then the next tier.
  for (const tier of [...new Set(ranked.map((r) => r.rank))].sort((a, b) => a - b)) {
    const pool = ranked.filter((r) => r.rank === tier);
    let dealt = true;
    while (dealt) { dealt = false; for (const h of pool) if (h.left > 0) { out.push(h.id); h.left--; dealt = true; } }
  }
  return out;
}
