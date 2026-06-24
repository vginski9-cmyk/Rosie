# Rosie — Data Model

The canonical model lives in [`prisma/schema.prisma`](../prisma/schema.prisma).
Dev runs on SQLite (boots instantly); the schema is written to be
Postgres-portable (no native enums, no JSON/array columns, explicit tenant
scoping). This doc is the conceptual map.

## Tenancy

Every root entity carries `institutionId`. This is what lets Rosie start as a
single-institution tool but aggregate/disaggregate across institutions later
without a rewrite. `Institution` is the tenant root.

## Entity map

```
Institution ─┬─ Occupation ──< DemandProjection >── Region
             │        └─────────────┐
             ├─ Program ── Occupation (optional link to labor demand)
             │     ├─ ProgramYearTarget        (North Star: credentials/yr, cohort capacity)
             │     ├─ Cohort ──< FunnelStage    (talent pipeline: target vs actual)
             │     └─ Term ──< Course ──< Session
             │                              (CLASS | LAB | CLINICAL archetype)
             ├─ CalendarBlock                 (16/14/12/8/5-wk, holiday-adjusted weekdays)
             ├─ Employer ──< Person           (clinical/WBL partners + their slots)
             └─ Person                        (instructors, preceptors, support, coordinators)
```

## The three data "temperatures"

Rosie's tables fall into three groups, which matters for ETL and for reasoning
about the model:

1. **Strategic / demand (slow-moving facts).**
   `Occupation`, `Region`, `DemandProjection`. Sourced from Lightcast. Answers
   "how many workers does the region need, where, over time."

2. **Design / archetype (the blueprint — "one and done, mostly").**
   `Program`, `Term`, `Course`, `Session`. The instructional structure of *one
   student's* experience. Per the template instructions, this is entered once
   per program type and updated only when curriculum changes.

3. **Plan / actuals (the moving parts).**
   `Cohort`, `FunnelStage`, `ProgramYearTarget`, plus enrollment inputs.
   Target-vs-actual numbers that change every term and drive the engines.

The **engines** (`capacity.ts`, `funnel.ts`) combine (2) × (3), contextualized
by `CalendarBlock`, to produce operational output.

## Key entities

### Session — the atom of the model
A single required instructional experience for one student. The fields that
matter to the engine:
- `kind` — `CLASS | LAB | CLINICAL`
- `lengthHours` — duration of one delivered instance
- `maxStudents` — capacity of **one instance/section** (NOT the cohort)
- `facultyNeeded`, `supportStaffNeeded`, `preceptorsNeeded` — per instance
- `week`, `dayOfWeek` — when it occurs
- `rotationType`, `clinicalMode` — clinical-only (e.g. "Med-Surg",
  "preceptor-led")

> The user never enters cohort-scaled numbers here. 12 labs = 12 session rows,
> each describing what one lab looks like when delivered. The engine scales.

### DemandProjection — the labor-market fact
`occupation × region × year → { jobs, openings, growthPct, replacementPct,
turnoverPct }`. `openings = growth + replacement` (the Lightcast definition).

### FunnelStage — the pipeline
`cohort × stageKey → { targetNumber, actualNumber }`. Stage keys and order are
canonical (see `src/lib/funnel.ts STAGES`). Conversions, gaps, attainment, and
leak detection are all derived, not stored.

### CalendarBlock — the date dimension
A schedulable block within an academic term, with holiday-adjusted teachable
weekday counts (`nonHolidayMon..Fri`). This is what turns "4 weekly class hours"
into a real number of delivered sessions per term. 190 real blocks (2024–2033,
Spring/Summer/Fall, 16/14/12/8/5-week variants) are seeded from the Cape Fear
workbook.

### CalendarBlock note
v0.1's capacity engine uses term `startWeek/endWeek` for week counts; wiring the
holiday-adjusted block weekdays directly into the engine is a P1 item (see
ETL doc, "Calendar-aware capacity").

## Enums-as-strings (portability)

To keep the schema portable to SQLite and Postgres alike, enum-like fields are
`String` with documented allowed values:
- `Region.kind`: `NATIONAL | STATE | MSA | RADIUS_60 | RADIUS_45 | SERVICE_AREA`
- `Session.kind`: `CLASS | LAB | CLINICAL`
- `Program.status`: `active | draft | archived`
- `Person.role`: `instructor | support | preceptor | supervisor | coordinator`
- `CalendarBlock.termCode`: `SPRING | SUMMER | FALL`

When we move to Postgres in production we can promote these to native enums.

## What's intentionally NOT here yet

- **Alignment Engine (WBL)**: learner/employer motivation–constraint–capacity
  profiles and matches. Designed (see the Alignment Engine research doc the user
  provided) but not yet modeled — a P2 set of tables hanging off `Person` /
  `Employer` / `Cohort`.
- **Scenarios**: saved what-if capacity runs.
- **Assignments**: explicit Person↔Session/Course staffing rows (we compute FTE
  *demand* now; assigning specific people to it is P1).
- **Auth / users / roles**: tenancy is structural, not yet enforced by auth.
