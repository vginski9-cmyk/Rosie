// The glossary — one term per concept, used the same way on every screen (Phase 2 of
// docs/metrics-audit.md). `docs/glossary.md` is generated from this file (`npm run glossary`)
// and the /glossary page renders it; test/glossary.test.ts keeps the three in step and keeps
// the retired synonyms out of the UI.

export interface GlossaryTerm {
  /** Anchor id. */
  key: string;
  term: string;
  definition: string;
  /** Words that used to mean the same thing on some screens — retired. */
  retired?: string[];
  /** Related terms that are NOT the same thing, and how they differ. */
  notThe?: string;
  /** Where it shows up. */
  where?: string;
}

export interface GlossarySection { title: string; terms: GlossaryTerm[] }

export const GLOSSARY: GlossarySection[] = [
  {
    title: "Programs and the people in them",
    terms: [
      { key: "program-family", term: "Program family", definition: "Every program at one college that trains for one occupation — Radiography at Sandhills, Nurse Aide Level I at Lenoir. The family owns the North Star goal, the health rates, the credentialing body's requirement set and the agreements with clinical sites.", retired: ["family (short form is fine)", "delivery-model group"], notThe: "The occupation (the target job) is what the family trains for; the family is the college's set of programs for it.", where: "Home, the program workspace, the clinical hub" },
      { key: "program", term: "Program", definition: "One designed structure inside a family: its terms, courses and sessions, the maximum cohort it can hold, and the workbook it was imported from. \"Nurse Aide Level I — 6-week offering\" is a program; the family Nurse Aide Level I has six of them.", retired: ["delivery model", "model"], notThe: "The design pages still say \"template\" for the program's structure as designed, as opposed to an offering's dated copy of it.", where: "Programs, Design & sequence, the goal page's program cards" },
      { key: "offering", term: "Offering", definition: "One dated run of a program: a start date, term dates on the college calendar, section bookings, staff, and the students in it. An offering is what the goal page locks in and what the calendar, staffing and scheduler count.", retired: ["instantiation", "class", "run"], notThe: "A cohort is the students in an offering, not the run itself.", where: "Programs › Offerings, the goal page, every Insights view" },
      { key: "cohort", term: "Cohort", definition: "The students enrolled in one offering, as a group: cohort size, maximum cohort, \"the cohort splits into four sections\". Cohort names (\"Cohort 39\", \"Class of 2028\") name the offering's students.", notThe: "Not a synonym for the offering. Say offering for the dated run and cohort for its people.", where: "Enrollment figures, section splits, the students page" },
      { key: "term", term: "Term and semester", definition: "A term is a block of weeks in a program's structure (Term 1 … Term 5); the offering places each term on real dates. A semester is the college calendar period a term lands in (Fall 2026).", where: "Design & sequence, the offering's term dates, the academic calendar" },
      { key: "session", term: "Session", definition: "One recurring meeting type of a course as designed: class, lab or clinical, with its length in hours, the most students it can hold, and the faculty, support staff and preceptors one run of it needs. Sessions are what one student sits through.", where: "Design & sequence (Sessions row), the course page" },
      { key: "section", term: "Course section", definition: "One of the groups a session's enrollment is split into when it exceeds the session's maximum: ROUNDUP(enrollment ÷ max students). \"Section 2 of 4\". A student sits in one section per course kind.", retired: ["group"], notThe: "A section is a group of students; a shift is that group on one date.", where: "Students › sections, the offering's weekly pattern, the master calendar's section table" },
      { key: "section-booking", term: "Section booking", definition: "A section's weekly slot on the calendar: day, time, room or clinical site, and the people who staff it. One booking per section per course kind; the master calendar, the offering page and the coverage view all edit the same record.", retired: ["meeting", "meeting pattern", "weekly pattern (the set of bookings)"], where: "The offering's weekly pattern, the master calendar, a site's \"Booked here\"" },
    ],
  },
  {
    title: "Shifts, seats and bookings",
    terms: [
      { key: "shift", term: "Shift", definition: "One section on one date — a dated occurrence of a session. \"Shifts needed\" is each session run as many times as its capacity needs (class, lab and clinical), and a clinical shift is the unit the scheduler places at a site. A shift needs a room or site and a person to run it.", retired: ["section (for a dated occurrence)", "section-meeting", "section-shift", "occurrence"], where: "Design & sequence (Shifts row), the scheduler, coverage, staffing" },
      { key: "learner-shift", term: "Learner-shift", definition: "One student on one shift: a seat on a date. The scheduler's demand is counted in learner-shifts and learner-hours.", where: "The scheduler's Demand tile and bottlenecks" },
      { key: "asset-booking", term: "Asset booking", definition: "A site's asset — a room, unit or machine — reserved for a shift on a date and shift block (day, evening, night). Applying a scheduler plan writes asset bookings; they are not learner-shifts.", where: "The scheduler's apply notice, clinical site capacity" },
      { key: "student-attendance", term: "Student-attendance", definition: "One student counted once for each session they attend that day. Daily coverage shows distinct students (each person once) and, beside it, student-attendances: on Aug 17, 2026 the 41 radiography students in class and lab plus 19 surgical technology students are 60 students and 101 student-attendances.", where: "Daily coverage" },
      { key: "clinical-placement", term: "Clinical placement", definition: "A section or a student placed at a clinical site for a shift or a rotation. Always say clinical placement; a placement on its own is ambiguous.", notThe: "An employment placement is a graduate in a job.", where: "The scheduler, the coverage view's clinical chips, the rotation board" },
      { key: "employment-placement", term: "Employment placement and work-based learning placement", definition: "An employment placement is a graduate placed in a job — the funnel's \"retained & placed in a regional job\" stage. A work-based learning placement is a student's employer placement recorded on the student page (planned, active, completed), separate from their clinical shifts.", notThe: "Neither is a clinical placement.", where: "The talent pipeline, the student page, a site's \"Booked here\"" },
    ],
  },
  {
    title: "Staffing",
    terms: [
      { key: "fte", term: "FTE — cumulative vs peak concurrent", definition: "A full-time equivalent of contact hours. Cumulative semester-FTE adds each term's FTE over the whole program (73.8 preceptor FTE is a budget total across five terms, not people on site at once). Peak concurrent FTE is the busiest week ÷ the work week: the people needed at the same time. Both are labeled as such.", where: "Design & sequence, instructors & preceptors needed" },
      { key: "faculty-vs-preceptor", term: "Faculty vs preceptor", definition: "Faculty (instructors and support staff) are college-paid and cover class, lab and instructor-led clinicals. Preceptors are a partner site's own staff supervising students on a precepted clinical, typically one to one. The two are never added into one figure.", where: "Every staffing view" },
      { key: "instructor-led-vs-precepted", term: "Instructor-led vs precepted clinical", definition: "An instructor-led clinical is a section supervised by college faculty at a site (one instructor per section). A precepted clinical pairs each student with a site preceptor, so each student is their own shift and clinical placement.", where: "Session design, coverage, the scheduler" },
    ],
  },
  {
    title: "Goals and the talent pipeline",
    terms: [
      { key: "north-star", term: "North Star goal", definition: "How many fully productive workers a family must add to the region in a year. Everything upstream — enrollment capacity, offers, qualified applicants, interested candidates — is derived from it by the health rates.", where: "Home, the goal page" },
      { key: "required-count", term: "Required count (pipeline target)", definition: "The number a pipeline stage must reach for the goal to hold. Required counts round UP on screen and read \"at least 83\" when the calculation is fractional; hover a target for the calculation. Actuals are counts of real students and never round up.", where: "The goal page, the offering funnel, the pipeline analytics board" },
      { key: "health-rates", term: "Health rates", definition: "The conversion rates between pipeline stages (enrollment rate, completion rate, licensure pass rate, placement rate, productivity rate) and the surpluses above capacity (interested, qualified, offered). Family defaults; an offering may carry its own.", where: "The goal page, the offering's targets editor" },
    ],
  },
  {
    title: "Clinical sites and supply",
    terms: [
      { key: "clinical-site", term: "Clinical site (partner)", definition: "An employer that hosts clinical shifts. Its agreement with the college is none, prospect, asked, secured or declined; a family may hold its own agreement with the site, which wins over the institution's.", retired: ["employer (as the noun for a hosting site)"], where: "Clinical sites, a site's page, the family's site setup" },
      { key: "asset", term: "Asset and setting", definition: "An asset is a room, unit or machine at a site with a setting code (GEN, ORS, ED …), the days and shift blocks it runs, and the learners it hosts per shift. A setting is the kind of clinical experience an asset provides; a program's service areas map to settings.", where: "A site's assets, clinical site capacity, the scheduler" },
      { key: "supply-ceiling", term: "Supply ceiling, hostable, placed", definition: "The supply ceiling is every asset-shift × learners per shift in the window — a theoretical maximum, not usable capacity. Hostable by secured sites is the part of demand that fits at sites with a secured agreement. Placed is what the scheduler actually put on an asset under its levers; seats-only placement is exploratory (nobody may be free to precept).", where: "The scheduler's tiles, clinical site capacity, site load" },
      { key: "requirement", term: "Requirement set, item and provision", definition: "The credentialing body's list for a family (ARRT competencies, AST case categories, CMS hours): the set, its items (each with a category, mandatory or elective, and the settings that can provide it), and a provision — whether a given site provides an item, confirmed with the site, estimated, or only inferred from its assets. A case-log standard's rules (total volume, the First Scrub role, a spread of specialties) are scored as requirement lines beside the items.", where: "The clinical hub's requirements panel, a site's provision checklist, the student's requirement log" },
      { key: "evidence-status", term: "Evidence status", definition: "How well a site-experience capability is known, on one ladder: inferred (the asset map implies it, or someone entered an estimate), confirmed (the site said so — a VERIFIED record with who and when), committed (confirmed, with a secured agreement, accreditor recognition where required, and a capacity figure on record), scheduled (a booking exists), verified complete (a preceptor-verified student log). Every headline is computed from the weakest required input: \"Potential coverage identified for 42/42. Confirmed: 0/42.\" Only confirmed and above may read as success. Unknown (no asset, no answer) is neither zero nor available, and a service line a generic asset does not imply reads \"possible\" until the site confirms it.", retired: ["covered (as a success word for an inferred provider)"], where: "Every coverage headline, the requirements panel, a site's setup steps and provision checklist" },
      { key: "scope-strip", term: "Scope strip", definition: "The line above every capacity, coverage, staffing and scheduler view saying what the numbers are (requirements, a proposed scenario or the applied plan), whose enrollment they count, the date window, the constraints enforced, when they were computed, and why a sibling view differs.", where: "Insights" },
    ],
  },
  {
    title: "Expansion and assumptions",
    terms: [
      { key: "scenario", term: "Scenario", definition: "A named what-if for one program: a workforce target, a design (an additional cohort, a larger cohort, an accelerated or hybrid track, new geography, a shared regional cohort, or better retention), its dated proposed cohorts, its own assumption overrides and the saved answer. Nothing in a scenario touches the operating plan; one can be marked recommended.", notThe: "An offering is a cohort the college has committed to run; a scenario's proposed cohorts are hypothetical until someone creates offerings from them.", where: "Scenarios" },
      { key: "binding-constraint", term: "Binding constraint", definition: "The first thing that runs out when a scenario's cohorts are laid over every offering already planned: faculty FTE in the peak week, preceptor-shifts at secured sites, learner seats on a date × shift × setting (physical, or only the agreements), rooms, the accreditor's capacity, the pipeline of applicants, or time (the lead times cannot land before the first start). Each one says what it is, when it first bites, by how much, and the smallest change that would relieve it.", retired: ["bottleneck (as a scenario verdict)"], where: "Scenarios" },
      { key: "assumption-registry", term: "Assumption registry", definition: "Every planning figure the answers depend on — pipeline rates, lags to a productive worker, lead times, costs, supervision ratios — with its value, range, source, owner, status (default, estimate, verified) and review date. Values resolve from the most specific scope set: program → job family → college → workspace → the shipped default. A default is always shown as a default.", notThe: "A scenario override changes the figure for one scenario only and never writes to the registry.", where: "Scenarios, Setup → Planning assumptions" },
    ],
  },
];

export const GLOSSARY_TERMS: GlossaryTerm[] = GLOSSARY.flatMap((s) => s.terms);

/** The Markdown for docs/glossary.md — generated, never hand-edited. */
export function glossaryMarkdown(): string {
  const out: string[] = [
    "# Rosie glossary",
    "",
    "One term per concept, used the same way on every screen. Generated from `src/lib/glossary.ts` (`npm run glossary`); the same content is on the site at `/glossary`. Retired words are ones that used to mean the same thing somewhere in the UI and no longer appear.",
    "",
  ];
  for (const s of GLOSSARY) {
    out.push(`## ${s.title}`, "");
    for (const t of s.terms) {
      out.push(`### ${t.term}`, "", t.definition, "");
      if (t.retired?.length) out.push(`- **Retired:** ${t.retired.join(", ")}`);
      if (t.notThe) out.push(`- **Not the same as:** ${t.notThe}`);
      if (t.where) out.push(`- **Where:** ${t.where}`);
      out.push("");
    }
  }
  return out.join("\n");
}
