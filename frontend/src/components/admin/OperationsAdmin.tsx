import { useState, useEffect, useMemo } from 'react';
import api from '../../api/axios';
import { fmtNum, fmtMoney, fmtRate } from '../../lib/format';
import { format } from 'date-fns';

type Edit = {
  id: number;
  editedAt: string;
  prevAmount: string | number;
  prevRate: string | number;
  newAmount: string | number;
  newRate: string | number;
  note?: string;
  editedBy: { name: string };
};

function EditHistoryModal({ opNumber, opId, onClose }: { opNumber: string; opId: number; onClose: () => void }) {
  const [edits, setEdits] = useState<Edit[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/operations/${opId}/edits`)
      .then(({ data }) => setEdits(data))
      .finally(() => setLoading(false));
  }, [opId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Історія змін</div>
            <div className="font-bold text-gray-800 mt-0.5">#{opNumber}</div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        {loading ? (
          <div className="text-center py-8 text-gray-400 text-sm">Завантаження...</div>
        ) : edits.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm">Змін не було</div>
        ) : (
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {edits.map((e, i) => (
              <div key={e.id} className="border border-gray-100 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-500">
                    Зміна #{i + 1} · {e.editedBy.name}
                  </span>
                  <span className="text-xs text-gray-400">
                    {format(new Date(e.editedAt), 'dd.MM.yy HH:mm')}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="bg-red-50 rounded p-2">
                    <div className="text-xs text-gray-400 mb-1">Було</div>
                    <div>Кількість: <span className="font-semibold">{fmtNum(e.prevAmount)}</span></div>
                    <div>Курс: <span className="font-semibold">{Number(e.prevRate).toFixed(2)}</span></div>
                  </div>
                  <div className="bg-green-50 rounded p-2">
                    <div className="text-xs text-gray-400 mb-1">Стало</div>
                    <div>Кількість: <span className="font-semibold">{fmtNum(e.newAmount)}</span></div>
                    <div>Курс: <span className="font-semibold">{Number(e.newRate).toFixed(2)}</span></div>
                  </div>
                </div>
                {e.note && (
                  <div className="text-xs text-gray-500 bg-gray-50 rounded px-2 py-1">
                    💬 {e.note}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function OperationsAdmin() {
  const [tab, setTab] = useState<'all' | 'BUY' | 'SELL'>('all');
  const [date, setDate] = useState('');       // YYYY-MM-DD; порожньо = останні 500
  const [fCur, setFCur] = useState('all');    // клієнтський фільтр валюти
  const [fCashier, setFCashier] = useState('all'); // клієнтський фільтр касира
  const [ops, setOps] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [historyOp, setHistoryOp] = useState<{ id: number; number: string } | null>(null);

  // Тип і день фільтруються на сервері; валюта й касир — на клієнті.
  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (tab !== 'all') params.set('type', tab);
    if (date) params.set('date', date);
    api.get(`/operations?${params.toString()}`)
      .then(({ data }) => setOps(data))
      .finally(() => setLoading(false));
  }, [tab, date]);

  const currencies = useMemo(() => Array.from(new Set(ops.map((o) => o.currency))).sort(), [ops]);
  const cashiers = useMemo(
    () => Array.from(new Set(ops.map((o) => o.cashier?.name).filter(Boolean))).sort(),
    [ops],
  );

  const filtered = useMemo(
    () => ops.filter(
      (o) => (fCur === 'all' || o.currency === fCur) && (fCashier === 'all' || o.cashier?.name === fCashier),
    ),
    [ops, fCur, fCashier],
  );

  const filterLabel = [
    tab === 'all' ? 'усі типи' : tab === 'BUY' ? 'купівля' : 'продаж',
    fCur === 'all' ? 'усі валюти' : fCur,
    fCashier === 'all' ? 'усі касири' : fCashier,
    date ? `день ${format(new Date(date), 'dd.MM.yyyy')}` : 'останні записи',
  ].join(' · ');

  // Експорт відфільтрованого списку в CSV (BOM + «;» — Excel-ready).
  const exportCsv = () => {
    const head = ['Номер', 'Дата', 'Тип', 'Валюта', 'Кількість', 'Курс', 'Сума UAH', 'Дав (валюта)', 'Дав (сума)', 'Сторно', 'Точка', 'Касир'];
    const rows = filtered.map((o) => [
      o.number, format(new Date(o.createdAt), 'dd.MM.yyyy HH:mm'),
      o.type === 'BUY' ? 'Купівля' : 'Продаж',
      o.currency, o.amount, o.rate, o.totalUah,
      o.payCurrency ?? '', o.payAmount ?? '', o.cancelled ? 'так' : '',
      o.shift?.cashDesk?.exchangePoint?.name ?? '', o.cashier?.name ?? '',
    ]);
    const csv = '﻿' + [head, ...rows]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';'))
      .join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `operations_${format(new Date(), 'yyyyMMdd_HHmm')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // Друк відфільтрованого списку (А4).
  const printList = () => {
    const totalUah = filtered.reduce((s, o) => s + (o.cancelled ? 0 : Number(o.totalUah)), 0);
    const rows = filtered.map((o) => `
      <tr${o.cancelled ? ' class="canc"' : ''}>
        <td>${format(new Date(o.createdAt), 'dd.MM.yy HH:mm')}</td>
        <td>${o.type === 'BUY' ? 'Купівля' : 'Продаж'}${o.cancelled ? ' (сторно)' : ''}</td>
        <td class="b">${o.currency}</td>
        <td class="num">${fmtMoney(o.amount)}</td>
        <td class="num">${fmtRate(o.rate, 2)}</td>
        <td class="num">${fmtMoney(o.totalUah)}</td>
        <td>${o.cashier?.name ?? '—'}</td>
        <td>${o.shift?.cashDesk?.exchangePoint?.name ?? '—'}</td>
      </tr>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Операції</title>
    <style>
      @page { size: A4; margin: 12mm; }
      body { font: 11px/1.4 Arial, sans-serif; color: #111; margin: 0; }
      h1 { font-size: 16px; margin: 0 0 2px; }
      .meta { color: #555; font-size: 11px; margin-bottom: 10px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 1px solid #bbb; padding: 3px 5px; font-size: 10.5px; }
      th { background: #f0f1f3; text-align: left; font-size: 9.5px; text-transform: uppercase; }
      td.num { text-align: right; font-variant-numeric: tabular-nums; }
      td.b { font-weight: 700; }
      tr.canc td { color: #999; text-decoration: line-through; }
      tfoot td { font-weight: 700; border-top: 2px solid #111; }
    </style></head><body>
      <h1>Операції</h1>
      <div class="meta">Фільтр: ${filterLabel} · записів: ${filtered.length} · сформовано ${format(new Date(), 'dd.MM.yyyy HH:mm')}</div>
      <table>
        <thead><tr><th>Дата</th><th>Тип</th><th>Валюта</th><th>Кількість</th><th>Курс</th><th>Сума ₴</th><th>Касир</th><th>Точка</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8" style="text-align:center;color:#888">Немає</td></tr>'}</tbody>
        <tfoot><tr><td colspan="5">Разом гривнею (без сторно)</td><td class="num">${fmtMoney(totalUah)}</td><td colspan="2"></td></tr></tfoot>
      </table>
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

  const tabBtn = (key: 'all' | 'BUY' | 'SELL', label: string, active: string) =>
    <button onClick={() => setTab(key)}
      className={`px-4 py-2 rounded-lg font-medium text-sm ${tab === key ? active : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
      {label}
    </button>;
  const selCls = 'border border-gray-300 rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400';

  return (
    <>
      {historyOp && (
        <EditHistoryModal opId={historyOp.id} opNumber={historyOp.number} onClose={() => setHistoryOp(null)} />
      )}

      <div className="bg-white rounded-xl shadow p-4 space-y-4">
        <div className="flex gap-2 items-center flex-wrap">
          {tabBtn('all', 'Всі', 'bg-blue-700 text-white')}
          {tabBtn('BUY', 'Купівля', 'bg-green-600 text-white')}
          {tabBtn('SELL', 'Продаж', 'bg-red-600 text-white')}

          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className={selCls} title="День (порожньо — останні записи)" />
          {date && (
            <button onClick={() => setDate('')} className="text-xs text-gray-400 hover:text-gray-600">✕ день</button>
          )}

          <select value={fCur} onChange={(e) => setFCur(e.target.value)} className={selCls}>
            <option value="all">Усі валюти</option>
            {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>

          <select value={fCashier} onChange={(e) => setFCashier(e.target.value)} className={selCls}>
            <option value="all">Усі касири</option>
            {cashiers.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>

          <div className="ml-auto flex gap-2">
            <button onClick={printList} disabled={loading || filtered.length === 0}
              className="px-4 py-2 rounded-lg font-medium text-sm border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              🖨 Друк
            </button>
            <button onClick={exportCsv} disabled={loading || filtered.length === 0}
              className="px-4 py-2 rounded-lg font-medium text-sm border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              ⬇ CSV
            </button>
          </div>
        </div>

        <div className="text-xs text-gray-400">Показано: {filtered.length}{ops.length !== filtered.length ? ` з ${ops.length}` : ''}</div>

        {loading ? (
          <div className="text-center py-8 text-gray-400">Завантаження...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="pb-2 pr-4">№</th>
                  <th className="pb-2 pr-4">Дата</th>
                  <th className="pb-2 pr-4">Тип</th>
                  <th className="pb-2 pr-4">Валюта</th>
                  <th className="pb-2 pr-4">Кількість</th>
                  <th className="pb-2 pr-4">Курс</th>
                  <th className="pb-2 pr-4">Сума UAH</th>
                  <th className="pb-2 pr-4">Касир</th>
                  <th className="pb-2 pr-4">Точка</th>
                  <th className="pb-2">Зміни</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={10} className="py-8 text-center text-gray-400">Операцій немає</td></tr>
                )}
                {filtered.map((op) => (
                  <tr key={op.id} className={`border-b hover:bg-gray-50 ${op.cancelled ? 'opacity-40 line-through' : ''}`}>
                    <td className="py-2 pr-4 font-mono text-xs text-gray-500">{op.number}</td>
                    <td className="py-2 pr-4 text-gray-500 whitespace-nowrap">{format(new Date(op.createdAt), 'dd.MM.yy HH:mm')}</td>
                    <td className="py-2 pr-4">
                      <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${op.type === 'BUY' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {op.type === 'BUY' ? 'Купівля' : 'Продаж'}
                      </span>
                    </td>
                    <td className="py-2 pr-4 font-bold">{op.currency}</td>
                    <td className="py-2 pr-4">{fmtNum(op.amount)}</td>
                    <td className="py-2 pr-4">{Number(op.rate).toFixed(2)}</td>
                    <td className="py-2 pr-4">{fmtNum(op.totalUah)}</td>
                    <td className="py-2 pr-4">{op.cashier?.name ?? '—'}</td>
                    <td className="py-2 pr-4">{op.shift?.cashDesk?.exchangePoint?.name ?? '—'}</td>
                    <td className="py-2">
                      <button onClick={() => setHistoryOp({ id: op.id, number: op.number })}
                        className="text-xs text-blue-600 hover:underline whitespace-nowrap">
                        Історія →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
