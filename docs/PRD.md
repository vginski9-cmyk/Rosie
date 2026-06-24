# Rosie — Product Requirements Document (v0.1)

> Workforce-aligned education program planning, capacity modeling, and
> stakeholder coordination. Rosie helps program leads build, calendar, staff,
> and scale education programs *with fidelity* — from labor-market demand all
> the way down to how many clinical slots and instructors next Tuesday requires.

Status: **living document.** v0.1 reflects the first end-to-end vertical slice
that is actually built and running (see [Implementation status](#11-implementation-status)).
Everything else is the roadmap we iterate against.

---

## 1. The problem

Education program leads — especially in workforce programs like nursing, allied
health, and the skilled trades — are asked to do five hard jobs at once, in
spreadsheets that don't talk to each other:

1. **Strategic planning** — How many graduates does the region actually need
   (the *North Star*), and for how many years?
2. **Program design** — What does the program *look like* — terms, courses,
   sessions, clinical rotations — for a single student to complete it?
3. **Program operations** — Given enrollment, how many sections, lab slots,
   clinical/WBL slots, instructors, preceptors, and rooms does that require,
   when, and where?
4. **Stakeholder engagement** — Coordinating instructors, support staff,
   employers, preceptors, supervisors, and K-12 partners around that plan.
5. **Enrollment & student success** — Managing the funnel from career awareness
   → interested → qualified → enrolled → completed → credentialed → placed →
   productive, and finding where it leaks.

Today these live in disconnected Excel workbooks (we have five of them). The
demand analysis doesn't flow into the program design; the program design doesn't
automatically compute staffing; the funnel targets aren't tied to the capacity
plan. Rosie makes them **one connected model.**

## 2. Who it's for

| Persona | Primary need |
|---|---|
| **Program lead / director** (e.g. "Lindsey") | Build the program, set multi-year goals, see where the pipeline leaks, justify capacity expansion. |
| **Dean / VP of Instruction** | Roll up demand and capacity across all programs; make staffing and investment decisions. |
| **Workforce / regional partnership** (e.g. Talent Partnership of the Sandhills) | Aggregate across institutions; coordinate employers and K-12; track the regional North Star. |
| **Clinical coordinator** | Forecast and place clinical/WBL slots against partner capacity. |
| **Institutional researcher / data team** | Land, clean, and reconcile the source spreadsheets (ETL). |

## 3. The core insight (the model that makes Rosie work)

The program-planning template the user already built encodes the key idea:

> **Model one student's required experience, then let the model scale it.**

You document, for each course, the sessions (class / lab / clinical) a *single*
student must attend, and what each session looks like *when delivered* — length,
how many students fit in one instance, how many faculty/preceptors/support staff
it needs, when it happens. You **never** manually scale for cohort size. Rosie
overlays enrollment (and a holiday-adjusted calendar) onto that archetype and
computes the real delivery footprint: total sections, WBL slots, instructor
FTEs, room-hours — by week, term, and year, aggregated or disaggregated however
you slice it.

This is the heart of the product and it is **built and tested** in v0.1
(`src/lib/capacity.ts`).

## 4. The five layers (product surface area)

```
   ┌─────────────────────────────────────────────────────────────┐
 1 │ STRATEGY   Labor-market demand → North Star goals (multi-yr) │  ← Lightcast SOC analysis
   ├─────────────────────────────────────────────────────────────┤
 2 │ PIPELINE   Talent funnel: interest → … → productive (T vs A) │  ← Talent Pipeline Health
   ├─────────────────────────────────────────────────────────────┤
 3 │ DESIGN     Program → Term → Course → Session archetype       │  ← Program Planning Template
   ├─────────────────────────────────────────────────────────────┤
 4 │ OPERATIONS Capacity engine: sections, WBL slots, FTEs, rooms │  ← FTE / clinical calc engine
   ├─────────────────────────────────────────────────────────────┤
 5 │ PEOPLE     Instructors, preceptors, employers, WBL matching  │  ← Alignment Engine (WBL)
   └─────────────────────────────────────────────────────────────┘
        All sit on a shared, multi-tenant data model + ETL.
```

### Layer 1 — Strategy: demand → North Star
- Ingest Lightcast occupation tables (jobs, annual openings = growth +
  replacement, turnover) across nested geographies: national → state → MSA →
  60-min → 45-min → service area.
- Wage vs. cost-of-living (MIT Living Wage) and job-posting/benefit context to
  judge whether a wage will attract candidates.
- Translate demand into a **North Star goal**: "produce, place, and regionally
  retain *N* fully-productive workers per year," multi-year.

### Layer 2 — Pipeline: the talent funnel
Canonical stages (target vs. actual at each):
`Interested → Qualified → Offered → Enrolled (Term 1) → Completing on time →
Passing licensure → Retained & placed regionally → Fully productive.`
- Back-size the funnel from the North Star using target conversion rates.
- Surface the **biggest leak** (where actual conversion falls furthest below
  plan) so interventions target the right stage (top vs. bottom of funnel).

### Layer 3 — Design: program structure
- Program (a "program type": Traditional ADN, LPN-to-RN, Accelerated BSN, …) →
  Terms (with instructional week windows) → Courses (weekly class/lab/clinical
  hours) → Sessions (the per-student required experiences).
- **Drag-and-drop** to sequence courses across terms and adjust the plan.

### Layer 4 — Operations: capacity engine
- Scale the archetype by enrollment (with attrition across terms) → sections,
  **WBL/clinical slots**, faculty FTE, preceptor slots, support staff, room-hours.
- Calendar/date dimension (16/14/12/8/5-week blocks, holiday-adjusted teachable
  weekdays) converts weekly structure into real per-term counts.
- "What-if" scenarios: change enrollment or term length, see staffing/space move.

### Layer 5 — People: stakeholders & WBL alignment
- Assign instructors, support staff, preceptors, supervisors; track workload.
- Employers / clinical partners and their **WBL slot capacity**.
- The **Alignment Engine**: the three-layer (motivations / constraints /
  capacities) model for learners *and* employers, to design and match
  work-based-learning placements with fidelity.

## 5. Goals & non-goals (v0.x)

**Goals**
- One connected model from demand → design → capacity → people.
- Faithful to the user's existing spreadsheets (we seed from the real data).
- Excel-in / Excel-out ETL so program leads keep working how they work.
- Multi-tenant-ready: one institution now, aggregate across many later.
- Drag-and-drop program sequencing.

**Non-goals (for now)**
- Not an SIS/LMS replacement (no grades, attendance, registration of record).
- Not a live timetable/room-assignment scheduler (we model *demand* for rooms,
  not the final room booking) — though that's a plausible later layer.
- Not a CRM (we model the funnel, not individual applicant outreach).

## 6. Key user journeys

1. **Set the North Star.** Import demand → review openings/turnover → set
   "29 rad-techs/yr" → Rosie back-sizes the funnel (83 interested → … → 29
   productive).
2. **See the leak.** Open the program → funnel shows actual vs. target →
   "biggest leak: Qualified applicants" → focus interventions on prereqs/advising.
3. **Design the program.** Enter terms/courses/sessions (or import the
   template). Drag courses to sequence them.
4. **Plan capacity.** Set proposed cohort size (e.g. 47 → 80 seats) → instantly
   see required sections, clinical slots, faculty FTE → take the staffing/space
   case to leadership.
5. **Coordinate stakeholders.** Match clinical slots to employer WBL capacity;
   assign preceptors; track instructor workload.

## 7. Requirements (prioritized)

**P0 (the slice — built in v0.1)**
- Multi-tenant data model (Institution → everything).
- Capacity engine (one-student → cohort) with unit tests.
- Talent-pipeline funnel with target-vs-actual + leak detection.
- Program structure browse + drag-and-drop course sequencer (persisted).
- ETL: upload a workbook, auto-detect sheet type, preview, load calendar blocks.
- Seeded with real Sandhills (rad-tech, surg-tech) + Cape Fear data.

**P1 (next)**
- Full importer for the program-planning template (terms/courses/sessions) and
  Lightcast demand exports.
- Session/course CRUD editing UI (not just sequencing).
- Calendar-aware capacity (use block non-holiday weekdays, not just term weeks).
- Multi-year, multi-cohort capacity roll-ups (aggregate/disaggregate).
- Auth + real tenancy boundaries.

**P2 (later)**
- Alignment Engine (WBL motivations/constraints/capacities) profiling & matching.
- Scenario compare & save; workload dashboards per instructor.
- Cross-institution regional roll-ups; accreditation report exports.
- Postgres deployment; background ETL jobs; "data team" reconciliation views.

## 8. Data model

See [`DATA_MODEL.md`](./DATA_MODEL.md). Implemented in `prisma/schema.prisma`.

## 9. ETL & data flows

See [`ETL_AND_DATAFLOWS.md`](./ETL_AND_DATAFLOWS.md).

## 10. Tech & architecture

- **Next.js 14 (App Router) + TypeScript + Tailwind** — one language across UI
  and server; first-class for the drag-and-drop + charts.
- **Prisma + SQLite (dev) → Postgres (prod)** — schema written portable, with
  `institutionId` on every root entity for multi-tenancy.
- **Pure-TS engine** (`src/lib/capacity.ts`, `funnel.ts`) — runs server- or
  client-side, fully unit-tested, the durable core.
- **SheetJS** for ETL ingestion; **Recharts** for funnel viz; **dnd-kit** for
  sequencing.

## 11. Implementation status

| Capability | Status |
|---|---|
| Multi-tenant schema (23 models) | ✅ built |
| **Integration engine** — multi-cohort calendar overlay + supply/demand reconciliation (`plan.ts`); see [`INTEGRATION.md`](./INTEGRATION.md) | ✅ built |
| **Operations plan** — concurrent demand vs faculty/preceptor/WBL supply, bottleneck board, staff assignments | ✅ built |
| **Skills loop** — design (benchmark) → delivery (`SessionSkill`) → assessment coverage | ✅ built |
| Bottleneck surfacing on dashboard + program banner | ✅ built |
| Capacity + funnel engines (27 passing tests, incl. KSA + WBL + plan) | ✅ built |
| Dashboard (portfolio, North Star, leak) | ✅ built |
| Program page (structure + funnel + live capacity + KSA coverage) | ✅ built |
| Drag-and-drop sequencer (persisted) | ✅ built |
| **In-app authoring** (new/duplicate/delete program; CRUD terms/courses/sessions; edit funnel) | ✅ built |
| **KSA framework** (skill library, shared proficiency scale + per-skill descriptors, program/course mapping, graduate benchmarks, coverage analysis) | ✅ built |
| **WBL Alignment Engine** (learner/employer profiles; motivations/constraints/capacities; live alignment + dealbreaker detection) | ✅ built |
| **Excel export** (funnel + capacity + KSA coverage workbook) | ✅ built |
| Seed from real Sandhills/Cape Fear artifacts | ✅ built (2 inst., 3 programs, 292 sessions, 380 blocks, 5 KSAs, 2 WBL profiles) |
| ~~ETL importer~~ | ❌ removed — all data is authored in-app by design |
| Session-level inline editing polish, bulk ops | ⏳ P1 |
| WBL: persisted matches, match-key autocomplete, life-stage/sector modifiers | ⏳ P1 |
| Auth / Postgres / regional roll-ups | ⏳ P2 |

> **v0.2 direction change:** data is **authored in-app**, not imported. Rosie is
> the system of record for program design — create, edit, duplicate, and
> configure everything in the UI; Excel is an **export** (data out), not an
> import path.

## 12. Open questions (to resolve as we iterate)

1. **Faculty load standard** — how is 1.0 FTE defined (weekly contact hours vs.
   credit/load units)? Currently a configurable parameter (default 15 hrs/wk).
2. **WBL slot semantics** — is a "slot" a student-seat at a site, or a
   rotation-group? v0.1 treats a clinical *section* as a placement group; we may
   want both seat-level and group-level views.
3. **Funnel actuals source** — manual entry, SIS export, or both?
4. **Aggregation rules** — when rolling up across programs/institutions, how do
   we handle shared faculty, shared clinical sites, and double-counting?
5. **Alignment Engine integration** — does WBL matching drive clinical capacity,
   or sit alongside it?
