export const API_ERROR_CODES = [
  'UNAUTHORIZED',
  'VALIDATION',
  'NOT_FOUND',
  'WA_NOT_CONNECTED',
  'QUEUE_FULL',
  'SHOPEE_UNCONFIGURED',
  'MARKETPLACE_ERROR',
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
}
