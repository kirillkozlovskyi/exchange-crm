/**
 * Чистий калькулятор грошової математики операції — єдине джерело істини
 * для create() і update(). Тип визначається за валютами (currency / payCurrency),
 * а НЕ за збереженим op.type, тому редагування крос-операції рахується правильно.
 *
 * Крос-логіка «через гривню» (підтверджено бізнесом):
 *   клієнт дає payCurrency, отримує currency;
 *   totalUah = payAmount × buy(payCurrency)            // EUR → UAH за курсом купівлі EUR
 *   amount   = totalUah / sell(currency)               // UAH → USD за курсом продажу USD (рахує фронт)
 *   profit   = payAmount × sell(payCur) − amount × buy(getCur)
 *            ≡ payAmount×(sell−buy)[payCur] + amount×(sell−buy)[getCur]   // спред на обох плечах
 */

export interface RatePair {
  buy: number;
  sell: number;
}

/** Повертає активний курс валюти або null (UAH обробляється окремо). */
export type RateLookup = (currency: string) => RatePair | null;

export interface OperationInput {
  currency: string; // що клієнт отримує (getCur)
  amount: number;
  rate: number;
  payCurrency?: string | null; // що клієнт дає (для крос/BUY)
  payAmount?: number | null;
  mode?: string; // 'BUY' | 'SELL' — тип для крос-операції
}

export interface OperationTotals {
  type: 'BUY' | 'SELL' | 'EXCHANGE';
  totalUah: number;
  profit: number;
}

export function computeOperationTotals(
  input: OperationInput,
  getRate: RateLookup,
): OperationTotals {
  const getCur = input.currency;
  const payCur = input.payCurrency || 'UAH';

  const getCurRate = getCur !== 'UAH' ? getRate(getCur) : null;
  const payCurRate = payCur !== 'UAH' ? getRate(payCur) : null;

  const buyOf = (cur: string): number => {
    if (cur === 'UAH') return 1;
    if (cur === getCur && getCurRate) return getCurRate.buy;
    if (cur === payCur && payCurRate) return payCurRate.buy;
    return 0;
  };
  const sellOf = (cur: string): number => {
    if (cur === 'UAH') return 1;
    if (cur === getCur && getCurRate) return getCurRate.sell;
    if (cur === payCur && payCurRate) return payCurRate.sell;
    return 0;
  };

  // Класичний SELL: клієнт платить UAH, отримує валюту
  if (payCur === 'UAH' && getCur !== 'UAH') {
    return {
      type: 'SELL',
      totalUah: input.amount * input.rate,
      profit: getCurRate ? input.amount * (getCurRate.sell - getCurRate.buy) : 0,
    };
  }

  // Класичний BUY: клієнт дає валюту, отримує UAH
  if (getCur === 'UAH' && payCur !== 'UAH') {
    return {
      type: 'BUY',
      totalUah: input.amount * input.rate,
      profit: payCurRate ? input.amount * (payCurRate.sell - payCurRate.buy) : 0,
    };
  }

  // Крос-обмін: валюта → валюта (через гривню)
  const payAmount = input.payAmount ?? 0;
  return {
    type: (input.mode as OperationTotals['type']) ?? 'EXCHANGE',
    totalUah: payAmount * buyOf(payCur),
    profit: payAmount * sellOf(payCur) - input.amount * buyOf(getCur),
  };
}
