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

  // Реалістично великі старти, щоб десятки випадкових операцій не заганяли
  // жодну валюту в мінус (операції обміну достатність не перевіряють — касир
  // бачить баланс на екрані; передачі/інкасації/USDT перевіряють на сервері).
  const start1 = { UAH: 800_000, USD: 15_000, EUR: 12_000, PLN: 15_000 };
  const start2 = { UAH: 600_000, USD: 12_000, EUR: 10_000, PLN: 12_000 };
  const shift1 = await must('зміна на SIM-1', 'POST', '/shifts/open', { cashDeskId: d1.id, startBalance: start1 }, tok1);
  const shift2 = await must('зміна на SIM-2', 'POST', '/shifts/open', { cashDeskId: d2.id, startBalance: start2 }, tok2);
  Object.entries(start1).forEach(([c, v]) => add(desk1, c, v));
  Object.entries(start2).forEach(([c, v]) => add(desk2, c, v));
  check('повторне відкриття зміни блокується',
    (await api('POST', '/shifts/open', { cashDeskId: d1.id, startBalance: {} }, tok1)).status === 400);

  let opsCount = 0, opsCount2 = 0;

  // Хелпер: операція каси 1 + дзеркало
  const trade = async (dto) => {
    const r = await api('POST', '/operations', dto, tok1);
    if (r.status !== 201) throw new Error(`операція впала: ${JSON.stringify(r.data).slice(0, 140)}`);
    opsCount++;
    opEffect(desk1, dto);
    return r.data;
  };
  // Хелпер: операція каси 2 + дзеркало
  const trade2 = async (dto) => {
    const r = await api('POST', '/operations', dto, tok2);
    if (r.status !== 201) throw new Error(`операція каси 2 впала: ${JSON.stringify(r.data).slice(0, 140)}`);
    opsCount2++;
    opEffect(desk2, dto);
    return r.data;
  };

  log('\n═══ 3. Торговий день: обидві каси активно торгують ═══');
  const CURS = ['USD', 'EUR', 'PLN'];
  const randOp = (shiftId) => {
    const cur = pick(CURS);
    const mode = rnd() < 0.55 ? 'BUY' : 'SELL';
    const base = mode === 'BUY' ? RATES[cur].buy : RATES[cur].sell;
    const rate = rnd() < 0.2 ? Math.round((base + (rnd() - 0.5) * 0.2) * 100) / 100 : base;
    return { shiftId, currency: cur, amount: randInt(1, 20) * 50, rate, mode };
  };
  // Каси працюють «паралельно»: чергуємо операції між ними.
  for (let i = 0; i < 55; i++) {
    await trade(randOp(shift1.id));
    if (i % 2 === 0) await trade2(randOp(shift2.id)); // каса 2 — трохи рідше
  }
  ok(`каса 1: ${opsCount} операцій, каса 2: ${opsCount2} операцій`);

  log('\n═══ 4. Крос-обміни (обидві каси) ═══');
  const crossDto = (shiftId) => {
    const payCur = pick(CURS);
    const getCur = pick(CURS.filter((c) => c !== payCur));
    const payAmount = randInt(2, 10) * 50;
    const cross = RATES[payCur].buy / RATES[getCur].sell;
    return {
      shiftId, currency: getCur, amount: Math.round(payAmount * cross * 100) / 100,
      rate: Math.round(cross * 10000) / 10000, payCurrency: payCur, payAmount, mode: pick(['BUY', 'SELL']),
    };
  };
  for (let i = 0; i < 8; i++) await trade(crossDto(shift1.id));
  for (let i = 0; i < 6; i++) await trade2(crossDto(shift2.id));
  ok(`крос: каса 1 +8, каса 2 +6 (разом ${opsCount + opsCount2})`);

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
  // Каса 2 теж рухає готівку: підкріплення з банку + власна інкасація в банк.
  await move(tok2, desk2, shift2.id, d2.id, 'IN', 'UAH', 60_000, 'BANK');
  await move(tok2, desk2, shift2.id, d2.id, 'IN', 'USD', 2000, 'BANK');
  await move(tok2, desk2, shift2.id, d2.id, 'OUT', 'UAH', 10_000, 'BANK');
  check('інкасація понад залишок блокується',
    (await api('POST', '/cash-movements',
      { shiftId: shift2.id, direction: 'OUT', currency: 'PLN', amount: 999_999, counterparty: 'EXTERNAL' }, tok2)).status === 400);

  log('\n═══ 7. Передачі між касами (в обидва боки) ═══');
  const tr1 = await must('передача 1000 USD SIM-1→SIM-2', 'POST', '/transfers',
    { fromDeskId: d1.id, toDeskId: d2.id, currency: 'USD', amount: 1000 }, tok1);
  check('відправник НЕ може підтвердити свою передачу',
    (await api('PATCH', `/transfers/${tr1.id}/confirm`, {}, tok1)).status === 400);
  await must('отримувач підтверджує', 'PATCH', `/transfers/${tr1.id}/confirm`, {}, tok2, 200);
  add(desk1, 'USD', -1000); add(desk2, 'USD', 1000);

  // Зворотна передача: каса 2 → каса 1 (щоб рух був у обидва боки).
  const tr2 = await must('передача 300 EUR SIM-2→SIM-1', 'POST', '/transfers',
    { fromDeskId: d2.id, toDeskId: d1.id, currency: 'EUR', amount: 300 }, tok2);
  await must('каса 1 підтверджує вхідну', 'PATCH', `/transfers/${tr2.id}/confirm`, {}, tok1, 200);
  add(desk2, 'EUR', -300); add(desk1, 'EUR', 300);

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
  // USDT-операції на касі 2 (той самий глобальний банк).
  const usdt2 = async (side, usdtAmount, settleCurrency, settleAmount, pct = 0) => {
    const r = await must(`[каса 2] USDT ${side} ${usdtAmount} → ${settleAmount} ${settleCurrency}`,
      'POST', '/usdt', { shiftId: shift2.id, side, usdtAmount, settleCurrency, settleAmount, pct }, tok2);
    add(desk2, settleCurrency, side === 'SELL' ? settleAmount : -settleAmount);
    usdtBank += side === 'SELL' ? -usdtAmount : usdtAmount;
    return r;
  };
  const s1 = await usdt('SELL', 300, 'USD', 300);          // чесний 1:1 → маржа 0
  const s2 = await usdt('SELL', 500, 'USD', 505);          // +5 USD маржі
  const s3 = await usdt('SELL', 1000, 'UAH', 45_200);      // UAH-розрахунок
  const b1 = await usdt('BUY', 400, 'UAH', 17_600);        // купили дешевше бази → маржа+
  const c2s = await usdt2('SELL', 200, 'USD', 202);        // каса 2: +2 USD маржі
  usdtOps.push(c2s);
  check('USDT 1:1 → маржа 0', near(Number(s1.profitUah), 0));
  const mid = (RATES.USD.buy + RATES.USD.sell) / 2; // 44.7
  check('USDT ручна сума → маржа з факту (5 USD × mid)', near(Number(s2.profitUah), 5 * mid, 0.5));
  check('USDT UAH-розрахунок: маржа = 45200 − 1000×mid', near(Number(s3.profitUah), 45_200 - 1000 * mid, 0.5));
  check('USDT BUY: маржа = 400×mid − 17600', near(Number(b1.profitUah), 400 * mid - 17_600, 0.5));
  check('USDT в основній формі блокується',
    (await api('POST', '/operations', { shiftId: shift1.id, currency: 'USDT', amount: 10, rate: 44, mode: 'BUY' }, tok1)).status === 400);
  const usdtMargin = usdtOps.reduce((s, o) => s + Number(o.profitUah), 0);

  log('\n═══ 9. Звірка стану: бекенд ↔ леджер скрипта (обидві каси) ═══');
  // Незалежний перерахунок балансу каси з СИРИХ даних бекенда тим самим ledger-алгоритмом.
  const backendBalanceOf = (shiftData, deskId) => {
    const bal = { ...shiftData.startBalance };
    for (const op of shiftData.operations) {
      if (op.cancelled) continue;
      opEffect(bal, {
        mode: op.type, currency: op.currency, amount: Number(op.amount),
        rate: Number(op.rate), payCurrency: op.payCurrency,
        payAmount: op.payAmount != null ? Number(op.payAmount) : 0,
      });
    }
    for (const m of shiftData.cashMovements) add(bal, m.currency, (m.direction === 'IN' ? 1 : -1) * Number(m.amount));
    for (const u of shiftData.usdtOperations) add(bal, u.settleCurrency, (u.side === 'SELL' ? 1 : -1) * Number(u.settleAmount));
    for (const t of shiftData.confirmedTransfers ?? []) {
      if (t.toDeskId === deskId) { add(bal, t.currency, Number(t.amount)); if (t.counterCurrency) add(bal, t.counterCurrency, -Number(t.counterAmount)); }
      if (t.fromDeskId === deskId) { add(bal, t.currency, -Number(t.amount)); if (t.counterCurrency) add(bal, t.counterCurrency, Number(t.counterAmount)); }
    }
    return bal;
  };

  const my1 = (await api('GET', '/shifts/my', null, tok1)).data;
  const be1 = backendBalanceOf(my1, d1.id);
  for (const cur of new Set([...Object.keys(desk1), ...Object.keys(be1)])) {
    check(`SIM-1 баланс ${cur}: ${(desk1[cur] ?? 0).toFixed(2)}`, near(desk1[cur] ?? 0, be1[cur] ?? 0),
      `бекенд ${(be1[cur] ?? 0).toFixed(2)}`);
  }
  const my2 = (await api('GET', '/shifts/my', null, tok2)).data;
  const be2 = backendBalanceOf(my2, d2.id);
  for (const cur of new Set([...Object.keys(desk2), ...Object.keys(be2)])) {
    check(`SIM-2 баланс ${cur}: ${(desk2[cur] ?? 0).toFixed(2)}`, near(desk2[cur] ?? 0, be2[cur] ?? 0),
      `бекенд ${(be2[cur] ?? 0).toFixed(2)}`);
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
  // SIM-2: рівно за очікуваним → без нестачі (тепер із реальним торговим прибутком)
  const close2 = await must('закрити SIM-2', 'PATCH', `/shifts/${shift2.id}/close`, { endBalance: desk2 }, tok2, 200);
  check(`SIM-2: торговий прибуток ${Number(close2.profit).toFixed(2)} ₴`, Number.isFinite(Number(close2.profit)));
  check('SIM-2: факт = торговий (без нестачі)', near(Number(close2.factualProfit), Number(close2.profit), 0.02));

  // SIM-1: навмисна нестача 100 UAH
  const end1 = { ...desk1, UAH: (desk1.UAH ?? 0) - 100 };
  const close1 = await must('закрити SIM-1 (нестача 100 грн)', 'PATCH', `/shifts/${shift1.id}/close`, { endBalance: end1 }, tok1, 200);
  check(`SIM-1: торговий прибуток ${Number(close1.profit).toFixed(2)} ₴ (USDT-маржа ${usdtMargin.toFixed(2)} усередині)`,
    Number.isFinite(Number(close1.profit)));
  check('SIM-1: факт = торговий − 100 (нестача)', near(Number(close1.factualProfit), Number(close1.profit) - 100, 0.02));
  const stored = (await api('GET', `/shifts/${shift1.id}`, null, adminTok)).data;
  check('звіт закриття збережено в БД (factualProfit)', near(Number(stored.factualProfit), Number(close1.factualProfit), 0.01));

  log('\n═══ 11. Фінанси: єдина модель прибутку (обидві каси однієї точки) ═══');
  const fin = (await api('GET', '/finance/daily', null, adminTok)).data;
  const simPoint = fin.points.find((p) => p.pointName === point.name);
  check('точка SIM у фінансах', !!simPoint);
  if (simPoint) {
    // Фінанси пулять операції ОБОХ кас точки за день, тож матчать більше
    // позицій, ніж кожна зміна окремо → прибуток точки ≥ суми прибутків змін
    // (коли каси взаємно закривають позиції). Це коректно, не помилка.
    const bothShifts = Number(close1.profit) + Number(close2.profit);
    check(`фінанси точки (${simPoint.totalProfit.toFixed(2)}) ≥ Σ прибутків змін (${bothShifts.toFixed(2)})`,
      simPoint.totalProfit >= bothShifts - 0.1);
    log(`     ↳ пул точки додав ${(simPoint.totalProfit - bothShifts).toFixed(2)} ₴ (взаємне закриття позицій між касами)`);
    check('USDT-рядок у фінансах присутній', !!simPoint.byCurrency.USDT);
  }

  const totalOps = opsCount + opsCount2;
  const totalActions = totalOps + usdtOps.length + 6 + 4 + 1;
  log(`\n═══ ПІДСУМОК: два касири за зміну ═══`);
  log(`Каса 1: ${opsCount} операцій обміну (2 сторновані, 1 редагована) + 4 USDT`);
  log(`Каса 2: ${opsCount2} операцій обміну + 1 USDT`);
  log(`Рухів готівки: 6 (Банк/Інше) · Передач: 4 (в обидва боки, 1 своп, 1 відхилена)`);
  log(`Разом операцій обміну: ${totalOps} · дій за «день»: ~${totalActions}`);
  log(`Перевірок: ${passed + failed} · ✅ ${passed} · ❌ ${failed}`);
  if (failed > 0) process.exit(1);
};

run().catch((e) => { console.error('\n💥 Симуляція перервана:', e.message); process.exit(1); });
