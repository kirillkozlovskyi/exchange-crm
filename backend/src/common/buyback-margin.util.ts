/**
 * «Маржа з відкупу» — модель прибутку замовника (додатковий показник поруч із
 * основним WAC-прибутком; фінанси на ній НЕ будуються).
 *
 * Ідея замовника («кільце»): продана валюта сама по собі заробітку не дає —
 * продаж лише «продає гривню» за курсом продажу. Заробіток виникає, коли на цю
 * гривню валюту ВІДКУПОВУЮТЬ: різниця між курсом, за яким гривню продали, і
 * курсом, за яким відкупили.
 *
 * Реалізація — дзеркало WAC: позиція ведеться по ГРИВНІ, отриманій з продажів.
 *   • продаж q од. по курсу r → у пул додається q од. гривні за курсом r;
 *   • купівля q од. по курсу b → закриває пул: маржа = min(q, пул) × (сер.курс пулу − b).
 * Купівля понад пул маржі не дає (нема що відкуповувати) — вона просто поповнює
 * запас. Гривня, вже витрачена на відкуп, із пулу ВИХОДИТЬ і більше не тягне
 * середній курс (інакше маржа кільця не дорівнювала б грошам цього кільця).
 *
 * Собівартість валюти тут ролі не грає — на відміну від WAC. Саме тому цей
 * показник не сходиться з реальним приростом грошей, коли змінюється запас
 * валюти; це усвідомлений вибір замовника.
 */

export interface SoldPool {
  units: number; // скільки одиниць валюти «продано» і ще не відкуплено
  uah: number;   // скільки гривні за них отримано
}
export type SoldPoolMap = Record<string, SoldPool>;

export interface MarginOperation {
  currency: string;
  amount: unknown;
  totalUah: unknown;
  payCurrency?: string | null;
  payAmount?: unknown;
  type?: string; // BUY | SELL | EXCHANGE
  cancelled?: boolean;
}

const EPS = 1e-9;

/** Середній курс, за яким гривня в пулі була продана (0 — пул порожній). */
export function poolRate(p: SoldPool): number {
  return p.units > EPS ? p.uah / p.units : 0;
}

/**
 * Один знаковий «трейд»: q>0 — каса придбала валюту (відкуп), q<0 — віддала
 * (продаж). Мутує пул, повертає реалізовану маржу.
 */
export function applyBuyback(pool: SoldPool, q: number, price: number): number {
  if (Math.abs(q) < EPS) return 0;

  // Продаж: гривня заходить у пул і чекає відкупу. Маржі поки немає.
  if (q < 0) {
    pool.units += -q;
    pool.uah += -q * price;
    return 0;
  }

  // Відкуп: закриваємо стільки, скільки є в пулі.
  const closed = Math.min(q, pool.units);
  if (closed < EPS) return 0; // нема що відкуповувати — просто запас

  const rate = poolRate(pool);
  const margin = closed * (rate - price);
  pool.units -= closed;
  pool.uah -= closed * rate; // виводимо гривню за середнім курсом → курс решти не змінюється
  if (pool.units < EPS) { pool.units = 0; pool.uah = 0; }
  return margin;
}

/** Розкладає операцію на трейди по валютах (UAH — числовник, не позиція). */
function opTrades(op: MarginOperation): { cur: string; q: number; price: number }[] {
  const amount = Number(op.amount);
  const totalUah = Number(op.totalUah);
  const cur = op.currency;
  const payCur = op.payCurrency && op.payCurrency !== 'UAH' ? op.payCurrency : null;
  const payAmount = op.payAmount != null ? Number(op.payAmount) : 0;

  // Крос: віддали cur, придбали payCur; обидва плеча оцінені в totalUah грн.
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
  if (cur === 'UAH' || !(amount > 0)) return [];
  const price = totalUah / amount;
  return op.type === 'BUY'
    ? [{ cur, q: +amount, price }]
    : [{ cur, q: -amount, price }];
}

export interface MarginResult {
  totalMargin: number;
  byCurrency: Record<string, number>;
  perOp: number[];
  ending: SoldPoolMap; // пул, що переноситься на наступну зміну каси
}

/**
 * Маржа з відкупу за списком операцій (у ХРОНОЛОГІЧНОМУ порядку), від заданого
 * відкриваючого пулу. Скасовані (сторно) пропускаються.
 */
export function buybackMargin(opening: SoldPoolMap, ops: MarginOperation[]): MarginResult {
  const pool: SoldPoolMap = {};
  for (const [c, p] of Object.entries(opening)) pool[c] = { units: p.units, uah: p.uah };

  const byCurrency: Record<string, number> = {};
  const perOp: number[] = [];
  let total = 0;

  for (const op of ops) {
    if (op.cancelled) { perOp.push(0); continue; }
    let opMargin = 0;
    for (const t of opTrades(op)) {
      const p = (pool[t.cur] ??= { units: 0, uah: 0 });
      const m = applyBuyback(p, t.q, t.price);
      opMargin += m;
      byCurrency[t.cur] = (byCurrency[t.cur] ?? 0) + m;
    }
    perOp.push(opMargin);
    total += opMargin;
  }

  return { totalMargin: total, byCurrency, perOp, ending: pool };
}
