import { NextResponse, type NextRequest } from "next/server";
import { GATE_COOKIE, gateToken, sitePassword } from "@/lib/gate";

// Every page and API route sits behind the shared password, except the login
// page itself, the login/logout routes, and static assets.
export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const cookie = req.cookies.get(GATE_COOKIE)?.value;
  if (cookie && cookie === (await gateToken(sitePassword()))) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("next", pathname + search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!login|api/login|api/logout|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|txt|xml)).*)"],
};
