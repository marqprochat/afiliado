'use client';
import { useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Imagem de produto que, se não carregar (ex.: feed da loja com imagem fora do ar), vira um
 * placeholder neutro em vez de mostrar o texto alternativo por cima do card. O alt continua
 * disponível para leitor de tela no placeholder.
 */
export function ProductImage({
  src,
  alt,
  className,
  placeholderClassName,
  iconClassName,
  loading = 'lazy',
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
  placeholderClassName?: string;
  iconClassName?: string;
  loading?: 'lazy' | 'eager';
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  if (!src || failed) {
    return (
      <div
        data-testid="product-image-placeholder"
        {...(alt ? { role: 'img', 'aria-label': alt } : { 'aria-hidden': true })}
        className={cn(
          'flex h-full w-full items-center justify-center bg-muted text-muted-foreground',
          placeholderClassName,
        )}
      >
        <ImageOff className={cn('h-8 w-8 opacity-60', iconClassName)} aria-hidden />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={className}
      loading={loading}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}
