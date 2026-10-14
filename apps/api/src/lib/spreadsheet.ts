import * as XLSX from 'xlsx';
import type { ProductsImportItem } from '@afilados/shared';

function cleanString(val: unknown): string {
  if (val === null || val === undefined) return '';
  return String(val).trim();
}

export function parseMoneyValue(val: unknown): number | undefined {
  if (typeof val === 'number') return isNaN(val) ? undefined : val;
  if (!val) return undefined;
  const s = String(val).trim();
  const cleaned = s.replace(/[^\d.,]/g, '').trim();
  if (!cleaned) return undefined;

  let normalized = cleaned;
  if (cleaned.includes(',') && cleaned.includes('.')) {
    // 1.562,00 -> 1562.00
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (cleaned.includes(',')) {
    // 1562,00 -> 1562.00
    normalized = cleaned.replace(',', '.');
  }
  const n = parseFloat(normalized);
  return isNaN(n) ? undefined : n;
}

function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface ColumnIndexes {
  urlIdx: number;
  titleIdx: number;
  priceIdx: number;
  originalPriceIdx: number;
  couponCodeIdx: number;
  couponValueIdx: number;
}

const URL_HEADERS = [
  'link',
  'url',
  'link do item',
  'link do produto',
  'link aliexpress',
  'link ali',
  'link do produto no aliexpress',
  'product url',
  'product link',
];

const TITLE_HEADERS = [
  'nome do item',
  'nome',
  'titulo',
  'produto',
  'nome do produto',
  'item',
  'descricao',
  'title',
  'product name',
];

const PRICE_PROMO_HEADERS = [
  'preco c cupom',
  'preco com cupom',
  'preco por',
  'por',
  'preco promocional',
  'preco final',
  'sale price',
  'saleprice',
];

const PRICE_ORIGINAL_HEADERS = [
  'preco de',
  'de',
  'preco antigo',
  'preco original',
  'original price',
  'originalprice',
];

const PRICE_GENERIC_HEADERS = ['preco', 'price', 'valor'];

const COUPON_CODE_HEADERS = [
  'codigo cupom',
  'codigo do cupom',
  'cupom',
  'codigo',
  'coupon',
  'coupon code',
  'code',
];

const COUPON_VALUE_HEADERS = [
  'cupom ali',
  'desconto cupom',
  'valor cupom',
  'valor do cupom',
  'desconto ali',
  'coupon value',
  'discount',
];

function findHeaderRow(rows: unknown[][]): { headerIdx: number; cols: ColumnIndexes } | null {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;

    let urlIdx = -1;
    let titleIdx = -1;
    let promoPriceIdx = -1;
    let origPriceIdx = -1;
    let genericPriceIdx = -1;
    let couponCodeIdx = -1;
    let couponValueIdx = -1;

    for (let c = 0; c < row.length; c++) {
      const cell = normalizeHeader(cleanString(row[c]));
      if (!cell) continue;

      if (urlIdx === -1 && URL_HEADERS.includes(cell)) urlIdx = c;
      if (titleIdx === -1 && TITLE_HEADERS.includes(cell)) titleIdx = c;
      if (promoPriceIdx === -1 && PRICE_PROMO_HEADERS.includes(cell)) promoPriceIdx = c;
      if (origPriceIdx === -1 && PRICE_ORIGINAL_HEADERS.includes(cell)) origPriceIdx = c;
      if (genericPriceIdx === -1 && PRICE_GENERIC_HEADERS.includes(cell)) genericPriceIdx = c;
      if (couponCodeIdx === -1 && COUPON_CODE_HEADERS.includes(cell)) couponCodeIdx = c;
      if (couponValueIdx === -1 && COUPON_VALUE_HEADERS.includes(cell)) couponValueIdx = c;
    }

    // Se achou uma coluna de URL ou se achou pelo menos 2 cabeçalhos relevantes
    const foundCount =
      (urlIdx !== -1 ? 1 : 0) +
      (titleIdx !== -1 ? 1 : 0) +
      (promoPriceIdx !== -1 ? 1 : 0) +
      (origPriceIdx !== -1 ? 1 : 0) +
      (couponCodeIdx !== -1 ? 1 : 0);

    if (urlIdx !== -1 || foundCount >= 2) {
      const nextRow = rows[i + 1];
      if (urlIdx === -1 && Array.isArray(nextRow)) {
        for (let c = 0; c < nextRow.length; c++) {
          if (cleanString(nextRow[c]).startsWith('http')) {
            urlIdx = c;
            break;
          }
        }
      }

      const priceIdx = promoPriceIdx !== -1 ? promoPriceIdx : genericPriceIdx;

      return {
        headerIdx: i,
        cols: {
          urlIdx,
          titleIdx,
          priceIdx,
          originalPriceIdx: origPriceIdx,
          couponCodeIdx,
          couponValueIdx,
        },
      };
    }
  }

  return null;
}

export function parseSpreadsheetRows(rows: unknown[][]): ProductsImportItem[] {
  const detected = findHeaderRow(rows);
  if (!detected || detected.cols.urlIdx === -1) {
    // Fallback: se não achou cabeçalho padrão, procura qualquer URL nas células
    const items: ProductsImportItem[] = [];
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      for (const cell of row) {
        const str = cleanString(cell);
        if (str.startsWith('http://') || str.startsWith('https://')) {
          items.push({ url: str });
        }
      }
    }
    return items;
  }

  const { headerIdx, cols } = detected;
  const items: ProductsImportItem[] = [];

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row) || row.length === 0) continue;

    let url = cols.urlIdx !== -1 ? cleanString(row[cols.urlIdx]) : '';
    // Se a célula de URL não tiver http, faz varredura na linha para ver se alguma célula tem URL
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      for (const cell of row) {
        const s = cleanString(cell);
        if (s.startsWith('http://') || s.startsWith('https://')) {
          url = s;
          break;
        }
      }
    }

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      continue;
    }

    const title = cols.titleIdx !== -1 ? cleanString(row[cols.titleIdx]) : undefined;
    const originalPrice =
      cols.originalPriceIdx !== -1 ? parseMoneyValue(row[cols.originalPriceIdx]) : undefined;
    const couponValue =
      cols.couponValueIdx !== -1 ? parseMoneyValue(row[cols.couponValueIdx]) : undefined;

    let price = cols.priceIdx !== -1 ? parseMoneyValue(row[cols.priceIdx]) : undefined;
    if (price === undefined && originalPrice !== undefined) {
      if (couponValue !== undefined && couponValue > 0 && originalPrice > couponValue) {
        price = originalPrice - couponValue;
      } else {
        price = originalPrice;
      }
    }

    let couponCode =
      cols.couponCodeIdx !== -1 ? cleanString(row[cols.couponCodeIdx]) : undefined;
    if (!couponCode) couponCode = undefined;

    let discountPct: number | undefined;
    if (originalPrice && price && originalPrice > price) {
      discountPct = Math.round(((originalPrice - price) / originalPrice) * 100);
    }

    items.push({
      url,
      ...(title ? { title } : {}),
      ...(price !== undefined ? { price } : {}),
      ...(originalPrice !== undefined ? { originalPrice } : {}),
      ...(discountPct !== undefined ? { discountPct } : {}),
      ...(couponCode ? { couponCode } : {}),
    });
  }

  return items;
}

export function parseSpreadsheetBuffer(buffer: Buffer): ProductsImportItem[] {
  try {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return [];
    const sheet = wb.Sheets[sheetName];
    if (!sheet) return [];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
    return parseSpreadsheetRows(rows);
  } catch {
    return [];
  }
}

export function parseSpreadsheetText(text: string): ProductsImportItem[] {
  try {
    const wb = XLSX.read(text, { type: 'string' });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return [];
    const sheet = wb.Sheets[sheetName];
    if (!sheet) return [];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
    return parseSpreadsheetRows(rows);
  } catch {
    return [];
  }
}
