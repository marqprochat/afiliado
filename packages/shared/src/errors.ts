export const API_ERROR_CODES = [
  'UNAUTHORIZED',
  'VALIDATION',
  'CONFLICT',
  'NOT_FOUND',
  'WA_NOT_CONNECTED',
  'QUEUE_FULL',
  'SHOPEE_UNCONFIGURED',
  'MARKETPLACE_ERROR',
  'TELEGRAM_ERROR',
  'AI_ERROR',
  'BATCH_INACTIVE',
  'BATCH_DUPLICATE',
  'PRODUCT_NOT_READY',
  'SERVICE_UNAVAILABLE',
  'INTERNAL',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
  static unauthorized(msg = 'Não autenticado') {
    return new ApiError('UNAUTHORIZED', msg, 401);
  }
  static notFound(msg = 'Não encontrado') {
    return new ApiError('NOT_FOUND', msg, 404);
  }
  static validation(msg: string) {
    return new ApiError('VALIDATION', msg, 400);
  }
  static conflict(msg: string) {
    return new ApiError('CONFLICT', msg, 409);
  }
  static serviceUnavailable(msg = 'Serviço temporariamente indisponível') {
    return new ApiError('SERVICE_UNAVAILABLE', msg, 503);
  }
}
