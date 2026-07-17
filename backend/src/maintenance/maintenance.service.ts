import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Небезпечні операції обслуговування. Обнулення операційних даних — «старт із
 * чистого аркуша»: видаляє все, що стосується грошей/руху, лишає довідники.
 */
@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);
  constructor(private prisma: PrismaService) {}

  /** Лічильники того, що буде видалено/скинуто (для попередження в UI). */
  async operationalCounts() {
    const [operations, shifts, cashMovements, transfers, usdtOperations, reconciliations, expenses, archivedRates] =
      await Promise.all([
        this.prisma.operation.count(),
        this.prisma.shift.count(),
        this.prisma.cashMovement.count(),
        this.prisma.transfer.count(),
        this.prisma.usdtOperation.count(),
        this.prisma.reconciliation.count(),
        this.prisma.expense.count(),
        this.prisma.rate.count({ where: { status: 'INACTIVE' } }),
      ]);
    return { operations, shifts, cashMovements, transfers, usdtOperations, reconciliations, expenses, archivedRates };
  }

  /**
   * Обнулення операційних даних (усі точки):
   *  ВИДАЛЯЄ: операції+правки, зміни, рух готівки, звірки, передачі,
   *           USDT-операції, витрати, сповіщення, журнал банку, перехідну
   *           собівартість (DeskCostBasis) і пул відкупу (DeskSoldPool),
   *           АРХІВНІ курси (status=INACTIVE).
   *  ОБНУЛЯЄ: баланс банку готівки, USDT-гаманці.
   *  ЗБЕРІГАЄ: точки, каси, валюти, користувачів, налаштування та АКТИВНІ курси.
   * Усе в одній транзакції — все або нічого.
   */
  async resetOperational() {
    const before = await this.operationalCounts();
    await this.prisma.$transaction(async (tx) => {
      await tx.operationEdit.deleteMany({});
      await tx.operation.deleteMany({});
      await tx.reconciliation.deleteMany({});
      await tx.cashMovement.deleteMany({});
      await tx.usdtOperation.deleteMany({});
      await tx.transfer.deleteMany({});
      await tx.notification.deleteMany({});
      await tx.expense.deleteMany({});
      await tx.cashBankMovement.deleteMany({});
      // Курси: лишаємо активні, видаляємо лише архів (історію трендів).
      await tx.rate.deleteMany({ where: { status: 'INACTIVE' } });
      await tx.shift.deleteMany({}); // після всього, що на неї посилається
      await tx.deskCostBasis.deleteMany({});
      // Балансові стани — обнуляємо (гроші без підстав після видалення операцій).
      await tx.cashBankBalance.updateMany({ data: { amount: 0 } });
      await tx.usdtGlobalWallet.updateMany({ data: { balance: 0 } });
      await tx.usdtWallet.updateMany({ data: { balance: 0 } });
    });
    this.logger.warn(
      `Операційні дані обнулено: видалено операцій=${before.operations}, змін=${before.shifts}, ` +
      `рухів=${before.cashMovements}, передач=${before.transfers}, USDT=${before.usdtOperations}, ` +
      `звірок=${before.reconciliations}, витрат=${before.expenses}, архів.курсів=${before.archivedRates}.`,
    );
    return before;
  }
}
