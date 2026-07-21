import { useEffect, useState } from 'react';
import api from '../../api/axios';
import { format } from 'date-fns';
import { computeCurrentBalance } from '../../lib/balance';
import { applyCashMovements } from '../../lib/cash-movements';
import { netTransfers } from '../../lib/transfers';
import { usdtCashDelta } from '../../lib/usdt';
import { printReceipt } from '../cashier/OperationsList';
import { usdtProfit, usdtProfitUsd } from '../../lib/usdt';
import { fmtMoney, fmtNum as fmt, fmtRate } from '../../lib/format';

const STATUS: Record<string, { label: string; cls: string }> = {
  OPEN: { label: 'Відкрита', cls: 'bg-green-100 text-green-700' },
  CLOSED: { label: 'Закрита', cls: 'bg-gray-100 text-gray-600' },
};

const num = (v: any) => Number(v ?? 0);

function Section({ title, count, actions, children }: { title: string; count?: number; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3">
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          {title}{count != null && <span className="text-gray-400 font-normal"> · {count}</span>}
        </h4>
        {actions}
      </div>
      {children}
    </div>
  );
}

// ── Деталі однієї зміни ──────────────────────────────────────────────────────
function ShiftDetail({ shiftId }: { shiftId: number }) {
  const [d, setD] = useState<any>(null);
  const [orgName, setOrgName] = useState('');
  // Фільтри таблиці операцій зміни.
  const [fType, setFType] = useState<'all' | 'BUY' | 'SELL'>('all');
  const [fCur, setFCur] = useState<string>('all');
  // Вид звіту зміни: коротка друкована (зведення), повна друкована (зі списками
  // документів), JSON (ті самі дані для розробника/аналізу).
  const [reportKind, setReportKind] = useState<'short' | 'full' | 'json'>('short');
  // Кастомний прибуток адміна: редагування + збереження (довідкове число).
  const [apEdit, setApEdit] = useState(false);
  const [apUsd, setApUsd] = useState('');
  const [apUah, setApUah] = useState('');
  const [apNote, setApNote] = useState('');
  const [apSaving, setApSaving] = useState(false);
  useEffect(() => {
    api.get(`/shifts/${shiftId}`).then(({ data }) => setD(data)).catch(() => setD(null));
  }, [shiftId]);

  const startAdminEdit = () => {
    setApUsd(d?.adminProfitUsd != null ? String(Number(d.adminProfitUsd)) : '');
    setApUah(d?.adminProfitUah != null ? String(Number(d.adminProfitUah)) : '');
    setApNote(d?.adminProfitNote ?? '');
    setApEdit(true);
  };
  const saveAdminProfit = async () => {
    setApSaving(true);
    try {
      const parse = (s: string) => (s.trim() === '' ? null : parseFloat(s));
      const { data } = await api.patch(`/shifts/${shiftId}/admin-profit`, {
        profitUsd: parse(apUsd), profitUah: parse(apUah), note: apNote.trim() || null,
      });
      setD((prev: any) => ({ ...prev, ...data }));
      setApEdit(false);
    } finally {
      setApSaving(false);
    }
  };

  useEffect(() => {
    api.get('/settings/org-name').then(({ data }) => setOrgName(data.name ?? '')).catch(() => {});
  }, []);

  if (!d) return <div className="text-sm text-gray-400 py-3 px-1">Завантаження деталей...</div>;

  const closed = d.status === 'CLOSED';
  const start: Record<string, number> = d.startBalance || {};
  const ops: any[] = d.operations || [];
  const moves: any[] = d.cashMovements || [];
  const transfers: any[] = d.confirmedTransfers || [];
  const recons: any[] = d.reconciliations || [];
  const usdtOps: any[] = d.usdtOperations || [];

  // Очікуваний залишок: для закритих — збережений calcBalance; для відкритих — рахуємо живий.
  const expected: Record<string, number> = closed
    ? (d.calcBalance || {})
    : (() => {
        const b = applyCashMovements(computeCurrentBalance(start, ops), moves);
        const net = netTransfers(transfers, d.cashDeskId);
        for (const [c, a] of Object.entries(net)) b[c] = (b[c] ?? 0) + a;
        const ud = usdtCashDelta(usdtOps);
        for (const [c, a] of Object.entries(ud)) b[c] = (b[c] ?? 0) + a;
        return b;
      })();
  const actual: Record<string, number> | null = closed ? (d.endBalance || {}) : null;

  const currencies = Array.from(new Set([
    'UAH',
    ...Object.keys(start), ...Object.keys(expected), ...(actual ? Object.keys(actual) : []),
  ]));

  // Дані шапки чека для друку окремої операції (як у касира).
  const receipt = {
    orgName,
    address: d.cashDesk?.exchangePoint?.address ?? '',
    deskNo: d.cashDeskId,
  };

  // ── Оборот по валютах: скільки куплено / продано за зміну (дзеркало tradeStats касира) ──
  const tradeStats = (() => {
    const stats: Record<string, { boughtQty: number; boughtUah: number; soldQty: number; soldUah: number }> = {};
    const ensure = (c: string) => (stats[c] ??= { boughtQty: 0, boughtUah: 0, soldQty: 0, soldUah: 0 });
    for (const op of ops) {
      if (op.cancelled) continue;
      const amount = num(op.amount); const totalUah = num(op.totalUah);
      const payCur = op.payCurrency; const payAmount = op.payAmount != null ? num(op.payAmount) : 0;
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
    return Object.entries(stats).map(([cur, s]) => ({
      cur, ...s,
      avgBuy: s.boughtQty > 0 ? s.boughtUah / s.boughtQty : 0,
      avgSell: s.soldQty > 0 ? s.soldUah / s.soldQty : 0,
    })).sort((a, b) => a.cur.localeCompare(b.cur));
  })();

  // ── Друк звіту по зміні (А4) ────────────────────────────────────────────────
  // short: лише зведення (оборот, прибуток, залишки) — 1 сторінка для клієнта.
  // full:  зведення + усі документи зміни (операції, рух готівки, USDT,
  //        передачі, звірки) — той самий склад даних, що й у JSON-звіті.
  const printShiftReport = (mode: 'short' | 'full' = 'full') => {
    const full = mode === 'full';
    // Гроші — через глобальний формат (копійки за опцією); курс/dd=4 — завжди точний.
    const n2 = (v: any, dd?: number) => (dd ? fmtRate(v, dd) : fmtMoney(v));
    const dt = (s: string) => format(new Date(s), 'dd.MM.yyyy HH:mm');
    const tm = (s: string) => format(new Date(s), 'HH:mm');

    // Прибуток по валютах ($-числовник: op.profitUsd нативний, op.profit — ₴-знімок).
    const realizedByCur: Record<string, number> = {};
    const realizedByCurUsd: Record<string, number> = {};
    let realizedTotal = 0;
    let realizedTotalUsd = 0;
    for (const op of ops) {
      if (op.cancelled) continue;
      const p = num(op.profit);
      const pu = num(op.profitUsd);
      realizedByCur[op.currency] = (realizedByCur[op.currency] ?? 0) + p;
      realizedByCurUsd[op.currency] = (realizedByCurUsd[op.currency] ?? 0) + pu;
      realizedTotal += p;
      realizedTotalUsd += pu;
    }
    const usdtMargin = usdtProfit(usdtOps as any);
    const usdtMarginUsd = usdtProfitUsd(usdtOps as any);
    const tradingProfit = realizedTotal + usdtMargin;
    const tradingProfitUsd = realizedTotalUsd + usdtMarginUsd;

    const tradeRows = tradeStats.map((r) => `
      <tr><td class="b">${r.cur}</td>
        <td class="num">${r.boughtQty > 0 ? n2(r.boughtQty) : '—'}</td>
        <td class="num">${r.boughtQty > 0 ? n2(r.avgBuy, 4) : '—'}</td>
        <td class="num">${r.boughtQty > 0 ? n2(r.boughtUah) : '—'}</td>
        <td class="num">${r.soldQty > 0 ? n2(r.soldQty) : '—'}</td>
        <td class="num">${r.soldQty > 0 ? n2(r.avgSell, 4) : '—'}</td>
        <td class="num">${r.soldQty > 0 ? n2(r.soldUah) : '—'}</td>
      </tr>`).join('');

    const profitCurs = Object.keys(realizedByCur)
      .filter((c) => Math.abs(realizedByCur[c]) >= 0.005 || Math.abs(realizedByCurUsd[c] ?? 0) >= 0.005)
      .sort();
    const profitRows = profitCurs.map((c) => `
      <tr><td class="b">${c}</td><td class="num">${((realizedByCurUsd[c] ?? 0) > 0 ? '+' : '') + n2(realizedByCurUsd[c] ?? 0)}</td><td class="num">${(realizedByCur[c] > 0 ? '+' : '') + n2(realizedByCur[c])}</td></tr>`).join('')
      + (Math.abs(usdtMargin) >= 0.005 ? `<tr><td class="b">USDT</td><td class="num">${(usdtMarginUsd > 0 ? '+' : '') + n2(usdtMarginUsd)}</td><td class="num">${(usdtMargin > 0 ? '+' : '') + n2(usdtMargin)}</td></tr>` : '');

    const balanceRows = currencies.map((c) => {
      const o = Math.round(num(start[c])); const e = Math.round(num(expected[c]));
      const a = actual ? Math.round(num(actual[c])) : null;
      if (!o && !e && !(a ?? 0)) return '';
      const diff = a != null ? a - e : null;
      return `<tr><td class="b">${c}</td><td class="num">${o}</td><td class="num">${e}</td>` +
        (closed ? `<td class="num">${a}</td><td class="num${diff ? ' warn' : ''}">${diff ? (diff > 0 ? '+' : '') + diff : '—'}</td>` : '') +
        `</tr>`;
    }).join('');

    // ── Деталізація: усі документи зміни (лише для повної версії) ─────────────
    const opRows = !full ? '' : [...ops]
      .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt))
      .map((op) => {
        const type = op.type === 'BUY' ? 'Купівля' : op.type === 'SELL' ? 'Продаж' : 'Обмін';
        const cross = op.payCurrency ? `${fmt(op.payAmount)} ${op.payCurrency} → ` : '';
        return `<tr${op.cancelled ? ' class="void"' : ''}>
          <td>${tm(op.createdAt)}</td>
          <td>${op.number ?? ''}</td>
          <td>${type}${op.cancelled ? ' (сторно)' : ''}</td>
          <td class="num">${cross}${fmt(op.amount)} ${op.currency}</td>
          <td class="num">${n2(op.rate, 4)}</td>
          <td class="num">${fmt(op.totalUah)}</td>
          <td class="num">${op.cancelled ? '—' : (num(op.profit) > 0 ? '+' : '') + n2(op.profit)}</td>
          <td class="num">${op.cashierProfit != null ? n2(op.cashierProfit) : '—'}</td>
          <td>${op.cashierProfitNote ?? '—'}</td>
          <td>${op.cashier?.name ?? ''}</td>
        </tr>`;
      }).join('');

    const moveRows = !full ? '' : [...moves]
      .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt))
      .map((m) => `<tr>
        <td>${tm(m.createdAt)}</td>
        <td>${m.number ?? ''}</td>
        <td>${m.direction === 'IN' ? 'Підкріплення' : 'Інкасація'}</td>
        <td class="num">${m.direction === 'IN' ? '+' : '−'}${fmt(m.amount)} ${m.currency}</td>
        <td>${[m.source, m.note].filter(Boolean).join(' · ') || '—'}</td>
      </tr>`).join('');

    const usdtRows = !full ? '' : [...usdtOps]
      .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt))
      .map((u) => `<tr${u.cancelled ? ' class="void"' : ''}>
        <td>${tm(u.createdAt)}</td>
        <td>${u.number ?? ''}</td>
        <td>${u.side === 'SELL' ? 'Продаж' : 'Купівля'}${u.cancelled ? ' (сторно)' : ''}</td>
        <td class="num">${u.side === 'SELL' ? '−' : '+'}${fmt(u.usdtAmount)} USDT</td>
        <td class="num">${fmt(u.settleAmount)} ${u.settleCurrency}</td>
        <td class="num">${u.cancelled ? '—' : '+' + n2(u.profitUah)}</td>
      </tr>`).join('');

    const transferRows = !full ? '' : transfers.map((t) => {
      const incoming = t.toDeskId === d.cashDeskId;
      const counter = t.counterCurrency
        ? ` ↔ ${incoming ? '−' : '+'}${fmt(t.counterAmount)} ${t.counterCurrency}`
        : '';
      return `<tr>
        <td>${t.confirmedAt ? tm(t.confirmedAt) : '—'}</td>
        <td>${t.number ?? ''}</td>
        <td>${incoming ? 'Отримано' : 'Відправлено'}</td>
        <td class="num">${incoming ? '+' : '−'}${fmt(t.amount)} ${t.currency}${counter}</td>
      </tr>`;
    }).join('');

    const reconRows = !full ? '' : recons.map((r) => {
      const curs = Array.from(new Set([...Object.keys(r.expected || {}), ...Object.keys(r.actual || {})]));
      const detail = curs.map((c) => {
        const e = num(r.expected?.[c]); const a = num(r.actual?.[c]);
        return Math.abs(a - e) >= 0.01 ? `${c}: ${fmt(a)}/${fmt(e)}` : `${c}: ${fmt(a)}`;
      }).join(' · ');
      return `<tr>
        <td>${tm(r.createdAt)}</td>
        <td>${r.createdBy?.name ?? ''}</td>
        <td>${r.hasDiscrepancy ? 'розбіжність' : 'збіглося'}</td>
        <td>${detail}</td>
      </tr>`;
    }).join('');

    const empty = (cols: number, text = 'Немає') =>
      `<tr><td colspan="${cols}" style="text-align:center;color:#888">${text}</td></tr>`;

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Звіт по зміні ${d.number}</title>
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
      tr.void td { color: #999; text-decoration: line-through; }
      .section { page-break-inside: avoid; }
      /* Довгі списки документів можуть не влізти на сторінку — рвемо по рядках. */
      .list { margin-top: 4px; }
      .list tr { page-break-inside: avoid; }
      .totals { margin-top: 12px; page-break-inside: avoid; }
      .totals div { display: flex; justify-content: space-between; padding: 3px 0; font-size: 12.5px; }
      .totals .line { border-top: 1.5px solid #111; margin-top: 4px; padding-top: 6px; font-weight: 700; font-size: 14px; }
      .sign { margin-top: 26px; display: flex; gap: 40px; page-break-inside: avoid; }
      .sign div { flex: 1; border-top: 1px solid #111; padding-top: 4px; font-size: 11px; color: #555; text-align: center; }
    </style></head><body>
      <h1>${full ? 'Повний звіт' : 'Звіт'} по зміні №${d.number}${closed ? '' : ' (відкрита)'}</h1>
      <div class="meta">
        ${orgName ? orgName + ' · ' : ''}${d.cashDesk?.exchangePoint?.name ?? ''} · ${d.cashDesk?.name ?? ''}
        · Касир: ${d.openedBy?.name ?? '—'}<br>
        Відкрита: ${dt(d.openedAt)}${d.closedAt ? ` · Закрита: ${dt(d.closedAt)}` : ''}
        · Звіт сформовано: ${format(new Date(), 'dd.MM.yyyy HH:mm')}
        · Операцій: ${ops.filter((o: any) => !o.cancelled).length}
      </div>

      <div class="section">
        <h2>Купівля / продаж по валютах</h2>
        <table>
          <thead><tr><th>Валюта</th><th>Куплено</th><th>Сер. курс</th><th>Куплено, ₴</th><th>Продано</th><th>Сер. курс</th><th>Продано, ₴</th></tr></thead>
          <tbody>${tradeRows || '<tr><td colspan="7" style="text-align:center;color:#888">Операцій не було</td></tr>'}</tbody>
        </table>
      </div>

      <div class="section">
        <h2>Прибуток за зміну (по валютах)</h2>
        <table>
          <thead><tr><th>Валюта</th><th>Прибуток, $</th><th>Прибуток, ₴</th></tr></thead>
          <tbody>${profitRows || '<tr><td colspan="3" style="text-align:center;color:#888">—</td></tr>'}</tbody>
        </table>
      </div>

      <div class="section">
        <h2>Залишки каси</h2>
        <table>
          <thead><tr><th>Валюта</th><th>На початок</th><th>Очікувано</th>${closed ? '<th>Фактично</th><th>Різниця</th>' : ''}</tr></thead>
          <tbody>${balanceRows || '<tr><td colspan="' + (closed ? 5 : 3) + '" style="text-align:center;color:#888">—</td></tr>'}</tbody>
        </table>
      </div>

      <div class="totals">
        <div><span>Торговий прибуток</span><span>${tradingProfitUsd >= 0 ? '+' : ''}${n2(tradingProfitUsd)} $ (${tradingProfit >= 0 ? '+' : ''}${n2(tradingProfit)} ₴)</span></div>
        ${Math.abs(usdtMargin) >= 0.005 ? `<div><span>у т.ч. маржа USDT</span><span>${usdtMarginUsd >= 0 ? '+' : ''}${n2(usdtMarginUsd)} $ (${usdtMargin >= 0 ? '+' : ''}${n2(usdtMargin)} ₴)</span></div>` : ''}
        ${closed ? `<div class="line"><span>Прибуток зміни (збережено)</span><span>${num(d.profitUsd) >= 0 ? '+' : ''}${n2(d.profitUsd)} $ (${num(d.profit) >= 0 ? '+' : ''}${n2(d.profit)} ₴)</span></div>` : ''}
        ${closed && d.tillUsd?.total != null ? `<div><span>Каса в доларах</span><span>${n2(d.tillUsd.total)} $</span></div>` : ''}
      </div>

      ${full ? `
      <div class="list">
        <h2>Операції зміни (${ops.length})</h2>
        <table>
          <thead><tr><th>Час</th><th>Номер</th><th>Тип</th><th>Сума</th><th>Курс</th><th>₴</th><th>Прибуток (система)</th><th>Прибуток (касир)</th><th>Як рахував касир</th><th>Касир</th></tr></thead>
          <tbody>${opRows || empty(10, 'Операцій не було')}</tbody>
        </table>
      </div>

      <div class="list">
        <h2>Рух готівки — підкріплення / інкасації (${moves.length})</h2>
        <table>
          <thead><tr><th>Час</th><th>Номер</th><th>Тип</th><th>Сума</th><th>Джерело / примітка</th></tr></thead>
          <tbody>${moveRows || empty(5)}</tbody>
        </table>
      </div>

      <div class="list">
        <h2>USDT-операції (${usdtOps.length})</h2>
        <table>
          <thead><tr><th>Час</th><th>Номер</th><th>Тип</th><th>USDT</th><th>Готівка</th><th>Маржа, ₴</th></tr></thead>
          <tbody>${usdtRows || empty(6)}</tbody>
        </table>
      </div>

      <div class="list">
        <h2>Передачі / свопи між касами (${transfers.length})</h2>
        <table>
          <thead><tr><th>Час</th><th>Номер</th><th>Напрям</th><th>Сума</th></tr></thead>
          <tbody>${transferRows || empty(4)}</tbody>
        </table>
      </div>

      <div class="list">
        <h2>Проміжні звірки (${recons.length})</h2>
        <table>
          <thead><tr><th>Час</th><th>Хто</th><th>Результат</th><th>Деталі (факт/розрахунок)</th></tr></thead>
          <tbody>${reconRows || empty(4, 'Звірок не було')}</tbody>
        </table>
      </div>` : ''}

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
    doc.open(); doc.write(html); doc.close();
    const win = iframe.contentWindow!;
    win.focus();
    win.onafterprint = () => { try { document.body.removeChild(iframe); } catch { /* removed */ } };
    setTimeout(() => { win.print(); setTimeout(() => { try { document.body.removeChild(iframe); } catch { /* noop */ } }, 60_000); }, 150);
  };

  // Повний JSON-звіт зміни (всі операції, рух готівки, USDT, передачі, оборот,
  // ledger, собівартість) — для вивантаження даних на аналіз.
  const downloadFullReport = async () => {
    try {
      const { data } = await api.get(`/shifts/${shiftId}/report`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `zvit-zmina-${data.shift?.number ?? shiftId}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('Не вдалося сформувати звіт');
    }
  };

  return (
    <div className="bg-gray-50 border-t border-gray-200 p-3 space-y-3">
      <div className="flex items-center justify-end gap-2">
        <span className="text-xs text-gray-400">Звіт зміни:</span>
        <select
          value={reportKind}
          onChange={(e) => setReportKind(e.target.value as typeof reportKind)}
          className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          <option value="short">🖨 Коротка (зведення)</option>
          <option value="full">🖨 Повна (з усіма документами)</option>
          <option value="json">⬇ JSON (для розробника)</option>
        </select>
        <button
          onClick={() => (reportKind === 'json' ? downloadFullReport() : printShiftReport(reportKind))}
          className="px-3 py-1.5 rounded-lg font-medium text-sm bg-blue-700 text-white hover:bg-blue-800"
        >
          {reportKind === 'json' ? 'Скачати' : 'Друк'}
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
      {/* Залишки */}
      <Section title="Залишок каси">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-400 border-b">
              <th className="text-left pb-1">Валюта</th>
              <th className="text-right pb-1">Відкриття</th>
              <th className="text-right pb-1">Очікувано</th>
              {closed && <th className="text-right pb-1">Фактично</th>}
              {closed && <th className="text-right pb-1">Різниця</th>}
            </tr>
          </thead>
          <tbody>
            {currencies.map((c) => {
              const o = num(start[c]); const e = num(expected[c]);
              const a = actual ? num(actual[c]) : 0;
              const diff = a - e;
              const hasDiff = closed && Math.abs(diff) >= 1;
              if (!o && !e && !a) return null;
              return (
                <tr key={c} className={`border-b last:border-0 ${hasDiff ? 'bg-red-50' : ''}`}>
                  <td className="py-1 font-bold text-gray-800">{c}</td>
                  <td className="py-1 text-right text-gray-500">{fmt(o)}</td>
                  <td className="py-1 text-right font-medium text-blue-700">{fmt(e)}</td>
                  {closed && <td className="py-1 text-right">{fmt(a)}</td>}
                  {closed && (
                    <td className={`py-1 text-right font-semibold ${!hasDiff ? 'text-gray-300' : diff > 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {hasDiff ? (diff > 0 ? '+' : '') + fmt(diff) : '—'}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {closed && (
          <div className="text-sm text-gray-600 mt-2 pt-2 border-t space-y-1">
            <div>
              Прибуток зміни: <span className={`font-bold ${num(d.profitUsd) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {num(d.profitUsd) >= 0 ? '+' : ''}{fmtMoney(d.profitUsd)} $
              </span>
              <span className="text-gray-400"> ({num(d.profit) >= 0 ? '+' : ''}{fmt(d.profit)} ₴)</span>
            </div>
            {d.tillUsd?.total != null && (
              <div title="Каса в доларах: USD/USDT як є, гривня ÷ сер. курс, валюти × $-собівартість.">
                🧮 Каса в доларах: <span className="font-bold text-blue-700">{fmtMoney(d.tillUsd.total)} $</span>
                {d.tillUsd.usdSellRate ? <span className="text-gray-400"> (курс {num(d.tillUsd.usdSellRate).toFixed(2)})</span> : null}
              </div>
            )}
            {/* Кастомний прибуток адміна — довідкове число «як порахував власник». */}
            {!apEdit ? (
              <div className="flex items-center gap-2">
                <span>Прибуток (адмін):</span>
                {d.adminProfitUsd != null || d.adminProfitUah != null ? (
                  <span className="font-bold text-purple-700">
                    {d.adminProfitUsd != null && `${fmtMoney(d.adminProfitUsd)} $`}
                    {d.adminProfitUsd != null && d.adminProfitUah != null && ' · '}
                    {d.adminProfitUah != null && `${fmtMoney(d.adminProfitUah)} ₴`}
                  </span>
                ) : (
                  <span className="text-gray-400">не задано</span>
                )}
                {d.adminProfitNote && <span className="text-xs text-gray-400">({d.adminProfitNote})</span>}
                <button onClick={startAdminEdit} className="text-xs text-blue-600 hover:underline">
                  {d.adminProfitUsd != null || d.adminProfitUah != null ? 'змінити' : 'ввести'}
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <span>Прибуток (адмін):</span>
                <input type="number" step="0.01" placeholder="$" value={apUsd}
                  onChange={(e) => setApUsd(e.target.value)}
                  className="w-24 border border-gray-300 rounded px-2 py-1 text-right text-sm" />
                <span className="text-gray-400">$</span>
                <input type="number" step="0.01" placeholder="₴" value={apUah}
                  onChange={(e) => setApUah(e.target.value)}
                  className="w-28 border border-gray-300 rounded px-2 py-1 text-right text-sm" />
                <span className="text-gray-400">₴</span>
                <input type="text" placeholder="примітка" value={apNote}
                  onChange={(e) => setApNote(e.target.value)}
                  className="w-40 border border-gray-300 rounded px-2 py-1 text-sm" />
                <button onClick={saveAdminProfit} disabled={apSaving}
                  className="text-xs px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50">
                  {apSaving ? '…' : 'Зберегти'}
                </button>
                <button onClick={() => setApEdit(false)} className="text-xs text-gray-400 hover:text-gray-600">
                  скасувати
                </button>
              </div>
            )}
          </div>
        )}
      </Section>

      {/* Оборот по валютах */}
      <Section title="Оборот по валютах" count={tradeStats.length}>
        {tradeStats.length === 0 ? <p className="text-gray-400 text-sm py-2">Операцій не було</p> : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 border-b">
                  <th className="text-left pb-1">Валюта</th>
                  <th className="text-right pb-1">Куплено</th>
                  <th className="text-right pb-1">Сер. курс</th>
                  <th className="text-right pb-1">Куплено, ₴</th>
                  <th className="text-right pb-1">Продано</th>
                  <th className="text-right pb-1">Сер. курс</th>
                  <th className="text-right pb-1">Продано, ₴</th>
                  <th className="text-right pb-1" title="Середня собівартість — курс, проти якого рахується прибуток">Собівартість</th>
                </tr>
              </thead>
              <tbody>
                {tradeStats.map((r) => {
                  // Закрита — збережена на момент закриття; відкрита — поточна каси.
                  const cb = closed ? (d.costBasis || {}) : (d.costBasisLive || {});
                  return (
                  <tr key={r.cur} className="border-b last:border-0">
                    <td className="py-1 font-bold text-gray-800">{r.cur}</td>
                    <td className="py-1 text-right text-green-700 font-medium">{r.boughtQty > 0 ? fmt(r.boughtQty) : '—'}</td>
                    <td className="py-1 text-right text-gray-500">{r.boughtQty > 0 ? r.avgBuy.toFixed(4) : '—'}</td>
                    <td className="py-1 text-right text-gray-600">{r.boughtQty > 0 ? fmt(r.boughtUah) : '—'}</td>
                    <td className="py-1 text-right text-red-700 font-medium">{r.soldQty > 0 ? fmt(r.soldQty) : '—'}</td>
                    <td className="py-1 text-right text-gray-500">{r.soldQty > 0 ? r.avgSell.toFixed(4) : '—'}</td>
                    <td className="py-1 text-right text-gray-600">{r.soldQty > 0 ? fmt(r.soldUah) : '—'}</td>
                    <td className="py-1 text-right font-medium text-blue-700">{cb[r.cur] ? Number(cb[r.cur]).toFixed(4) : '—'}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        {/* Операції */}
        {(() => {
          const opCurrencies = Array.from(new Set(ops.map((o) => o.currency))).sort();
          const filtered = ops.filter(
            (o) => (fType === 'all' || o.type === fType) && (fCur === 'all' || o.currency === fCur),
          );
          const selCls = 'border border-gray-300 rounded px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400';
          const filterActions = ops.length > 0 && (
            <div className="flex items-center gap-1.5">
              <select value={fType} onChange={(e) => setFType(e.target.value as any)} className={selCls}>
                <option value="all">Усі типи</option>
                <option value="BUY">Купівля</option>
                <option value="SELL">Продаж</option>
              </select>
              <select value={fCur} onChange={(e) => setFCur(e.target.value)} className={selCls}>
                <option value="all">Усі валюти</option>
                {opCurrencies.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          );
          return (
        <Section title="Операції" count={filtered.length} actions={filterActions}>
          {ops.length === 0 ? <p className="text-gray-400 text-sm py-2">Немає</p> : filtered.length === 0 ? (
            <p className="text-gray-400 text-sm py-2">Немає операцій за фільтром</p>
          ) : (
            <div className="overflow-auto max-h-72">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white">
                  <tr className="text-xs text-gray-400 border-b">
                    <th className="text-left pb-1">Час</th><th className="text-left pb-1">Тип</th>
                    <th className="text-right pb-1">Сума</th><th className="text-right pb-1">Курс</th><th className="text-right pb-1">UAH</th>
                    <th className="text-right pb-1" title="Прибуток: система / за розрахунком касира">Прибуток</th>
                    <th className="pb-1"></th>
                  </tr>
                </thead>
                <tbody>
                  {[...filtered].reverse().map((op) => (
                    <tr key={op.id} className={`border-b last:border-0 ${op.cancelled ? 'opacity-40 line-through' : ''}`}>
                      <td className="py-1 text-gray-400 text-xs">{format(new Date(op.createdAt), 'HH:mm')}</td>
                      <td className="py-1">
                        <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${op.type === 'BUY' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          {op.type === 'BUY' ? 'Купівля' : 'Продаж'}
                        </span>
                      </td>
                      <td className="py-1 text-right font-medium">{fmt(op.amount)} <span className="text-gray-400 text-xs">{op.currency}</span></td>
                      <td className="py-1 text-right text-gray-500">{num(op.rate).toFixed(2)}</td>
                      <td className="py-1 text-right text-gray-600">{fmt(op.totalUah)}</td>
                      {/* Прибуток системи (WAC) і, якщо касир вводив, — його власний розрахунок. */}
                      <td className="py-1 text-right whitespace-nowrap">
                        <span className={num(op.profit) >= 0 ? 'text-gray-700' : 'text-red-600'}>{fmt(op.profit)}</span>
                        {op.cashierProfit != null && (
                          <span
                            className={`ml-1 text-xs ${
                              Math.abs(num(op.cashierProfit) - num(op.profit)) >= 0.5 ? 'text-amber-600 font-semibold' : 'text-gray-400'
                            }`}
                            title={op.cashierProfitNote || 'Розрахунок касира'}
                          >
                            / {fmt(op.cashierProfit)}
                          </span>
                        )}
                        {op.cashierProfitNote && (
                          <div className="text-[11px] text-gray-400 italic max-w-[220px] truncate ml-auto" title={op.cashierProfitNote}>
                            {op.cashierProfitNote}
                          </div>
                        )}
                      </td>
                      <td className="py-1 text-right">
                        <button
                          onClick={() => printReceipt(op, receipt)}
                          title="Друк чека операції"
                          className="text-gray-400 hover:text-blue-600 px-1"
                        >
                          🖨
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
          );
        })()}

        {/* Рух готівки */}
        <Section title="Рух готівки" count={moves.length}>
          {moves.length === 0 ? <p className="text-gray-400 text-sm py-2">Немає</p> : (
            <div className="overflow-auto max-h-72">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white">
                  <tr className="text-xs text-gray-400 border-b">
                    <th className="text-left pb-1">Час</th><th className="text-left pb-1">Тип</th>
                    <th className="text-left pb-1">Джерело</th><th className="text-right pb-1">Сума</th>
                  </tr>
                </thead>
                <tbody>
                  {[...moves].reverse().map((m) => {
                    const isIn = m.direction === 'IN';
                    return (
                      <tr key={m.id} className="border-b last:border-0">
                        <td className="py-1 text-gray-400 text-xs">{format(new Date(m.createdAt), 'HH:mm')}</td>
                        <td className="py-1">
                          <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${isIn ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700'}`}>
                            {isIn ? 'Підкр.' : 'Інкас.'}
                          </span>
                        </td>
                        <td className="py-1 text-gray-500 text-xs">{[m.source, m.note].filter(Boolean).join(' · ') || '—'}</td>
                        <td className={`py-1 text-right font-medium ${isIn ? 'text-green-600' : 'text-purple-600'}`}>
                          {isIn ? '+' : '−'}{fmt(m.amount)} <span className="text-gray-400 text-xs">{m.currency}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        {/* Передачі */}
        <Section title="Передачі / свопи" count={transfers.length}>
          {transfers.length === 0 ? <p className="text-gray-400 text-sm py-2">Немає</p> : (
            <div className="space-y-1">
              {transfers.map((t) => {
                const incoming = t.toDeskId === d.cashDeskId;
                return (
                  <div key={t.id} className="flex items-center justify-between text-sm border-b last:border-0 py-1">
                    <span className="text-xs text-gray-400">{t.confirmedAt ? format(new Date(t.confirmedAt), 'HH:mm') : ''}</span>
                    <span className={incoming ? 'text-blue-600' : 'text-orange-600'}>
                      {incoming ? '+' : '−'}{fmt(t.amount)} {t.currency}
                      {t.counterCurrency && <span className="text-gray-500"> ↔ {incoming ? '−' : '+'}{fmt(t.counterAmount)} {t.counterCurrency}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Section>

        {/* USDT-операції */}
        <Section title="USDT-операції" count={usdtOps.length}>
          {usdtOps.length === 0 ? <p className="text-gray-400 text-sm py-2">Немає</p> : (
            <div className="overflow-auto max-h-72">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white">
                  <tr className="text-xs text-gray-400 border-b">
                    <th className="text-left pb-1">Час</th><th className="text-left pb-1">Тип</th>
                    <th className="text-right pb-1">USDT</th><th className="text-right pb-1">Готівка</th><th className="text-right pb-1">Маржа ₴</th>
                  </tr>
                </thead>
                <tbody>
                  {[...usdtOps].reverse().map((op) => {
                    const isSell = op.side === 'SELL';
                    return (
                      <tr key={op.id} className={`border-b last:border-0 ${op.cancelled ? 'opacity-40 line-through' : ''}`}>
                        <td className="py-1 text-gray-400 text-xs">{format(new Date(op.createdAt), 'HH:mm')}</td>
                        <td className="py-1">
                          <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-teal-100 text-teal-700">
                            {isSell ? 'Продаж' : 'Купівля'}
                          </span>
                        </td>
                        <td className={`py-1 text-right font-medium ${isSell ? 'text-red-600' : 'text-green-600'}`}>
                          {isSell ? '−' : '+'}{fmt(op.usdtAmount)}
                        </td>
                        <td className="py-1 text-right text-gray-600">{fmt(op.settleAmount)} <span className="text-gray-400 text-xs">{op.settleCurrency}</span></td>
                        <td className="py-1 text-right font-medium text-green-600">+{fmt(op.profitUah)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {/* Проміжні звірки */}
        <Section title="Проміжні звірки" count={recons.length}>
          {recons.length === 0 ? <p className="text-gray-400 text-sm py-2">Не було</p> : (
            <div className="space-y-2">
              {recons.map((r) => {
                const curs = Array.from(new Set([...Object.keys(r.expected || {}), ...Object.keys(r.actual || {})]));
                return (
                  <div key={r.id} className="border-b last:border-0 pb-2">
                    <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
                      <span>{format(new Date(r.createdAt), 'HH:mm')}</span>
                      <span className="text-gray-400">{r.createdBy?.name}</span>
                      {r.hasDiscrepancy
                        ? <span className="text-red-500 font-semibold">⚠ розбіжність</span>
                        : <span className="text-green-600">✓ збіглося</span>}
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                      {curs.map((c) => {
                        const e = num(r.expected?.[c]); const a = num(r.actual?.[c]);
                        const diff = Math.abs(a - e) >= 0.01;
                        return (
                          <span key={c} className={diff ? 'text-red-600' : 'text-gray-600'}>
                            {c}: {fmt(a)}{diff && <span className="text-gray-400">/{fmt(e)}</span>}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

// ── Список змін ──────────────────────────────────────────────────────────────
export default function ShiftsAdmin() {
  const [points, setPoints] = useState<any[]>([]);
  const [pointId, setPointId] = useState('');
  const [shifts, setShifts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    api.get('/exchange-points').then(({ data }) => setPoints(data)).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const q = pointId ? `?pointId=${pointId}` : '';
    api.get(`/shifts/list${q}`).then(({ data }) => setShifts(data)).finally(() => setLoading(false));
  }, [pointId]);

  return (
    <div className="bg-white rounded-xl shadow p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-semibold text-lg">Зміни</h3>
        <select
          value={pointId}
          onChange={(e) => { setPointId(e.target.value); setExpanded(null); }}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          <option value="">Усі точки</option>
          {points.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
        </select>
      </div>

      {loading ? (
        <div className="text-center py-10 text-gray-400">Завантаження...</div>
      ) : shifts.length === 0 ? (
        <p className="text-gray-400 text-sm text-center py-6">Змін не знайдено</p>
      ) : (
        <div className="space-y-2">
          {shifts.map((s) => {
            const open = expanded === s.id;
            const st = STATUS[s.status] ?? STATUS.CLOSED;
            return (
              <div key={s.id} className="border border-gray-200 rounded-lg overflow-hidden">
                <button
                  onClick={() => setExpanded(open ? null : s.id)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 transition text-left"
                >
                  <span className="text-gray-400 text-sm">{open ? '▲' : '▼'}</span>
                  <div className="flex-1 min-w-0">
                    {/* Перший рядок — головне, великим: дата · точка · каса · касир + статус */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-800 text-base">
                        {format(new Date(s.openedAt), 'dd.MM.yyyy')} · {s.cashDesk?.exchangePoint?.name} · {s.cashDesk?.name} · {s.openedBy?.name}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.cls}`}>{st.label}</span>
                    </div>
                    {/* Другий рядок — деталі, дрібним */}
                    <div className="text-xs text-gray-400 mt-0.5">
                      #{s.number} · відкрито {format(new Date(s.openedAt), 'HH:mm')}
                      {s.closedAt && <> · закрито {format(new Date(s.closedAt), 'HH:mm')}</>}
                      {' · '}{s._count?.operations ?? 0} оп. · {s._count?.cashMovements ?? 0} рух · {s._count?.usdtOperations ?? 0} USDT · {s._count?.reconciliations ?? 0} звір.
                    </div>
                  </div>
                  {s.status === 'CLOSED' && (
                    <span className={`text-sm font-bold flex-shrink-0 text-right ${num(s.profitUsd) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {num(s.profitUsd) >= 0 ? '+' : ''}{fmtMoney(s.profitUsd)} $
                      <div className="text-xs font-medium text-gray-400">
                        {num(s.profit) >= 0 ? '+' : ''}{fmt(s.profit)} ₴
                      </div>
                    </span>
                  )}
                </button>
                {open && <ShiftDetail shiftId={s.id} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
