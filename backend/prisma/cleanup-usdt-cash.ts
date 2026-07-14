/**
 * Разова очистка «мертвого» USDT з готівкового обліку кас.
 *
 * Історія: до 2026-07-05 USDT проводили як звичайну валюту, і на касах
 * залишились хвости — USDT у startBalance відкритих змін (тягнеться префілом
 * з endBalance) та рядки USDT у DeskCostBasis (собівартість ~27.87 грн — ризик
 * фантомного прибутку, якщо позиція колись реалізується через WAC).
 * Рішення власника (2026-07-14): видалити і забути.
 *
 * Робить:
 *   - видаляє рядки DeskCostBasis з currency='USDT' (усі каси);
 *   - прибирає ключ USDT зі startBalance ВІДКРИТИХ змін.
 * НЕ чіпає: закриті зміни (історія лишається як була), USDT-гаманці,
 *           USDT-операції.
 *
 * БЕЗПЕКА: за замовчуванням DRY-RUN (лише показує, що буде зроблено);
 * реальне виконання — тільки з CONFIRM_CLEANUP=1.
 *
 * Запуск:
 *   Локально (dry-run):   npx ts-node prisma/cleanup-usdt-cash.ts
 *   Локально (виконати):  CONFIRM_CLEANUP=1 npx ts-node prisma/cleanup-usdt-cash.ts
 *   Railway (dry-run):    railway run npx ts-node prisma/cleanup-usdt-cash.ts
 *   Railway (виконати):   railway run -- bash -c 'CONFIRM_CLEANUP=1 npx ts-node prisma/cleanup-usdt-cash.ts'
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const confirmed = process.env.CONFIRM_CLEANUP === '1';

function dbHost(): string {
  try {
    const u = new URL(process.env.DATABASE_URL ?? '');
    return `${u.hostname}:${u.port || '5432'}${u.pathname}`;
  } catch {
    return '(не вдалося розпарсити DATABASE_URL)';
  }
}

async function main() {
  console.log(`БД: ${dbHost()}`);
  console.log(confirmed ? '── РЕЖИМ ВИКОНАННЯ ──' : '── DRY-RUN (CONFIRM_CLEANUP=1 щоб виконати) ──');

  const basisRows = await prisma.deskCostBasis.findMany({ where: { currency: 'USDT' } });
  for (const r of basisRows) {
    console.log(`DeskCostBasis: каса ${r.cashDeskId}, USDT avgCost=${r.avgCost} → видалити`);
  }
  if (!basisRows.length) console.log('DeskCostBasis: рядків USDT немає');

  const openShifts = await prisma.shift.findMany({
    where: { status: 'OPEN' },
    select: { id: true, number: true, cashDeskId: true, startBalance: true },
  });
  const toFix = openShifts.filter(
    (s) => (s.startBalance as Record<string, unknown>)?.USDT !== undefined,
  );
  for (const s of toFix) {
    console.log(
      `Зміна ${s.number} (каса ${s.cashDeskId}): startBalance.USDT=${(s.startBalance as any).USDT} → прибрати`,
    );
  }
  if (!toFix.length) console.log('Відкриті зміни: USDT у startBalance немає');

  if (!confirmed) return;

  await prisma.$transaction(async (tx) => {
    if (basisRows.length) {
      await tx.deskCostBasis.deleteMany({ where: { currency: 'USDT' } });
    }
    for (const s of toFix) {
      const { USDT: _drop, ...rest } = s.startBalance as Record<string, unknown>;
      await tx.shift.update({ where: { id: s.id }, data: { startBalance: rest as object } });
    }
  });
  console.log(`Готово: видалено рядків собівартості=${basisRows.length}, оновлено відкритих змін=${toFix.length}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
