import { NextResponse, type NextRequest } from "next/server";
import { GATE_COOKIE } from "@/lib/gate";

function signOut(req: NextRequest) {
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  const res = NextResponse.redirect(url, 303);
  res.cookies.set(GATE_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
export async function POST(req: NextRequest) { return signOut(req); }
/** A GET signs out only when asked explicitly (?confirm=1); a bare GET from a link or image just goes to the login page. */
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("confirm") === "1") return signOut(req);
  const url = req.nextUrl.clone(); url.pathname = "/login"; url.search = "";
  return NextResponse.redirect(url, 303);
}
