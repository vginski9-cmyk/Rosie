# Rosie — How it all integrates (the overall engine)

The whole point of Rosie is that the pieces are **not** separate tools. The
source spreadsheets each model one slice in isolation; Rosie wires them into one
engine where **everything is either supply or demand against capacity**, and a
change anywhere ripples everywhere.

## The one-paragraph model

Labor-market **demand** sets a **North Star** (grads/yr). The **funnel** back-sizes
that into **seats per cohort**. A **cohort series** (one entering each year) is
overlaid on the **academic calendar**, so several cohorts are in-flight at once.
The **capacity engine** scales each program's *one-student archetype* by each
active cohort's enrollment and **sums the concurrent demand** per academic term —
sections, clinical/WBL slots, faculty FTE, preceptors, rooms. That demand is
**reconciled against supply**: staff **assignments**, the preceptor pool, and
employer **WBL slots** → **bottlenecks**. Meanwhile **skills (KSAs)** thread the
whole way through: they shape **design** (benchmarks + curriculum map), scale with
**delivery** (sessions that build a skill), and drive **assessment** (sessions
that assess it → competency that feeds the funnel's completion stage).

## The dependency graph (who feeds whom)

```
 Lightcast DEMAND ──────────────► North Star (ProgramYearTarget.credentialTarget)
   (DemandProjection)                     │
                                          ▼
                         FUNNEL  ◄── conversion rates (FunnelStage)
                  sizeFunnelFromGoal()    │  back-sizes → seats/cohort
                                          ▼
                       cohortSeriesFromYearTargets()  (one cohort per year)
                                          │
   ACADEMIC CALENDAR ──────────────►  buildAcademicPlan()  ◄── PROGRAM ARCHETYPE
   (calendar.ts term ordinals)         multi-cohort overlay      (Term→Course→Session)
                                          │                         │
                                          │                     CAPACITY ENGINE
                                          │                     termDemand() per
                                          │                     active (cohort,term)
                                          ▼
                         CONCURRENT DEMAND per academic term
              sections · clinical/WBL slots · faculty FTE · preceptors · rooms
                                          │
              ┌───────────────────────────┼───────────────────────────┐
              ▼                            ▼                            ▼
     EMPLOYER WBL SLOTS            STAFF ASSIGNMENTS             PRECEPTOR POOL
     (Employer.wblSlots)          (Assignment.fteCommitment)    (Assignment role)
              │                            │                            │
              └───────────► SUPPLY vs DEMAND RECONCILIATION ◄───────────┘
                                  (plan.ts gaps) → BOTTLENECKS
                       surfaced on dashboard · program · ops plan

 SKILLS (KSA) cut across DESIGN → DELIVERY → ASSESSMENT:
   ProgramSkill (graduate benchmark) ─► analyzeCoverage(): does curriculum reach it?
   CourseSkill  (introduced/reinforced/mastered) ─┘
   SessionSkill (DELIVER) ─► scales with capacity (sessions × enrollment)
   SessionSkill (ASSESS)  ─► assessmentCoverage(): is each benchmark measured?
                                  └─► (future) competency throughput → funnel "completing"
```

## Concrete ripple examples

- **Raise the North Star** (more grads/yr) → funnel needs more interested/qualified
  → bigger cohorts → the ops plan's concurrent demand rises → faculty/clinical
  bottlenecks light up on the dashboard, program page, and ops plan.
- **Add a clinical course / change a session's group size** in the structure
  editor → capacity recomputes clinical sections → WBL-slot demand shifts → the
  reconciliation vs `Employer.wblSlots` updates.
- **Assign another instructor** (or raise FTE) on the ops plan → faculty supply
  rises → faculty bottlenecks shrink, live.
- **Map a skill to a course but never tag a session as ASSESS** → curriculum
  coverage says "met" but assessment coverage flags it as *taught-but-unassessed*.
- **Sequence/duplicate a program** → the archetype changes → every downstream
  number (capacity, plan, coverage, export) follows because they all read the
  same authored structure.

## Where the engines live

| Concern | Module | Integrates |
|---|---|---|
| One student → cohort footprint | `src/lib/capacity.ts` | archetype × enrollment |
| Funnel math + leak detection | `src/lib/funnel.ts` | demand → seats |
| Academic-term ordinals | `src/lib/calendar.ts` | cohort overlay |
| **Multi-cohort plan + supply/demand** | `src/lib/plan.ts` | **the hub** |
| KSA coverage + assessment | `src/lib/ksa.ts` | design ↔ delivery ↔ assessment |
| WBL alignment (+ modifiers/disclosure) | `src/lib/wbl.ts` | learner ↔ employer |
| Data access (assembles engine inputs) | `src/lib/queries.ts` | DB → engines |
| In-app authoring (mutations) | `src/lib/actions.ts` | UI → DB |

## The two loops (now closed)

**Loop 1 — assessment → completion.** `SessionSkill(ASSESS, level)` rolls up to a
per-skill *assessed level*; `analyzeAssessment()` grades each graduate benchmark
(ASSESSED / UNDER / UNASSESSED) and yields a **competency readiness** = share of
core benchmarks assessed to target. `competencyAdjustedCompletion()` then scales
the funnel's "completing" figure by readiness — a program that assesses only half
its core competencies can only defensibly certify half its planned completers.
Surfaced on the program page funnel. (Seed: Radiography reads 50% — positioning &
image-evaluation assessed to target; patient-care assessed below target; radiation
safety unassessed.)

**Loop 2 — alignment → placement capacity.** `effectivePlacementCapacity()` runs
each employer's profile through the WBL alignment engine for the cohort; only
**alignment-feasible** employers' slots count toward placement, and the ops plan
reconciles clinical demand against that *effective* number, not raw slots. (Seed:
Radiography's Night Imaging Center contributes 0 of its 6 slots — it can't meet
the cohort's binding daytime-hours constraint — so effective WBL = 16 of 22 raw.)

## Launch cadence (flexible)

A program declares its **delivery calendar** (`termSlots`, e.g. skip summer) and
**launch cadence**: ANNUAL, BIENNIAL (`launchIntervalYears`), MULTI_PER_YEAR
(several `launchTerms`), or ON_DEMAND (explicit `Cohort` rows). `generateCohortSeries()`
expands this into many concurrent cohorts; `deliveryOrdinals()` walks only active
terms. Long, frequently-launched programs naturally yield 15–20+ cohorts in flight.

## What's still only partially wired (honest gaps)

- **Calendar blocks**: the plan uses academic-term ordinals; the 380 holiday-
  adjusted blocks aren't yet used to refine per-term teachable-day counts.
- **Funnel actuals ← competency**: readiness adjusts the *projection*; it doesn't
  yet write back to the stored "licensed/placed" actuals (kept manual on purpose).
- **Placement assignment**: effective capacity is computed in aggregate; assigning
  specific cohorts to specific feasible employers (and consuming their slots) is
  the next step.
