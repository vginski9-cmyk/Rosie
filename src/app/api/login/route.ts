import { NextResponse, type NextRequest } from "next/server";
import { GATE_COOKIE, GATE_MAX_AGE, gateToken, sitePassword } from "@/lib/gate";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const password = String(form.get("password") ?? "");
  const nextRaw = String(form.get("next") ?? "/");
  const next = nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/";
  const url = req.nextUrl.clone();
  url.search = "";
  if (password !== sitePassword()) {
    url.pathname = "/login";
    url.searchParams.set("error", "1");
    if (next !== "/") url.searchParams.set("next", next);
    return NextResponse.redirect(url, 303);
  }
  url.pathname = next.split("?")[0];
  const qs = next.split("?")[1];
  if (qs) url.search = qs;
  const res = NextResponse.redirect(url, 303);
  // Enter the password ONCE. Over https the cookie is SameSite=None + Secure (+
  // Partitioned) so it is still sent when the site is opened inside an iframe or
  // preview pane — a Lax cookie is dropped there and the gate re-asks on every
  // page. Over plain http (local `next start`) a Secure cookie would be dropped
  // instead, so it falls back to Lax without Secure.
  const https = req.headers.get("x-forwarded-proto")?.split(",")[0].trim() === "https" || req.nextUrl.protocol === "https:";
  res.cookies.set(GATE_COOKIE, await gateToken(password), {
    httpOnly: true, path: "/", maxAge: GATE_MAX_AGE,
    sameSite: https ? "none" : "lax", secure: https, ...(https ? { partitioned: true } : {}),
  });
  return res;
}
