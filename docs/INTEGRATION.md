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

## What's still only partially wired (honest gaps)

- **Funnel ← assessment**: assessment coverage is computed, but competency
  throughput does not yet *drive* the funnel's "completing/licensed" actuals. The
  hook (`assessmentCoverage` + `SessionSkill ASSESS`) is in place; closing this
  loop is the next integration step.
- **WBL ↔ placement ↔ capacity**: the WBL engine scores learner/employer
  alignment, and the plan reconciles WBL *slot counts*; they are not yet joined so
  that *alignment-feasible* slots constrain placement. Planned.
- **Calendar blocks**: the plan uses term ordinals; the 380 holiday-adjusted
  blocks are not yet used to refine per-term teachable-day counts in the engine.
- **Cohort entry cadence** is assumed annual (Fall). Multi-entry (Spring/Summer
  starts) is supported by the engine but not yet authored per program in the UI.
