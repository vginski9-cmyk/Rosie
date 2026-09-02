// Dummy roster so assignments can be made on day one: campus rooms and labs,
// a full instructor / support-staff bench, preceptors attached to real
// partner sites (with agreement statuses set), and a handful of locked-in,
// calendarized offerings whose sections are waiting for people, rooms and sites.
// Every name here is invented.

import type { PrismaClient } from "@prisma/client";
import { deriveTermStarts } from "../src/lib/term";
import { deriveCohortTargets } from "../src/lib/pipeline";
import { BENCHMARK_RATES } from "../src/lib/northstar";
import { STAGES } from "../src/lib/funnel";
import { planMeetings } from "../src/lib/calendarize";

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
    { name: "Nurse Aide Lab", kind: "LAB", building: "Health Sciences", capacity: 10, areaSqft: 1100, equipment: "6 beds, Hoyer lift, ADL station" },
    { name: "Simulation Suite 1", kind: "SIM", building: "Health Sciences", capacity: 8, areaSqft: 900, equipment: "high-fidelity manikin, control room, debrief room" },
    { name: "Simulation Suite 2", kind: "SIM", building: "Health Sciences", capacity: 8, areaSqft: 900, equipment: "birthing simulator, pediatric manikin" },
    { name: "Mock OR 1", kind: "LAB", building: "Health Sciences", capacity: 10, areaSqft: 1000, equipment: "OR table, back tables, sterile core, scrub sinks" },
    { name: "Mock OR 2", kind: "LAB", building: "Health Sciences", capacity: 10, areaSqft: 1000, equipment: "OR table, laparoscopic tower" },
    { name: "Sterile Processing Lab", kind: "LAB", building: "Health Sciences", capacity: 12, areaSqft: 800, equipment: "autoclave, ultrasonic cleaner, instrument sets" },
    { name: "Radiography Energized Lab", kind: "LAB", building: "Health Sciences", capacity: 8, areaSqft: 1200, equipment: "energized x-ray room, phantoms, CR/DR readers" },
    { name: "Radiography Positioning Lab", kind: "LAB", building: "Health Sciences", capacity: 12, areaSqft: 900, equipment: "non-energized tube stands, positioning aids" },
    { name: "Medical Assisting Clinic Lab", kind: "LAB", building: "Blue Hall", capacity: 14, areaSqft: 1000, equipment: "exam tables, EKG, phlebotomy station, autoclave" },
    { name: "Phlebotomy Lab", kind: "LAB", building: "Blue Hall", capacity: 12, areaSqft: 600, equipment: "venipuncture arms, centrifuge" },
    { name: "Computer Lab 1", kind: "OTHER", building: "Kennedy Hall", capacity: 28, areaSqft: 900, equipment: "28 workstations, EHR sandbox" },
    { name: "Computer Lab 2", kind: "OTHER", building: "Blue Hall", capacity: 24, areaSqft: 800, equipment: "24 workstations" },
    { name: "Anatomy & Physiology Lab", kind: "LAB", building: "Van Dusen Hall", capacity: 24, areaSqft: 1300, equipment: "anatomical models, microscopes" },
    { name: "Van Dusen Hall 140", kind: "CLASSROOM", building: "Van Dusen Hall", capacity: 36, areaSqft: 850, equipment: "projector" },
    { name: "Van Dusen Hall 142", kind: "CLASSROOM", building: "Van Dusen Hall", capacity: 36, areaSqft: 850, equipment: "projector" },
  ];
  await prisma.facility.createMany({ data: ROOMS.map((r) => ({ institutionId, ...r, hours: "Mon–Fri 7:30a–9:30p · Sat 8a–2p", availability: "open for scheduling", status: "active" })) });
  const rooms = await prisma.facility.findMany({ where: { institutionId, status: "active" }, select: { id: true, name: true, kind: true, capacity: true } });

  // ── Partner sites: agreement statuses & slots ─────────────────────────────
  const employers = await prisma.employer.findMany({ where: { institutionId }, include: { units: { select: { unitCategory: true } } } });
  const isHospital = (e: typeof employers[number]) => (e.licensedBeds ?? 0) > 0 || (e.operatingRooms ?? 0) > 0;
  const isLtc = (e: typeof employers[number]) => (e.nursingHomeBeds ?? 0) > 0 || (e.adultCareBeds ?? 0) > 0;
  const hospitals = employers.filter((e) => e.status === "active" && isHospital(e)).sort((a, b) => (b.licensedBeds ?? 0) - (a.licensedBeds ?? 0));
  const ltcs = employers.filter((e) => e.status === "active" && !isHospital(e) && isLtc(e)).sort((a, b) => (b.nursingHomeBeds ?? 0) - (a.nursingHomeBeds ?? 0));
  const offices = employers.filter((e) => e.status === "active" && !isHospital(e) && !isLtc(e));
  const plan: { id: string; agreementStatus: string; wblSlots: number; notes: string }[] = [];
  hospitals.forEach((e, i) => plan.push({ id: e.id, agreementStatus: i < 5 ? "secured" : i < 8 ? "asked" : i < 11 ? "prospect" : "none", wblSlots: i < 5 ? 12 : 8, notes: i < 5 ? "Affiliation agreement on file through 2028." : i < 8 ? "Agreement sent to education dept.; awaiting signature." : "" }));
  ltcs.forEach((e, i) => plan.push({ id: e.id, agreementStatus: i < 6 ? "secured" : i < 9 ? "asked" : i < 12 ? "prospect" : "none", wblSlots: i < 6 ? 6 : 4, notes: i < 6 ? "NATCEP-eligible; agreement on file." : "" }));
  offices.forEach((e, i) => plan.push({ id: e.id, agreementStatus: i < 5 ? "secured" : i < 8 ? "asked" : i < 10 ? "prospect" : "none", wblSlots: i < 5 ? 3 : 2, notes: i < 5 ? "Hosts MA externs; agreement on file." : "" }));
  for (const p of plan) await prisma.employer.update({ where: { id: p.id }, data: { agreementStatus: p.agreementStatus, wblSlots: p.wblSlots, agreementNotes: p.notes || null } });

  // ── Instructors & support staff ───────────────────────────────────────────
  const INSTRUCTORS: { title: string; count: number; types: string[] }[] = [
    { title: "Surgical Technology Instructor, CST", count: 4, types: ["full-time", "full-time", "part-time", "adjunct"] },
    { title: "Surgical Technology Clinical Coordinator, CST, CSFA", count: 1, types: ["full-time"] },
    { title: "Radiography Instructor, RT(R)", count: 5, types: ["full-time", "full-time", "full-time", "part-time", "adjunct"] },
    { title: "Radiography Clinical Coordinator, RT(R)(CT)", count: 1, types: ["full-time"] },
    { title: "Nursing Instructor, RN, MSN", count: 6, types: ["full-time", "full-time", "full-time", "part-time", "adjunct", "adjunct"] },
    { title: "Nurse Aide Instructor, RN", count: 4, types: ["full-time", "part-time", "part-time", "adjunct"] },
    { title: "Medical Assisting Instructor, CMA (AAMA)", count: 4, types: ["full-time", "full-time", "part-time", "adjunct"] },
    { title: "Anatomy & Physiology Instructor", count: 2, types: ["full-time", "adjunct"] },
    { title: "Simulation Educator, RN", count: 2, types: ["full-time", "part-time"] },
    { title: "Clinical Placement Coordinator", count: 1, types: ["full-time"] },
  ];
  const people: { institutionId: string; name: string; role: string; title: string; email: string; employmentType: string; active: boolean; employerId?: string | null; startDate: Date }[] = [];
  for (const g of INSTRUCTORS) for (let i = 0; i < g.count; i++) {
    const name = nextName();
    people.push({ institutionId, name, role: /Coordinator/.test(g.title) ? "coordinator" : "instructor", title: g.title, email: emailOf(name, "sandhills.edu"), employmentType: g.types[i] ?? "adjunct", active: true, startDate: new Date(Date.UTC(2015 + Math.floor(rand() * 10), 7, 1)) });
  }
  const SUPPORT = ["Skills Lab Assistant", "Simulation Technician", "Sterile Processing Lab Technician", "Radiography Lab Technologist", "Health Sciences Lab Coordinator", "Medical Assisting Lab Assistant", "Nurse Aide Lab Assistant", "Academic Support Specialist"];
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
    const cats = [...new Set(e.units.map((u) => u.unitCategory))];
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
  const hostIds = plan.filter((p) => p.agreementStatus === "secured").map((p) => p.id);
  const OFFERINGS: { program: string; start: string; goal: number }[] = [
    { program: "Surgical Technology", start: "2026-08-17", goal: 12 },
    { program: "Radiography", start: "2026-08-17", goal: 14 },
    { program: "Radiography — Evening Track", start: "2027-01-11", goal: 8 },
    { program: "Medical Assisting", start: "2026-08-17", goal: 18 },
    { program: "Nurse Aide I — 6-Week Term", start: "2026-08-17", goal: 10 },
    { program: "Nurse Aide I — 12-Week Day Term", start: "2027-01-11", goal: 12 },
  ];
  let offerings = 0, meetings = 0;
  for (const o of OFFERINGS) {
    const program = await prisma.program.findFirst({ where: { institutionId, name: o.program }, include: { terms: { orderBy: { index: "asc" }, include: { courses: { include: { sessions: { select: { kind: true, maxStudents: true, lengthHours: true } } } } } }, cohorts: { select: { name: true } } } });
    if (!program) continue;
    const t = deriveCohortTargets(o.goal, BENCHMARK_RATES, Math.max(1, program.terms.length));
    const termWeeks = program.terms.map((term) => (term.endWeek ?? 16) - (term.startWeek ?? 1) + 1);
    const termStarts = deriveTermStarts(o.start, termWeeks, anchors);
    const endYear = new Date(termStarts[termStarts.length - 1].getTime() + termWeeks[termWeeks.length - 1] * 7 * 86400000).getUTCFullYear();
    let name = `Class of ${endYear}`;
    if (program.cohorts.some((c) => c.name === name)) { let n = 2; while (program.cohorts.some((c) => c.name === `${name} (${n})`)) n++; name = `${name} (${n})`; }
    const startD = new Date(o.start + "T00:00:00Z");
    const cohort = await prisma.cohort.create({ data: { programId: program.id, name, status: "planned", startDate: startD, entryYear: startD.getUTCFullYear(), isExplicit: true, plannedSeats: Math.round(t.capacity) } });
    const stageTargets: Record<string, number> = { interested: t.interested, qualified: t.qualified, offered: t.offered, enrolled: t.capacity, completing: t.completing, licensed: t.licensed, placed: t.placed, productive: t.productive };
    await prisma.funnelStage.createMany({ data: STAGES.map((s, i) => ({ cohortId: cohort.id, stageKey: s.key, sortOrder: i, label: s.label, targetNumber: Math.round(stageTargets[s.key] ?? 0) })) });
    for (let i = 0; i < program.terms.length; i++) await prisma.cohortTerm.create({ data: { cohortId: cohort.id, termId: program.terms[i].id, startDate: termStarts[i] } });
    const rows = planMeetings({
      cohortId: cohort.id, seats: Math.round(t.capacity), cohortStartMs: startD.getTime(),
      terms: program.terms.map((term, i) => ({ id: term.id, index: term.index, startWeek: term.startWeek, endWeek: term.endWeek, startMs: termStarts[i].getTime(), courses: term.courses })),
      rooms, hostIds,
    });
    for (let i = 0; i < rows.length; i += 400) await prisma.meetingPattern.createMany({ data: rows.slice(i, i + 400) });
    offerings++; meetings += rows.length;
  }

  return {
    rooms: rooms.length,
    instructors: people.filter((p) => p.role === "instructor" || p.role === "coordinator").length,
    support: people.filter((p) => p.role === "support").length,
    preceptors: people.filter((p) => p.role === "preceptor").length,
    secured: plan.filter((p) => p.agreementStatus === "secured").length,
    asked: plan.filter((p) => p.agreementStatus === "asked").length,
    offerings, meetings,
  };
}
