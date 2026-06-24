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

## What's in the slice

- **Dashboard** — program portfolio with North Star goals and automatic
  "biggest pipeline leak" detection.
- **Program page** — program structure (Term → Course → Session), the
  talent-pipeline funnel (target vs. actual), and a **live capacity engine**
  (drag the enrollment slider, watch sections / WBL slots / faculty FTE recompute).
- **Course sequencer** — drag-and-drop to re-sequence courses across terms,
  persisted to the DB and fed straight back into the capacity engine.
- **Import** — the ETL entry point: drop a spreadsheet, auto-detect the sheet
  type, preview it, and load it (calendar blocks today; demand/template next).

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
    etl/parseWorkbook.ts  spreadsheet ingestion + type detection
    queries.ts            data access (maps DB → engine shapes)
  app/                    App Router pages (dashboard, program, sequencer, import)
  components/             FunnelChart, CapacityWorkbench, CourseSequencer, Importer
test/                     engine unit tests (11 passing)
```

## Status & roadmap

v0.1 is a foundation to iterate on. The PRD tracks what's built (✅) vs. planned
(⏳ P1/P2): full template & demand importers, session editing, calendar-aware
capacity, multi-year roll-ups, the WBL Alignment Engine, auth, and Postgres
deployment. We build this out together — see [`docs/PRD.md`](docs/PRD.md).
