// THE SHARED SITE REGISTRY — one record per clinical site in the world, whichever colleges approach it.
//
// A college's partner record (Employer) is that college's relationship with a site: its agreement, its
// contacts, the drive time from ITS campus, the assets it has been granted. The site itself — name,
// system, facility type, address, beds — is one ClinicalSite that every partner record points at, so
// two colleges approaching the same hospital see each other and never keep two addresses.
//
// Sites are matched by name and city, normalised (case, punctuation, the words "the" and "inc").

import type { PrismaClient } from "@prisma/client";

/** What makes two records the same site: the name and city with case, punctuation and filler dropped. */
export const siteKey = (name: string, city: string | null | undefined): string =>
  `${name.toLowerCase().replace(/\b(the|inc|llc|of)\b/g, "").replace(/[^a-z0-9]/g, "")}|${(city ?? "").toLowerCase().replace(/[^a-z]/g, "")}`;

export interface SiteIdentity {
  name: string; organization?: string | null; facilityType?: string | null; address?: string | null; city?: string | null; state?: string | null; zip?: string | null; county?: string | null;
  lat?: number | null; lng?: number | null; geoSource?: string | null;
  licensedBeds?: number | null; nursingHomeBeds?: number | null; adultCareBeds?: number | null; operatingRooms?: number | null; annualSurgicalCases?: number | null; externalId?: string | null;
}

type Db = Pick<PrismaClient, "clinicalSite" | "employer">;

/** The registry record for a site — found by name and city, else created from the identity given. A found
 *  record takes any identity fields it was missing (a second college's address fills a blank, never overwrites). */
export async function ensureSite(db: Db, id: SiteIdentity): Promise<string> {
  const key = siteKey(id.name, id.city);
  const candidates = await db.clinicalSite.findMany({ where: { name: { contains: id.name.slice(0, 12) } }, select: { id: true, name: true, city: true, organization: true, facilityType: true, address: true, state: true, zip: true, county: true, lat: true, lng: true, geoSource: true, licensedBeds: true, nursingHomeBeds: true, adultCareBeds: true, operatingRooms: true, annualSurgicalCases: true, externalId: true } });
  const hit = candidates.find((c) => siteKey(c.name, c.city) === key);
  if (hit) {
    const fill: Record<string, unknown> = {};
    for (const k of ["organization", "facilityType", "address", "state", "zip", "county", "lat", "lng", "geoSource", "licensedBeds", "nursingHomeBeds", "adultCareBeds", "operatingRooms", "annualSurgicalCases", "externalId"] as const) {
      if (hit[k] == null && id[k] != null) fill[k] = id[k];
    }
    if (Object.keys(fill).length) await db.clinicalSite.update({ where: { id: hit.id }, data: fill });
    return hit.id;
  }
  const created = await db.clinicalSite.create({ data: {
    name: id.name, organization: id.organization ?? null, facilityType: id.facilityType ?? null, address: id.address ?? null, city: id.city ?? null, state: id.state ?? null, zip: id.zip ?? null, county: id.county ?? null,
    lat: id.lat ?? null, lng: id.lng ?? null, geoSource: id.geoSource ?? null,
    licensedBeds: id.licensedBeds ?? null, nursingHomeBeds: id.nursingHomeBeds ?? null, adultCareBeds: id.adultCareBeds ?? null, operatingRooms: id.operatingRooms ?? null, annualSurgicalCases: id.annualSurgicalCases ?? null, externalId: id.externalId ?? null,
  }, select: { id: true } });
  return created.id;
}

/** Every partner record without a registry site gets one (matched or created). Idempotent; the seed and
 *  an existing database both run it. */
export async function linkSiteRegistry(db: Db): Promise<{ linked: number; sites: number }> {
  const orphans = await db.employer.findMany({ where: { siteId: null }, select: { id: true, name: true, organization: true, facilityType: true, address: true, city: true, state: true, zip: true, county: true, lat: true, lng: true, geoSource: true, licensedBeds: true, nursingHomeBeds: true, adultCareBeds: true, operatingRooms: true, annualSurgicalCases: true, externalId: true } });
  const before = await db.clinicalSite.count();
  let linked = 0;
  for (const e of orphans) {
    const siteId = await ensureSite(db, e);
    await db.employer.update({ where: { id: e.id }, data: { siteId } });
    linked++;
  }
  return { linked, sites: (await db.clinicalSite.count()) - before };
}
