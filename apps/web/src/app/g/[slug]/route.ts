import { NextResponse, type NextRequest } from 'next/server';

const API_URL = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const res = await fetch(`${API_URL}/api/v1/public/group-links/${encodeURIComponent(slug)}`, {
      cache: 'no-store',
    });

    if (!res.ok) {
      if (res.status === 404) {
        return new NextResponse('Link de grupo não encontrado', {
          status: 404,
          headers: { 'Cache-Control': 'no-store' },
        });
      }
      return new NextResponse('Grupo temporariamente indisponível', {
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    const data = (await res.json()) as {
      ok: boolean;
      inviteLink: string | null;
      fallbackUrl: string | null;
    };

    if (data.inviteLink) {
      return NextResponse.redirect(data.inviteLink, {
        status: 302,
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    if (data.fallbackUrl) {
      return NextResponse.redirect(data.fallbackUrl, {
        status: 302,
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    return new NextResponse('Grupo temporariamente indisponível', {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return new NextResponse('Erro interno ao redirecionar', {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
