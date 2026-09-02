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
  res.cookies.set(GATE_COOKIE, await gateToken(password), {
    // Secure only when actually served over https — a Secure cookie over plain http is silently dropped and locks everyone out.
    httpOnly: true, sameSite: "lax", path: "/", maxAge: GATE_MAX_AGE,
    secure: req.headers.get("x-forwarded-proto") === "https" || req.nextUrl.protocol === "https:",
  });
  return res;
}
