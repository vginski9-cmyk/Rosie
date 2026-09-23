import { PrismaClient } from "@prisma/client";

// One client for the process. Reused across hot reloads in dev.
//
// The connection string comes from the environment the build chose: the hosted (Postgres) build's
// schema reads POSTGRES_URL_NON_POOLING (the older Vercel Postgres store's name), the newer Neon
// integration provides DATABASE_URL_UNPOOLED and DATABASE_URL, local dev's reads DATABASE_URL — the
// first one set wins, in that order, the same order the build script uses. A hosted serverless Postgres
// (Neon behind Vercel) scales to zero when idle and takes longer than Prisma's default 5-second
// connect timeout to wake, which would throw inside every page's render until it is warm; the URL
// therefore carries a 30-second connect and pool timeout unless it sets its own. A production
// process with no connection string at all fails with a message that names the variable, so the
// runtime log says exactly what is missing instead of a bare digest.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export function datasourceUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = env.POSTGRES_URL_NON_POOLING || env.DATABASE_URL_UNPOOLED || env.DATABASE_URL;
  if (!raw) {
    if (env.NODE_ENV === "production") throw new Error("Rosie has no database connection string: set POSTGRES_URL_NON_POOLING, DATABASE_URL_UNPOOLED or DATABASE_URL.");
    return undefined;
  }
  if (!/^postgres(ql)?:\/\//i.test(raw)) return raw; // SQLite and anything else: as given
  const [base, query = ""] = raw.split("?");
  const params = new URLSearchParams(query);
  if (!params.has("connect_timeout")) params.set("connect_timeout", "30");
  if (!params.has("pool_timeout")) params.set("pool_timeout", "30");
  return `${base}?${params.toString()}`;
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: datasourceUrl(),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
