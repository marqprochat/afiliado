import { NextResponse, type NextRequest } from 'next/server';

function isPublicPath(pathname: string): boolean {
  if (
    pathname === '/callbackml' ||
    pathname === '/landpage' ||
    pathname.startsWith('/landpage/') ||
    pathname === '/ofertas' ||
    pathname.startsWith('/ofertas/') ||
    pathname === '/lp' ||
    pathname.startsWith('/lp/') ||
    pathname.startsWith('/g/') ||
    pathname.startsWith('/downloads/') ||
    pathname === '/dudu-hero.jpg'
  ) {
    return true;
  }

  // Arquivos estáticos comuns na pasta public
  if (/\.(svg|png|jpg|jpeg|gif|webp|ico|zip|pdf|txt|xml|json)$/i.test(pathname)) {
    return true;
  }

  return false;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const has = req.cookies.has('afilados_session');
  const isLogin = pathname === '/login';

  // Rotas públicas que não exigem sessão (ofertas, LPs de afiliados, landing page, redirects de grupos, assets)
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // Não autenticado tentando acessar rota restrita -> redireciona para login
  if (!has && !isLogin) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  // Já autenticado tentando acessar /login -> redireciona para o painel principal
  if (has && isLogin) {
    return NextResponse.redirect(new URL('/', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|zip)$).*)'],
};

