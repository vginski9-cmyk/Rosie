import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { issueGateToken, verifyGateToken, sitePassword, gateConfigured, GATE_TTL_SECONDS } from "../src/lib/gate";

// The access gate: a signed, expiring session token; no default password in production.
const env = process.env as Record<string, string | undefined>;
let saved: Record<string, string | undefined> = {};
beforeEach(() => { saved = { NODE_ENV: env.NODE_ENV, SITE_PASSWORD: env.SITE_PASSWORD, SITE_SECRET: env.SITE_SECRET }; });
afterEach(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete env[k]; else env[k] = v; } });

describe("gate", () => {
  it("fails closed in production when no password is configured", () => {
    env.NODE_ENV = "production"; delete env.SITE_PASSWORD;
    expect(sitePassword()).toBeNull();
    expect(gateConfigured()).toBe(false);
  });
  it("keeps a development default only outside production", () => {
    env.NODE_ENV = "development"; delete env.SITE_PASSWORD;
    expect(sitePassword()).toBe("Foundational");
  });
  it("issues a token that verifies, and rejects a tampered, foreign or expired one", async () => {
    env.NODE_ENV = "production"; env.SITE_PASSWORD = "correct horse"; env.SITE_SECRET = "pepper";
    const t0 = Date.UTC(2026, 8, 19, 12, 0, 0);
    const token = await issueGateToken("correct horse", t0);
    expect(await verifyGateToken(token, t0 + 60_000)).toBe(true);
    expect(await verifyGateToken(token + "0", t0)).toBe(false);
    expect(await verifyGateToken(token.replace(/^\d+/, (m) => String(Number(m) + 1)), t0)).toBe(false);
    expect(await verifyGateToken(await issueGateToken("other password", t0), t0)).toBe(false);
    expect(await verifyGateToken(token, t0 + (GATE_TTL_SECONDS + 1) * 1000)).toBe(false);
    expect(await verifyGateToken(undefined, t0)).toBe(false);
    env.SITE_SECRET = "different pepper";
    expect(await verifyGateToken(token, t0)).toBe(false); // a token signed under another secret is not accepted
  });
  it("the legacy unsigned digest cookie no longer opens the site", async () => {
    env.NODE_ENV = "production"; env.SITE_PASSWORD = "correct horse";
    const legacy = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("correct horse|rosie-gate-v1")))).map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(await verifyGateToken(legacy)).toBe(false);
  });
});
