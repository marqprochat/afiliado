'use client';
import { useMemo, useState } from 'react';
import { Search, Trash2, X } from 'lucide-react';
import type { MarketplaceKind, SearchMode, SearchQuery } from '@afilados/shared';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ProductCard } from '@/components/products/product-card';
import { SearchFilters } from '@/components/products/search-filters';
import { ImportPanel } from '@/components/products/import-panel';
import { apiFetch } from '@/lib/api';
import { copyToClipboard } from '@/lib/clipboard';
import { useRealtime } from '@/lib/realtime';
import { formatBRL } from '@/lib/format';
import { useApiMutation } from '@/lib/mutations';
import { useMarketplaces, useQueue } from '@/lib/queries';
import type { ApiProduct } from '@/lib/types';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

const MARKETS: { key: MarketplaceKind; label: string }[] = [
  { key: 'SHOPEE', label: 'Shopee' },
  { key: 'MERCADOLIVRE', label: 'Mercado Livre' },
  { key: 'AMAZON', label: 'Amazon' },
  { key: 'MAGALU', label: 'Magalu' },
  { key: 'AWIN', label: 'Awin' },
  { key: 'ALIEXPRESS', label: 'AliExpress' },
];

// Busca por palavra-chave por raspagem é bloqueada pelo anti-bot. O Mercado Livre é liberado
// quando a API oficial está conectada (Marketplaces → Mercado Livre → "Conectar API oficial").
// A Amazon usa a Creators API, portanto sua aba de captura permanece disponível.
const SCRAPED_KEYWORD_SOURCES: MarketplaceKind[] = ['MERCADOLIVRE', 'MAGALU'];
// Categoria/mais buscados existem na API oficial da Shopee e na do AliExpress. Loja
// favorita é só Shopee (shopId na productOfferV2). Os demais marketplaces só têm busca
// por palavra-chave (scraping) e importação por link.
const ALL_SUBTABS: {
  key: SearchMode | 'import';
  label: string;
  sources?: MarketplaceKind[];
}[] = [
  { key: 'keyword', label: 'Captura de Produtos' },
  { key: 'category', label: 'Explorar Categorias', sources: ['SHOPEE', 'ALIEXPRESS'] },
  { key: 'trending', label: 'Mais Buscados', sources: ['SHOPEE', 'ALIEXPRESS'] },
  { key: 'shop', label: 'Lojas Favoritas', sources: ['SHOPEE'] },
  { key: 'listing', label: 'Ofertas do ML', sources: ['MERCADOLIVRE'] },
  { key: 'listing', label: 'Ofertas da Amazon', sources: ['AMAZON'] },
  { key: 'import', label: 'Por Links / CSV' },
];

export default function ProdutosPage() {
  const [source, setSource] = useState<MarketplaceKind>('SHOPEE');
  const [sub, setSub] = useState<SearchMode | 'import'>('keyword');
  const [products, setProducts] = useState<ApiProduct[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [listFilter, setListFilter] = useState('');
  const { data: marketplaces } = useMarketplaces();
  const mlApiConnected = Boolean(marketplaces?.find((m) => m.kind === 'MERCADOLIVRE')?.hasMlApi);
  const DISABLED_KEYWORD_SOURCES = SCRAPED_KEYWORD_SOURCES.filter(
    (k) => !(k === 'MERCADOLIVRE' && mlApiConnected),
  );
  const isKeywordDisabled = DISABLED_KEYWORD_SOURCES.includes(source);
  const baseSubtabs = ALL_SUBTABS.filter((t) => !t.sources || t.sources.includes(source));
  const SUBTABS = isKeywordDisabled
    ? [
        ...baseSubtabs.filter((t) => t.key === 'import'),
        ...baseSubtabs.filter((t) => t.key !== 'import'),
      ]
    : baseSubtabs;
  // Sem busca por palavra-chave (anti-bot), o ML abre nas Ofertas do ML; os demais, em Por Links / CSV.
  const fallbackSub = (kind: MarketplaceKind): SearchMode | 'import' =>
    kind === 'MERCADOLIVRE' ? 'listing' : 'import';
  const effectiveSub: SearchMode | 'import' =
    isKeywordDisabled && sub === 'keyword' ? fallbackSub(source) : sub;

  function selectSource(kind: MarketplaceKind) {
    setSource(kind);
    // A captura da Amazon usa a Creators API. Ao trocar para ela, abre essa aba em vez de
    // herdar a listagem do Mercado Livre (as duas usam o mesmo modo interno `listing`).
    if (kind === 'AMAZON' && source !== kind) {
      setSub('keyword');
      return;
    }
    const willDisableKeyword = DISABLED_KEYWORD_SOURCES.includes(kind);
    // Vindo de outro marketplace (ex.: ML → Amazon → ML), o ML sem API oficial abre em Ofertas do ML
    // em vez de herdar "Por Links / CSV" que a Amazon deixou.
    if (willDisableKeyword && (sub === 'keyword' || (kind === 'MERCADOLIVRE' && source !== kind))) {
      setSub(fallbackSub(kind));
      return;
    }
    const stillValid = ALL_SUBTABS.some(
      (t) => t.key === sub && (!t.sources || t.sources.includes(kind)),
    );
    if (!stillValid) {
      setSub(willDisableKeyword ? fallbackSub(kind) : 'keyword');
    }
  }

  // Produtos importados em lote chegam como esqueleto e são atualizados quando o worker termina
  useRealtime((e) => {
    if (e.type !== 'product.enriched') return;
    void apiFetch<{ products: ApiProduct[] }>(`/products?ids=${e.productId}`).then((r) => {
      const fresh = r.products[0];
      if (!fresh) return;
      setProducts((prev) => prev.map((p) => (p.id === fresh.id ? fresh : p)));
    });
  });
  const { data: queue } = useQueue();

  const search = useApiMutation(
    (q: SearchQuery) =>
      apiFetch<{ products: ApiProduct[] }>('/products/search', { method: 'POST', json: q }),
    {
      onSuccess: (r) => {
        setProducts(r.products);
        setSelected(new Set());
        if (r.products.length === 0) toast.info('Nenhum produto encontrado');
      },
    },
  );
  const save = useApiMutation(
    (productIds: string[]) =>
      apiFetch<{ added: number; count: number }>('/queue', {
        method: 'POST',
        json: { productIds },
      }),
    {
      invalidate: [['queue'], ['overview']],
      onSuccess: (r) => {
        toast.success(`${r.added} produto(s) salvos na fila`);
        setSelected(new Set());
      },
    },
  );

  const normalizedListFilter = listFilter.trim().toLowerCase();
  const visibleProducts = useMemo(() => {
    if (!normalizedListFilter) return products;
    return products.filter(
      (p) =>
        p.title.toLowerCase().includes(normalizedListFilter) ||
        (p.shopName?.toLowerCase().includes(normalizedListFilter) ?? false),
    );
  }, [products, normalizedListFilter]);

  const allVisibleSelected =
    visibleProducts.length > 0 && visibleProducts.every((p) => selected.has(p.id));

  function toggle(id: string) {
    const s = new Set(selected);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setSelected(s);
  }
  function toggleAll() {
    const next = new Set(selected);
    if (allVisibleSelected) {
      for (const p of visibleProducts) next.delete(p.id);
    } else {
      for (const p of visibleProducts) next.add(p.id);
    }
    setSelected(next);
  }
  function removeSelectedFromList() {
    if (selected.size === 0) return;
    setProducts((prev) => prev.filter((p) => !selected.has(p.id)));
    setSelected(new Set());
    toast.success('Itens selecionados removidos da lista');
  }
  async function copy(p: ApiProduct) {
    await copyToClipboard(`${p.title}\n${formatBRL(p.price)}\n${p.originalUrl}`);
    toast.success('Copiado');
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Buscar Produtos</h1>
        <span className="rounded-md border border-border bg-surface px-3 py-1 text-sm">
          Produtos salvos na fila <b className="text-brand">{queue?.count ?? 0}</b>
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {MARKETS.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => selectSource(m.key)}
            className={cn(
              'rounded-md border px-3 py-1.5 text-sm transition-colors',
              source === m.key
                ? 'border-brand bg-brand text-white'
                : 'border-border bg-surface-2 text-muted-foreground hover:text-foreground',
            )}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-4 border-b border-border text-sm">
        {SUBTABS.map((t) => {
          const isDisabled = isKeywordDisabled && t.key === 'keyword';
          if (isDisabled) {
            return (
              <TooltipProvider key={t.key} delay={100}>
                <Tooltip>
                  <TooltipTrigger
                    type="button"
                    aria-disabled="true"
                    className="-mb-px border-b-2 border-transparent px-1 pb-2 text-muted-foreground/40 cursor-not-allowed select-none"
                  >
                    {t.label}
                  </TooltipTrigger>
                  <TooltipContent>Em desenvolvimento</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            );
          }
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setSub(t.key)}
              className={cn(
                '-mb-px border-b-2 px-1 pb-2 transition-colors',
                effectiveSub === t.key
                  ? 'border-brand text-brand'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {effectiveSub === 'import' ? (
        <ImportPanel
          onImported={(r) => {
            setProducts(r.products);
            setSelected(new Set(r.products.map((p) => p.id)));
          }}
        />
      ) : (
        <SearchFilters
          key={`${source}-${effectiveSub}`}
          source={source}
          mode={effectiveSub}
          onSearch={(q) => search.mutate(q)}
          loading={search.isPending}
        />
      )}

      {products.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2 text-sm">
            <div className="relative flex-1 min-w-[180px] max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={listFilter}
                onChange={(e) => setListFilter(e.target.value)}
                placeholder="Filtrar lista por palavra-chave..."
                aria-label="Filtrar resultados por palavra-chave"
                className="h-7 pl-7 pr-7 text-xs"
              />
              {listFilter && (
                <button
                  type="button"
                  onClick={() => setListFilter('')}
                  aria-label="Limpar filtro da lista"
                  className="absolute right-2 top-1.5 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {normalizedListFilter && (
              <span className="text-xs text-muted-foreground">
                {visibleProducts.length} de {products.length}
              </span>
            )}
            <Button
              size="sm"
              variant="secondary"
              disabled={visibleProducts.length === 0}
              onClick={toggleAll}
            >
              {allVisibleSelected
                ? 'Desmarcar todos'
                : `Selecionar todos (${visibleProducts.length})`}
            </Button>
            <span className="text-muted-foreground">{selected.size} selecionado(s)</span>
            {selected.size > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={removeSelectedFromList}
                className="text-red-300 hover:text-red-200"
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" /> Remover selecionados
              </Button>
            )}
            <Button
              size="sm"
              className="ml-auto bg-brand text-white hover:bg-brand/90"
              disabled={!selected.size || save.isPending}
              onClick={() => save.mutate([...selected])}
            >
              Salvar selecionados
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
            {visibleProducts.map((p) => (
              <ProductCard
                key={p.id}
                product={p}
                selected={selected.has(p.id)}
                onToggle={toggle}
                onCopy={copy}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
