'use client';
import { useState } from 'react';
import type { MarketplaceKind, SearchMode, SearchQuery } from '@afilados/shared';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ProductCard } from '@/components/products/product-card';
import { SearchFilters } from '@/components/products/search-filters';
import { ImportPanel } from '@/components/products/import-panel';
import { apiFetch } from '@/lib/api';
import { useRealtime } from '@/lib/realtime';
import { formatBRL } from '@/lib/format';
import { useApiMutation } from '@/lib/mutations';
import { useQueue } from '@/lib/queries';
import type { ApiProduct } from '@/lib/types';
import { cn } from '@/lib/utils';

const MARKETS: { key: MarketplaceKind; label: string }[] = [
  { key: 'SHOPEE', label: 'Shopee' },
  { key: 'MERCADOLIVRE', label: 'Mercado Livre' },
  { key: 'AMAZON', label: 'Amazon' },
  { key: 'MAGALU', label: 'Magalu' },
  { key: 'AWIN', label: 'Awin' },
  { key: 'ALIEXPRESS', label: 'AliExpress' },
];
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
  { key: 'import', label: 'Por Links / CSV' },
];

export default function ProdutosPage() {
  const [source, setSource] = useState<MarketplaceKind>('SHOPEE');
  const [sub, setSub] = useState<SearchMode | 'import'>('keyword');
  const [products, setProducts] = useState<ApiProduct[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const SUBTABS = ALL_SUBTABS.filter((t) => !t.sources || t.sources.includes(source));

  function selectSource(kind: MarketplaceKind) {
    setSource(kind);
    const stillValid = ALL_SUBTABS.find((t) => t.key === sub);
    if (stillValid?.sources && !stillValid.sources.includes(kind)) setSub('keyword');
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

  function toggle(id: string) {
    const s = new Set(selected);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setSelected(s);
  }
  function toggleAll() {
    setSelected(selected.size === products.length ? new Set() : new Set(products.map((p) => p.id)));
  }
  async function copy(p: ApiProduct) {
    await navigator.clipboard.writeText(`${p.title}\n${formatBRL(p.price)}\n${p.originalUrl}`);
    toast.success('Copiado');
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Buscar Produtos</h1>
        <span className="rounded-md border border-border bg-surface px-3 py-1 text-sm">
          Produtos salvos na fila <b className="text-brand">{queue?.count ?? 0}</b> /{' '}
          {queue?.limit ?? '—'}
        </span>
      </div>
      <div className="flex gap-2">
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
      <div className="flex gap-4 border-b border-border text-sm">
        {SUBTABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setSub(t.key)}
            className={cn(
              '-mb-px border-b-2 px-1 pb-2',
              sub === t.key
                ? 'border-brand text-brand'
                : 'border-transparent text-muted-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {sub === 'import' ? (
        <ImportPanel
          onImported={(r) => {
            setProducts(r.products);
            setSelected(new Set(r.products.map((p) => p.id)));
          }}
        />
      ) : (
        <SearchFilters
          key={`${source}-${sub}`}
          source={source}
          mode={sub}
          onSearch={(q) => search.mutate(q)}
          loading={search.isPending}
        />
      )}

      {products.length > 0 && (
        <>
          <div className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-2 text-sm">
            <Button size="sm" variant="secondary" onClick={toggleAll}>
              {selected.size === products.length
                ? 'Desmarcar todos'
                : `Selecionar todos (${products.length})`}
            </Button>
            <span className="text-muted-foreground">{selected.size} selecionado(s)</span>
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
            {products.map((p) => (
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
