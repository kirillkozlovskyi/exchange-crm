/**
 * Симуляція повноцінного робочого дня обмінника проти живого API.
 *
 * Створює окрему тестову точку «SIM» (дві каси, два касири), проганяє ~100
 * операцій різного характеру і на кожному етапі звіряє стан бекенда з власним
 * «дзеркальним» леджером скрипта:
 *   • купівлі/продажі USD/EUR/PLN (звичайні та за кастомним курсом)
 *   • крос-обміни (валюта↔валюта)
 *   • сторно (будь-яка операція у вікні) та адмінське редагування
 *   • підкріплення/інкасації: Банк (рухає банк компанії) та Інше
 *   • передачі між касами + двовалютний своп (підтвердження отримувачем)
 *   • USDT: продаж/купівля (1:1 та з маржею), джерело — глобальний банк
 *   • проміжна звірка, закриття обох змін (одна — з навмисною нестачею 100 грн)
 *   • негативні кейси: овердрафт, чужа передача, USDT в основній формі, сторно×2
 *
 * Запуск:  node scripts/simulate-day.mjs   (бекенд на localhost:4000)
 * Дані лишаються в БД (точка «SIM …» — легко впізнати).
 */

const BASE = process.env.API ?? 'http://localhost:4000/api';

// ── Утиліти ──────────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
const log = (msg) => console.log(msg);
const ok = (name) => { passed++; console.log(`  ✅ ${name}`); };
const bad = (name, extra = '') => { failed++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); };
const check = (name, cond, extra = '') => (cond ? ok(name) : bad(name, extra));
const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;

// Детермінований генератор (щоб прогін відтворювався)
let seed = 42;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const randInt = (min, max) => min + Math.floor(rnd() * (max - min + 1));

async function api(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}
const must = async (label, method, path, body, token, expectStatus = 201) => {
  const r = await api(method, path, body, token);
  if (r.status !== expectStatus && !(expectStatus === 200 && r.status === 201)) {
    bad(label, `HTTP ${r.status}: ${JSON.stringify(r.data).slice(0, 160)}`);
    throw new Error(`FATAL: ${label}`);
  }
  return r.data;
};

// ── Дзеркальний леджер скрипта ───────────────────────────────────────────────
const mkBal = () => ({});
const add = (bal, cur, amt) => { bal[cur] = (bal[cur] ?? 0) + amt; };
const desk1 = mkBal(), desk2 = mkBal(), bank = mkBal();
let usdtBank = 0;

// Курси тестової точки (задає адмін нижче)
const RATES = {
  USD: { buy: 44.5, sell: 44.9 },
  EUR: { buy: 51.0, sell: 51.6 },
  PLN: { buy: 11.8, sell: 12.1 },
};

// Ефект звичайної операції на леджер (дзеркало balance.util)
function opEffect(bal, { mode, currency, amount, rate, payCurrency, payAmount }, sign = 1) {
  if (payCurrency && payCurrency !== 'UAH' && currency !== 'UAH') {
    add(bal, payCurrency, sign * payAmount);
    add(bal, currency, -sign * amount);
  } else {
    const s = mode === 'BUY' ? 1 : -1;
    add(bal, currency, sign * s * amount);
    add(bal, 'UAH', -sign * s * amount * rate);
  }
}

// ── Основний сценарій ────────────────────────────────────────────────────────
const run = async () => {
  log('\n═══ 0. Підготовка: адмін, точка SIM, каси, касири, курси ═══');
  const adminTok = (await must('логін адміна', 'POST', '/auth/login',
    { login: 'admin', password: 'admin123' }, null, 201)).access_token;

  const stamp = Date.now().toString().slice(-5);
  const point = await must('створити точку SIM', 'POST', '/exchange-points',
    { name: `SIM Тестова ${stamp}`, code: `SIM${stamp}` }, adminTok);
  const d1 = await must('каса SIM-1', 'POST', '/cash-desks', { name: 'SIM Каса 1', exchangePointId: point.id }, adminTok);
  const d2 = await must('каса SIM-2', 'POST', '/cash-desks', { name: 'SIM Каса 2', exchangePointId: point.id }, adminTok);

  const u1 = { login: `sim1_${stamp}`, password: 'sim12345' };
  const u2 = { login: `sim2_${stamp}`, password: 'sim12345' };
  await must('касир 1', 'POST', '/users', { name: 'SIM Касир 1', ...u1, role: 'CASHIER', exchangePointId: point.id }, adminTok);
  await must('касир 2', 'POST', '/users', { name: 'SIM Касир 2', ...u2, role: 'CASHIER', exchangePointId: point.id }, adminTok);

  for (const [cur, r] of Object.entries(RATES)) {
    await must(`курс ${cur}`, 'POST', '/rates', { exchangePointId: point.id, currency: cur, ...r }, adminTok);
  }

  log('\n═══ 1. Банк: депозити (готівка + USDT) ═══');
  // Банк — спільний для всієї компанії: знімаємо початковий стан і далі
  // звіряємо ДЕЛЬТИ (початок + дзеркало скрипта == бекенд).
  const bank0 = (await api('GET', '/cash-bank', null, adminTok)).data;
  const bankStart = Object.fromEntries(bank0.currencies.map((c) => [c.currency, c.amount]));
  const usdtBankStart = bank0.usdt;
  await must('депозит 1 000 000 UAH', 'POST', '/cash-bank/deposit', { currency: 'UAH', amount: 1_000_000 }, adminTok, 201);
  add(bank, 'UAH', 1_000_000);
  await must('депозит 20 000 USD', 'POST', '/cash-bank/deposit', { currency: 'USD', amount: 20_000 }, adminTok, 201);
  add(bank, 'USD', 20_000);
  await must('депозит USDT +5000', 'POST', '/usdt/global/adjust', { delta: 5000 }, adminTok, 201);
  usdtBank += 5000;

  log('\n═══ 2. Відкриття змін ═══');
  const tok1 = (await must('логін касира 1', 'POST', '/auth/login', u1, null, 201)).access_token;
  const tok2 = (await must('логін касира 2', 'POST', '/auth/login', u2, null, 201)).access_token;

  const start1 = { UAH: 300_000, USD: 4000, EUR: 3000, PLN: 5000 };
  const start2 = { UAH: 150_000, USD: 2000, EUR: 1000, PLN: 0 };
  const shift1 = await must('зміна на SIM-1', 'POST', '/shifts/open', { cashDeskId: d1.id, startBalance: start1 }, tok1);
  const shift2 = await must('зміна на SIM-2', 'POST', '/shifts/open', { cashDeskId: d2.id, startBalance: start2 }, tok2);
  Object.entries(start1).forEach(([c, v]) => add(desk1, c, v));
  Object.entries(start2).forEach(([c, v]) => add(desk2, c, v));
  check('повторне відкриття зміни блокується',
    (await api('POST', '/shifts/open', { cashDeskId: d1.id, startBalance: {} }, tok1)).status === 400);

  let opsCount = 0;

  // Хелпер: операція каси 1 + дзеркало
  const trade = async (dto) => {
    const r = await api('POST', '/operations', dto, tok1);
    if (r.status !== 201) throw new Error(`операція впала: ${JSON.stringify(r.data).slice(0, 140)}`);
    opsCount++;
    opEffect(desk1, dto);
    return r.data;
  };

  log('\n═══ 3. Торговий день: ~70 звичайних операцій ═══');
  const CURS = ['USD', 'EUR', 'PLN'];
  for (let i = 0; i < 70; i++) {
    const cur = pick(CURS);
    const mode = rnd() < 0.55 ? 'BUY' : 'SELL';
    // Кастомний курс у ~20% випадків (± до 10 коп. від ринку)
    const base = mode === 'BUY' ? RATES[cur].buy : RATES[cur].sell;
    const rate = rnd() < 0.2 ? Math.round((base + (rnd() - 0.5) * 0.2) * 100) / 100 : base;
    const amount = randInt(1, 20) * 50; // 50..1000
    await trade({ shiftId: shift1.id, currency: cur, amount, rate, mode });
  }
  ok(`70 операцій BUY/SELL проведено (разом ${opsCount})`);

  log('\n═══ 4. Крос-обміни (8 шт) ═══');
  for (let i = 0; i < 8; i++) {
    const payCur = pick(CURS);
    let getCur = pick(CURS.filter((c) => c !== payCur));
    const payAmount = randInt(2, 10) * 50;
    // Сума «отримує» за крос-курсом buy(pay)/sell(get) (як рахує фронт)
    const cross = RATES[payCur].buy / RATES[getCur].sell;
    const amount = Math.round(payAmount * cross * 100) / 100;
    await trade({
      shiftId: shift1.id, currency: getCur, amount,
      rate: Math.round(cross * 10000) / 10000,
      payCurrency: payCur, payAmount, mode: pick(['BUY', 'SELL']),
    });
  }
  ok(`8 крос-обмінів проведено (разом ${opsCount})`);

  log('\n═══ 5. Сторно та редагування ═══');
  const opToStorno = await trade({ shiftId: shift1.id, currency: 'USD', amount: 300, rate: RATES.USD.buy, mode: 'BUY' });
  await must('сторно останньої', 'POST', `/operations/${opToStorno.id}/storno`, { note: 'sim: помилка' }, tok1, 201);
  opEffect(desk1, { mode: 'BUY', currency: 'USD', amount: 300, rate: RATES.USD.buy }, -1); // відкат
  const older = await trade({ shiftId: shift1.id, currency: 'EUR', amount: 200, rate: RATES.EUR.sell, mode: 'SELL' });
  await trade({ shiftId: shift1.id, currency: 'USD', amount: 100, rate: RATES.USD.buy, mode: 'BUY' }); // новіша зверху
  await must('сторно НЕ останньої (у вікні)', 'POST', `/operations/${older.id}/storno`, { note: 'sim: клієнт передумав' }, tok1, 201);
  opEffect(desk1, { mode: 'SELL', currency: 'EUR', amount: 200, rate: RATES.EUR.sell }, -1);
  check('повторне сторно блокується',
    (await api('POST', `/operations/${older.id}/storno`, {}, tok1)).status === 400);
  check('редагування сторнованої блокується',
    (await api('PATCH', `/operations/${older.id}`, { amount: 1, rate: 1 }, adminTok)).status === 400);

  // Адмінське редагування звичайної операції: 100 USD → 150 USD
  const toEdit = await trade({ shiftId: shift1.id, currency: 'USD', amount: 100, rate: 44.6, mode: 'BUY' });
  await must('адмін редагує операцію', 'PATCH', `/operations/${toEdit.id}`, { amount: 150, rate: 44.6, note: 'sim edit' }, adminTok, 200);
  opEffect(desk1, { mode: 'BUY', currency: 'USD', amount: 100, rate: 44.6 }, -1);
  opEffect(desk1, { mode: 'BUY', currency: 'USD', amount: 150, rate: 44.6 });
  check('касир НЕ може редагувати',
    (await api('PATCH', `/operations/${toEdit.id}`, { amount: 1, rate: 1 }, tok1)).status === 403);

  log('\n═══ 6. Рух готівки: Банк та Інше ═══');
  const move = async (tokN, deskBal, shiftId, deskId, direction, currency, amount, counterparty) => {
    await must(`${direction === 'IN' ? 'підкріплення' : 'інкасація'} ${amount} ${currency} (${counterparty})`,
      'POST', '/cash-movements',
      { shiftId, direction, currency, amount, source: counterparty === 'BANK' ? 'Банк' : 'Інше', counterparty }, tokN, 201);
    add(deskBal, currency, direction === 'IN' ? amount : -amount);
    if (counterparty === 'BANK') add(bank, currency, direction === 'IN' ? -amount : amount);
  };
  await move(tok1, desk1, shift1.id, d1.id, 'IN', 'UAH', 100_000, 'BANK');
  await move(tok1, desk1, shift1.id, d1.id, 'IN', 'USD', 3000, 'BANK');
  await move(tok1, desk1, shift1.id, d1.id, 'OUT', 'UAH', 50_000, 'BANK');
  await move(tok1, desk1, shift1.id, d1.id, 'OUT', 'UAH', 20_000, 'EXTERNAL'); // «в карман»
  await move(tok2, desk2, shift2.id, d2.id, 'IN', 'UAH', 30_000, 'BANK');
  check('інкасація понад залишок блокується',
    (await api('POST', '/cash-movements',
      { shiftId: shift2.id, direction: 'OUT', currency: 'PLN', amount: 999, counterparty: 'EXTERNAL' }, tok2)).status === 400);

  log('\n═══ 7. Передачі між касами ═══');
  const tr1 = await must('передача 1000 USD SIM-1→SIM-2', 'POST', '/transfers',
    { fromDeskId: d1.id, toDeskId: d2.id, currency: 'USD', amount: 1000 }, tok1);
  check('відправник НЕ може підтвердити свою передачу',
    (await api('PATCH', `/transfers/${tr1.id}/confirm`, {}, tok1)).status === 400);
  await must('отримувач підтверджує', 'PATCH', `/transfers/${tr1.id}/confirm`, {}, tok2, 200);
  add(desk1, 'USD', -1000); add(desk2, 'USD', 1000);

  const swap = await must('своп 500 EUR ↔ 25 000 UAH', 'POST', '/transfers',
    { fromDeskId: d1.id, toDeskId: d2.id, currency: 'EUR', amount: 500, counterCurrency: 'UAH', counterAmount: 25_000 }, tok1);
  await must('своп підтверджено', 'PATCH', `/transfers/${swap.id}/confirm`, {}, tok2, 200);
  add(desk1, 'EUR', -500); add(desk1, 'UAH', 25_000);
  add(desk2, 'EUR', 500); add(desk2, 'UAH', -25_000);

  const rej = await must('передача для відхилення', 'POST', '/transfers',
    { fromDeskId: d1.id, toDeskId: d2.id, currency: 'PLN', amount: 200 }, tok1);
  await must('отримувач відхиляє', 'PATCH', `/transfers/${rej.id}/reject`, { rejectNote: 'sim: не потрібно' }, tok2, 200);
  check('овердрафт передачі блокується (з урахуванням резерву PENDING)',
    (await api('POST', '/transfers', { fromDeskId: d1.id, toDeskId: d2.id, currency: 'PLN', amount: 99_999 }, tok1)).status === 400);

  log('\n═══ 8. USDT (глобальний банк) ═══');
  const usdtOps = [];
  const usdt = async (side, usdtAmount, settleCurrency, settleAmount, pct = 0) => {
    const r = await must(`USDT ${side} ${usdtAmount} → ${settleAmount} ${settleCurrency}`,
      'POST', '/usdt', { shiftId: shift1.id, side, usdtAmount, settleCurrency, settleAmount, pct }, tok1);
    usdtOps.push(r);
    add(desk1, settleCurrency, side === 'SELL' ? settleAmount : -settleAmount);
    usdtBank += side === 'SELL' ? -usdtAmount : usdtAmount;
    return r;
  };
  const s1 = await usdt('SELL', 300, 'USD', 300);          // чесний 1:1 → маржа 0
  const s2 = await usdt('SELL', 500, 'USD', 505);          // +5 USD маржі
  const s3 = await usdt('SELL', 1000, 'UAH', 45_200);      // UAH-розрахунок
  const b1 = await usdt('BUY', 400, 'UAH', 17_600);        // купили дешевше бази → маржа+
  check('USDT 1:1 → маржа 0', near(Number(s1.profitUah), 0));
  const mid = (RATES.USD.buy + RATES.USD.sell) / 2; // 44.7
  check('USDT ручна сума → маржа з факту (5 USD × mid)', near(Number(s2.profitUah), 5 * mid, 0.5));
  check('USDT UAH-розрахунок: маржа = 45200 − 1000×mid', near(Number(s3.profitUah), 45_200 - 1000 * mid, 0.5));
  check('USDT BUY: маржа = 400×mid − 17600', near(Number(b1.profitUah), 400 * mid - 17_600, 0.5));
  check('USDT в основній формі блокується',
    (await api('POST', '/operations', { shiftId: shift1.id, currency: 'USDT', amount: 10, rate: 44, mode: 'BUY' }, tok1)).status === 400);
  const usdtMargin = usdtOps.reduce((s, o) => s + Number(o.profitUah), 0);

  log('\n═══ 9. Звірка стану: бекенд ↔ леджер скрипта ═══');
  // Каса 1: перерахунок із сирих даних бекенда тим самим ledger-алгоритмом
  const my1 = (await api('GET', '/shifts/my', null, tok1)).data;
  const backendBal = { ...my1.startBalance };
  for (const op of my1.operations) {
    if (op.cancelled) continue;
    opEffect(backendBal, {
      mode: op.type, currency: op.currency, amount: Number(op.amount),
      rate: Number(op.rate), payCurrency: op.payCurrency,
      payAmount: op.payAmount != null ? Number(op.payAmount) : 0,
    });
  }
  for (const m of my1.cashMovements) add(backendBal, m.currency, (m.direction === 'IN' ? 1 : -1) * Number(m.amount));
  for (const u of my1.usdtOperations) add(backendBal, u.settleCurrency, (u.side === 'SELL' ? 1 : -1) * Number(u.settleAmount));
  for (const t of my1.confirmedTransfers ?? []) {
    if (t.toDeskId === d1.id) { add(backendBal, t.currency, Number(t.amount)); if (t.counterCurrency) add(backendBal, t.counterCurrency, -Number(t.counterAmount)); }
    if (t.fromDeskId === d1.id) { add(backendBal, t.currency, -Number(t.amount)); if (t.counterCurrency) add(backendBal, t.counterCurrency, Number(t.counterAmount)); }
  }
  for (const cur of new Set([...Object.keys(desk1), ...Object.keys(backendBal)])) {
    check(`SIM-1 баланс ${cur}: ${(desk1[cur] ?? 0).toFixed(2)}`, near(desk1[cur] ?? 0, backendBal[cur] ?? 0),
      `бекенд дає ${(backendBal[cur] ?? 0).toFixed(2)}`);
  }

  // Банк готівки та USDT-банк: початковий стан + дельта скрипта == бекенд
  const bankApi = (await api('GET', '/cash-bank', null, adminTok)).data;
  for (const [cur, delta] of Object.entries(bank)) {
    const expected = (bankStart[cur] ?? 0) + delta;
    const got = bankApi.currencies.find((c) => c.currency === cur)?.amount ?? 0;
    check(`Банк ${cur}: ${(bankStart[cur] ?? 0).toFixed(0)} + Δ${delta.toFixed(0)} = ${expected.toFixed(2)}`,
      near(got, expected), `бекенд ${got}`);
  }
  check(`USDT-банк: ${usdtBankStart} + Δ${usdtBank} = ${usdtBankStart + usdtBank}`,
    near(bankApi.usdt, usdtBankStart + usdtBank), `бекенд ${bankApi.usdt}`);

  // Проміжна звірка касира (усе збігається)
  await must('проміжна звірка (збіглася)', 'POST', '/reconciliations',
    { shiftId: shift1.id, expected: desk1, actual: desk1 }, tok1);

  log('\n═══ 10. Закриття змін ═══');
  // SIM-2: рівно за очікуваним → без нестачі
  const close2 = await must('закрити SIM-2', 'PATCH', `/shifts/${shift2.id}/close`, { endBalance: desk2 }, tok2, 200);
  check('SIM-2: без операцій → торговий прибуток 0', near(Number(close2.profit), 0));
  check('SIM-2: факт = торговий (без нестачі)', near(Number(close2.factualProfit), Number(close2.profit), 0.02));

  // SIM-1: навмисна нестача 100 UAH
  const end1 = { ...desk1, UAH: (desk1.UAH ?? 0) - 100 };
  const close1 = await must('закрити SIM-1 (нестача 100 грн)', 'PATCH', `/shifts/${shift1.id}/close`, { endBalance: end1 }, tok1, 200);
  check(`SIM-1: торговий прибуток ${Number(close1.profit).toFixed(2)} ₴ (USDT-маржа ${usdtMargin.toFixed(2)} усередині)`,
    Number.isFinite(Number(close1.profit)));
  check('SIM-1: факт = торговий − 100 (нестача)', near(Number(close1.factualProfit), Number(close1.profit) - 100, 0.02));
  const stored = (await api('GET', `/shifts/${shift1.id}`, null, adminTok)).data;
  check('звіт закриття збережено в БД (factualProfit)', near(Number(stored.factualProfit), Number(close1.factualProfit), 0.01));

  log('\n═══ 11. Фінанси: єдина модель прибутку ═══');
  const fin = (await api('GET', '/finance/daily', null, adminTok)).data;
  const simPoint = fin.points.find((p) => p.pointName === point.name);
  check('точка SIM у фінансах', !!simPoint);
  if (simPoint) {
    check(`фінанси point.totalProfit == прибуток зміни (${Number(close1.profit).toFixed(2)})`,
      near(simPoint.totalProfit, Number(close1.profit), 0.05),
      `фінанси ${simPoint.totalProfit?.toFixed?.(2)}`);
    check('USDT-рядок у фінансах', !!simPoint.byCurrency.USDT && near(simPoint.byCurrency.USDT.profit, usdtMargin, 0.05));
  }

  // Разом операцій за день:
  const totalActions = opsCount + usdtOps.length + 5 /* рухи готівки */ + 3 /* передачі */ + 1 /* звірка */;
  log(`\n═══ ПІДСУМОК ═══`);
  log(`Операцій обміну: ${opsCount} (з них 2 сторновані, 1 редагована) · USDT: ${usdtOps.length} · рухів готівки: 5 · передач: 3 (1 відхилена)`);
  log(`Всього дій за «день»: ~${totalActions}`);
  log(`Перевірок: ${passed + failed} · ✅ ${passed} · ❌ ${failed}`);
  if (failed > 0) process.exit(1);
};

run().catch((e) => { console.error('\n💥 Симуляція перервана:', e.message); process.exit(1); });
