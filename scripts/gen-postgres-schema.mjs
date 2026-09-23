// Generates prisma/schema.postgres.prisma from the single-source schema.prisma
// for hosted (Vercel) deployments: swaps the datasource provider to PostgreSQL
// and adds the serverless-runtime binary target. Keeping one source schema
// avoids drift — this is derived at build time, never hand-edited.
import { readFileSync, writeFileSync } from "node:fs";

const src = readFileSync("prisma/schema.prisma", "utf-8");

let out = src.replace('provider = "sqlite"', 'provider = "postgresql"');

// Use Neon's DIRECT (non-pooling) connection string that the Vercel↔Neon
// integration provisions automatically. This works for both `prisma db push`
// at build time and runtime queries at demo scale, and avoids pgbouncer /
// prepared-statement pitfalls — without the user having to edit any locked,
// integration-managed env var. (Local dev still uses DATABASE_URL via the
// untouched sqlite schema.prisma.)
out = out.replace(/url\s*=\s*env\("DATABASE_URL"\)/, 'url      = env("POSTGRES_URL_NON_POOLING")');

// The generator already carries the Vercel runtime's binary target (the source schema does, for
// the bundled-SQLite deployment); nothing to add here.

writeFileSync("prisma/schema.postgres.prisma", out);
console.log("Wrote prisma/schema.postgres.prisma (provider=postgresql, url=POSTGRES_URL_NON_POOLING, +rhel binary target)");
