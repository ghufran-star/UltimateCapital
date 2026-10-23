import { NextRequest, NextResponse } from "next/server";

const PUBLIC = ["/login", "/setup", "/invite/", "/sign/", "/a/", "/d/", "/api/webhooks/", "/api/retell/", "/api/health", "/api/sign/", "/api/portal/"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p))) return NextResponse.next();
  if (req.cookies.get("uc_session")?.value) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest).*)"] };
