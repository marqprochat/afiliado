import { NextResponse, type NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  const has = req.cookies.has('afilados_session');
  const isLogin = req.nextUrl.pathname === '/login';
  // Retorno do OAuth do Mercado Livre, Links Fixos (/g/[slug]) e Landpage pública: não exigem sessão de login
  if (
    req.nextUrl.pathname === '/callbackml' ||
    req.nextUrl.pathname.startsWith('/g/') ||
    req.nextUrl.pathname === '/landpage'
  ) {
    return NextResponse.next();
  }
  if (!has && !isLogin) return NextResponse.redirect(new URL('/login', req.url));
  if (has && isLogin) return NextResponse.redirect(new URL('/', req.url));
  return NextResponse.next();
}
export const config = { matcher: ['/((?!api|_next|favicon.ico).*)'] };
