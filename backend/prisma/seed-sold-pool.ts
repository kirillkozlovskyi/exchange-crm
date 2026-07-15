/**
 * Разове задання стартового «пулу проданої гривні» для маржі з відкупу.
 *
 * Навіщо: маржа з відкупу тримає пул гривні, отриманої з продажів, що чекає
 * відкупу (DeskSoldPool). Він переноситься між змінами, але почав вестися лише
 * з появою фічі — тож перший розрахунок неточний без стартового значення.
 * Цей скрипт задає пул вручну (з даних попереднього дня).
 *
 * Параметри через env:
 *   DESK   — cashDeskId (напр. каса «Курс ОК / Касса 2 Вика» = 2 на проді)
 *   CUR    — валюта (напр. USD)
 *   UNITS  — скільки одиниць валюти «продано» і чекає відкупу
 *   UAH    — скільки гривні за них отримано
 *
 * БЕЗПЕКА: за замовчуванням DRY-RUN; виконання — лише з CONFIRM_SEED=1.
 *
 * Приклад (каса КО, USD: 683 574 грн продано ≈ по 45.03 → 15180.41 од.):
 *   railway run -- bash -c 'DESK=2 CUR=USD UNITS=15180.41 UAH=683574 \
 *     CONFIRM_SEED=1 npx ts-node prisma/seed-sold-pool.ts'
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const cashDeskId = Number(process.env.DESK);
  const currency = (process.env.CUR ?? '').toUpperCase();
  const units = Number(process.env.UNITS);
  const uah = Number(process.env.UAH);
  const confirmed = process.env.CONFIRM_SEED === '1';

  if (!Number.isFinite(cashDeskId) || !currency || !Number.isFinite(units) || !Number.isFinite(uah)) {
    console.error('Потрібні env: DESK, CUR, UNITS, UAH');
    process.exit(1);
  }

  const existing = await prisma.deskSoldPool.findUnique({
    where: { cashDeskId_currency: { cashDeskId, currency } },
  });
  console.log(`Каса ${cashDeskId} · ${currency}`);
  console.log(`  було: ${existing ? `${existing.units} од / ${existing.uah} грн` : '(порожньо)'}`);
  console.log(`  стане: ${units} од / ${uah} грн (сер. курс ${(uah / units).toFixed(4)})`);

  if (!confirmed) {
    console.log('\nDRY-RUN. Додайте CONFIRM_SEED=1 щоб записати.');
    return;
  }

  await prisma.deskSoldPool.upsert({
    where: { cashDeskId_currency: { cashDeskId, currency } },
    create: { cashDeskId, currency, units, uah },
    update: { units, uah },
  });
  console.log('✓ Пул записано.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
