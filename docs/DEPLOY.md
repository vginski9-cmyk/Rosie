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

## Option B — Full editable app (Vercel) · the real product

Everything works and persists: create/edit/duplicate programs, edit cadence,
assign staff, etc. Backed by a free hosted Postgres database.

### One-time setup (all in the browser, ~5 clicks)

1. Go to **vercel.com** → sign in with GitHub → **Add New… → Project**.
2. **Import** the `vginski9-cmyk/rosie` repository.
3. Before deploying, add a database: in the project, open the **Storage** tab →
   **Create Database → Postgres** (Vercel's Neon integration). Accept the
   defaults. This automatically sets the `DATABASE_URL` environment variable.
   - *(Alternatively: create a free DB at neon.tech and paste its connection
     string into Vercel → Settings → Environment Variables as `DATABASE_URL`.)*
4. Add the site password: **Settings → Environment Variables → `SITE_PASSWORD`**
   (any value; it is the one password everyone types on the door). Without it a
   production deployment **fails closed** — every page shows "not configured"
   and nobody gets in. Optional: `SITE_SECRET` (a long random string) signs the
   session cookie separately from the password, so changing one does not
   require changing the other.
5. Go to **Deployments → Redeploy** (so the build picks up `DATABASE_URL` and the password).
6. Open the deployment URL — Rosie asks for the password, then shows the strategic product.

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
`vercel.json` points the build at `npm run vercel-build`, which:
- derives a PostgreSQL Prisma schema from the single source schema,
- builds the Next.js app (so a code error can never touch the live database),
- resets and creates the tables (`prisma db push --force-reset`),
- seeds the real Sandhills / Cape Fear data (batched writes; the build log prints ⏱ laps per phase).

If the seed fails or the build hits Vercel's 45-minute limit, the deployment fails and the previous one
stays live — against a database that has just been reset. Every page then shows its empty state until the
next successful deploy. Check **Deployments → the failed build → Build Logs** for the last ⏱ lap and the
error. The database client waits up to 30 s for the hosted database to wake from idle (Neon scales to zero),
so the first request after a quiet spell is slow, not an error.

Every redeploy re-seeds the demo data (fine for a showcase; we'll switch to
migrations + persistent data when you're ready for real users).

---

## Local (only if you ever want it)
```bash
npm install && npm run setup && npm run dev   # http://localhost:3000
```
