import { PrismaClient } from "@prisma/client";
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// One client for the process. Reused across hot reloads in dev.
//
// WHERE THE DATABASE IS. The hosted deployment carries its own: scripts/vercel-build.sh seeds
// prisma/rosie.db at build time and next.config ships it inside every function, so nothing has to
// be set up, and nothing can expire. The function's filesystem is read-only, so on first use the
// file is copied to /tmp (writable) and the client opens it there — edits last for that instance
// and are rebuilt from the seed on the next deploy. ROSIE_DB=postgres opts into a hosted Postgres
// (POSTGRES_URL_NON_POOLING, DATABASE_URL_UNPOOLED or DATABASE_URL, first one set); a serverless
// Postgres that scales to zero takes longer than Prisma's 5-second default to wake, so that URL
// carries a 30-second connect and pool timeout unless it sets its own. Local dev reads
// DATABASE_URL (SQLite). A production process with no database at all fails with a message naming
// the variables, so the runtime log says what is missing instead of a bare digest.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const BUNDLED_DB = "prisma/rosie.db";
export const RUNTIME_DB = "/tmp/rosie.db";

export type DbEnv = Partial<Record<"ROSIE_DB" | "POSTGRES_URL_NON_POOLING" | "DATABASE_URL_UNPOOLED" | "DATABASE_URL" | "VERCEL" | "NODE_ENV", string>>;
export function datasourceUrl(env: DbEnv = process.env, cwd: string = process.cwd(), fs: { existsSync: typeof existsSync; copyFileSync: typeof copyFileSync } = { existsSync, copyFileSync }): string | undefined {
  if (env.ROSIE_DB === "postgres") {
    const raw = env.POSTGRES_URL_NON_POOLING || env.DATABASE_URL_UNPOOLED || env.DATABASE_URL;
    if (!raw) throw new Error("Rosie has ROSIE_DB=postgres but no connection string: set POSTGRES_URL_NON_POOLING, DATABASE_URL_UNPOOLED or DATABASE_URL.");
    if (!/^postgres(ql)?:\/\//i.test(raw)) return raw;
    const [base, query = ""] = raw.split("?");
    const params = new URLSearchParams(query);
    if (!params.has("connect_timeout")) params.set("connect_timeout", "30");
    if (!params.has("pool_timeout")) params.set("pool_timeout", "30");
    return `${base}?${params.toString()}`;
  }
  const bundled = join(cwd, BUNDLED_DB);
  if (env.VERCEL && fs.existsSync(bundled)) {
    if (!fs.existsSync(RUNTIME_DB)) fs.copyFileSync(bundled, RUNTIME_DB);
    return `file:${RUNTIME_DB}`;
  }
  if (env.DATABASE_URL) return env.DATABASE_URL;
  if (env.NODE_ENV === "production") throw new Error(`Rosie has no database: no ${BUNDLED_DB} in the deployment and no DATABASE_URL.`);
  return undefined;
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: datasourceUrl(),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
