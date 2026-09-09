// Dummy roster so assignments can be made on day one: campus rooms and labs,
// a full instructor / support-staff bench, preceptors attached to real
// partner sites (with agreement statuses set), and a handful of locked-in,
// calendarized offerings whose sections are waiting for people, rooms and sites.
// Every name here is invented.

import type { PrismaClient } from "@prisma/client";
import { alignOffering } from "../src/lib/termalign";
import { DEFAULT_POLICIES } from "../src/lib/workload";
import { deriveCohortTargets } from "../src/lib/pipeline";
import { BENCHMARK_RATES } from "../src/lib/northstar";
import { STAGES } from "../src/lib/funnel";
import { planMeetings } from "../src/lib/calendarize";
import { parseHoursText } from "../src/lib/rooms";
import { clinicalHostsFor } from "../src/lib/hosts";

const FIRST = ["Maria", "James", "Aisha", "Daniel", "Priya", "Marcus", "Elena", "Thomas", "Keisha", "Robert", "Sofia", "William", "Nadia", "Andre", "Grace", "Samuel", "Lena", "Victor", "Hannah", "Omar", "Claire", "Jordan", "Renee", "Miguel", "Tasha", "Peter", "Yolanda", "Chris", "Ingrid", "Devon", "Beatriz", "Nathan", "Carmen", "Louis", "Farah", "Isaac", "Monica", "Trevor", "Dana", "Kwame"];
const LAST = ["Alvarez", "Bennett", "Chen", "Dawson", "Ellis", "Foster", "Garcia", "Hughes", "Ibrahim", "Jenkins", "Kim", "Lopez", "Mitchell", "Nguyen", "Owens", "Patel", "Quinn", "Reyes", "Sullivan", "Torres", "Underwood", "Vance", "Walker", "Xiong", "Young", "Zimmerman", "Abbott", "Brooks", "Castillo", "Duncan", "Espinoza", "Franklin", "Grant", "Holloway", "Ivey", "Jacobs", "Kessler", "Lawson", "Morales", "Norris"];

function rng(seed: number) { let a = seed >>> 0; return () => { a += 0x6d2b79f5; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const emailOf = (name: string, domain: string) => name.toLowerCase().replace(/[^a-z ]/g, "").split(" ").join(".") + "@" + domain;

export async function seedRoster(prisma: PrismaClient, institutionId: string) {
  const rand = rng(20260817);
  const used = new Set<string>();
  const nextName = () => { for (;;) { const n = `${FIRST[Math.floor(rand() * FIRST.length)]} ${LAST[Math.floor(rand() * LAST.length)]}`; if (!used.has(n)) { used.add(n); return n; } } };
  const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];

  // ── Campus rooms & labs ───────────────────────────────────────────────────
  const ROOMS: { name: string; kind: string; building: string; capacity: number; areaSqft: number; equipment?: string }[] = [
    ...[101, 102, 104, 108, 112, 120, 125, 130].map((n) => ({ name: `Kennedy Hall ${n}`, kind: "CLASSROOM", building: "Kennedy Hall", capacity: n % 3 === 0 ? 40 : 30, areaSqft: 780, equipment: "projector, whiteboard" })),
    ...[201, 204, 210, 215].map((n) => ({ name: `Blue Hall ${n}`, kind: "CLASSROOM", building: "Blue Hall", capacity: 24, areaSqft: 620, equipment: "projector, whiteboard" })),
    { name: "Health Sciences Lecture Hall", kind: "CLASSROOM", building: "Health Sciences", capacity: 90, areaSqft: 2100, equipment: "lecture capture, dual projectors" },
    { name: "Nursing Skills Lab A", kind: "LAB", building: "Health Sciences", capacity: 12, areaSqft: 1400, equipment: "8 hospital beds, med carts, task trainers" },
    { name: "Nursing Skills Lab B", kind: "LAB", building: "Health Sciences", capacity: 12, areaSqft: 1400, equipment: "8 hospital beds, IV trainers" },
    { name: "Simulation Suite 1", kind: "SIM", building: "Health Sciences", capacity: 8, areaSqft: 900, equipment: "high-fidelity manikin, control room, debrief room" },
    { name: "Simulation Suite 2", kind: "SIM", building: "Health Sciences", capacity: 8, areaSqft: 900, equipment: "birthing simulator, pediatric manikin" },
    { name: "Mock OR 1", kind: "LAB", building: "Health Sciences", capacity: 10, areaSqft: 1000, equipment: "OR table, back tables, sterile core, scrub sinks" },
    { name: "Mock OR 2", kind: "LAB", building: "Health Sciences", capacity: 10, areaSqft: 1000, equipment: "OR table, laparoscopic tower" },
    { name: "Sterile Processing Lab", kind: "LAB", building: "Health Sciences", capacity: 12, areaSqft: 800, equipment: "autoclave, ultrasonic cleaner, instrument sets" },
    { name: "Radiography Energized Lab", kind: "LAB", building: "Health Sciences", capacity: 8, areaSqft: 1200, equipment: "energized x-ray room, phantoms, CR/DR readers" },
    { name: "Radiography Positioning Lab", kind: "LAB", building: "Health Sciences", capacity: 12, areaSqft: 900, equipment: "non-energized tube stands, positioning aids" },
    { name: "Computer Lab 1", kind: "OTHER", building: "Kennedy Hall", capacity: 28, areaSqft: 900, equipment: "28 workstations, EHR sandbox" },
    { name: "Computer Lab 2", kind: "OTHER", building: "Blue Hall", capacity: 24, areaSqft: 800, equipment: "24 workstations" },
    { name: "Anatomy & Physiology Lab", kind: "LAB", building: "Van Dusen Hall", capacity: 24, areaSqft: 1300, equipment: "anatomical models, microscopes" },
    { name: "Van Dusen Hall 140", kind: "CLASSROOM", building: "Van Dusen Hall", capacity: 36, areaSqft: 850, equipment: "projector" },
    { name: "Van Dusen Hall 142", kind: "CLASSROOM", building: "Van Dusen Hall", capacity: 36, areaSqft: 850, equipment: "projector" },
    // The rooms the program sheets actually name (Kennedy Hall 102 / 104 are above).
    { name: "Kennedy Hall 147", kind: "LAB", building: "Kennedy Hall", capacity: 26, areaSqft: 1100, equipment: "radiography positioning lab" },
    { name: "Kennedy Hall 148", kind: "CLASSROOM", building: "Kennedy Hall", capacity: 24, areaSqft: 700, equipment: "projector, whiteboard" },
    { name: "Kennedy Hall Lab 129", kind: "LAB", building: "Kennedy Hall", capacity: 20, areaSqft: 900, equipment: "surgical technology lab" },
  ];
  // Campus → buildings → rooms. Open hours are structured per weekday (not
  // free text), and each room's fixed equipment is its own inventory row.
  const campus = await prisma.campus.create({ data: { institutionId, name: "Main Campus", city: "Pinehurst", state: "NC" } });
  const buildingIds = new Map<string, string>();
  for (const [name, code] of [["Kennedy Hall", "KH"], ["Blue Hall", "BH"], ["Health Sciences", "HS"], ["Van Dusen Hall", "VD"]] as const) {
    const b = await prisma.building.create({ data: { institutionId, campusId: campus.id, name, code } });
    buildingIds.set(name, b.id);
  }
  const HOURS_TEXT = "Mon–Fri 7:30a–9:30p · Sat 8a–2p";
  const spans = parseHoursText(HOURS_TEXT);
  const EQUIP_OF: Record<string, { name: string; category: string; mobility: string; quantity?: number }[]> = {
    "Nursing Skills Lab A": [{ name: "Hospital bed", category: "Medical device", mobility: "fixed", quantity: 8 }, { name: "Medication cart", category: "Medical device", mobility: "mobile", quantity: 2 }, { name: "Task trainer set", category: "Simulation", mobility: "portable", quantity: 4 }],
    "Nursing Skills Lab B": [{ name: "Hospital bed", category: "Medical device", mobility: "fixed", quantity: 8 }, { name: "IV trainer arm", category: "Simulation", mobility: "portable", quantity: 6 }],
    "Simulation Suite 1": [{ name: "High-fidelity adult manikin", category: "Simulation", mobility: "mobile" }, { name: "Sim control-room AV", category: "AV / IT", mobility: "fixed" }],
    "Simulation Suite 2": [{ name: "Birthing simulator", category: "Simulation", mobility: "mobile" }, { name: "Pediatric manikin", category: "Simulation", mobility: "mobile" }],
    "Mock OR 1": [{ name: "OR table", category: "Medical device", mobility: "fixed" }, { name: "Back table", category: "Furniture", mobility: "mobile", quantity: 2 }, { name: "Scrub sink", category: "Sterile processing", mobility: "fixed", quantity: 2 }],
    "Mock OR 2": [{ name: "OR table", category: "Medical device", mobility: "fixed" }, { name: "Laparoscopic tower", category: "Medical device", mobility: "mobile" }],
    "Sterile Processing Lab": [{ name: "Autoclave", category: "Sterile processing", mobility: "fixed" }, { name: "Ultrasonic cleaner", category: "Sterile processing", mobility: "fixed" }, { name: "Instrument set", category: "Sterile processing", mobility: "portable", quantity: 12 }],
    "Radiography Energized Lab": [{ name: "Energized x-ray unit", category: "Imaging", mobility: "fixed" }, { name: "Radiographic phantom", category: "Imaging", mobility: "portable", quantity: 3 }, { name: "CR/DR reader", category: "Imaging", mobility: "fixed" }],
    "Radiography Positioning Lab": [{ name: "Non-energized tube stand", category: "Imaging", mobility: "fixed", quantity: 2 }, { name: "Positioning aids kit", category: "Imaging", mobility: "portable", quantity: 4 }],
    "Computer Lab 1": [{ name: "Workstation", category: "Computing", mobility: "fixed", quantity: 28 }],
    "Computer Lab 2": [{ name: "Workstation", category: "Computing", mobility: "fixed", quantity: 24 }],
    "Anatomy & Physiology Lab": [{ name: "Anatomical model set", category: "Lab bench", mobility: "portable", quantity: 6 }, { name: "Microscope", category: "Lab bench", mobility: "portable", quantity: 24 }],
    "Health Sciences Lecture Hall": [{ name: "Lecture-capture system", category: "AV / IT", mobility: "fixed" }, { name: "Projector", category: "AV / IT", mobility: "fixed", quantity: 2 }],
  };
  for (const r of ROOMS) {
    const num = /(\d+)$/.exec(r.name)?.[1] ?? null;
    const f = await prisma.facility.create({ data: {
      institutionId, ...r, buildingId: buildingIds.get(r.building) ?? null, roomNumber: num, floor: num ? String(num[0]) : null,
      hours: HOURS_TEXT, availability: "open for scheduling", status: "active",
      openHours: { create: spans.map((s) => ({ dayOfWeek: s.dayOfWeek, openTime: s.openTime, closeTime: s.closeTime })) },
    } });
    const eq = EQUIP_OF[r.name] ?? (r.equipment?.includes("projector") ? [{ name: "Projector", category: "AV / IT", mobility: "fixed" }, { name: "Whiteboard", category: "Furniture", mobility: "fixed" }] : []);
    for (const e of eq) await prisma.equipment.create({ data: { institutionId, name: e.name, category: e.category, mobility: e.mobility, quantity: e.quantity ?? 1, homeFacilityId: f.id, buildingId: buildingIds.get(r.building) ?? null, status: "in service" } });
  }
  // A couple of shared mobile units that live at the building level and get placed per term.
  const hsId = buildingIds.get("Health Sciences") ?? null;
  const portableXray = await prisma.equipment.create({ data: { institutionId, name: "Portable x-ray unit", category: "Imaging", mobility: "mobile", quantity: 1, buildingId: hsId, status: "in service" } });
  await prisma.equipment.create({ data: { institutionId, name: "Ultrasound cart", category: "Imaging", mobility: "mobile", quantity: 1, buildingId: hsId, status: "in service" } });
  const rooms = await prisma.facility.findMany({ where: { institutionId, status: "active" }, select: { id: true, name: true, kind: true, capacity: true } });
  const energized = rooms.find((r) => r.name === "Radiography Energized Lab");
  if (energized) await prisma.equipmentAssignment.create({ data: { equipmentId: portableXray.id, facilityId: energized.id, quantity: 1, note: "Parked here between clinical demos." } });

  // ── Partner sites: agreement statuses & slots ─────────────────────────────
  const employers = await prisma.employer.findMany({ where: { institutionId }, include: { units: { select: { unitCategory: true } }, assets: { select: { settingCode: true } } } });
  // Asset setting → the unit category its preceptors are titled by (new sites carry assets, not units).
  const CAT_OF_SETTING: Record<string, string> = { GEN: "Imaging", CT: "Imaging", MRI: "Imaging", US: "Imaging", MAMMO: "Imaging", FLUORO: "Imaging", PORT: "Imaging", ED: "Emergency", OR: "Surgical", BEDS: "Inpatient beds", ICU: "Inpatient beds", OB: "Inpatient beds", PEDS: "Inpatient beds", LTC: "Long-term care beds", ALF: "Adult care beds", BH: "Behavioral health", AMB: "Ambulatory office", DENT: "Ambulatory office", PHARM: "Ambulatory office", REHAB: "Ambulatory office", LAB: "Laboratory", PH: "Community", HH: "Community", HOSP: "Community", EMS: "Community", DIAL: "Ambulatory office" };
  const isHospital = (e: typeof employers[number]) => (e.licensedBeds ?? 0) > 0 || (e.operatingRooms ?? 0) > 0;
  const isLtc = (e: typeof employers[number]) => (e.nursingHomeBeds ?? 0) > 0 || (e.adultCareBeds ?? 0) > 0;
  const hospitals = employers.filter((e) => e.status === "active" && isHospital(e)).sort((a, b) => (b.licensedBeds ?? 0) - (a.licensedBeds ?? 0));
  const ltcs = employers.filter((e) => e.status === "active" && !isHospital(e) && isLtc(e)).sort((a, b) => (b.nursingHomeBeds ?? 0) - (a.nursingHomeBeds ?? 0));
  const offices = employers.filter((e) => e.status === "active" && !isHospital(e) && !isLtc(e));
  const plan: { id: string; agreementStatus: string; wblSlots: number; notes: string }[] = [];
  hospitals.forEach((e, i) => plan.push({ id: e.id, agreementStatus: i < 5 ? "secured" : i < 8 ? "asked" : i < 11 ? "prospect" : "none", wblSlots: i < 5 ? 12 : 8, notes: i < 5 ? "Affiliation agreement on file through 2028." : i < 8 ? "Agreement sent to education dept.; awaiting signature." : "" }));
  ltcs.forEach((e, i) => plan.push({ id: e.id, agreementStatus: i < 6 ? "secured" : i < 9 ? "asked" : i < 12 ? "prospect" : "none", wblSlots: i < 6 ? 6 : 4, notes: i < 6 ? "NATCEP-eligible; agreement on file." : "" }));
  offices.forEach((e, i) => plan.push({ id: e.id, agreementStatus: i < 5 ? "secured" : i < 8 ? "asked" : i < 10 ? "prospect" : "none", wblSlots: i < 5 ? 3 : 2, notes: i < 5 ? "Hosts MA externs; agreement on file." : "" }));
  // A site that already carries an agreement (the Sandhills site seed sets them) keeps it; the plan only fills in the rest.
  for (const p of plan) {
    const cur = employers.find((x) => x.id === p.id)!;
    if (cur.agreementStatus && cur.agreementStatus !== "none") { p.agreementStatus = cur.agreementStatus; continue; }
    await prisma.employer.update({ where: { id: p.id }, data: { agreementStatus: p.agreementStatus, wblSlots: p.wblSlots, agreementNotes: p.notes || null } });
  }

  // ── Instructors & support staff ───────────────────────────────────────────
  const INSTRUCTORS: { title: string; count: number; types: string[] }[] = [
    { title: "Surgical Technology Instructor, CST", count: 4, types: ["full-time", "full-time", "part-time", "adjunct"] },
    { title: "Surgical Technology Clinical Coordinator, CST, CSFA", count: 1, types: ["full-time"] },
    { title: "Radiography Instructor, RT(R)", count: 5, types: ["full-time", "full-time", "full-time", "part-time", "adjunct"] },
    { title: "Radiography Clinical Coordinator, RT(R)(CT)", count: 1, types: ["full-time"] },
    { title: "Nursing Instructor, RN, MSN", count: 6, types: ["full-time", "full-time", "full-time", "part-time", "adjunct", "adjunct"] },
    { title: "Anatomy & Physiology Instructor", count: 2, types: ["full-time", "adjunct"] },
    { title: "Simulation Educator, RN", count: 2, types: ["full-time", "part-time"] },
    { title: "Clinical Placement Coordinator", count: 1, types: ["full-time"] },
  ];
  const people: { institutionId: string; name: string; role: string; title: string; email: string; employmentType: string; active: boolean; employerId?: string | null; startDate: Date }[] = [];
  for (const g of INSTRUCTORS) for (let i = 0; i < g.count; i++) {
    const name = nextName();
    people.push({ institutionId, name, role: /Coordinator/.test(g.title) ? "coordinator" : "instructor", title: g.title, email: emailOf(name, "sandhills.edu"), employmentType: g.types[i] ?? "adjunct", active: true, startDate: new Date(Date.UTC(2015 + Math.floor(rand() * 10), 7, 1)) });
  }
  const SUPPORT = ["Skills Lab Assistant", "Simulation Technician", "Sterile Processing Lab Technician", "Radiography Lab Technologist", "Health Sciences Lab Coordinator", "Academic Support Specialist"];
  for (const t of SUPPORT) { const name = nextName(); people.push({ institutionId, name, role: "support", title: t, email: emailOf(name, "sandhills.edu"), employmentType: pick(["full-time", "part-time"]), active: true, startDate: new Date(Date.UTC(2018 + Math.floor(rand() * 7), 0, 15)) }); }

  // ── Preceptors, attached to secured / asked sites, titled by what the site hosts ──
  const TITLE_BY_CATEGORY: Record<string, string[]> = {
    "Surgical": ["OR RN, Preceptor", "CST, Preceptor", "CSFA, Preceptor", "OR Charge Nurse"],
    "Inpatient beds": ["RN, Med-Surg", "RN, Telemetry", "RN, ICU", "RN, Pediatrics", "RN, Labor & Delivery"],
    "Emergency": ["RN, Emergency Department", "ED Charge Nurse"],
    "Imaging": ["Radiologic Technologist, RT(R)", "RT(R)(CT)", "Lead Radiographer", "MRI Technologist"],
    "Laboratory": ["MLT, Clinical Laboratory", "Phlebotomy Supervisor"],
    "Long-term care beds": ["LPN, Skilled Nursing", "RN, SNF Unit Manager", "Nurse Aide Preceptor, CNA II"],
    "Adult care beds": ["Resident Care Coordinator", "LPN, Adult Care"],
    "Behavioral health": ["RN, Behavioral Health"],
    "Ambulatory office": ["CMA (AAMA), Office Preceptor", "Office RN", "Practice Manager"],
    "Community": ["Community Health Nurse", "Public Health RN"],
  };
  const siteList = plan.filter((p) => p.agreementStatus === "secured" || p.agreementStatus === "asked");
  for (const p of siteList) {
    const e = employers.find((x) => x.id === p.id)!;
    const cats = [...new Set([...e.units.map((u) => u.unitCategory), ...e.assets.map((a) => CAT_OF_SETTING[a.settingCode]).filter((c): c is string => !!c)])];
    const n = p.agreementStatus === "secured" ? (isHospital(e) ? 6 : 3) : (isHospital(e) ? 3 : 2);
    for (let i = 0; i < n; i++) {
      const cat = cats.length ? cats[i % cats.length] : isHospital(e) ? "Inpatient beds" : isLtc(e) ? "Long-term care beds" : "Ambulatory office";
      const titles = TITLE_BY_CATEGORY[cat] ?? ["Preceptor"];
      const name = nextName();
      people.push({ institutionId, name, role: "preceptor", title: `${titles[i % titles.length]} — ${e.name}`, email: emailOf(name, e.organization ? e.organization.toLowerCase().replace(/[^a-z]/g, "").slice(0, 14) + ".org" : "partner.org"), employmentType: "preceptor", active: true, employerId: e.id, startDate: new Date(Date.UTC(2019 + Math.floor(rand() * 6), 2, 1)) });
    }
  }
  await prisma.person.createMany({ data: people });

  // ── Locked-in, calendarized offerings — sections waiting to be staffed ────
  const inst = await prisma.institution.findUnique({ where: { id: institutionId }, select: { springStart: true, summerStart: true, fallStart: true } });
  const anchors = { springStart: inst?.springStart ?? "01-08", summerStart: inst?.summerStart ?? "05-28", fallStart: inst?.fallStart ?? "08-15" };
  // Each offering carries the family's whole-year North-Star goal (the
  // Radiography and Surgical Technology launches are the partner's 29 and 14)
  // and, exactly like lock-in, inherits the family's talent-pipeline rates —
  // so the Fall 2026 cohorts land on the funnel's 41 and 19 enrolled.
  const OFFERINGS: { program: string; start: string; goal: number }[] = [
    { program: "Surgical Technology", start: "2026-08-17", goal: 14 },
    { program: "Radiography", start: "2026-08-17", goal: 29 },
  ];
  let offerings = 0;
  for (const o of OFFERINGS) {
    const program = await prisma.program.findFirst({ where: { institutionId, name: o.program }, include: { family: { select: { goalPlan: true } }, terms: { orderBy: { index: "asc" }, include: { courses: { include: { sessions: { select: { kind: true, maxStudents: true, lengthHours: true, dayOfWeek: true, startTime: true, endTime: true, sectionTimes: true, deliveryMode: true, location: true, rotationType: true } } } } } }, cohorts: { select: { name: true } } } });
    if (!program) continue;
    let rates = { ...BENCHMARK_RATES };
    if (program.family?.goalPlan) { try { const saved = JSON.parse(program.family.goalPlan) as { goal?: Partial<typeof BENCHMARK_RATES> }; if (saved.goal) rates = { ...rates, ...saved.goal }; } catch { /* benchmarks */ } }
    const t = deriveCohortTargets(o.goal, rates, Math.max(1, program.terms.length));
    // Same alignment engine as lock-in: term starts/ends and course windows on the institution's calendar.
    const courses = await prisma.course.findMany({ where: { term: { programId: program.id } }, select: { id: true, code: true, name: true, termId: true, sessions: { select: { week: true } } } });
    const aligned = alignOffering({ startIso: o.start, terms: program.terms.map((t) => ({ id: t.id, index: t.index, name: t.name, semester: t.semester, startWeek: t.startWeek, endWeek: t.endWeek })), courses, anchors, events: [] });
    const endYear = Number(aligned.terms.map((t) => t.endIso).sort().at(-1)!.slice(0, 4));
    let name = `Class of ${endYear}`;
    if (program.cohorts.some((c) => c.name === name)) { let n = 2; while (program.cohorts.some((c) => c.name === `${name} (${n})`)) n++; name = `${name} (${n})`; }
    const startD = new Date(o.start + "T00:00:00Z");
    const cohort = await prisma.cohort.create({ data: { programId: program.id, name, status: "planned", startDate: startD, entryYear: startD.getUTCFullYear(), isExplicit: true, plannedSeats: Math.round(t.capacity), pipelineRates: JSON.stringify({ goal: o.goal, rates, termOverrides: [] }) } });
    const stageTargets: Record<string, number> = { interested: t.interested, qualified: t.qualified, offered: t.offered, enrolled: t.capacity, completing: t.completing, licensed: t.licensed, placed: t.placed, productive: t.productive };
    await prisma.funnelStage.createMany({ data: STAGES.map((s, i) => ({ cohortId: cohort.id, stageKey: s.key, sortOrder: i, label: s.label, targetNumber: Math.round(stageTargets[s.key] ?? 0) })) });
    for (const t of aligned.terms) await prisma.cohortTerm.create({ data: { cohortId: cohort.id, termId: t.termId, startDate: new Date(t.startIso + "T00:00:00Z"), endDate: new Date(t.endIso + "T00:00:00Z"), source: t.startSource, semester: t.semester.split(" ")[0] } });
    for (const c of aligned.courses) await prisma.cohortCourseDates.create({ data: { cohortId: cohort.id, courseId: c.courseId, startDate: new Date(c.startIso + "T00:00:00Z"), endDate: new Date(c.endIso + "T00:00:00Z"), auto: true } });
    offerings++;
  }

  return {
    rooms: rooms.length,
    instructors: people.filter((p) => p.role === "instructor" || p.role === "coordinator").length,
    support: people.filter((p) => p.role === "support").length,
    preceptors: people.filter((p) => p.role === "preceptor").length,
    secured: plan.filter((p) => p.agreementStatus === "secured").length,
    asked: plan.filter((p) => p.agreementStatus === "asked").length,
    offerings,
  };
}

/** Calendarize every planned / active offering of the institution: one weekly booking
 *  per course × session type × section, in campus rooms and at partner sites. Runs
 *  AFTER the clinical models load, so clinical sections are placed against the
 *  families' FINAL site agreements — never against a transient status. Re-plans
 *  from scratch (existing bookings are replaced). */
export async function seedOfferingMeetings(prisma: PrismaClient, institutionId: string) {
  const rooms = await prisma.facility.findMany({ where: { institutionId, status: "active" }, select: { id: true, name: true, kind: true, capacity: true } });
  const cohorts = await prisma.cohort.findMany({
    where: { program: { institutionId }, status: { in: ["planned", "active"] } },
    include: {
      cohortTerms: { select: { termId: true, startDate: true, endDate: true } },
      program: { select: { familyId: true, defaultCohortSeats: true, terms: { orderBy: { index: "asc" }, include: { courses: { include: { sessions: { select: { kind: true, maxStudents: true, lengthHours: true, dayOfWeek: true, startTime: true, endTime: true, sectionTimes: true, deliveryMode: true, location: true, rotationType: true } } } } } } } },
    },
  });
  const secured = (await prisma.employer.findMany({ where: { institutionId, status: "active", agreementStatus: "secured" }, select: { id: true } })).map((e) => e.id);
  let meetings = 0, offerings = 0;
  for (const co of cohorts) {
    if (!co.cohortTerms.length) continue;
    const { hosts, rotations } = await clinicalHostsFor(institutionId, co.program.familyId);
    const ctById = new Map(co.cohortTerms.map((ct) => [ct.termId, ct]));
    const rows = planMeetings({
      cohortId: co.id, seats: Math.round(co.plannedSeats ?? co.program.defaultCohortSeats ?? 30), cohortStartMs: co.startDate?.getTime() ?? null,
      terms: co.program.terms.map((t) => ({ id: t.id, index: t.index, startWeek: t.startWeek, endWeek: t.endWeek, startMs: ctById.get(t.id)?.startDate?.getTime() ?? null, endMs: ctById.get(t.id)?.endDate?.getTime() ?? null, courses: t.courses })),
      rooms, hostIds: secured, hosts, rotations,
    });
    await prisma.meetingPattern.deleteMany({ where: { cohortId: co.id } });
    for (let i = 0; i < rows.length; i += 400) await prisma.meetingPattern.createMany({ data: rows.slice(i, i + 400) });
    meetings += rows.length; offerings++;
  }
  return { offerings, meetings };
}

// ── Workload policies (every institution) and demo shift assignments ────────

/** The built-in policy set, coded per institution so the People page shows
 *  real rows to edit (Sandhills' own numbers: FT 16/40 → 2.5, adjunct 18/40, support 1:1, preceptor 1:1). */
export async function seedWorkloadPolicies(prisma: PrismaClient) {
  const institutions = await prisma.institution.findMany({ select: { id: true } });
  let n = 0;
  for (const inst of institutions) for (const d of DEFAULT_POLICIES) {
    await prisma.workloadPolicy.create({ data: { institutionId: inst.id, employerId: null, role: d.role, employmentType: d.employmentType, title: d.title, label: d.label ?? null, contactHoursPerWeek: d.contactHoursPerWeek, workWeekHours: d.workWeekHours, termWeeks: d.termWeeks, annualWeeks: d.annualWeeks, hoursPerContactHour: d.hoursPerContactHour, maxContactHoursPerWeek: d.maxContactHoursPerWeek, notes: d.role === "instructor" && d.employmentType === "full-time" ? "FT = 16/40 = 2.5 (program workbook)" : d.role === "instructor" && d.employmentType === "adjunct" ? "adjunct = 18/40 = 2.25 (program workbook)" : d.role === "support" ? "support = 1:1 (program workbook)" : null } });
    n++;
  }
  return n;
}

/** Dummy staffing for the seeded offerings: each course's class and lab
 *  sessions covered in full by the program's own instructors (round-robin per
 *  shift), each clinical shift by a preceptor at the site its weekly booking
 *  points to. Adjust any shift on the design page. */
export async function seedShiftAssignments(prisma: PrismaClient, institutionId: string) {
  const cohorts = await prisma.cohort.findMany({
    where: { program: { institutionId }, status: { in: ["planned", "active"] } },
    include: { program: { include: { terms: { include: { courses: { include: { sessions: { select: { id: true, kind: true, lengthHours: true, maxStudents: true, facultyNeeded: true, preceptorsNeeded: true } } } } } } } }, meetings: { select: { courseId: true, kind: true, sectionIndex: true, employerId: true } }, _count: { select: { students: true } } },
  });
  const people = await prisma.person.findMany({ where: { institutionId, active: true }, select: { id: true, role: true, title: true, employerId: true, name: true } });
  // Every site that hosts a clinical section has preceptors in that discipline — an RT
  // at each imaging site, a CST / OR RN at each surgical site — so no section is
  // precepted by someone from another field or left without a preceptor.
  const DISCIPLINE: { test: RegExp; title: RegExp; titles: string[] }[] = [
    { test: /Radiograph/i, title: /Radiolog|RT\(R\)|Radiograph|MRI/i, titles: ["Radiologic Technologist, RT(R)", "RT(R)(CT)", "Lead Radiographer"] },
    { test: /Surgical/i, title: /Surg|OR |CST|CSFA|Operating/i, titles: ["CST, Preceptor", "OR RN, Preceptor", "CSFA, Preceptor"] },
    { test: /Nurse Aide/i, title: /Nurse Aide|CNA|LPN|SNF|RN,/i, titles: ["LPN, Skilled Nursing", "Nurse Aide Preceptor, CNA II"] },
  ];
  const prand = rng(20260909);
  const usedNames = new Set(people.map((p) => p.name));
  const nextName = () => { for (;;) { const n = `${FIRST[Math.floor(prand() * FIRST.length)]} ${LAST[Math.floor(prand() * LAST.length)]}`; if (!usedNames.has(n)) { usedNames.add(n); return n; } } };
  const employerName = new Map((await prisma.employer.findMany({ where: { institutionId }, select: { id: true, name: true, organization: true } })).map((e) => [e.id, e]));
  for (const co of cohorts) {
    const disc = DISCIPLINE.find((d) => d.test.test(co.program.name));
    if (!disc) continue;
    const hostIds = [...new Set(co.meetings.filter((m) => m.kind === "CLINICAL" && m.employerId).map((m) => m.employerId!))];
    for (const eid of hostIds) {
      const have = people.filter((p) => p.role === "preceptor" && p.employerId === eid && disc.title.test(p.title ?? "")).length;
      const e = employerName.get(eid);
      for (let i = have; i < 2; i++) {
        const name = nextName();
        const row = await prisma.person.create({ data: { institutionId, name, role: "preceptor", title: `${disc.titles[i % disc.titles.length]} — ${e?.name ?? "partner site"}`, email: emailOf(name, e?.organization ? e.organization.toLowerCase().replace(/[^a-z]/g, "").slice(0, 14) + ".org" : "partner.org"), employmentType: "preceptor", active: true, employerId: eid, startDate: new Date(Date.UTC(2018 + Math.floor(prand() * 7), 2, 1)) }, select: { id: true, role: true, title: true, employerId: true, name: true } });
        people.push(row);
      }
    }
  }
  let made = 0;
  for (const co of cohorts) {
    const key = /Radiograph/i.test(co.program.name) ? /Radiograph/i : /Surgical/i.test(co.program.name) ? /Surgical/i : /Nurse Aide/i.test(co.program.name) ? /Nurse Aide/i : /./;
    const instructors = people.filter((p) => p.role === "instructor" && key.test(p.title ?? ""));
    if (!instructors.length) continue;
    const enrolled = Math.max(co._count.students, co.plannedSeats ?? 0, 1);
    // Class and lab shifts rotate through the instructors so nobody carries a
    // whole course alone; clinical shifts get a preceptor at the booked site
    // (clinical faculty are left for someone to assign by hand).
    let rr = 0;
    for (const t of co.program.terms) for (const c of t.courses) {
      for (const s of c.sessions) {
        const shifts = Math.max(1, Math.ceil(enrolled / Math.max(1, s.maxStudents)));
        if (s.kind === "CLINICAL") {
          if (s.preceptorsNeeded <= 0) continue;
          for (let sec = 1; sec <= shifts; sec++) {
            const m = co.meetings.find((x) => x.courseId === c.id && x.kind === "CLINICAL" && x.sectionIndex === sec) ?? co.meetings.find((x) => x.courseId === c.id && x.kind === "CLINICAL");
            // The preceptor must work at the site the section is booked at AND practise the
            // program's discipline (an RT precepts radiography, never a CMA at an office).
            const siteIds = m?.employerId ? [m.employerId] : [...new Set(co.meetings.filter((x) => x.kind === "CLINICAL" && x.employerId).map((x) => x.employerId!))];
            const disc = /Radiograph/i.test(co.program.name) ? /Radiolog|RT\(R\)|Radiograph|MRI/i : /Surgical/i.test(co.program.name) ? /Surg|OR |CST|CSFA|Operating/i : /Nurse Aide/i.test(co.program.name) ? /Nurse Aide|CNA|LPN|SNF|RN,/i : /./;
            const atSite = people.filter((p) => p.role === "preceptor" && p.employerId && siteIds.includes(p.employerId));
            const pool = atSite.filter((p) => disc.test(p.title ?? ""));
            const pre = pool.length ? pool[(sec - 1) % pool.length] : null;
            if (pre) { await prisma.sessionInstructor.create({ data: { cohortId: co.id, sessionId: s.id, personId: pre.id, sectionIndex: sec, role: "preceptor", contactHours: s.lengthHours, startOffsetMin: 0 } }); made++; }
          }
          continue;
        }
        for (let sec = 1; sec <= shifts; sec++) {
          const who = instructors[rr++ % instructors.length];
          await prisma.sessionInstructor.create({ data: { cohortId: co.id, sessionId: s.id, personId: who.id, sectionIndex: sec, role: "instructor", contactHours: s.lengthHours, startOffsetMin: 0 } });
          made++;
          if (s.facultyNeeded >= 2) { const second = instructors[rr++ % instructors.length]; if (second.id !== who.id) { await prisma.sessionInstructor.create({ data: { cohortId: co.id, sessionId: s.id, personId: second.id, sectionIndex: sec, role: "instructor", contactHours: s.lengthHours, startOffsetMin: 0, segment: "co-teaching" } }); made++; } }
        }
      }
    }
  }
  return made;
}
