// THE OTHER PLACES A COLLEGE'S CLASSES MEET — a high school, a hospital, a county center — seeded as
// campuses beside the main one, so an offering can be planned there ("at — where?" on the goal page,
// "Where it meets" on the offering page, the Where column on Programs, the map). Each is placed by its
// town through the gazetteer until someone types coordinates.
import type { PrismaClient } from "@prisma/client";
import { geocodeOffline } from "../src/lib/geo";

export const OTHER_CAMPUSES: Record<string, { name: string; address: string; city: string; state: string; zip: string; notes: string }[]> = {
  "Carteret Community College": [
    // Nurse Aide I's alternate locations, as the owner gave them (2026-10-21).
    { name: "East Carteret High School (ECHS)", address: "3263 US-70 East", city: "Beaufort", state: "NC", zip: "28516", notes: "Nurse Aide I classes meet here." },
    { name: "Carteret Health Care (CHC)", address: "3500 Arendell St", city: "Morehead City", state: "NC", zip: "28557", notes: "Nurse Aide I classes meet at the hospital, which is also a clinical site (CCC-H01)." },
  ],
};
export async function seedOtherCampuses(prisma: PrismaClient): Promise<number> {
  let n = 0;
  for (const [name, places] of Object.entries(OTHER_CAMPUSES)) {
    const inst = await prisma.institution.findFirst({ where: { name }, select: { id: true } });
    if (!inst) continue;
    for (const c of places) {
      const loc = geocodeOffline({ city: c.city, state: c.state });
      await prisma.campus.create({ data: { institutionId: inst.id, ...c, isMain: false, ...(loc ? { lat: loc.lat, lng: loc.lng, geoSource: loc.source } : {}) } });
      n++;
    }
  }
  return n;
}
