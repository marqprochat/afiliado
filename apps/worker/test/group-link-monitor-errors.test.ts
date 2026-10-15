import { describe, it, expect } from 'vitest';
import { isGroupGoneError } from '../src/group-links/monitor';

describe('isGroupGoneError', () => {
  it('não trata timeout/erros transitórios como grupo perdido', () => {
    expect(isGroupGoneError(new Error('Timed Out'))).toBe(false);
    expect(isGroupGoneError(new Error('Connection Closed'))).toBe(false);
    expect(isGroupGoneError(new Error('rate-overlimit'))).toBe(false);
    expect(isGroupGoneError({ output: { statusCode: 408 }, message: 'Timed Out' })).toBe(false);
    expect(isGroupGoneError(undefined)).toBe(false);
  });

  it('reconhece grupo inexistente ou sem acesso', () => {
    expect(isGroupGoneError(new Error('item-not-found'))).toBe(true);
    expect(isGroupGoneError(new Error('forbidden'))).toBe(true);
    expect(isGroupGoneError(new Error('not-authorized'))).toBe(true);
    expect(isGroupGoneError(new Error('GROUP_NOT_FOUND'))).toBe(true);
    expect(isGroupGoneError({ output: { statusCode: 404 }, message: 'x' })).toBe(true);
    expect(isGroupGoneError({ data: 403, message: 'x' })).toBe(true);
  });
});
