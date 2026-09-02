// Site-wide password gate — one shared password, one cookie. Edge-safe (no
// Node-only imports) so the middleware and the login route share it.

export const GATE_COOKIE = "rosie_gate";
export const GATE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

/** The password that opens the site (override with SITE_PASSWORD). */
export const sitePassword = () => process.env.SITE_PASSWORD || "Foundational";

/** The cookie value that proves the password was entered — a digest, never the password itself. */
export async function gateToken(password: string): Promise<string> {
  const data = new TextEncoder().encode(`${password}|rosie-gate-v1`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
