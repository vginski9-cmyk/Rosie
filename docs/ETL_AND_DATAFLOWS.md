# Rosie — Data Flows

> **v0.2 update — the importer was removed.** Data is now **authored in-app**:
> Rosie is the system of record for program design. You create, edit, duplicate,
> and configure everything in the UI (`src/lib/actions.ts` server actions), and
> **Excel is an export only** (`/api/programs/[id]/export` → funnel + capacity +
> KSA coverage workbook). The spreadsheet-ingestion pipeline described below is
> retained for historical context and as a reference if a *bulk-onboarding*
> import is ever reintroduced as an option — but it is not part of the product.
> The **"data flow through the model"** section further down is still current and
> is the important part.

The original inputs that informed the data model are listed below, followed by
how data flows *through* the connected model once it's in Rosie.

## The inputs (from the provided artifacts)

| Source artifact | What it is | Maps to |
|---|---|---|
| `All_Institutions_All_Programs_Data_Table_for_Insights.xlsx` | System-wide reporting: FTEs required by semester/week, clinical rotation scheduling, talent-pipeline health across all institutions | `DemandProjection`, `FunnelStage`, capacity outputs (aggregated) |
| `Institution_Program_Template_Cape_Fear_CC…SOC_Code_Analysis.xlsx` | Per-program input: Lightcast demand by geography, credential targets, talent-pipeline targets, **term & block calendar**, holidays, date dimension | `Occupation`, `Region`, `DemandProjection`, `ProgramYearTarget`, `Cohort/FunnelStage`, **`CalendarBlock`** |
| `Updated_Program_Planning_Template…Course_Planning_Template.xlsx` | The "one student's experience" template: 12 terms, ≤8 courses each, class/lab/clinical session tables | `Program`, `Term`, `Course`, `Session` |
| `Sandhills_Nightingale_Pilot_Meeting…pptx` | The pilot briefing: demand/supply analysis, program effectiveness (PED), DRAFT North Star goals, target-vs-actual funnels, intervention plans | `ProgramYearTarget` (North Star), `FunnelStage` (target vs actual) |
| `alignmentengine_12.html` | Research model for work-based-learning: 3-layer motivations/constraints/capacities for learners & employers | Alignment Engine (P2) |

## The pipeline (3 stages)

```
  ┌──────────┐   ┌───────────────┐   ┌────────────────┐   ┌──────────────┐
  │  LAND    │ → │   DETECT &     │ → │   MAP & VALIDATE│ → │   LOAD       │
  │ (upload) │   │   PREVIEW      │   │  (typed records)│   │ (DB, upsert) │
  └──────────┘   └───────────────┘   └────────────────┘   └──────────────┘
   SheetJS read    header heuristics    per-entity mappers    Prisma upsert
   any .xlsx/.csv  → DetectedType       (calendar, demand…)   keyed by natural id
```

Implemented in:
- `src/lib/etl/parseWorkbook.ts` — `parseWorkbook()`, `detectType()`,
  `mapCalendarBlocks()` (pure, testable).
- `src/app/api/import/route.ts` — `action=preview` and `action=load`.
- `src/app/import/page.tsx` + `src/components/Importer.tsx` — the UI.

### Stage 1 — Land
Drag/drop or pick a workbook. Parsed in-memory with SheetJS; no file is stored.

### Stage 2 — Detect & preview
Each sheet's headers are matched against known shapes → a `DetectedType`:
`calendar_blocks | demand | funnel | program_structure | unknown`. The UI shows
every sheet, its detected type, row count, and a sample. This is deliberately
heuristic and transparent — the program lead confirms before loading.

> Verified against the real Cape Fear workbook: it correctly flags
> `INPUT TERM AND BLOCK INFO` (190 rows) as `calendar_blocks` and loads them.

### Stage 3 — Map, validate & load
Recognized sheets are mapped to typed records and `upsert`ed by natural key
(e.g. `CalendarBlock` by `institutionId + blockKey`), so re-importing is
idempotent — a clean program lead can re-upload an updated workbook without
creating duplicates.

## Data flow *through* the model (how the layers connect)

This is the connective tissue that the disconnected spreadsheets lack:

```
 Lightcast demand ──► DemandProjection ──► North Star goal (ProgramYearTarget)
                                               │
                                               ▼
                          sizeFunnelFromGoal() back-sizes the funnel
                                               │
   Program-planning template ──► Program/Term/Course/Session (archetype)
                                               │
        Cohort enrollment ──┐                  │
                            ▼                   ▼
        CalendarBlock ──►  programDemand()  ◄── (one-student archetype × enrollment)
                                               │
                                               ▼
                 sections · WBL slots · faculty FTE · preceptors · room-hours
                       (aggregate or disaggregate by term / course / kind / year)
```

- **Funnel ← demand**: `sizeFunnelFromGoal(productiveTarget, rates)` turns "29
  productive/yr" into the interest/qualified/offered/enrolled targets.
- **Capacity ← design × plan**: `programDemand(terms, enrollmentByTerm)` turns
  the archetype + enrollment into the operational footprint.
- **Leak detection**: `analyzeFunnel()` + `pipelineHealth()` compare actual vs.
  target conversion to find where the pipeline is losing people.

## What's built vs. planned

| Flow | Status |
|---|---|
| Land any workbook, detect sheet types, preview | ✅ |
| Load `calendar_blocks` (idempotent upsert) | ✅ |
| Seed full real dataset (demand, programs, sessions, funnels, 380 blocks) | ✅ |
| `demand` sheet → `DemandProjection` loader | ⏳ P1 |
| `program_structure` template → Term/Course/Session loader | ⏳ P1 |
| `funnel` sheet → Cohort/FunnelStage loader | ⏳ P1 |
| Calendar-aware capacity (use block non-holiday weekdays in the engine) | ⏳ P1 |
| Excel/CSV **export** of capacity & funnel outputs | ⏳ P1 |
| Scheduled/background ETL + reconciliation views for data teams | ⏳ P2 |

## Design principles for the ETL

1. **Excel-in, Excel-out.** Program leads live in spreadsheets; meet them there.
2. **Transparent detection.** Never silently transform — show what was detected
   and let the user confirm before loading.
3. **Idempotent loads.** Upsert by natural key so re-imports are safe.
4. **Pure mappers.** Parsing/mapping logic has no DB dependency, so it's unit-
   testable and reusable client- or server-side.
5. **Tenant-scoped writes.** Every load targets a specific `institutionId`.
