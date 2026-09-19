import { NextResponse, type NextRequest } from "next/server";
import { GATE_COOKIE, gateConfigured, issueGateToken, sitePassword } from "@/lib/gate";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const password = String(form.get("password") ?? "");
  const nextRaw = String(form.get("next") ?? "/");
  const next = nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/";
  const url = req.nextUrl.clone();
  url.search = "";
  const expected = sitePassword();
  if (!gateConfigured() || expected == null) {
    url.pathname = "/login"; url.searchParams.set("unconfigured", "1");
    return NextResponse.redirect(url, 303);
  }
  // Constant-time comparison so a wrong password takes as long as a right one.
  const a = new TextEncoder().encode(password), b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  if (diff !== 0) {
    url.pathname = "/login";
    url.searchParams.set("error", "1");
    if (next !== "/") url.searchParams.set("next", next);
    return NextResponse.redirect(url, 303);
  }
  url.pathname = next.split("?")[0];
  const qs = next.split("?")[1];
  if (qs) url.search = qs;
  const res = NextResponse.redirect(url, 303);
  // A SESSION cookie: it ends when the browser closes, and the token inside it expires on its own
  // after GATE_TTL_SECONDS. Over https it is SameSite=None + Secure (+ Partitioned) so the site still
  // opens inside an iframe or preview pane; over plain http (local `next start`) Lax without Secure.
  const https = req.headers.get("x-forwarded-proto")?.split(",")[0].trim() === "https" || req.nextUrl.protocol === "https:";
  res.cookies.set(GATE_COOKIE, await issueGateToken(expected), {
    httpOnly: true, path: "/",
    sameSite: https ? "none" : "lax", secure: https, ...(https ? { partitioned: true } : {}),
  });
  return res;
}
