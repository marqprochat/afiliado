import { Suspense } from 'react';
import { MarketplacesClient } from './marketplaces-client';

export default function MarketplacesPage() {
  return (
    <Suspense fallback={null}>
      <MarketplacesClient />
    </Suspense>
  );
}
