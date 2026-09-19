import { NextResponse, type NextRequest } from "next/server";
import { GATE_COOKIE, gateConfigured, verifyGateToken } from "@/lib/gate";

// Every page and API route sits behind the shared password, except the login page itself, the
// login/logout routes, and static assets. The site fails closed: with no password configured in
// production nothing is served but the login page's "not configured" notice.
export async function middleware(req: NextRequest) {
  // The static demo build (GitHub Pages) has no server at all — its gate runs in the browser
  // (DemoGate) and the crawler that snapshots it must see the pages. That build excludes person-level
  // records (see scripts/crawl-demo.mjs) because a browser-side gate protects nothing.
  if (process.env.DEMO === "1") return NextResponse.next();
  const { pathname, search } = req.nextUrl;
  const cookie = req.cookies.get(GATE_COOKIE)?.value;
  if (gateConfigured() && (await verifyGateToken(cookie))) {
    const res = NextResponse.next();
    // Gated pages are never cached by a shared cache or indexed.
    res.headers.set("Cache-Control", "private, no-store");
    res.headers.set("X-Robots-Tag", "noindex, nofollow");
    return res;
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  if (!gateConfigured()) url.searchParams.set("unconfigured", "1");
  else url.searchParams.set("next", pathname + search);
  const res = NextResponse.redirect(url);
  if (cookie) res.cookies.set(GATE_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}

export const config = {
  matcher: ["/((?!login|api/login|api/logout|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|txt|xml)).*)"],
};
