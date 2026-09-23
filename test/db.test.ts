import { describe, expect, it } from "vitest";
import { datasourceUrl, BUNDLED_DB, RUNTIME_DB } from "../src/lib/db";

type Fs = Parameters<typeof datasourceUrl>[2];
const fsOf = (present: string[], copies: string[][] = []): Fs => ({ existsSync: (p) => present.includes(String(p)), copyFileSync: (a, b) => { copies.push([String(a), String(b)]); present.push(String(b)); } });

describe("where the database is", () => {
  it("on the hosted deployment the bundled SQLite file is copied to /tmp once and opened there", () => {
    const copies: string[][] = []; const fs = fsOf([`/var/task/${BUNDLED_DB}`], copies);
    expect(datasourceUrl({ VERCEL: "1", NODE_ENV: "production", DATABASE_URL: "postgresql://dead@host/db" }, "/var/task", fs)).toBe(`file:${RUNTIME_DB}`);
    expect(copies).toEqual([[`/var/task/${BUNDLED_DB}`, RUNTIME_DB]]);
    expect(datasourceUrl({ VERCEL: "1", NODE_ENV: "production" }, "/var/task", fs)).toBe(`file:${RUNTIME_DB}`);
    expect(copies).toHaveLength(1); // already there
  });
  it("during the hosted build every step writes the bundled file in place, never a /tmp copy", () => {
    const copies: string[][] = []; const fs = fsOf([`/vercel/path0/${BUNDLED_DB}`], copies);
    expect(datasourceUrl({ VERCEL: "1", ROSIE_DB_FILE: "/vercel/path0/prisma/rosie.db", DATABASE_URL: "file:/vercel/path0/prisma/rosie.db" }, "/vercel/path0", fs)).toBe("file:/vercel/path0/prisma/rosie.db");
    expect(copies).toEqual([]);
  });
  it("Postgres is an opt-in, with a 30-second connect and pool timeout unless the URL sets its own", () => {
    expect(datasourceUrl({ ROSIE_DB: "postgres", POSTGRES_URL_NON_POOLING: "postgresql://u:p@h/db?sslmode=require" })).toBe("postgresql://u:p@h/db?sslmode=require&connect_timeout=30&pool_timeout=30");
    expect(datasourceUrl({ ROSIE_DB: "postgres", DATABASE_URL_UNPOOLED: "postgres://h/db?connect_timeout=5" })).toBe("postgres://h/db?connect_timeout=5&pool_timeout=30");
    expect(datasourceUrl({ ROSIE_DB: "postgres", DATABASE_URL: "postgres://h/db" })).toBe("postgres://h/db?connect_timeout=30&pool_timeout=30");
    expect(() => datasourceUrl({ ROSIE_DB: "postgres" })).toThrow(/POSTGRES_URL_NON_POOLING, DATABASE_URL_UNPOOLED or DATABASE_URL/);
  });
  it("local dev reads DATABASE_URL; a production process with nothing at all says so", () => {
    expect(datasourceUrl({ DATABASE_URL: "file:./dev.db" }, "/x", fsOf([]))).toBe("file:./dev.db");
    expect(datasourceUrl({}, "/x", fsOf([]))).toBeUndefined();
    expect(() => datasourceUrl({ NODE_ENV: "production" }, "/x", fsOf([]))).toThrow(/no prisma\/rosie.db in the deployment and no DATABASE_URL/);
  });
});
