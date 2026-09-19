// Site-wide password gate — one shared password, one signed session cookie. Edge-safe (no
// Node-only imports) so the middleware and the login route share it.
//
// Rules:
//   • In production the password MUST be set (SITE_PASSWORD); there is no default. With none set the
//     site fails closed and the login page says so. The development default exists only so local
//     `next dev` / tests run without configuration.
//   • The cookie is a SESSION cookie (dropped when the browser closes) carrying a signed token that
//     also expires on its own after GATE_TTL_SECONDS. The token is an HMAC over the issue time, keyed
//     by the password and a server secret (SITE_SECRET, else the password), so it cannot be forged
//     from the repository alone once a real password is set.

export const GATE_COOKIE = "rosie_gate";
/** How long a signed-in session stays valid even while the browser stays open. */
export const GATE_TTL_SECONDS = 60 * 60 * 12; // 12 hours

const isProduction = () => process.env.NODE_ENV === "production";

/** The password that opens the site: SITE_PASSWORD, or the development default outside production. Null = not configured (fail closed). */
export const sitePassword = (): string | null => process.env.SITE_PASSWORD || (isProduction() ? null : "Foundational");
/** Whether the gate can admit anyone at all. */
export const gateConfigured = () => sitePassword() != null;

const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
async function hmac(key: string, message: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, enc.encode(message)));
}
const secret = (password: string) => `${process.env.SITE_SECRET || password}|rosie-gate-v2`;

/** A fresh session token for a correct password: `<issuedAtSeconds>.<signature>`. */
export async function issueGateToken(password: string, now = Date.now()): Promise<string> {
  const iat = Math.floor(now / 1000);
  return `${iat}.${await hmac(secret(password), `${password}|${iat}`)}`;
}

/** Whether a cookie value is a valid, unexpired token for the configured password. */
export async function verifyGateToken(token: string | undefined | null, now = Date.now()): Promise<boolean> {
  const password = sitePassword();
  if (!password || !token) return false;
  const [iatRaw, sig] = token.split(".");
  const iat = Number(iatRaw);
  if (!Number.isInteger(iat) || !sig) return false;
  const age = Math.floor(now / 1000) - iat;
  if (age < -60 || age > GATE_TTL_SECONDS) return false;
  const expected = await hmac(secret(password), `${password}|${iat}`);
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}
