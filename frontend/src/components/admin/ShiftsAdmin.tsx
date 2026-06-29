import { useEffect, useState } from 'react';
import api from '../../api/axios';
import { format } from 'date-fns';
import { computeCurrentBalance } from '../../lib/balance';
import { applyCashMovements } from '../../lib/cash-movements';
import { netTransfers } from '../../lib/transfers';

const STATUS: Record<string, { label: string; cls: string }> = {
  OPEN: { label: 'Відкрита', cls: 'bg-green-100 text-green-700' },
  CLOSED: { label: 'Закрита', cls: 'bg-gray-100 text-gray-600' },
};

const num = (v: any) => Number(v ?? 0);
const fmt = (v: any) => num(v).toLocaleString('uk-UA', { maximumFractionDigits: 2 });

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3">
      <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
        {title}{count != null && <span className="text-gray-400 font-normal"> · {count}</span>}
      </h4>
      {children}
    </div>
  );
}

// ── Деталі однієї зміни ──────────────────────────────────────────────────────
function ShiftDetail({ shiftId }: { shiftId: number }) {
  const [d, setD] = useState<any>(null);

  useEffect(() => {
    api.get(`/shifts/${shiftId}`).then(({ data }) => setD(data)).catch(() => setD(null));
  }, [shiftId]);

  if (!d) return <div className="text-sm text-gray-400 py-3 px-1">Завантаження деталей...</div>;

  const closed = d.status === 'CLOSED';
  const start: Record<string, number> = d.startBalance || {};
  const ops: any[] = d.operations || [];
  const moves: any[] = d.cashMovements || [];
  const transfers: any[] = d.confirmedTransfers || [];
  const recons: any[] = d.reconciliations || [];

  // Очікуваний залишок: для закритих — збережений calcBalance; для відкритих — рахуємо живий.
  const expected: Record<string, number> = closed
    ? (d.calcBalance || {})
    : (() => {
        const b = applyCashMovements(computeCurrentBalance(start, ops), moves);
        const net = netTransfers(transfers, d.cashDeskId);
        for (const [c, a] of Object.entries(net)) b[c] = (b[c] ?? 0) + a;
        return b;
      })();
  const actual: Record<string, number> | null = closed ? (d.endBalance || {}) : null;

  const currencies = Array.from(new Set([
    'UAH',
    ...Object.keys(start), ...Object.keys(expected), ...(actual ? Object.keys(actual) : []),
  ]));

  return (
    <div className="bg-gray-50 border-t border-gray-200 p-3 space-y-3">
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
          <div className="text-sm text-gray-600 mt-2 pt-2 border-t">
            Прибуток зміни: <span className={`font-bold ${num(d.profit) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {num(d.profit) >= 0 ? '+' : ''}{fmt(d.profit)} ₴
            </span>
          </div>
        )}
      </Section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        {/* Операції */}
        <Section title="Операції" count={ops.length}>
          {ops.length === 0 ? <p className="text-gray-400 text-sm py-2">Немає</p> : (
            <div className="overflow-auto max-h-72">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white">
                  <tr className="text-xs text-gray-400 border-b">
                    <th className="text-left pb-1">Час</th><th className="text-left pb-1">Тип</th>
                    <th className="text-right pb-1">Сума</th><th className="text-right pb-1">Курс</th><th className="text-right pb-1">UAH</th>
                  </tr>
                </thead>
                <tbody>
                  {[...ops].reverse().map((op) => (
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

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
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-800">#{s.number}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.cls}`}>{st.label}</span>
                      <span className="text-xs text-gray-500">
                        {s.cashDesk?.exchangePoint?.name} · {s.cashDesk?.name}
                      </span>
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {s.openedBy?.name} · відкрито {format(new Date(s.openedAt), 'dd.MM.yyyy HH:mm')}
                      {s.closedAt && <> · закрито {format(new Date(s.closedAt), 'HH:mm')}</>}
                      {' · '}{s._count?.operations ?? 0} оп. · {s._count?.cashMovements ?? 0} рух · {s._count?.reconciliations ?? 0} звір.
                    </div>
                  </div>
                  {s.status === 'CLOSED' && (
                    <span className={`text-sm font-bold flex-shrink-0 ${num(s.profit) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {num(s.profit) >= 0 ? '+' : ''}{fmt(s.profit)} ₴
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
