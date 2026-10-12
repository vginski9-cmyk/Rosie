# Viewing Rosie in a browser

Two hosted options. Both are no-terminal — your code is already on GitHub.

---

## Option A — Live view-only demo (GitHub Pages) · fastest

A permanent URL that renders the strategic screens with the real seeded data. You
can click through everything and use the interactive bits (the capacity slider,
charts, drag-and-drop). It's a **snapshot**, so edits don't save.

> **Not access-controlled.** A static site has no server, so its password prompt
> runs in the browser and protects nothing. For that reason the snapshot
> **excludes every person-level record** — no student pages, no people roster,
> no master calendar — and is only suitable for a public repo. Anything
> confidential belongs on Option B behind `SITE_PASSWORD`.

> **Note:** GitHub Pages only works on a **public** repo (free plan) or a paid
> GitHub plan. If the repo is private on the free plan, use Option B (Vercel),
> which works with private repos.

### How it goes live
A GitHub Actions workflow (`.github/workflows/pages.yml`) builds and publishes it
automatically. It runs on every push to the working branch.

1. In GitHub, open the repo → **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
   *(The workflow also tries to enable this automatically — if it's already set,
   skip this step.)*
3. Open the **Actions** tab → the **Deploy demo to GitHub Pages** run → when it
   finishes (~2–3 min), the **deploy** job shows the URL:

   **https://vginski9-cmyk.github.io/Rosie/**

To re-publish after changes: just push (or Actions tab → run the workflow
manually via **Run workflow**).

> If the URL 404s right after the first run, give it a minute — Pages can take a
> moment to propagate the first deployment.
>
> If the **deploy** job fails with *"branch is not allowed to deploy to
> github-pages"*, open **Settings → Environments → github-pages → Deployment
> branches and tags** and add `claude/beautiful-wozniak-s9lf4d` (or switch it to
> "All branches"). Re-run the workflow.

---

## Option B — The app on Vercel · the real product

Two ways to run it. **Demo mode** (the default) needs nothing set up: the deployment carries
its own seeded database, but edits made on the site do not persist. **Persistent mode** adds a
hosted Postgres (Neon, free tier, three clicks in Vercel) and every lock-in, edit and policy
change is kept and seen by everyone on every page. Use persistent mode for any demo where
someone will make changes and look for them elsewhere on the site.

### One-time setup (all in the browser)

1. Go to **vercel.com** → sign in with GitHub → **Add New… → Project**.
2. **Import** the `vginski9-cmyk/rosie` repository.
3. Add the site password: **Settings → Environment Variables → `SITE_PASSWORD`**
   (any value; it is the one password everyone types on the door). Without it a
   production deployment **fails closed** — every page shows "not configured"
   and nobody gets in. Optional: `SITE_SECRET` (a long random string) signs the
   session cookie separately from the password, so changing one does not
   require changing the other.
4. **Deploy.** That is demo mode. For persistent mode, continue:
5. **Storage → Create Database → Neon** (Vercel Marketplace, free plan) → **Connect** it to the
   project for all environments. Vercel writes the connection variables, among them
   `POSTGRES_URL_NON_POOLING`, which the build and the app read.
6. **Settings → Environment Variables → add `ROSIE_DB` = `postgres`** (all environments).
7. **Redeploy** (Deployments → ⋯ → Redeploy). The build creates the tables and seeds the
   workspace into Neon; from then on edits persist.

### Demo mode: the database travels with the deployment
Every build seeds the whole workspace into a SQLite file (`prisma/rosie.db`, about 60 MB) and
ships it inside every server function. Nothing to provision, connect, wake up or pay for, and a
build that fails never touches the live site. But the function's file is read-only, so the app
copies it to `/tmp` on first use — and each server instance, and each function Vercel splits the
routes into, has its own `/tmp`. An edit made on one page can land in a copy the next page never
reads, and every deploy starts again from the seed. **Edits do not persist in demo mode.** This
is what made changes vanish in the October demo.

### Persistent mode: Neon Postgres
With `ROSIE_DB=postgres` and a connection string (`POSTGRES_URL_NON_POOLING`,
`DATABASE_URL_UNPOOLED` or `DATABASE_URL` — the first one set wins), the build proves itself
first (`next build`) and touches the database last (`prisma db push --force-reset` + the seed),
and the client waits up to 30 s for a serverless database to wake. Every edit is written to Neon
and read from Neon by every page. Two things to know:
- **Every successful deploy reseeds the store.** A push to the branch rebuilds the workspace
  from the seed, so edits made on the site are kept between deploys only if they are also put
  into the seed. Plan demos around that: make the changes after the deploy, not before.
- If a build fails, the previous deployment stays live against a database that has just been
  reset, so a broken store shows every page empty until the next successful deploy — replace
  the store (they are disposable) and redeploy. Delete the old store's `POSTGRES_*` / `PG*`
  variables when replacing it, or the stale host wins.

This path was proven end to end on 2026-10-12 against Postgres 16: build, push, seed, the
accuracy audit, and a lock-in on the goal page seen on the Offerings tab, Programs, the
calendar, the scheduler and the staffing pages.

### Access control (how the door works)
- The password is checked on the server for every page and API route (`src/middleware.ts`).
- A correct password sets a **session cookie** carrying a signed token: the cookie ends when the
  browser closes, and the token expires on its own 12 hours after sign-in. A fresh browser
  session always asks again. There is no default password in production.
- The strategic product is the default. The operational module (applying schedules,
  auto-assigning, logging competencies, editing offerings and students by hand) is switched on
  only with `ROSIE_OPERATIONAL=1`; otherwise those screens are read-only and the server refuses
  the writes.

### What the build does (already configured)
`vercel.json` points the build at `npm run vercel-build` → `scripts/vercel-build.sh`, which:
- generates the Prisma client (with the Vercel runtime's engine),
- seeds `prisma/rosie.db` (`prisma db push --force-reset` + `tsx prisma/seed.ts`; the log prints ⏱ laps per phase),
- builds the Next.js app, tracing the database file and the engine into every function.

With `ROSIE_DB=postgres` it derives the Postgres schema, builds, then pushes and seeds the hosted database.
Check **Deployments → the failed build → Build Logs** for the last ⏱ lap and the error when a build fails.

---

## Local (only if you ever want it)
```bash
npm install && npm run setup && npm run dev   # http://localhost:3000
```
