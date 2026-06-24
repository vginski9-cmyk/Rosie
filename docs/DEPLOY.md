# Viewing Rosie in a browser

Two hosted options. Both are no-terminal — your code is already on GitHub.

---

## Option A — Live view-only demo (GitHub Pages) · fastest

A permanent URL that renders every screen with the real seeded data. You can
click through everything and use the interactive bits (the capacity slider,
charts, drag-and-drop). It's a **snapshot**, so edits don't save.

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
4. Go to **Deployments → Redeploy** (so the build picks up `DATABASE_URL`).
5. Open the deployment URL — Rosie is live and fully editable.

### What the build does (already configured)
`vercel.json` points the build at `npm run vercel-build`, which:
- derives a PostgreSQL Prisma schema from the single source schema,
- creates the tables (`prisma db push`),
- seeds the real Sandhills / Cape Fear data,
- builds the Next.js app.

Every redeploy re-seeds the demo data (fine for a showcase; we'll switch to
migrations + persistent data when you're ready for real users).

---

## Local (only if you ever want it)
```bash
npm install && npm run setup && npm run dev   # http://localhost:3000
```
