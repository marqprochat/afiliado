import { describe, it, expect, vi } from 'vitest';
import {
  getAwinProgrammeDetails,
  mapAwinProgrammeDetails,
} from '../src/awin/programme-details';
import { AwinApiError } from '../src/awin/datafeed';
import fixture from '../src/awin/fixtures/programme-details.json';

const CREDS = { publisherId: '691887', offersApiToken: 'tok-123' };

describe('mapAwinProgrammeDetails', () => {
  it('normaliza programmeInfo, kpi (números em string) e faixa de comissão', () => {
    expect(mapAwinProgrammeDetails(fixture)).toEqual({
      advertiserId: '68224',
      name: 'Drogal BR',
      logoUrl: 'https://ui.awin.com/images/upload/merchant/profile/68224.png',
      displayUrl: 'https://www.drogal.com.br',
      currency: 'BRL',
      epc: 0.42,
      conversionRate: 3.1,
      approvalPercentage: 87.25,
      averagePaymentTime: 46,
      validationDays: 60,
      awinIndex: 1.8,
      commissionMin: 1.5,
      commissionMax: 8,
      commissionType: 'percentage',
    });
  });

  it('campos ausentes viram null e usa o id de reserva', () => {
    expect(mapAwinProgrammeDetails({ programmeInfo: { name: 'Loja X' } }, '77')).toEqual({
      advertiserId: '77',
      name: 'Loja X',
      logoUrl: null,
      displayUrl: null,
      currency: null,
      epc: null,
      conversionRate: null,
      approvalPercentage: null,
      averagePaymentTime: null,
      validationDays: null,
      awinIndex: null,
      commissionMin: null,
      commissionMax: null,
      commissionType: null,
    });
  });

  it('valores inválidos viram null; sem id nenhum → null', () => {
    const r = mapAwinProgrammeDetails(
      { programmeInfo: { id: 5, name: 'Y' }, kpi: { epc: 'n/d', approvalPercentage: '' } },
      undefined,
    );
    expect(r?.epc).toBeNull();
    expect(r?.approvalPercentage).toBeNull();
    expect(mapAwinProgrammeDetails({ kpi: {} })).toBeNull();
    expect(mapAwinProgrammeDetails('x')).toBeNull();
  });

  it('comissão de tipos diferentes usa o tipo da primeira faixa', () => {
    const r = mapAwinProgrammeDetails({
      programmeInfo: { id: 1, name: 'Z' },
      commissionRange: [
        { min: 10, max: 10, type: 'fix' },
        { min: 3, max: 4, type: 'percentage' },
      ],
    });
    expect(r).toMatchObject({ commissionMin: 3, commissionMax: 10, commissionType: 'fix' });
  });
});

describe('getAwinProgrammeDetails', () => {
  it('chama programmedetails com advertiserId, relationship=joined e Bearer', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(fixture), { status: 200 }));
    const r = await getAwinProgrammeDetails(CREDS, 68224, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r?.epc).toBe(0.42);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'https://api.awin.com/publishers/691887/programmedetails?advertiserId=68224&relationship=joined',
    );
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-123');
  });

  it('401/403 → AwinApiError AWIN_UNAUTHORIZED', async () => {
    for (const status of [401, 403]) {
      const fetchImpl = vi.fn(async () => new Response('{}', { status }));
      const err = await getAwinProgrammeDetails(CREDS, 1, {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AwinApiError);
      expect((err as AwinApiError).code).toBe('AWIN_UNAUTHORIZED');
    }
  });

  it('outros erros HTTP → AWIN_ERROR', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 500 }));
    const err = await getAwinProgrammeDetails(CREDS, 1, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).catch((e: unknown) => e);
    expect((err as AwinApiError).code).toBe('AWIN_ERROR');
  });
});
