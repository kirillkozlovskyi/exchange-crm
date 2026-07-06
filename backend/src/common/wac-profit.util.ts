/**
 * Реалізований прибуток за моделлю ковзної середньої собівартості (WAC),
 * з ПЕРЕХІДНОЮ позицією між змінами (Варіант 1, підтверджено власником).
 *
 * Ідея: по кожній валюті каса тримає позицію (кількість + середня собівартість
 * у гривні). Прибуток реалізується в МОМЕНТ операції, що зменшує позицію:
 *   • продаж наявної валюти:      прибуток = к-сть × (ціна продажу − сер.собівартість)
 *   • викуп короткої позиції:     прибуток = к-сть × (сер.ціна продажу − ціна викупу)
 * Купівля (нарощення позиції) прибутку не дає — лише оновлює середню собівартість.
 * Непродана позиція НЕ переоцінюється (жодного фантомного прибутку від коливань).
 *
 * На відміну від старої «з відкупу» моделі — матчинг НЕ рветься на межі зміни:
 * позиція переноситься, тож продаж наявного запасу дає прибуток одразу
 * (сценарій замовника: продав USD учора → прибуток є вже сьогодні на відкриття).
 */

export interface WacPosition {
  qty: number;      // знакова позиція: >0 довга (є валюта), <0 коротка (продали більше)
  avgCost: number;  // середня ціна відкритої позиції, грн за одиницю
}
export type PositionMap = Record<string, WacPosition>;

export interface WacOperation {
  currency: string;
  amount: unknown;
  totalUah: unknown;
  payCurrency?: string | null;
  payAmount?: unknown;
  type?: string; // BUY | SELL | EXCHANGE
  cancelled?: boolean;
}

const EPS = 1e-9;
const sign = (n: number) => (n > 0 ? 1 : n < 0 ? -1 : 0);

/**
 * Застосовує один знаковий «трейд» (q>0 — придбали, q<0 — віддали) за ціною
 * price (грн/од.) до позиції. Мутує pos, повертає реалізований прибуток.
 */
export function applyTrade(pos: WacPosition, q: number, price: number): number {
  if (Math.abs(q) < EPS) return 0;

  // Той самий напрямок (або позиція порожня) → нарощуємо, середня зважена.
  if (pos.qty === 0 || sign(q) === sign(pos.qty)) {
    const nq = pos.qty + q;
    pos.avgCost = Math.abs(nq) > EPS ? (pos.avgCost * pos.qty + price * q) / nq : 0;
    pos.qty = nq;
    return 0;
  }

  // Протилежний напрямок → закриваємо (можливо, з переворотом).
  const closeQty = Math.min(Math.abs(q), Math.abs(pos.qty));
  const realized = pos.qty > 0
    ? closeQty * (price - pos.avgCost) // довга: продаж вище собівартості = прибуток
    : closeQty * (pos.avgCost - price); // коротка: викуп нижче сер.ціни продажу = прибуток

  const remainder = Math.abs(q) - Math.abs(pos.qty);
  if (remainder > EPS) {
    // Позиція перевернулась: залишок відкриває протилежну сторону за price.
    pos.qty = sign(q) * remainder;
    pos.avgCost = price;
  } else {
    pos.qty += q;
    if (Math.abs(pos.qty) < EPS) { pos.qty = 0; pos.avgCost = 0; }
    // Часткове закриття: середня собівартість решти не змінюється.
  }
  return realized;
}

/** Розкладає операцію на трейди по валютах (UAH — числовник, не позиція). */
function opTrades(op: WacOperation): { cur: string; q: number; price: number }[] {
  const amount = Number(op.amount);
  const totalUah = Number(op.totalUah);
  const cur = op.currency;
  const payCur = op.payCurrency && op.payCurrency !== 'UAH' ? op.payCurrency : null;
  const payAmount = op.payAmount != null ? Number(op.payAmount) : 0;

  // Крос: віддали cur (amount), придбали payCur (payAmount); обидва плеча = totalUah грн.
  if (payCur && cur !== 'UAH') {
    const t: { cur: string; q: number; price: number }[] = [];
    if (amount > 0) t.push({ cur, q: -amount, price: totalUah / amount });
    if (payAmount > 0) t.push({ cur: payCur, q: +payAmount, price: totalUah / payAmount });
    return t;
  }
  // Старий формат BUY: клієнт дав payCur, отримав UAH → каса придбала payCur.
  if (payCur && cur === 'UAH') {
    return payAmount > 0 ? [{ cur: payCur, q: +payAmount, price: totalUah / payAmount }] : [];
  }
  // Пара з гривнею.
  if (cur === 'UAH' || !(amount > 0)) return [];
  const price = totalUah / amount;
  return op.type === 'BUY'
    ? [{ cur, q: +amount, price }]   // каса купує валюту → нарощує позицію
    : [{ cur, q: -amount, price }];  // SELL/EXCHANGE: каса віддає валюту → реалізує
}

export interface WacResult {
  totalRealized: number;
  byCurrency: Record<string, number>;
  perOp: number[];        // реалізований прибуток кожної операції (за порядком)
  ending: PositionMap;    // позиція після всіх операцій
}

/**
 * Реалізований прибуток за списком операцій (у ХРОНОЛОГІЧНОМУ порядку), від
 * заданої відкриваючої позиції. Скасовані (сторно) пропускаються.
 */
export function wacRealized(opening: PositionMap, ops: WacOperation[]): WacResult {
  const pos: PositionMap = {};
  for (const [c, p] of Object.entries(opening)) pos[c] = { qty: p.qty, avgCost: p.avgCost };

  const byCurrency: Record<string, number> = {};
  const perOp: number[] = [];
  let total = 0;

  for (const op of ops) {
    if (op.cancelled) { perOp.push(0); continue; }
    let opRealized = 0;
    for (const t of opTrades(op)) {
      const p = (pos[t.cur] ??= { qty: 0, avgCost: 0 });
      const r = applyTrade(p, t.q, t.price);
      opRealized += r;
      byCurrency[t.cur] = (byCurrency[t.cur] ?? 0) + r;
    }
    perOp.push(opRealized);
    total += opRealized;
  }

  return { totalRealized: total, byCurrency, perOp, ending: pos };
}
