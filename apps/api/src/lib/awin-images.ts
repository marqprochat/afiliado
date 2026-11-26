import {
  resolveFallbackImage,
  type FallbackImageResult,
  type ImageFallbackCache,
} from '@afilados/marketplaces';
import { getRedis } from './redis';

/** Cache das verificações de imagem da Awin no Redis (TTL decidido por quem grava). */
export const redisImageCache: ImageFallbackCache = {
  get: (key) => getRedis().get(key),
  set: async (key, value, ttlSeconds) => {
    await getRedis().set(key, value, 'EX', ttlSeconds);
  },
};

export type ResolveAwinImage = (input: {
  imageUrl: string | null;
  deepLink: string;
}) => Promise<FallbackImageResult>;

/** Imagem do produto Awin (a do feed, ou a da loja se a do feed saiu do ar), com cache no Redis. */
export const resolveAwinImage: ResolveAwinImage = (input) =>
  resolveFallbackImage(input, { cache: redisImageCache });
