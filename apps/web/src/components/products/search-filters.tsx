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
import { useAliexpressCategories } from '@/lib/queries';

export const SORT_LABELS: Record<SearchSort, string> = {
  DISCOUNT_DESC: 'Maiores descontos',
  COMMISSION_DESC: 'Maior comissão',
  SALES_DESC: 'Mais vendidos',
  PRICE_ASC: 'Menor preço',
  PRICE_DESC: 'Maior preço',
};
// A Shopee Affiliate API não expõe nenhuma query para listar categorias válidas (confirmado
// por introspecção do schema GraphQL: só existem shopOfferV2/shopeeOfferV2/productOfferV2/
// conversionReport/validatedReport/partnerOrderReport/listItemFeeds/getItemFeedData). Testado
// ao vivo: o ID que aparece na URL da categoria em shopee.com.br (ex.: "...-cat.11059984") é de
// um namespace diferente do usado pela Open Platform e sempre retorna 0 resultados, mesmo sendo
// uma categoria real. O único ID que funciona é o `productCatIds` que a própria API devolve nos
// produtos — por isso ele aparece como um chip copiável ("🏷️ Categoria NNNNNN") em cada produto
// Shopee da Captura por palavra-chave.
//
// O AliExpress é diferente: tem o endpoint oficial `aliexpress.affiliate.category.get`
// (testado ao vivo — `category_ids` só filtra de verdade com um ID de lá), então a categoria
// dele usa um <select> de verdade em vez de um ID digitado à mão.
const CATEGORY_HELP: Partial<Record<MarketplaceKind, string>> = {
  SHOPEE:
    'Não use o número da URL do shopee.com.br — é outro sistema de IDs e sempre dá 0 resultados. Faça uma busca por palavra-chave, copie o chip "🏷️ Categoria" de um produto e cole aqui.',
};

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
  const [categoryId, setCategoryId] = useState('');
  const [sort, setSort] = useState<SearchSort>('DISCOUNT_DESC');
  const [limit, setLimit] = useState('100');
  const [topSellers, setTopSellers] = useState(false);
  const [extraCommission, setExtraCommission] = useState(false);
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [minDiscountPct, setMinDiscountPct] = useState('');
  const [minSales, setMinSales] = useState('');
  const [freeShippingOnly, setFreeShippingOnly] = useState(false);

  const isShopee = source === 'SHOPEE';
  const isAliexpress = source === 'ALIEXPRESS';
  // Categoria/mais buscados existem tanto na API oficial da Shopee quanto na do AliExpress;
  // os demais marketplaces (ML/Amazon/Magalu/Awin) só têm busca por palavra-chave.
  const supportsAdvancedModes = isShopee || isAliexpress;
  const { data: aliexpressCategories, isLoading: loadingCategories } = useAliexpressCategories(
    isAliexpress && mode === 'category',
  );

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const raw: Record<string, unknown> = {
      source,
      mode,
      sort,
      limit: Number(limit),
      topSellers: isShopee && topSellers,
      extraCommission: isShopee && extraCommission,
      freeShippingOnly,
    };
    if (mode === 'keyword') raw.query = text;
    if (mode === 'shop') raw.shopId = text;
    if (mode === 'category') raw.categoryId = categoryId;
    if (minPrice) raw.minPrice = Number(minPrice);
    if (maxPrice) raw.maxPrice = Number(maxPrice);
    if (minDiscountPct) raw.minDiscountPct = Number(minDiscountPct);
    if (minSales) raw.minSales = Number(minSales);
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
        {mode === 'category' && isAliexpress && (
          <div className="flex-1">
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className={`${selectCls} w-full`}
              aria-label="Categoria"
              disabled={loadingCategories}
            >
              <option value="">
                {loadingCategories ? 'Carregando categorias…' : 'Selecione uma categoria'}
              </option>
              {aliexpressCategories?.categories.map((c) => (
                <option key={c.categoryId} value={c.categoryId}>
                  {c.categoryName}
                </option>
              ))}
            </select>
          </div>
        )}
        {mode === 'category' && !isAliexpress && (
          <div className="flex-1">
            <Input
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value.replace(/\D/g, ''))}
              placeholder="ID da categoria (ex.: 100039)"
              aria-label="ID da categoria"
            />
            {CATEGORY_HELP[source] && (
              <p className="mt-1 text-xs text-muted-foreground">{CATEGORY_HELP[source]}</p>
            )}
          </div>
        )}
        {mode === 'trending' && (
          <p className="flex-1 self-center text-sm text-muted-foreground">
            {isShopee ? 'Itens em alta segundo a API da Shopee.' : 'Itens em alta / promoções segundo a API do AliExpress.'}
          </p>
        )}
        <Button
          type="submit"
          className="bg-brand text-white hover:bg-brand/90"
          disabled={
            loading ||
            (!supportsAdvancedModes && mode !== 'keyword') ||
            (mode === 'category' && !categoryId)
          }
        >
          {loading ? 'Buscando…' : 'Buscar'}
        </Button>
      </div>
      <div className="flex flex-wrap items-end gap-4 text-sm">
        {supportsAdvancedModes && (
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
        <div className="flex flex-col gap-1">
          <Label htmlFor="minPrice">Preço mín. (R$)</Label>
          <Input
            id="minPrice"
            type="number"
            min="0"
            step="0.01"
            value={minPrice}
            onChange={(e) => setMinPrice(e.target.value)}
            className="w-28"
            placeholder="0"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="maxPrice">Preço máx. (R$)</Label>
          <Input
            id="maxPrice"
            type="number"
            min="0"
            step="0.01"
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
            className="w-28"
            placeholder="sem limite"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="minDiscountPct">Desconto mín. (%)</Label>
          <Input
            id="minDiscountPct"
            type="number"
            min="1"
            max="99"
            value={minDiscountPct}
            onChange={(e) => setMinDiscountPct(e.target.value)}
            className="w-24"
            placeholder="0"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="minSales">Vendas mín.</Label>
          <Input
            id="minSales"
            type="number"
            min="0"
            value={minSales}
            onChange={(e) => setMinSales(e.target.value)}
            className="w-24"
            placeholder="0"
          />
        </div>
        <label className="flex items-center gap-2">
          <NativeCheckbox
            checked={freeShippingOnly}
            onChange={(e) => setFreeShippingOnly(e.target.checked)}
          />{' '}
          Só frete grátis
        </label>
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
        {!supportsAdvancedModes && (mode === 'category' || mode === 'shop' || mode === 'trending') && (
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
