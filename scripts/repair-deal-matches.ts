/**
 * Reparo das páginas de oferta (MasterProduct) que juntaram produtos diferentes
 * (outro modelo, capacidade, tamanho, quantidade…) e por isso misturavam o histórico de preços.
 *
 * Para cada produto com mais de uma listagem, a listagem cujo título conflita com o do produto
 * (ou cujo preço passa de 1.8× a mediana das compatíveis) é re-casada com outro produto ou ganha
 * um produto novo. A listagem é movida com o próprio histórico; as métricas são recalculadas.
 *
 * Dry-run por padrão (só imprime); `--apply` grava. `--tenant <id>` limita a um tenant.
 *
 *   DATABASE_URL=... pnpm --filter @afilados/db exec tsx ../../scripts/repair-deal-matches.ts
 *   DATABASE_URL=... pnpm --filter @afilados/db exec tsx ../../scripts/repair-deal-matches.ts --tenant <id> --apply
 *
 * Os imports são relativos porque a raiz do monorepo não enxerga os pacotes @afilados/*.
 */
import { prisma, forTenant } from '../packages/db/src/index';
import { repairDealMatches } from '../packages/deals/src/repair-matches';

const EXAMPLES = 15;
const brl = (n: number) => `R$ ${n.toFixed(2)}`;

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const tenantIdx = args.indexOf('--tenant');
  const onlyTenant = tenantIdx >= 0 ? args[tenantIdx + 1] : undefined;
  if (tenantIdx >= 0 && !onlyTenant) throw new Error('--tenant precisa de um id');

  const tenants = await prisma.tenant.findMany({
    where: onlyTenant ? { id: onlyTenant } : {},
    select: { id: true, name: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log(
    `--- Reparo de ofertas (${apply ? 'APPLY: gravando' : 'dry-run: nada é gravado'}) ---`,
  );

  const totals = { scanned: 0, affected: 0, noAnchor: 0, moved: 0, newMasters: 0 };
  for (const t of tenants) {
    const r = await repairDealMatches(forTenant(t.id), t.id, { apply });
    totals.scanned += r.mastersScanned;
    totals.affected += r.mastersAffected;
    totals.noAnchor += r.mastersWithoutAnchor;
    totals.moved += r.moves.length;
    totals.newMasters += r.newMasters;
    if (r.mastersScanned === 0) continue;
    console.log(
      `\nTenant ${t.name} (${t.id}): ${r.mastersScanned} produtos com >1 oferta, ` +
        `${r.mastersAffected} com ofertas de outro produto, ${r.moves.length} ofertas a mover, ` +
        `${r.newMasters} produtos novos, ${r.mastersWithoutAnchor} sem oferta compatível com o título`,
    );
    for (const m of r.moves.slice(0, EXAMPLES)) {
      console.log(
        `  [${m.reason}] "${m.listingTitle}" ${brl(m.price)}\n` +
          `      de: "${m.fromTitle}"\n` +
          `    para: "${m.toTitle}"${m.toMasterId ? '' : ' (novo)'}`,
      );
    }
    if (r.moves.length > EXAMPLES) console.log(`  … e mais ${r.moves.length - EXAMPLES}`);
  }

  console.log(
    `\nTotal: ${totals.scanned} produtos analisados, ${totals.affected} afetados, ` +
      `${totals.moved} ofertas ${apply ? 'movidas' : 'a mover'}, ${totals.newMasters} produtos novos, ` +
      `${totals.noAnchor} sem oferta compatível (não mexidos).`,
  );
  if (!apply) console.log('Nada foi gravado. Rode com --apply para aplicar.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
