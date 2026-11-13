import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(_req: NextRequest) {
  try {
    const defaultPath = path.join(process.cwd(), 'public', 'assets', 'landing', 'hero-model.jpg');
    if (fs.existsSync(defaultPath)) {
      const buffer = fs.readFileSync(defaultPath);
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          'Content-Type': 'image/jpeg',
          'Content-Length': buffer.length.toString(),
          'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
        },
      });
    }
  } catch (err) {
    console.error('[landpage hero-image route] erro ao carregar imagem:', err);
  }

  return new NextResponse('Image not found', { status: 404 });
}
