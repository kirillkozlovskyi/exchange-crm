// Оцінка залишків каси — для нестачі/надлишку при закритті зміни та «каси в
// доларах» (дзеркало backend/common/profit.util.ts + wac-profit.util.ts).
// Прибуток тут НЕ рахується: він приходить із сервера (op.profitUsd/op.profit).

export function midRates(
  rates: { currency: string; buy: number | string; sell: number | string }[],
): Record<string, number> {
  const mid: Record<string, number> = { UAH: 1 };
  for (const r of rates) mid[r.currency] = (Number(r.buy) + Number(r.sell)) / 2;
  return mid;
}

/**
 * Курси ПРОДАЖУ — оцінка нестачі/надлишку каси (дзеркало backend sellRates).
 * Нестача 100 $ коштує стільки, за скільки каса продала б ці 100 $ клієнту.
 */
export function sellRates(
  rates: { currency: string; buy: number | string; sell: number | string }[],
): Record<string, number> {
  const map: Record<string, number> = { UAH: 1 };
  for (const r of rates) map[r.currency] = Number(r.sell);
  return map;
}

export function valueOf(
  balance: Record<string, number>,
  valuation: Record<string, number>,
): number {
  return Object.entries(balance).reduce(
    (sum, [cur, amt]) => sum + Number(amt) * (valuation[cur] ?? 0),
    0,
  );
}

/** Активний курс продажу USD точки (S — база $-числовника). */
export function activeUsdSell(
  rates: { currency: string; buy: number | string; sell: number | string }[],
): number {
  const usd = rates.find((r) => r.currency === 'USD');
  return usd ? Number(usd.sell) : 0;
}

/**
 * «Каса в доларах» — підсумок каси за принципом власника (дзеркало backend
 * tillUsdValue): долари всіх видів (USD, USDT, USDW, USDG) — «готова валюта»
 * 1:1 по факту; UAH — ÷ сер. курс (₴/$); інші валюти — × їх $-крос (курс
 * задає власник). basis — людський формат (UAH: 44.95, EUR: 1.1420).
 * Валюта без бази оцінюється в 0 (чесний нуль, а не вигадана вартість).
 */
type RateRow = { currency: string; buy: number | string; sell: number | string };

/**
 * Очікуваний сер. курс валюти в людському форматі: UAH — ₴ за 1 $ (курс продажу
 * USD точки), інші — $-крос від курсу КУПІВЛІ точки. Це орієнтир для підказки та
 * перевірки вводу, а не значення для збереження: собівартість каси відрізняється
 * від курсу дня на відсотки, не в рази. 0 — орієнтиру немає (валюти немає в курсах).
 */
export function expectedBasis(cur: string, rates: RateRow[], uahBasis?: number): number {
  if (cur.startsWith('USD')) return 0; // долари всіх видів — 1:1, курсу не мають
  const usdSell = activeUsdSell(rates);
  if (cur === 'UAH') return usdSell;
  // Знаменник кросу — сер. курс гривні (введений), інакше поточний продаж USD.
  const uahPerUsd = uahBasis && uahBasis > 0 ? uahBasis : usdSell;
  const buy = Number(rates.find((r) => r.currency === cur)?.buy ?? 0);
  return buy > 0 && uahPerUsd > 0 ? buy / uahPerUsd : 0;
}

/**
 * Перевірка введеного сер. курсу на переплутані одиниці. Причина інциденту
 * 23–27.07.2026: у поле $-кросу вписували ГРИВНЕВИЙ курс (PLN 11.78 замість
 * 0.26, CHF 55 замість 1.21) — прибуток рахувався проти собівартості, що в ~45
 * разів більша за реальну, і продаж 500 злотих давав «збиток» 5 000 $.
 * Коридор ±30%: реальна собівартість відхиляється від курсу дня на одиниці
 * відсотків, а помилка в одиницях — у десятки разів. Повертає текст або null.
 */
export function basisWarning(cur: string, value: number, expected: number): string | null {
  if (!(value > 0) || !(expected > 0)) return null;
  const ratio = value / expected;
  if (ratio <= 1.3 && ratio >= 0.7) return null;
  const hint = expected.toFixed(cur === 'UAH' ? 2 : 4);
  // Класична підміна: вписано ₴-курс замість $-кросу — тоді ratio ≈ ₴ за 1 $.
  return cur !== 'UAH' && ratio > 20
    ? `Схоже на гривневий курс. Тут потрібна вартість 1 ${cur} у доларах — приблизно ${hint}`
    : `Не схоже на правду: очікується приблизно ${hint}`;
}

export function tillUsd(
  balance: Record<string, number>,
  basis: Record<string, number>,
): { byCurrency: Record<string, number>; total: number } {
  const byCurrency: Record<string, number> = {};
  let total = 0;
  for (const [cur, raw] of Object.entries(balance)) {
    const qty = Number(raw);
    if (!Number.isFinite(qty) || qty === 0) continue;
    let usd = 0;
    if (cur.startsWith('USD')) usd = qty;
    else if (cur === 'UAH') usd = basis.UAH > 0 ? qty / basis.UAH : 0;
    else usd = qty * (basis[cur] > 0 ? basis[cur] : 0);
    byCurrency[cur] = usd;
    total += usd;
  }
  return { byCurrency, total };
}
