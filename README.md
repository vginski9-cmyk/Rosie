# Rosie 🌹

**Workforce-aligned education program planning, capacity modeling, and
stakeholder coordination.**

Rosie connects the five jobs a program lead juggles — strategy, program design,
operations, stakeholder engagement, and the enrollment/success funnel — into one
model. It goes from labor-market demand all the way down to *how many clinical
slots and instructors next term actually requires.*

> This repo is the **v0.1 thin vertical slice**: a real, running app that proves
> the whole pipeline end-to-end (demand → program structure → talent-pipeline
> funnel → capacity engine), seeded with real Sandhills CC and Cape Fear CC data.
> See [`docs/PRD.md`](docs/PRD.md) for the full vision and roadmap.

## What's in it

Everything is **authored in-app** — Rosie is the system of record for program
design. (There is no importer by design; Excel is an *export*, not an input.)

- **Dashboard** — program portfolio with North Star goals and automatic
  "biggest pipeline leak" detection.
- **Program page** — structure (Term → Course → Session), the talent-pipeline
  funnel (editable, target vs. actual), a **live capacity engine** (drag the
  enrollment slider, watch sections / WBL slots / faculty FTE recompute), and
  **KSA graduate-proficiency coverage** (does the curriculum reach the benchmark?).
- **Operations plan** — the integrated view: a cohort enters each year, overlaid
  on the academic calendar so several run at once; Rosie sums the **concurrent**
  capacity demand per term and reconciles it against **supply** (staff FTE,
  preceptors, employer WBL slots) to surface **bottlenecks**. See
  [`docs/INTEGRATION.md`](docs/INTEGRATION.md) for how every piece feeds this.
- **In-app authoring** — create / duplicate / delete programs; add and edit
  terms, courses, and sessions; map KSAs to courses; edit funnel numbers — all
  via server actions (works even without JS).
- **Course sequencer** — drag-and-drop to re-sequence courses across terms.
- **Skill library (KSAs)** — define Knowledge/Skills/Abilities with a definition,
  a context-of-use, and per-level proficiency descriptors on a shared scale;
  duplicate and reuse across programs.
- **WBL Alignment Engine** — profile learners and employers across motivations /
  constraints / capacities; score alignment live and hard-flag dealbreakers.
- **Excel export** — a workbook with funnel, capacity, and KSA coverage per program.

## The core engine

The heart of Rosie is a pure, unit-tested TypeScript engine
([`src/lib/capacity.ts`](src/lib/capacity.ts)) that implements the key idea from
the user's planning template: **model one student's required experience, then
scale it.** You describe what one class/lab/clinical session looks like when
delivered; Rosie computes the real delivery footprint for any enrollment. The
talent-pipeline funnel math lives in [`src/lib/funnel.ts`](src/lib/funnel.ts).

## Tech stack

Next.js 14 (App Router) · TypeScript · Tailwind · Prisma (SQLite dev →
Postgres-portable) · SheetJS (ETL) · Recharts · dnd-kit.

## Getting started

```bash
npm install        # installs deps (also generates the Prisma client)
npm run setup      # prisma generate + db push (SQLite) + seed real data
npm run dev        # http://localhost:3000
```

Then open <http://localhost:3000>, click **Radiography**, and drag the
enrollment slider.

### Other commands

```bash
npm test           # run the engine unit tests (vitest)
npm run typecheck  # tsc --noEmit
npm run build      # production build
npm run db:reset   # wipe + re-seed the dev database
```

### Offline / restricted-network note

Prisma downloads its query engine on install. If you're behind a proxy that
blocks the Prisma binary CDN, the engines can be fetched manually and pointed at
via `PRISMA_QUERY_ENGINE_LIBRARY` — see `prisma/schema.prisma` comments. On a
normal connection `npm install` handles this automatically.

## Project layout

```
docs/                     PRD, data model, ETL & data-flow specs
prisma/
  schema.prisma           multi-tenant data model (14 models)
  seed.ts                 real Sandhills + Cape Fear seed
  seed-data/              extracted JSON (190 real calendar blocks)
src/
  lib/
    capacity.ts           ⭐ capacity engine (one student → cohort footprint)
    funnel.ts             talent-pipeline funnel math + leak detection
    ksa.ts                curriculum coverage / proficiency-gap analysis
    wbl.ts                WBL alignment scoring engine
    actions.ts            server actions — all in-app authoring (CRUD)
    queries.ts            data access (maps DB → engine shapes)
  app/                    App Router pages (dashboard, program, structure editor,
                          sequencer, skills, wbl) + Excel export route
  components/             FunnelChart, CapacityWorkbench, CourseSequencer
test/                     engine unit tests (19 passing)
```

## Status & roadmap

v0.1 is a foundation to iterate on. The PRD tracks what's built (✅) vs. planned
(⏳ P1/P2): full template & demand importers, session editing, calendar-aware
capacity, multi-year roll-ups, the WBL Alignment Engine, auth, and Postgres
deployment. We build this out together — see [`docs/PRD.md`](docs/PRD.md).
