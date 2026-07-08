/**
 * Очищення ЛИШЕ операційних даних (початок з чистого аркуша).
 *
 * Видаляє: операції та їх правки, зміни, рух готівки, звірки, передачі,
 *          USDT-операції, курси, витрати, сповіщення, перехідну собівартість
 *          (DeskCostBasis) і журнал банку готівки.
 * Обнуляє: баланс банку готівки (CashBankBalance), глобальний і точкові
 *          USDT-гаманці — щоб не лишалося грошей без підстав.
 * ЗБЕРІГАЄ: точки, каси, валюти (Currency/PointCurrency), користувачів, settings.
 *
 * БЕЗПЕКА (особливо для Railway-прод):
 *   - за замовчуванням DRY-RUN: лише показує поточні лічильники та цільову БД;
 *   - реальне видалення виконується ЛИШЕ якщо CONFIRM_RESET=1;
 *   - усе — в одній транзакції (усе або нічого).
 *
 * Запуск:
 *   Локально (dry-run):   npx ts-node prisma/reset-operational.ts
 *   Локально (виконати):  CONFIRM_RESET=1 npx ts-node prisma/reset-operational.ts
 *   Railway (dry-run):    railway run npx ts-node prisma/reset-operational.ts
 *   Railway (виконати):   railway run -- bash -c 'CONFIRM_RESET=1 npx ts-node prisma/reset-operational.ts'
 *
 *   Якщо хочете ЗБЕРЕГТИ баланси банку/гаманців — додайте KEEP_BALANCES=1.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const confirmed = process.env.CONFIRM_RESET === '1';
const keepBalances = process.env.KEEP_BALANCES === '1';

// Хост цільової БД (для видимості, щоб не стерти не ту базу).
function dbHost(): string {
  try {
    const u = new URL(process.env.DATABASE_URL ?? '');
    return `${u.hostname}:${u.port || '5432'}${u.pathname}`;
  } catch {
    return '(не вдалося розпарсити DATABASE_URL)';
  }
}

async function counts() {
  const [
    operationEdit, operation, reconciliation, cashMovement, usdtOperation,
    transfer, notification, rate, expense, cashBankMovement, shift, deskCostBasis,
  ] = await Promise.all([
    prisma.operationEdit.count(),
    prisma.operation.count(),
    prisma.reconciliation.count(),
    prisma.cashMovement.count(),
    prisma.usdtOperation.count(),
    prisma.transfer.count(),
    prisma.notification.count(),
    prisma.rate.count(),
    prisma.expense.count(),
    prisma.cashBankMovement.count(),
    prisma.shift.count(),
    prisma.deskCostBasis.count(),
  ]);
  return {
    operationEdit, operation, reconciliation, cashMovement, usdtOperation,
    transfer, notification, rate, expense, cashBankMovement, shift, deskCostBasis,
  };
}

async function main() {
  console.log('🎯 Цільова БД:', dbHost());
  console.log('📊 Поточні лічильники (буде видалено):');
  console.table(await counts());

  if (!confirmed) {
    console.log('\n⚠️  DRY-RUN: нічого не змінено.');
    console.log('   Щоб виконати — запустіть із CONFIRM_RESET=1');
    console.log(keepBalances
      ? '   (KEEP_BALANCES=1 — баланси банку та гаманців буде збережено)'
      : '   (баланси банку готівки та USDT-гаманців буде ОБНУЛЕНО; KEEP_BALANCES=1 щоб зберегти)');
    return;
  }

  console.log('\n🗑  Виконую очищення в транзакції...');
  await prisma.$transaction(async (tx) => {
    // Порядок — від дочірніх до батьківських (foreign keys).
    await tx.operationEdit.deleteMany({});
    await tx.operation.deleteMany({});
    await tx.reconciliation.deleteMany({});
    await tx.cashMovement.deleteMany({});
    await tx.usdtOperation.deleteMany({});
    await tx.transfer.deleteMany({});
    await tx.notification.deleteMany({});
    await tx.rate.deleteMany({});
    await tx.expense.deleteMany({});
    await tx.cashBankMovement.deleteMany({});
    await tx.shift.deleteMany({}); // після усього, що на неї посилається
    await tx.deskCostBasis.deleteMany({}); // скидаємо перехідну собівартість WAC

    if (!keepBalances) {
      // Обнуляємо балансові стани (гроші без підстав після видалення операцій).
      await tx.cashBankBalance.updateMany({ data: { amount: 0 } });
      await tx.usdtGlobalWallet.updateMany({ data: { balance: 0 } });
      await tx.usdtWallet.updateMany({ data: { balance: 0 } });
    }
  });

  console.log('✅ Готово. Лічильники після очищення:');
  console.table(await counts());
  console.log(keepBalances
    ? 'ℹ️  Баланси банку та гаманців збережено (KEEP_BALANCES=1).'
    : 'ℹ️  Баланси банку готівки та USDT-гаманців обнулено.');
}

main()
  .catch((e) => { console.error('❌ Помилка:', e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
