import { NextResponse, type NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  const has = req.cookies.has('afilados_session');
  const isLogin = req.nextUrl.pathname === '/login';
  if (!has && !isLogin) return NextResponse.redirect(new URL('/login', req.url));
  if (has && isLogin) return NextResponse.redirect(new URL('/', req.url));
  return NextResponse.next();
}
export const config = { matcher: ['/((?!api|_next|favicon.ico).*)'] };
