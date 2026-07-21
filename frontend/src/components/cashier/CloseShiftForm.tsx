import { useState, useMemo, useEffect, useRef } from 'react';
import { format } from 'date-fns';
import { computeCurrentBalance } from '../../lib/balance';
import { sellRates, valueOf, activeUsdSell, tillUsd } from '../../lib/profit';
import { netTransfers, type TransferRow } from '../../lib/transfers';
import { cashMovementsDelta, type CashMovementRow } from '../../lib/cash-movements';
import { usdtCashDelta, usdtProfit, usdtProfitUsd, type UsdtOpRow } from '../../lib/usdt';
import { shiftCashBalance } from '../../lib/shift-balance';
import { fmtMoney, fmtNum, fmtRate } from '../../lib/format';

type Operation = {
  id: number;
  type: 'BUY' | 'SELL';
  currency: string;
  amount: string | number;
  rate: string | number;
  totalUah: string | number;
  payCurrency?: string | null;
  payAmount?: string | number | null;
  cancelled?: boolean;
  profit?: string | number | null;     // ₴-знімок (за курсом моменту операції)
  profitUsd?: string | number | null;  // нативний $ ($-числовник)
  createdAt: string;
};

type Shift = {
  id: number;
  number: string;
  openedAt: string;
  startBalance: Record<string, number>;
  operations: Operation[];
};

type Rate = { currency: string; buy: number | string; sell: number | string };

// Рух готівки з повними полями для відображення (math використовує лише
// direction/currency/amount із CashMovementRow).
type MovementRow = CashMovementRow & {
  id?: number;
  number?: string;
  source?: string | null;
  note?: string | null;
  createdAt?: string;
};

// Передача з полями для показу в блоці «Рух готівки» (math у netTransfers
// використовує лише currency/amount/fromDeskId/toDeskId/counter*).
type DeskRef = { name?: string | null; exchangePoint?: { name?: string | null } | null };
type TransferDisplayRow = TransferRow & {
  id?: number;
  number?: string;
  confirmedAt?: string | null;
  fromDesk?: DeskRef | null;
  toDesk?: DeskRef | null;
};

export default function CloseShiftForm({
  shift,
  rates = [],
  deskId,
  transfers = [],
  cashMovements = [],
  usdtOperations = [],
  showProfit = true,
  onClose,
  onCancel,
  onRecalcBasis,
}: {
  shift: Shift;
  rates?: Rate[];
  deskId?: number;
  transfers?: TransferDisplayRow[];
  cashMovements?: MovementRow[];
  usdtOperations?: (UsdtOpRow & { id?: number; number?: string; usdtAmount?: number | string; createdAt?: string })[];
  // Адмінське налаштування «Касир бачить прибуток каси»: ховає блок прибутку
  // на екрані закриття та в друкованому звіті.
  showProfit?: boolean;
  onClose: (endBalance: Record<string, number>) => Promise<void>;
  onCancel: () => void;
  // Застосувати відредагований сер. курс (собівартість) і перерахувати прибуток
  // зміни на сервері. Без цього колбека поле сер. курсу лишається лише показом.
  onRecalcBasis?: (basis: Record<string, number>) => Promise<void>;
}) {
  const startBal = (shift.startBalance as Record<string, number>) || {};
  // Поточна собівартість каси — курс, проти якого рахується прибуток (із сервера).
  const costBasisLive = ((shift as any).costBasisLive as Record<string, number>) || {};

  // Редагування сер. курсу (собівартості) прямо у формі. Поле дефолтиться поточним
  // costBasisLive; змінене значення застосовується кнопкою (перерахунок на сервері).
  const [basisEdit, setBasisEdit] = useState<Record<string, string>>({});
  const [recalcing, setRecalcing] = useState(false);
  const basisValue = (cur: string) =>
    basisEdit[cur] ?? (costBasisLive[cur] != null ? String(costBasisLive[cur]) : '');
  const basisDirty = Object.keys(basisEdit).some((cur) => {
    const v = parseFloat(basisEdit[cur]);
    return v > 0 && Math.abs(v - (costBasisLive[cur] ?? 0)) >= 0.00005;
  });

  // Нетто-передачі каси за зміну (отримано − відправлено) по валютах.
  // Це рух готівки між касами, а не прибуток — вилучаємо з фактичного результату.
  const net = useMemo(
    () => (deskId != null ? netTransfers(transfers, deskId) : {}),
    [transfers, deskId],
  );

  // Рух готівки (підкріплення +, інкасація −) по валютах. Як і передачі, не входить
  // у прибуток, але змінює очікуваний фізичний залишок у касі.
  const moveNet = useMemo(() => cashMovementsDelta(cashMovements), [cashMovements]);

  // USDT: фізична готівка (settleCurrency) — торгова, входить у прибуток окремою маржею.
  const usdtNet = useMemo(() => usdtCashDelta(usdtOperations), [usdtOperations]);
  const usdtMargin = useMemo(() => usdtProfit(usdtOperations), [usdtOperations]);
  const usdtMarginUsd = useMemo(() => usdtProfitUsd(usdtOperations), [usdtOperations]);

  // ── Залишок до руху готівки (початок + операції) — база для прибутку ───────
  const opsBalance = useMemo(
    () => computeCurrentBalance({ UAH: 0, ...startBal }, shift.operations),
    [shift],
  );

  // ── Розрахунковий (очікуваний фізичний) залишок ───────────────────────────
  // Єдиний ledger-розрахунок: операції + USDT-готівка + рух готівки +
  // підтверджені передачі/свопи (Б1). Дзеркало backend shift-ledger.util.
  const calcBalance = useMemo(
    () =>
      shiftCashBalance(
        {
          startBalance: { UAH: 0, ...startBal },
          operations: shift.operations,
          cashMovements,
          usdtOperations,
        },
        net,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shift, cashMovements, usdtOperations, net],
  );

  // Очікувана торгова готівка (для нестачі/надлишку) = операції + USDT-готівка.
  const expectedTrading = useMemo(() => {
    const b: Record<string, number> = { ...opsBalance };
    for (const [cur, amt] of Object.entries(usdtNet)) b[cur] = (b[cur] ?? 0) + amt;
    return b;
  }, [opsBalance, usdtNet]);

  // Всі валюти: UAH + всі з балансу + всі з операцій + передач + руху готівки
  const currencies = useMemo(() => {
    const set = new Set<string>(['UAH']);
    for (const k of Object.keys(startBal)) set.add(k);
    for (const op of shift.operations) set.add(op.currency);
    for (const k of Object.keys(net)) set.add(k);
    for (const k of Object.keys(moveNet)) set.add(k);
    for (const k of Object.keys(usdtNet)) set.add(k);
    return Array.from(set);
  }, [shift, startBal, net, moveNet, usdtNet]);

  // Фактичний залишок (вводить касир) — prefill з calcBalance, без копійок/центів
  const [endBal, setEndBal] = useState<Record<string, string>>(
    Object.fromEntries(currencies.map((c) => [c, String(Math.round(calcBalance[c] ?? 0))]))
  );

  // Передачі підвантажуються асинхронно вже після першого рендера — і calcBalance
  // («Очікувано») перераховується, а endBal («Фактично») лишався б зафіксованим на
  // старті БЕЗ передач, даючи фантомну розбіжність. Тож доки касир не почав вводити
  // вручну, тримаємо «Фактично» рівним «Очікувано». Після першого ж редагування
  // (touched) авто-синхронізацію вимикаємо — введене касиром недоторкане.
  const touched = useRef(false);
  useEffect(() => {
    if (touched.current) return;
    setEndBal(Object.fromEntries(currencies.map((c) => [c, String(Math.round(calcBalance[c] ?? 0))])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calcBalance, currencies]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // ── Прибуток = реалізований за $-числовником (op.profitUsd — нативний $,
  // op.profit — ₴-знімок; рахує сервер). Нестача/надлишок — за курсом ПРОДАЖУ.
  const valuation = useMemo(() => sellRates(rates), [rates]);
  const usdSell = useMemo(() => activeUsdSell(rates as any), [rates]);
  // Торговий прибуток по валютах: відкуп реалізує проти сер. курсу гривні,
  // продаж валюти — проти її $-кросу. Розбивка — по валюті операції.
  const realized = useMemo(() => {
    const byCurrency: Record<string, number> = {};
    const byCurrencyUsd: Record<string, number> = {};
    let total = 0;
    let totalUsd = 0;
    for (const op of shift.operations) {
      if (op.cancelled) continue;
      const p = Number(op.profit ?? 0);
      const pu = Number(op.profitUsd ?? 0);
      byCurrency[op.currency] = (byCurrency[op.currency] ?? 0) + p;
      byCurrencyUsd[op.currency] = (byCurrencyUsd[op.currency] ?? 0) + pu;
      total += p;
      totalUsd += pu;
    }
    return { total, totalUsd, byCurrency, byCurrencyUsd };
  }, [shift]);
  const tradingProfit = realized.total + usdtMargin;
  const tradingProfitUsd = realized.totalUsd + usdtMarginUsd;
  const endBalParsed = useMemo(
    () => Object.fromEntries(Object.entries(endBal).map(([k, v]) => [k, parseFloat(v) || 0])),
    [endBal],
  );
  // Фактичний результат — за введеним залишком, з якого прибираємо нетто-передачі
  // та рух готівки (підкріплення/інкасації): жодне з них не є прибутком каси.
  const factualEnd = useMemo(() => {
    const eff: Record<string, number> = { ...endBalParsed };
    for (const [cur, amt] of Object.entries(net)) eff[cur] = (eff[cur] ?? 0) - amt;
    for (const [cur, d] of Object.entries(moveNet)) eff[cur] = (eff[cur] ?? 0) - d; // IN(+)→прибрати, OUT(−)→повернути
    return eff;
  }, [endBalParsed, net, moveNet]);
  // Фактичний = торговий прибуток + нестача/надлишок каси (за курсом продажу).
  const surplusShort = valueOf(factualEnd, valuation) - valueOf(expectedTrading, valuation);
  const factualProfit = tradingProfit + surplusShort;
  const factualProfitUsd = tradingProfitUsd + (usdSell > 0 ? surplusShort / usdSell : 0);

  // Чи були передачі/рух готівки взагалі (для умовного показу колонки/рядка)
  const hasTransfers = Object.values(net).some((v) => Math.abs(v) >= 0.005);
  const hasMovements = Object.values(moveNet).some((v) => Math.abs(v) >= 0.005);

  // Єдиний список руху готівки для блоку «Рух готівки»: підкріплення/інкасації
  // ТА передачі між касами (їх касир теж має бачити як рух — гроші фізично
  // прийшли/пішли, хоч у прибуток і не входять). Своп дає два рядки (обидва плеча).
  const movementRows = useMemo(() => {
    type Row = { key: string; time?: string; label: string; badge: string; source: string; amount: number; currency: string; incoming: boolean };
    const rows: Row[] = [];
    for (const m of cashMovements) {
      const isIn = m.direction === 'IN';
      rows.push({
        key: `m${m.id ?? rows.length}`,
        time: m.createdAt,
        label: isIn ? 'Підкріплення' : 'Інкасація',
        badge: isIn ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700',
        source: [m.source, m.note].filter(Boolean).join(' · ') || '—',
        amount: Number(m.amount), currency: m.currency, incoming: isIn,
      });
    }
    const desk = deskId ?? -1;
    for (const t of transfers) {
      const isOut = t.fromDeskId === desk;
      const isIn = t.toDeskId === desk;
      if (!isOut && !isIn) continue;
      const other = isOut ? t.toDesk : t.fromDesk;
      const party = other?.exchangePoint?.name ?? other?.name ?? 'інша каса';
      const time = t.confirmedAt ?? undefined;
      const num = t.number ? ` · ${t.number}` : '';
      // Основне плече: currency йде від fromDesk до toDesk.
      rows.push({
        key: `t${t.id ?? rows.length}-a`,
        time,
        label: t.counterCurrency ? 'Своп' : isIn ? 'Передача (отримано)' : 'Передача (відпр.)',
        badge: isIn ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700',
        source: (isIn ? `від «${party}»` : `до «${party}»`) + num,
        amount: Number(t.amount), currency: t.currency, incoming: isIn,
      });
      // Зустрічне плече свопу — протилежний напрям (fromDesk отримує counter).
      if (t.counterCurrency && t.counterAmount != null) {
        rows.push({
          key: `t${t.id ?? rows.length}-b`,
          time,
          label: 'Своп',
          badge: isIn ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700',
          source: (isIn ? `до «${party}»` : `від «${party}»`) + num,
          amount: Number(t.counterAmount), currency: t.counterCurrency, incoming: !isIn,
        });
      }
    }
    return rows.sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));
  }, [cashMovements, transfers, deskId]);

  // ── Звіт купівля/продаж по кожній валюті ──────────────────────────────────
  // Скільки каса КУПИЛА і ПРОДАЛА кожної валюти за зміну (кількість, грн,
  // середній курс). Крос: куплено payCurrency + продано currency (грн-вартість
  // обох ніг = totalUah). Сторновані не враховуються.
  const tradeStats = useMemo(() => {
    const stats: Record<string, { boughtQty: number; boughtUah: number; soldQty: number; soldUah: number }> = {};
    const ensure = (c: string) => (stats[c] ??= { boughtQty: 0, boughtUah: 0, soldQty: 0, soldUah: 0 });
    for (const op of shift.operations) {
      if (op.cancelled) continue;
      const amount = Number(op.amount);
      const totalUah = Number(op.totalUah);
      const payCur = op.payCurrency;
      const payAmount = op.payAmount != null ? Number(op.payAmount) : 0;
      if (payCur && payCur !== 'UAH' && op.currency !== 'UAH') {
        const b = ensure(payCur); b.boughtQty += payAmount; b.boughtUah += totalUah;
        const s = ensure(op.currency); s.soldQty += amount; s.soldUah += totalUah;
      } else if (payCur && payCur !== 'UAH') {
        const b = ensure(payCur); b.boughtQty += payAmount; b.boughtUah += totalUah;
      } else if (op.type === 'BUY') {
        const b = ensure(op.currency); b.boughtQty += amount; b.boughtUah += totalUah;
      } else {
        const s = ensure(op.currency); s.soldQty += amount; s.soldUah += totalUah;
      }
    }
    return Object.entries(stats)
      .map(([cur, s]) => ({
        cur,
        ...s,
        avgBuy: s.boughtQty > 0 ? s.boughtUah / s.boughtQty : 0,
        avgSell: s.soldQty > 0 ? s.soldUah / s.soldQty : 0,
      }))
      .sort((a, b) => a.cur.localeCompare(b.cur));
  }, [shift]);

  // Прибуток по кожній валюті ($-числовник): відкуп USD реалізує проти сер.
  // курсу гривні (рядок USD), продаж валюти — проти її $-кросу. Рядок UAH
  // показує сер. курс (базу гривні) — головне редаговане поле моделі.
  const profitRows = useMemo(() => {
    const rows = currencies
      .map((cur) => {
        const open = Number(startBal[cur] ?? 0);
        const close = calcBalance[cur] ?? 0;          // показуємо очікуваний (після руху готівки)
        const transfer = net[cur] ?? 0;
        const movement = moveNet[cur] ?? 0;           // рух готівки (підкр. +, інкас. −)
        const profitUah = realized.byCurrency[cur] ?? 0;
        const profitUsd = realized.byCurrencyUsd[cur] ?? 0;
        return { cur, open, close, transfer, movement, profitUah, profitUsd };
      })
      .filter((r) =>
        r.cur === 'UAH' || // сер. курс гривні показуємо завжди
        Math.abs(r.profitUah) >= 0.005 ||
        Math.abs(r.transfer) >= 0.005 ||
        Math.abs(r.movement) >= 0.005 ||
        Math.abs(r.close - r.open) >= 0.005,
      );
    // USDT-маржа — окремим рядком (гаманець не входить у фізичну касу).
    if (Math.abs(usdtMargin) >= 0.005) {
      rows.push({ cur: 'USDT', open: 0, close: 0, transfer: 0, movement: 0, profitUah: usdtMargin, profitUsd: usdtMarginUsd });
    }
    return rows;
  }, [currencies, startBal, calcBalance, net, moveNet, realized, usdtMargin, usdtMarginUsd]);

  // «Каса в доларах» — підсумок каси за принципом власника: за введеним
  // фактичним залишком і поточною собівартістю (з урахуванням локальних правок).
  const tillBasis = useMemo(() => {
    const b: Record<string, number> = {};
    for (const cur of currencies) {
      const v = parseFloat(basisEdit[cur] ?? (costBasisLive[cur] != null ? String(costBasisLive[cur]) : ''));
      if (v > 0) b[cur] = v;
    }
    return b;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currencies, basisEdit, costBasisLive]);
  const till = useMemo(() => tillUsd(endBalParsed, tillBasis), [endBalParsed, tillBasis]);

  // ── Друк звіту по зміні (А4) ─────────────────────────────────────────────
  const printReport = () => {
    // Гроші — через глобальний формат (копійки за опцією); курс/dd=4 — завжди точний.
    const n = (v: number, d?: number) => (d ? fmtRate(v, d) : fmtMoney(v));
    const dt = (s: string) => format(new Date(s), 'dd.MM.yyyy HH:mm');
    const tradeRows = tradeStats.map((r) => `
      <tr>
        <td class="b">${r.cur}</td>
        <td class="num">${r.boughtQty > 0 ? n(r.boughtQty) : '—'}</td>
        <td class="num">${r.boughtQty > 0 ? n(r.avgBuy, 4) : '—'}</td>
        <td class="num">${r.boughtQty > 0 ? n(r.boughtUah) : '—'}</td>
        <td class="num">${r.soldQty > 0 ? n(r.soldQty) : '—'}</td>
        <td class="num">${r.soldQty > 0 ? n(r.avgSell, 4) : '—'}</td>
        <td class="num">${r.soldQty > 0 ? n(r.soldUah) : '—'}</td>
      </tr>`).join('');
    const profitRowsHtml = profitRows.map((r) => `
      <tr>
        <td class="b">${r.cur}</td>
        <td class="num">${n(r.open)}</td>
        <td class="num">${Math.abs(r.transfer) >= 0.005 ? (r.transfer > 0 ? '+' : '') + n(r.transfer) : '—'}</td>
        <td class="num">${Math.abs(r.movement) >= 0.005 ? (r.movement > 0 ? '+' : '') + n(r.movement) : '—'}</td>
        <td class="num">${n(r.close)}</td>
        <td class="num">${Math.abs(r.profitUsd) >= 0.005 ? (r.profitUsd > 0 ? '+' : '') + n(r.profitUsd) : '—'}</td>
        <td class="num">${Math.abs(r.profitUah) >= 0.005 ? (r.profitUah > 0 ? '+' : '') + n(r.profitUah) : '—'}</td>
      </tr>`).join('');
    const tillRowsHtml = Object.entries(till.byCurrency)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cur, v]) => `
      <tr>
        <td class="b">${cur}</td>
        <td class="num">${n(endBalParsed[cur] ?? 0)}</td>
        <td class="num">${cur === 'UAH' ? '÷ ' + (tillBasis.UAH ?? '—') : cur.startsWith('USD') ? '1:1' : '× ' + n(tillBasis[cur] ?? 0, 4)}</td>
        <td class="num">${n(v)}</td>
      </tr>`).join('');
    const balanceRows = currencies.map((cur) => {
      const start = Math.round(Number(startBal[cur] ?? 0));
      const expected = Math.round(calcBalance[cur] ?? 0);
      const actual = Math.round(parseFloat(endBal[cur]) || 0);
      const diff = actual - expected;
      return `
      <tr>
        <td class="b">${cur}</td>
        <td class="num">${start}</td>
        <td class="num">${expected}</td>
        <td class="num">${actual}</td>
        <td class="num${diff !== 0 ? ' warn' : ''}">${diff !== 0 ? (diff > 0 ? '+' : '') + diff : '—'}</td>
      </tr>`;
    }).join('');

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Звіт по зміні ${shift.number}</title>
    <style>
      @page { size: A4; margin: 12mm; }
      * { box-sizing: border-box; }
      body { font: 12px/1.45 Arial, sans-serif; color: #111; margin: 0; }
      h1 { font-size: 17px; margin: 0 0 2px; }
      .meta { color: #555; font-size: 11.5px; margin-bottom: 10px; }
      h2 { font-size: 13px; margin: 14px 0 4px; padding-bottom: 3px; border-bottom: 1.5px solid #111; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 1px solid #bbb; padding: 3.5px 6px; font-size: 11.5px; }
      th { background: #f0f1f3; font-size: 10px; text-transform: uppercase; letter-spacing: .03em; text-align: right; }
      th:first-child { text-align: left; }
      td.num { text-align: right; font-variant-numeric: tabular-nums; }
      td.b { font-weight: 700; }
      td.warn { color: #b91c1c; font-weight: 700; }
      .section { page-break-inside: avoid; }
      .totals { margin-top: 12px; page-break-inside: avoid; }
      .totals div { display: flex; justify-content: space-between; padding: 3px 0; font-size: 12.5px; }
      .totals .line { border-top: 1.5px solid #111; margin-top: 4px; padding-top: 6px; font-weight: 700; font-size: 14px; }
      .sign { margin-top: 26px; display: flex; gap: 40px; page-break-inside: avoid; }
      .sign div { flex: 1; border-top: 1px solid #111; padding-top: 4px; font-size: 11px; color: #555; text-align: center; }
    </style></head><body>
      <h1>Звіт по зміні ${shift.number}</h1>
      <div class="meta">
        Відкрита: ${dt(shift.openedAt)} · Звіт сформовано: ${format(new Date(), 'dd.MM.yyyy HH:mm')}
        · Операцій: ${shift.operations.filter((o) => !o.cancelled).length}
      </div>

      <div class="section">
        <h2>Купівля / продаж по валютах</h2>
        <table>
          <thead><tr>
            <th>Валюта</th><th>Куплено</th><th>Сер. курс</th><th>Куплено, ₴</th>
            <th>Продано</th><th>Сер. курс</th><th>Продано, ₴</th>
          </tr></thead>
          <tbody>${tradeRows || '<tr><td colspan="7" style="text-align:center;color:#888">Операцій не було</td></tr>'}</tbody>
        </table>
      </div>

      ${showProfit ? `<div class="section">
        <h2>Прибуток за зміну (по валютах)</h2>
        <table>
          <thead><tr>
            <th>Валюта</th><th>Відкриття</th><th>Передачі</th><th>Підкр./Інкас.</th><th>Закриття</th><th>Прибуток, $</th><th>Прибуток, ₴</th>
          </tr></thead>
          <tbody>${profitRowsHtml || '<tr><td colspan="7" style="text-align:center;color:#888">—</td></tr>'}</tbody>
        </table>
      </div>` : ''}

      ${showProfit ? `<div class="section">
        <h2>Каса в доларах</h2>
        <table>
          <thead><tr>
            <th>Валюта</th><th>Залишок</th><th>Курс/крос</th><th>У доларах</th>
          </tr></thead>
          <tbody>${tillRowsHtml || '<tr><td colspan="4" style="text-align:center;color:#888">—</td></tr>'}
            <tr><td class="b" colspan="3">Разом у доларах</td><td class="num b">${n(till.total)}</td></tr>
          </tbody>
        </table>
      </div>` : ''}

      <div class="section">
        <h2>Залишки каси</h2>
        <table>
          <thead><tr>
            <th>Валюта</th><th>На початок</th><th>Очікувано</th><th>Фактично</th><th>Різниця</th>
          </tr></thead>
          <tbody>${balanceRows}</tbody>
        </table>
      </div>

      <div class="totals">
        ${showProfit ? `<div><span>Торговий прибуток</span><span>${tradingProfitUsd >= 0 ? '+' : ''}${n(tradingProfitUsd)} $ (${tradingProfit >= 0 ? '+' : ''}${n(tradingProfit)} ₴)</span></div>` : ''}
        ${showProfit && Math.abs(usdtMargin) >= 0.005 ? `<div><span>у т.ч. маржа USDT</span><span>${usdtMarginUsd >= 0 ? '+' : ''}${n(usdtMarginUsd)} $ (${usdtMargin >= 0 ? '+' : ''}${n(usdtMargin)} ₴)</span></div>` : ''}
        ${Math.abs(cashDiff) >= 0.01 ? `<div><span>Нестача/надлишок каси</span><span>${cashDiff >= 0 ? '+' : ''}${n(cashDiff)} ₴</span></div>` : ''}
        ${showProfit ? `<div class="line"><span>Фактичний результат</span><span>${factualProfitUsd >= 0 ? '+' : ''}${n(factualProfitUsd)} $ (${factualProfit >= 0 ? '+' : ''}${n(factualProfit)} ₴)</span></div>` : ''}
      </div>

      <div class="sign">
        <div>Касир (підпис, ПІБ)</div>
        <div>Перевірив (підпис, ПІБ)</div>
      </div>
    </body></html>`;

    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow?.document;
    if (!doc) { document.body.removeChild(iframe); return; }
    doc.open();
    doc.write(html);
    doc.close();
    const win = iframe.contentWindow!;
    win.focus();
    win.onafterprint = () => { try { document.body.removeChild(iframe); } catch { /* removed */ } };
    setTimeout(() => {
      win.print();
      setTimeout(() => { try { document.body.removeChild(iframe); } catch { /* noop */ } }, 60_000);
    }, 150);
  };

  const handleSubmit = async () => {
    setSaving(true);
    setError('');
    try {
      const balanceObj = Object.fromEntries(
        Object.entries(endBal).map(([k, v]) => [k, parseFloat(v) || 0])
      );
      await onClose(balanceObj);
    } catch (e: any) {
      setError(e.response?.data?.message ?? 'Помилка закриття зміни');
    } finally {
      setSaving(false);
    }
  };

  // Застосувати відредаговані сер. курси (гривня ₴/$ + $-кроси валют — курси
  // задає власник; долари USD* — завжди 1:1, поля не мають).
  // Після успіху скидаємо локальні правки — форма перемалюється з новими
  // costBasisLive та op.profit(Usd) (сервер перерахував).
  const applyBasis = async () => {
    if (!onRecalcBasis) return;
    const basis: Record<string, number> = {};
    for (const [cur, raw] of Object.entries(basisEdit)) {
      if (cur.startsWith('USD')) continue;
      const v = parseFloat(raw);
      if (v > 0) basis[cur] = v;
    }
    setRecalcing(true);
    try { await onRecalcBasis(basis); setBasisEdit({}); }
    finally { setRecalcing(false); }
  };

  const hasDiscrepancy = currencies.some((c) => {
    const actual = Math.round(parseFloat(endBal[c]) || 0);
    const expected = Math.round(calcBalance[c] ?? 0);
    return Math.abs(actual - expected) >= 1;
  });

  const cashDiff = surplusShort;
  // Формат $: два знаки, розділені розряди, зі знаком.
  const usd = (v: number) => `${v >= 0 ? '+' : ''}${fmtMoney(v)} $`;

  return (
    <div className="w-full space-y-2.5 pb-24">

      {/* ── Заголовок (липкий) ── */}
      <div className="sticky top-0 z-20 bg-white/95 backdrop-blur rounded-xl shadow p-3 flex items-center justify-between">
        <div>
          <h2 className="font-bold text-lg text-red-700">Закриття зміни</h2>
          <div className="text-sm text-gray-500 mt-0.5">
            Зміна #{shift.number} · відкрита {format(new Date(shift.openedAt), 'dd.MM.yyyy HH:mm')}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={printReport}
            className="text-sm font-medium border border-gray-300 rounded-lg px-3 py-1.5 text-gray-700 hover:bg-gray-50 flex items-center gap-1.5">
            🖨 Друк звіту
          </button>
          <button onClick={onCancel} className="text-sm text-gray-400 hover:text-gray-600">
            ← Скасувати
          </button>
        </div>
      </div>

      {/* ── Основна сітка: три рівні частини ── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-2.5 items-start">

        {/* ── Частина 1: Підрахунок залишку + Прибуток за зміну ── */}
        <div className="space-y-2.5">

          {/* Підрахунок залишку */}
          <div className="bg-white rounded-xl shadow p-4">
          <div className="flex items-baseline justify-between mb-1">
            <h3 className="font-semibold text-gray-800">Підрахунок залишку</h3>
            {hasDiscrepancy && (
              <span className="text-xs font-semibold text-red-600 bg-red-50 rounded-full px-2.5 py-0.5">
                є розбіжності
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400 mb-4">
            Введіть фактичний залишок у касі. Система порівняє з розрахунковим.
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-400 border-b">
                <th className="pb-2 text-left">Валюта</th>
                <th className="pb-2 text-right">На початок</th>
                <th className="pb-2 text-right">Очікувано</th>
                <th className="pb-2 text-right">Фактично</th>
                <th className="pb-2 text-right">Різниця</th>
              </tr>
            </thead>
            <tbody>
              {currencies.map((cur) => {
                // Залишок рахуємо без копійок/центів — округлюємо до цілих.
                const start = Math.round(Number(startBal[cur] ?? 0));
                const expected = Math.round(calcBalance[cur] ?? 0);
                const actual = Math.round(parseFloat(endBal[cur]) || 0);
                const diff = actual - expected;
                const hasDiff = Math.abs(diff) >= 1;
                return (
                  <tr key={cur} className={`border-b last:border-0 ${hasDiff ? 'bg-red-50' : ''}`}>
                    <td className="py-2.5 font-bold text-gray-800">{cur}</td>
                    <td className="py-2.5 text-right text-gray-500">{start}</td>
                    <td className="py-2.5 text-right font-medium text-blue-700">{expected}</td>
                    <td className="py-2.5 text-right">
                      <input
                        type="number"
                        step="1"
                        value={endBal[cur]}
                        onChange={(e) => { touched.current = true; setEndBal((b) => ({ ...b, [cur]: e.target.value })); }}
                        className={`w-32 border rounded-lg px-3 py-1.5 text-right font-medium focus:outline-none focus:ring-2 ${
                          hasDiff ? 'border-red-300 focus:ring-red-400 bg-red-50' : 'focus:ring-blue-400'
                        }`}
                      />
                    </td>
                    <td className={`py-2.5 text-right font-semibold ${
                      !hasDiff ? 'text-gray-300' : diff > 0 ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {hasDiff ? (diff > 0 ? '+' : '') + diff : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {hasDiscrepancy && (
            <div className="mt-4 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
              ⚠️ Виявлено розбіжності. Перевірте касу та виправте значення або підтвердіть з розбіжністю.
            </div>
          )}
        </div>

          {/* Прибуток за зміну — розбивка по валютах (якщо дозволено касиру) */}
          {showProfit && (
          <div className="bg-white rounded-xl shadow p-4">
            <h3 className="font-semibold text-gray-800 mb-1">Прибуток за зміну</h3>
            <p className="text-xs text-gray-400 mb-3">
              Каса міряється в доларах: продаж USD формує сер. курс гривні, прибуток
              реалізується на ВІДКУПІ (купівля USD дешевше за сер. курс) та при
              продажу валют проти їх $-собівартості (крос).
              {Math.abs(usdtMargin) >= 0.005 && ' USDT — чиста маржа %.'}
              {hasTransfers && ' Передачі між касами не входять у прибуток.'}
              {hasMovements && ' Підкріплення/інкасації не входять у прибуток.'}
            </p>

            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 border-b">
                  <th className="pb-2 text-left">Валюта</th>
                  <th className="pb-2 text-right">Відкриття</th>
                  {hasTransfers && <th className="pb-2 text-right">Передачі</th>}
                  {hasMovements && <th className="pb-2 text-right">Підкр./Інкас.</th>}
                  <th className="pb-2 text-right">Закриття</th>
                  <th className="pb-2 text-right" title="Собівартість: UAH — сер. курс проданого долара (₴/$); валюти — вартість у $ за 1 од.">Сер. курс</th>
                  <th className="pb-2 text-right">Прибуток</th>
                </tr>
              </thead>
              <tbody>
                {profitRows.map((r) => (
                  <tr key={r.cur} className="border-b last:border-0">
                    <td className="py-2 font-bold text-gray-800">{r.cur}</td>
                    <td className="py-2 text-right text-gray-500">{fmtMoney(r.open)}</td>
                    {hasTransfers && (
                      <td className={`py-2 text-right ${
                        Math.abs(r.transfer) < 0.005 ? 'text-gray-300' :
                        r.transfer > 0 ? 'text-blue-600' : 'text-orange-600'
                      }`}>
                        {Math.abs(r.transfer) < 0.005 ? '—' : (r.transfer > 0 ? '+' : '') + fmtNum(r.transfer)}
                      </td>
                    )}
                    {hasMovements && (
                      <td className={`py-2 text-right ${
                        Math.abs(r.movement) < 0.005 ? 'text-gray-300' :
                        r.movement > 0 ? 'text-green-600' : 'text-purple-600'
                      }`}>
                        {Math.abs(r.movement) < 0.005 ? '—' : (r.movement > 0 ? '+' : '−') + fmtNum(Math.abs(r.movement))}
                      </td>
                    )}
                    <td className="py-2 text-right font-medium text-gray-700">{fmtMoney(r.close)}</td>
                    <td className="py-2 text-right">
                      {!r.cur.startsWith('USD') && onRecalcBasis ? (
                        <input
                          type="number"
                          step={r.cur === 'UAH' ? '0.01' : '0.0001'}
                          value={basisValue(r.cur)}
                          onChange={(e) => setBasisEdit((b) => ({ ...b, [r.cur]: e.target.value }))}
                          className="w-24 border border-gray-200 rounded px-2 py-1 text-right text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-400"
                        />
                      ) : (
                        <span className="text-gray-500">
                          {r.cur.startsWith('USD')
                            ? '1:1'
                            : costBasisLive[r.cur]
                              ? Number(costBasisLive[r.cur]).toFixed(r.cur === 'UAH' ? 2 : 4)
                              : '—'}
                        </span>
                      )}
                    </td>
                    <td className={`py-2 text-right font-semibold ${
                      Math.abs(r.profitUsd) < 0.005 && Math.abs(r.profitUah) < 0.005 ? 'text-gray-300' :
                      r.profitUsd > 0 || (Math.abs(r.profitUsd) < 0.005 && r.profitUah > 0) ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {Math.abs(r.profitUsd) < 0.005 && Math.abs(r.profitUah) < 0.005 ? '—' : (
                        <>
                          {(r.profitUsd > 0 ? '+' : '') + fmtMoney(r.profitUsd)} $
                          <div className="text-xs font-normal text-gray-400">
                            {(r.profitUah > 0 ? '+' : '') + fmtNum(r.profitUah)} ₴
                          </div>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200">
                  <td colSpan={3 + (hasTransfers ? 1 : 0) + (hasMovements ? 1 : 0)} className="pt-2.5 font-semibold text-gray-700">
                    Торговий прибуток
                  </td>
                  <td className={`pt-2.5 text-right text-lg font-bold ${tradingProfitUsd >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {usd(tradingProfitUsd)}
                    <div className="text-xs font-medium text-gray-400">
                      {tradingProfit >= 0 ? '+' : ''}{fmtMoney(tradingProfit)} ₴
                    </div>
                  </td>
                </tr>
              </tfoot>
            </table>

            {onRecalcBasis && (
              <div className="mt-3 flex items-center gap-3">
                <button
                  onClick={applyBasis}
                  disabled={!basisDirty || recalcing}
                  className="text-sm px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-40 transition"
                >
                  {recalcing ? 'Перерахунок…' : 'Застосувати сер. курс і перерахувати'}
                </button>
                {basisDirty && !recalcing && (
                  <span className="text-xs text-amber-600">Сер. курс змінено — застосуйте, щоб оновити прибуток</span>
                )}
              </div>
            )}

            {/* Фактичний результат (за введеним залишком, передачі вилучено) */}
            <div className="flex items-center justify-between mt-4 pt-3 border-t">
              <div>
                <span className="font-semibold text-gray-700">Фактичний результат</span>
                <div className="text-xs text-gray-400">
                  за введеним залишком{(hasTransfers || hasMovements)
                    ? ` (без ${[hasTransfers && 'передач', hasMovements && 'руху готівки'].filter(Boolean).join(' та ')})`
                    : ''}
                </div>
              </div>
              <span className={`text-lg font-bold text-right ${factualProfitUsd >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {usd(factualProfitUsd)}
                <div className="text-xs font-medium text-gray-400">
                  {factualProfit >= 0 ? '+' : ''}{fmtMoney(factualProfit)} ₴
                </div>
              </span>
            </div>
            {Math.abs(cashDiff) >= 0.01 && (
              <div className="text-sm text-amber-600 bg-amber-50 rounded-lg px-3 py-1.5 mt-2">
                Розбіжність каси (нестача/надлишок): {cashDiff >= 0 ? '+' : ''}{fmtNum(cashDiff)} ₴
                {usdSell > 0 && ` (${fmtMoney(cashDiff / usdSell)} $)`}
              </div>
            )}
          </div>
          )}

          {/* «Каса в доларах» — підсумок каси за принципом власника */}
          {showProfit && (
          <div className="bg-white rounded-xl shadow p-4">
            <h3 className="font-semibold text-gray-800 mb-1">🧮 Каса в доларах</h3>
            <p className="text-xs text-gray-400 mb-3">
              Фактичний залишок у доларовому вимірі: USD і USDT — як є, гривня ÷ сер.
              курс, валюти × їх $-собівартість.
            </p>
            <table className="w-full text-sm">
              <tbody>
                {Object.entries(till.byCurrency)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([cur, v]) => (
                    <tr key={cur} className="border-b last:border-0">
                      <td className="py-1.5 font-bold text-gray-800">{cur}</td>
                      <td className="py-1.5 text-right text-gray-500">
                        {fmtNum(endBalParsed[cur] ?? 0)}
                        {cur !== 'USD' && cur !== 'USDT' && tillBasis[cur] > 0 && (
                          <span className="text-xs text-gray-400">
                            {' '}{cur === 'UAH' ? `÷ ${tillBasis.UAH}` : `× ${Number(tillBasis[cur]).toFixed(4)}`}
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 text-right font-medium text-gray-700">{fmtMoney(v)} $</td>
                    </tr>
                  ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200">
                  <td colSpan={2} className="pt-2.5 font-semibold text-gray-700">Разом у доларах</td>
                  <td className="pt-2.5 text-right text-lg font-bold text-blue-700">
                    {fmtMoney(till.total)} $
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          )}

        </div>

        {/* ── Частина 2: Купівля/продаж по валютах + Операції зміни ── */}
        <div className="space-y-2.5">
          {/* Звіт купівля/продаж по кожній валюті */}
          <div className="bg-white rounded-xl shadow p-4">
            <h3 className="font-semibold text-gray-800 mb-1">Купівля / продаж по валютах</h3>
            <p className="text-xs text-gray-400 mb-3">
              Обсяги за зміну: скільки куплено і продано кожної валюти, середні курси. Сторновані не враховано.
            </p>
            {tradeStats.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-4">Операцій не було</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 border-b">
                    <th className="pb-2 text-left">Валюта</th>
                    <th className="pb-2 text-right text-green-600">Куплено</th>
                    <th className="pb-2 text-right">Сер.курс</th>
                    <th className="pb-2 text-right text-red-600">Продано</th>
                    <th className="pb-2 text-right">Сер.курс</th>
                  </tr>
                </thead>
                <tbody>
                  {tradeStats.map((r) => (
                    <tr key={r.cur} className="border-b last:border-0">
                      <td className="py-2 font-bold text-gray-800">{r.cur}</td>
                      <td className="py-2 text-right font-medium text-green-700">
                        {r.boughtQty > 0 ? fmtNum(r.boughtQty) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="py-2 text-right text-gray-500">
                        {r.boughtQty > 0 ? r.avgBuy.toFixed(4) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="py-2 text-right font-medium text-red-600">
                        {r.soldQty > 0 ? fmtNum(r.soldQty) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="py-2 text-right text-gray-500">
                        {r.soldQty > 0 ? r.avgSell.toFixed(4) : <span className="text-gray-300">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="bg-white rounded-xl shadow p-4">
            <h3 className="font-semibold text-gray-800 mb-3">
              Операції зміни <span className="text-gray-400 font-normal">· {shift.operations.length}</span>
            </h3>
            {shift.operations.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-4">Операцій не було</p>
            ) : (
              <div className="overflow-auto max-h-[28rem]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white">
                    <tr className="text-xs text-gray-400 border-b">
                      <th className="pb-2 text-left">Час</th>
                      <th className="pb-2 text-left">Тип</th>
                      <th className="pb-2 text-right">Сума</th>
                      <th className="pb-2 text-right">Курс</th>
                      <th className="pb-2 text-right">UAH</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...shift.operations].reverse().map((op) => (
                      <tr key={op.id} className="border-b last:border-0">
                        <td className="py-1.5 text-gray-400 text-xs">
                          {format(new Date(op.createdAt), 'HH:mm')}
                        </td>
                        <td className="py-1.5">
                          <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
                            op.type === 'BUY' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                          }`}>
                            {op.type === 'BUY' ? 'Купівля' : 'Продаж'}
                          </span>
                        </td>
                        <td className="py-1.5 text-right font-medium">
                          {fmtNum(op.amount)} <span className="text-gray-400 text-xs">{op.currency}</span>
                        </td>
                        <td className="py-1.5 text-right text-gray-500">
                          {Number(op.rate).toFixed(2)}
                        </td>
                        {(() => {
                          // Рух гривні: Продаж → каса отримує грн (+), Купівля → віддає (−).
                          // Крос (валюта↔валюта) гривні не зачіпає — нейтрально.
                          const isCross = !!op.payCurrency && op.payCurrency !== 'UAH' && op.currency !== 'UAH';
                          const inflow = op.type === 'SELL';
                          return (
                            <td className={`py-1.5 text-right font-medium ${
                              isCross ? 'text-gray-400' : inflow ? 'text-green-600' : 'text-red-600'
                            }`}>
                              {isCross ? '' : inflow ? '+' : '−'}{fmtNum(op.totalUah)} ₴
                            </td>
                          );
                        })()}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* ── Частина 3: Рух готівки (підкріплення/інкасації + передачі) ── */}
        <div className="space-y-2.5">
          {movementRows.length === 0 ? (
            <div className="bg-white rounded-xl shadow p-4">
              <h3 className="font-semibold text-gray-800 mb-1">Рух готівки</h3>
              <p className="text-gray-400 text-sm text-center py-4">Підкріплень, інкасацій та передач не було</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow p-4">
              <h3 className="font-semibold text-gray-800 mb-1">
                Рух готівки <span className="text-gray-400 font-normal">· {movementRows.length}</span>
              </h3>
              <p className="text-xs text-gray-400 mb-3">
                Підкріплення/інкасації та передачі між касами. Змінюють залишок каси, але
                в прибуток зміни не входять.
              </p>
              <div className="overflow-auto max-h-[20rem]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white">
                    <tr className="text-xs text-gray-400 border-b">
                      <th className="pb-2 text-left">Час</th>
                      <th className="pb-2 text-left">Тип</th>
                      <th className="pb-2 text-left">Джерело</th>
                      <th className="pb-2 text-right">Сума</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movementRows.map((r) => (
                      <tr key={r.key} className="border-b last:border-0">
                        <td className="py-1.5 text-gray-400 text-xs">
                          {r.time ? format(new Date(r.time), 'HH:mm') : '—'}
                        </td>
                        <td className="py-1.5">
                          <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${r.badge}`}>
                            {r.label}
                          </span>
                        </td>
                        <td className="py-1.5 text-gray-500 text-xs">{r.source}</td>
                        <td className={`py-1.5 text-right font-medium ${r.incoming ? 'text-green-600' : 'text-red-600'}`}>
                          {r.incoming ? '+' : '−'}{fmtNum(r.amount)} <span className="text-gray-400 text-xs">{r.currency}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* USDT-операції зміни (окремий гаманець) */}
          {usdtOperations.length > 0 && (
            <div className="bg-white rounded-xl shadow p-4">
              <h3 className="font-semibold text-gray-800 mb-1">
                ₮ USDT <span className="text-gray-400 font-normal">· {usdtOperations.length}</span>
              </h3>
              <p className="text-xs text-gray-400 mb-3">
                Гаманець USDT (1:1 до USD). Фізична готівка рухає касу; прибуток — маржа %.
              </p>
              <div className="overflow-auto max-h-[20rem]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white">
                    <tr className="text-xs text-gray-400 border-b">
                      <th className="pb-2 text-left">Час</th>
                      <th className="pb-2 text-left">Тип</th>
                      <th className="pb-2 text-right">USDT</th>
                      <th className="pb-2 text-right">Готівка</th>
                      <th className="pb-2 text-right">Маржа&nbsp;₴</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...usdtOperations]
                      .sort((a, b) => ((a.createdAt as string) ?? '').localeCompare((b.createdAt as string) ?? ''))
                      .map((op, i) => {
                        const isSell = op.side === 'SELL';
                        return (
                          <tr key={op.id ?? i} className={`border-b last:border-0 ${op.cancelled ? 'opacity-40 line-through' : ''}`}>
                            <td className="py-1.5 text-gray-400 text-xs">
                              {op.createdAt ? format(new Date(op.createdAt as string), 'HH:mm') : '—'}
                            </td>
                            <td className="py-1.5">
                              <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-teal-100 text-teal-700">
                                {isSell ? 'Продаж' : 'Купівля'}
                              </span>
                            </td>
                            <td className={`py-1.5 text-right font-medium ${isSell ? 'text-red-600' : 'text-green-600'}`}>
                              {isSell ? '−' : '+'}{fmtNum(op.usdtAmount ?? 0)}
                            </td>
                            <td className={`py-1.5 text-right ${isSell ? 'text-green-600' : 'text-red-600'}`}>
                              {isSell ? '+' : '−'}{fmtNum(op.settleAmount)} <span className="text-gray-400 text-xs">{op.settleCurrency}</span>
                            </td>
                            <td className="py-1.5 text-right font-medium text-green-600">
                              +{fmtNum(op.profitUah ?? 0)}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Підтвердження (липка панель дій) ── */}
      <div className="fixed bottom-0 left-0 right-0 z-20 bg-white/95 backdrop-blur border-t border-gray-200 px-3 py-2">
        <div className="w-full space-y-2">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-red-700 text-sm">
              {error}
            </div>
          )}
          <div className="flex justify-end gap-3">
            <button
              onClick={onCancel}
              className="px-6 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-medium transition"
            >
              Скасувати
            </button>
            <button
              onClick={handleSubmit}
              disabled={saving}
              className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-xl disabled:opacity-50 transition"
            >
              {saving ? 'Закриваємо...' : hasDiscrepancy ? '⚠️ Закрити зміну з розбіжністю' : '✓ Закрити зміну'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
