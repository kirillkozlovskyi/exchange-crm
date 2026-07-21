/**
 * Реалізований прибуток за моделлю «каса в доларах» (USD — числовник),
 * ковзна середня собівартість (WAC) з ПЕРЕХІДНОЮ позицією між змінами.
 *
 * Ідея (модель власника, 2026-07-17): долар — одиниця виміру, «просто кількість»,
 * без позиції і собівартості. Все інше — товар із $-собівартістю:
 *   • ГРИВНЯ — позиція: сер. курс (₴/$) = середньозважений курс фактичних
 *     продажів USD. Продаж USD прибутку НЕ дає (гривня заходить за курсом цієї
 *     операції), прибуток реалізується при ВІДКУПІ дешевше:
 *     profit = totalUah × (1/rate − 1/basis).
 *   • Інші валюти (EUR, PLN, USDW/USDG…) — крос-собівартість у $ за одиницю
 *     (напр. EUR 1.1420 = 51.30/44.90). Купівля за гривню: гривня виходить за
 *     базою (без прибутку), валюта заходить за rate×(собівартість гривні).
 *     Продаж за гривню: валюта реалізує проти кросу за ціною rate/S, гривня
 *     заходить за 1/S, де S — курс продажу USD точки на МОМЕНТ операції.
 *
 * Всі avgCost у позиціях — USD за одиницю (для UAH це USD за гривню, ≈0.022).
 * Людський формат сер. курсу гривні (₴/$, напр. 44.95) живе лише на межі
 * збереження/API — див. uahBasisToCost / costToUahBasis.
 *
 * Непродана позиція НЕ переоцінюється (жодного фантомного прибутку від
 * коливань курсів); позиція переноситься між змінами.
 */

export interface WacPosition {
  qty: number;      // знакова позиція: >0 довга (є валюта), <0 коротка (віддали більше)
  avgCost: number;  // середня вартість відкритої позиції, USD за одиницю
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

/** Числовник моделі: єдина валюта без позиції і собівартості. */
export const NUMERAIRE = 'USD';

/** Сер. курс гривні: людський формат (₴ за $) → внутрішній ($ за ₴). */
export const uahBasisToCost = (uahPerUsd: number): number =>
  uahPerUsd > 0 ? 1 / uahPerUsd : 0;
/** Внутрішній ($ за ₴) → людський формат (₴ за $). */
export const costToUahBasis = (usdPerUah: number): number =>
  usdPerUah > 0 ? 1 / usdPerUah : 0;

const EPS = 1e-9;
const sign = (n: number) => (n > 0 ? 1 : n < 0 ? -1 : 0);

/**
 * Застосовує один знаковий «трейд» (q>0 — придбали, q<0 — віддали) за ціною
 * price ($/од.) до позиції. Мутує pos, повертає реалізований прибуток у $.
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
    ? closeQty * (price - pos.avgCost) // довга: віддали дорожче собівартості = прибуток
    : closeQty * (pos.avgCost - price); // коротка: викуп нижче сер.ціни = прибуток

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

/**
 * Неторговий рух валюти: підкріплення/інкасація каси, передачі між касами,
 * готівкові розрахунки USDT-вікна. Це НЕ купівля-продаж — прибутку не дає,
 * але змінює позицію:
 *   • вхід (q>0): валюта заходить у запас за ціною `price` ($/од.);
 *   • вихід (q<0): просто зменшує запас; собівартість решти не змінюється.
 *
 * Без цього кроку продана «підкріплена» валюта відкривала КОРОТКУ позицію:
 * прибуток від її продажу був 0, а собівартість підмінялась ціною продажу.
 */
export function applyFlow(pos: WacPosition, q: number, price: number): void {
  if (Math.abs(q) < EPS) return;

  if (q > 0) {
    // Вхід: нарощуємо запас за ціною price (як купівля, але без прибутку).
    if (pos.qty >= 0) {
      const nq = pos.qty + q;
      pos.avgCost = nq > EPS ? (pos.avgCost * pos.qty + price * q) / nq : 0;
      pos.qty = nq;
    } else {
      // Позиція коротка (віддали більше, ніж мали) — вхід її закриває без
      // прибутку: короткий борг гаситься фізичною валютою.
      pos.qty += q;
      if (pos.qty > EPS) pos.avgCost = price; // перевернулись у довгу за ціною входу
      else if (Math.abs(pos.qty) < EPS) { pos.qty = 0; pos.avgCost = 0; }
    }
    return;
  }

  // Вихід: зменшуємо запас за собівартістю (прибутку немає, середня не змінюється).
  pos.qty += q;
  if (Math.abs(pos.qty) < EPS) { pos.qty = 0; pos.avgCost = 0; }
}

/** Одне «плече» операції: trade реалізує прибуток, flow — ні (вихід гривні за базою). */
interface OpLeg {
  cur: string;
  q: number;
  price: number;        // $/од.; для flow-виходу ігнорується
  mode: 'trade' | 'flow';
  attr: string;         // валюта, якій приписується прибуток плеча (для byCurrency)
}

/**
 * Розкладає операцію на плечі в $-числовнику.
 * @param sUsd    курс продажу USD точки на момент операції (₴ за $)
 * @param uahCost поточна собівартість гривні в позиції ($ за ₴)
 */
function opLegs(op: WacOperation, sUsd: number, uahCost: number): OpLeg[] {
  const amount = Number(op.amount);
  const totalUah = Number(op.totalUah);
  const cur = op.currency;
  const payCur = op.payCurrency && op.payCurrency !== 'UAH' ? op.payCurrency : null;
  const payAmount = op.payAmount != null ? Number(op.payAmount) : 0;

  // Остання лінія захисту: без S працюємо від бази гривні, і навпаки.
  const S = sUsd > EPS ? sUsd : uahCost > EPS ? 1 / uahCost : 0;    // ₴ за $
  const B = uahCost > EPS ? uahCost : S > EPS ? 1 / S : 0;          // $ за ₴

  // Крос: віддали cur (amount), придбали payCur (payAmount).
  if (payCur && cur !== 'UAH') {
    if (!(amount > 0) || !(payAmount > 0)) return [];
    if (cur === NUMERAIRE) {
      // Віддали долари → payCur заходить за прямим курсом, без прибутку.
      return [{ cur: payCur, q: +payAmount, price: amount / payAmount, mode: 'trade', attr: payCur }];
    }
    if (payCur === NUMERAIRE) {
      // Отримали долари → cur реалізує проти кросу за прямим курсом.
      return [{ cur, q: -amount, price: payAmount / amount, mode: 'trade', attr: cur }];
    }
    if (!(S > EPS)) return [];
    // Обидва плеча ≠ USD: вартість обох = totalUah / S.
    return [
      { cur, q: -amount, price: totalUah / S / amount, mode: 'trade', attr: cur },
      { cur: payCur, q: +payAmount, price: totalUah / S / payAmount, mode: 'trade', attr: payCur },
    ];
  }

  // Старий формат BUY: каса віддала totalUah грн, придбала payCur.
  if (payCur && cur === 'UAH') {
    if (!(payAmount > 0) || !(totalUah > 0)) return [];
    if (payCur === NUMERAIRE) {
      // Відкуп долара: гривня виходить трейдом → реалізація проти бази.
      return [{ cur: 'UAH', q: -totalUah, price: payAmount / totalUah, mode: 'trade', attr: payCur }];
    }
    // Купівля валюти за гривню: гривня за базою (без прибутку), валюта успадковує вартість.
    return [
      { cur: 'UAH', q: -totalUah, price: 0, mode: 'flow', attr: payCur },
      { cur: payCur, q: +payAmount, price: (totalUah * B) / payAmount, mode: 'trade', attr: payCur },
    ];
  }

  // Пара з гривнею.
  if (cur === 'UAH' || !(amount > 0) || !(totalUah > 0)) return [];
  if (cur === NUMERAIRE) {
    // USD ↔ UAH: позицію веде гривня, ціна пряма ($ за ₴ = 1/rate).
    const price = amount / totalUah;
    return op.type === 'BUY'
      ? [{ cur: 'UAH', q: -totalUah, price, mode: 'trade', attr: NUMERAIRE }]  // відкуп: реалізація
      : [{ cur: 'UAH', q: +totalUah, price, mode: 'trade', attr: NUMERAIRE }]; // продаж: 0, оновлює базу
  }
  if (op.type === 'BUY') {
    // Купівля валюти за гривню: гривня за базою, валюта = rate × B (напр. 11.80/44.90).
    return [
      { cur: 'UAH', q: -totalUah, price: 0, mode: 'flow', attr: cur },
      { cur, q: +amount, price: (totalUah * B) / amount, mode: 'trade', attr: cur },
    ];
  }
  // SELL/EXCHANGE: валюта реалізує проти кросу (rate/S), гривня заходить за 1/S.
  if (!(S > EPS)) return [];
  return [
    { cur, q: -amount, price: totalUah / S / amount, mode: 'trade', attr: cur },
    { cur: 'UAH', q: +totalUah, price: 1 / S, mode: 'trade', attr: cur },
  ];
}

/** Елемент хронології зміни: торгова операція (з курсом продажу USD на її момент)
 *  або неторговий рух валюти (price — $/од., для UAH = 1/S). */
export type WacItem =
  | { kind: 'op'; op: WacOperation; sUsd: number }
  | { kind: 'flow'; currency: string; qty: number; price: number };

export interface WacResult {
  totalRealized: number;                 // $
  byCurrency: Record<string, number>;    // $ за валютою-джерелом прибутку
  perOp: number[];                       // реалізований прибуток кожної операції, $ (за порядком)
  ending: PositionMap;                   // позиція після всіх операцій (включно з UAH)
}

/**
 * Реалізований прибуток за ХРОНОЛОГІЄЮ зміни: торгові операції + неторгові рухи
 * валюти (підкріплення/інкасації/передачі/USDT-готівка). perOp повертається
 * лише для операцій — у тому ж порядку, в якому вони йшли у списку.
 */
export function wacRealizedTimeline(opening: PositionMap, items: WacItem[]): WacResult {
  const pos: PositionMap = {};
  for (const [c, p] of Object.entries(opening)) pos[c] = { qty: p.qty, avgCost: p.avgCost };

  const byCurrency: Record<string, number> = {};
  const perOp: number[] = [];
  let total = 0;

  for (const item of items) {
    if (item.kind === 'flow') {
      if (!item.currency || item.currency === NUMERAIRE || item.currency === 'USDT') continue;
      const p = (pos[item.currency] ??= { qty: 0, avgCost: item.price });
      applyFlow(p, item.qty, item.price);
      continue;
    }

    const op = item.op;
    if (op.cancelled) { perOp.push(0); continue; }
    const uahCost = pos['UAH']?.avgCost ?? 0;
    let opRealized = 0;
    for (const leg of opLegs(op, item.sUsd, uahCost)) {
      if (leg.cur === NUMERAIRE || leg.cur === 'USDT') continue; // числовник позиції не має
      const p = (pos[leg.cur] ??= { qty: 0, avgCost: 0 });
      if (leg.mode === 'flow') { applyFlow(p, leg.q, leg.price); continue; }
      const r = applyTrade(p, leg.q, leg.price);
      opRealized += r;
      byCurrency[leg.attr] = (byCurrency[leg.attr] ?? 0) + r;
    }
    perOp.push(opRealized);
    total += opRealized;
  }

  return { totalRealized: total, byCurrency, perOp, ending: pos };
}

/**
 * Реалізований прибуток за списком операцій (у ХРОНОЛОГІЧНОМУ порядку) від
 * заданої відкриваючої позиції, з ОДНИМ курсом продажу USD на всі операції
 * (зручно для тестів і простих сценаріїв). Скасовані (сторно) пропускаються.
 */
export function wacRealized(opening: PositionMap, ops: WacOperation[], sUsd: number): WacResult {
  return wacRealizedTimeline(opening, ops.map((op) => ({ kind: 'op' as const, op, sUsd })));
}

/**
 * «Каса в доларах» — підсумок каси за принципом власника:
 *   долари всіх видів (USD, USDT, USDW «білий», USDG «ветошь») — «готова
 *   валюта», по факту 1:1 без собівартості; UAH — ÷ сер. курс (₴/$);
 *   інші валюти — × їх $-крос (курс задає власник на відкритті зміни).
 * basis — у ЛЮДСЬКОМУ форматі (UAH: ₴ за $, напр. 44.95; інші: $ за одиницю).
 * Валюта без бази оцінюється в 0 (краще чесний нуль, ніж вигадана вартість).
 */
export function tillUsdValue(
  balance: Record<string, unknown>,
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
