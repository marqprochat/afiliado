import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const API_URL = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';

function getDefaultHeroBuffer(): { buffer: Buffer; contentType: string } | null {
  try {
    const defaultPath = path.join(process.cwd(), 'public', 'assets', 'landing', 'hero-model.jpg');
    if (fs.existsSync(defaultPath)) {
      return {
        buffer: fs.readFileSync(defaultPath),
        contentType: 'image/jpeg',
      };
    }
  } catch {}
  return null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug: rawSlug } = await params;
  const slug = (rawSlug || '').toLowerCase().trim();

  try {
    let heroImage: string | null = null;

    if (slug && slug !== 'exemplo') {
      const res = await fetch(`${API_URL}/api/v1/public/affiliate-landing/${slug}`, {
        cache: 'no-store',
      });
      if (res.ok) {
        const json = await res.json();
        heroImage = json?.data?.profile?.heroImage || null;
      }
    }

    if (!heroImage) {
      heroImage = '/assets/landing/hero-model.jpg';
    }

    // 1. Data URL (Base64) - ex: data:image/jpeg;base64,...
    if (heroImage.startsWith('data:image/')) {
      const match = heroImage.match(/^data:(image\/[a-zA-Z0-9\+\-\.]+);base64,(.+)$/);
      if (match && match[1] && match[2]) {
        const contentType = match[1];
        const buffer = Buffer.from(match[2], 'base64');
        return new NextResponse(new Uint8Array(buffer), {
          headers: {
            'Content-Type': contentType,
            'Content-Length': buffer.length.toString(),
            'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
          },
        });
      }
    }

    // 2. Arquivo relativo local (ex: /assets/landing/hero-model.jpg)
    if (heroImage.startsWith('/')) {
      const relativePath = heroImage.replace(/^\//, '');
      const filePath = path.join(process.cwd(), 'public', relativePath);
      if (fs.existsSync(filePath)) {
        const ext = path.extname(filePath).toLowerCase();
        const contentType =
          ext === '.png'
            ? 'image/png'
            : ext === '.webp'
              ? 'image/webp'
              : 'image/jpeg';
        const buffer = fs.readFileSync(filePath);
        return new NextResponse(new Uint8Array(buffer), {
          headers: {
            'Content-Type': contentType,
            'Content-Length': buffer.length.toString(),
            'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
          },
        });
      }
    }

    // 3. URL externa http/https - busca e retransmite como binário
    if (heroImage.startsWith('http://') || heroImage.startsWith('https://')) {
      try {
        const externalRes = await fetch(heroImage, {
          cache: 'force-cache',
          headers: { Accept: 'image/*' },
        });
        if (externalRes.ok) {
          const contentType = externalRes.headers.get('content-type') || 'image/jpeg';
          const arrayBuf = await externalRes.arrayBuffer();
          const buffer = Buffer.from(arrayBuf);
          return new NextResponse(new Uint8Array(buffer), {
            headers: {
              'Content-Type': contentType,
              'Content-Length': buffer.length.toString(),
              'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
            },
          });
        }
      } catch {
        // falha ao buscar URL externa, cai para o fallback
      }
    }
  } catch (err) {
    console.error('[hero-image route] erro ao processar imagem para slug:', slug, err);
  }

  // Fallback padrão
  const fallback = getDefaultHeroBuffer();
  if (fallback) {
    return new NextResponse(new Uint8Array(fallback.buffer), {
      headers: {
        'Content-Type': fallback.contentType,
        'Content-Length': fallback.buffer.length.toString(),
        'Cache-Control': 'public, max-age=86400',
      },
    });
  }

  return new NextResponse('Image not found', { status: 404 });
}
