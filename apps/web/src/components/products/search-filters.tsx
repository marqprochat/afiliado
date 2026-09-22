'use client';
import { useState } from 'react';
import {
  searchQuerySchema,
  type MarketplaceKind,
  type SearchMode,
  type SearchQuery,
  type SearchSort,
} from '@afilados/shared';
import { Button } from '@/components/ui/button';
import { NativeCheckbox } from '@/components/ui/native-checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export const SORT_LABELS: Record<SearchSort, string> = {
  DISCOUNT_DESC: 'Maiores descontos',
  COMMISSION_DESC: 'Maior comissão',
  SALES_DESC: 'Mais vendidos',
  PRICE_ASC: 'Menor preço',
  PRICE_DESC: 'Maior preço',
};
export const CATEGORIES: { id: string; name: string }[] = [
  { id: '11059983', name: 'Eletrônicos' },
  { id: '11059988', name: 'Celulares e Acessórios' },
  { id: '11059992', name: 'Computadores e Acessórios' },
  { id: '11059999', name: 'Casa e Decoração' },
  { id: '11060006', name: 'Eletrodomésticos' },
  { id: '11060020', name: 'Moda Feminina' },
  { id: '11060027', name: 'Moda Masculina' },
  { id: '11060036', name: 'Beleza' },
  { id: '11060044', name: 'Esportes e Lazer' },
  { id: '11060052', name: 'Brinquedos e Hobbies' },
];

const selectCls = 'h-9 rounded-md border border-input bg-surface-2 px-2 text-sm';

export function SearchFilters({
  source,
  mode,
  onSearch,
  loading,
}: {
  source: MarketplaceKind;
  mode: SearchMode;
  onSearch: (q: SearchQuery) => void;
  loading?: boolean;
}) {
  const [text, setText] = useState('');
  const [categoryId, setCategoryId] = useState(CATEGORIES[0]!.id);
  const [sort, setSort] = useState<SearchSort>('DISCOUNT_DESC');
  const [limit, setLimit] = useState('100');
  const [topSellers, setTopSellers] = useState(false);
  const [extraCommission, setExtraCommission] = useState(false);

  const isShopee = source === 'SHOPEE';

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const raw: Record<string, unknown> = {
      source,
      mode,
      sort,
      limit: Number(limit),
      topSellers: isShopee && topSellers,
      extraCommission: isShopee && extraCommission,
    };
    if (mode === 'keyword') raw.query = text;
    if (mode === 'shop') raw.shopId = text;
    if (mode === 'category') raw.categoryId = categoryId;
    const parsed = searchQuerySchema.safeParse(raw);
    if (parsed.success) onSearch(parsed.data);
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex gap-2">
        {mode === 'keyword' && (
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Buscar por palavra-chave…"
            className="flex-1"
          />
        )}
        {mode === 'shop' && (
          <Input
            value={text}
            onChange={(e) => setText(e.target.value.replace(/\D/g, ''))}
            placeholder="Shop ID da loja (ex.: 123456)"
            className="flex-1"
          />
        )}
        {mode === 'category' && (
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className={`${selectCls} flex-1`}
            aria-label="Categoria"
          >
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        {mode === 'trending' && (
          <p className="flex-1 self-center text-sm text-muted-foreground">
            Itens em alta segundo a API da Shopee.
          </p>
        )}
        <Button
          type="submit"
          className="bg-brand text-white hover:bg-brand/90"
          disabled={loading || (!isShopee && mode !== 'keyword')}
        >
          {loading ? 'Buscando…' : 'Buscar'}
        </Button>
      </div>
      <div className="flex flex-wrap items-end gap-4 text-sm">
        {isShopee && (
          <div className="flex flex-col gap-1">
            <Label htmlFor="sort">Ordenar</Label>
            <select
              id="sort"
              value={sort}
              onChange={(e) => setSort(e.target.value as SearchSort)}
              className={`${selectCls} w-48`}
            >
              {(Object.keys(SORT_LABELS) as SearchSort[]).map((k) => (
                <option key={k} value={k}>
                  {SORT_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <Label htmlFor="limit">Qtd.</Label>
          <select
            id="limit"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            className={`${selectCls} w-24`}
          >
            {['20', '50', '100', '200'].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        {isShopee && (
          <>
            <label className="flex items-center gap-2">
              <NativeCheckbox
                checked={topSellers}
                onChange={(e) => setTopSellers(e.target.checked)}
              />{' '}
              Top vendedores
            </label>
            <label className="flex items-center gap-2">
              <NativeCheckbox
                checked={extraCommission}
                onChange={(e) => setExtraCommission(e.target.checked)}
              />{' '}
              Comissão extra
            </label>
          </>
        )}
        {!isShopee && (mode === 'category' || mode === 'shop' || mode === 'trending') && (
          <p className="text-xs text-muted-foreground">
            {source === 'MERCADOLIVRE'
              ? 'Mercado Livre'
              : source === 'AMAZON'
                ? 'Amazon'
                : source === 'AWIN'
                  ? 'Awin'
                  : 'Magalu'}
            : só busca por palavra-chave está disponível.
          </p>
        )}
      </div>
    </form>
  );
}
