/**
 * Таймлайн курсу валюти точки: rates.service при зміні курсу деактивує старий
 * рядок Rate і створює новий, тож повна історія (ACTIVE + INACTIVE, за
 * createdAt) дозволяє відновити курс на БУДЬ-ЯКИЙ момент — це потрібно
 * $-числовнику: прибуток операції рахується за курсом продажу USD на момент
 * саме цієї операції, і зміна курсу вдень не переписує попередні операції.
 */

export interface RateAt {
  buy: number;
  sell: number;
}

export interface RateTimeline {
  /** Останній курс, що діяв на момент t; до першого запису — перший запис
   *  (краще наближення, ніж нічого); null — якщо історія порожня. */
  at(t: Date | number): RateAt | null;
}

export function buildRateTimeline(
  rows: { buy: unknown; sell: unknown; createdAt: Date | string }[],
): RateTimeline {
  const points = (rows ?? [])
    .map((r) => ({ at: new Date(r.createdAt ?? 0).getTime(), buy: Number(r.buy), sell: Number(r.sell) }))
    .sort((a, b) => a.at - b.at);

  return {
    at(t: Date | number): RateAt | null {
      if (points.length === 0) return null;
      const ts = typeof t === 'number' ? t : t.getTime();
      // Бінарний пошук останнього запису з at <= ts.
      let lo = 0;
      let hi = points.length - 1;
      if (ts < points[0].at) return { buy: points[0].buy, sell: points[0].sell };
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (points[mid].at <= ts) lo = mid;
        else hi = mid - 1;
      }
      return { buy: points[lo].buy, sell: points[lo].sell };
    },
  };
}
