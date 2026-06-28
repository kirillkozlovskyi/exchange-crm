import { useState, useEffect } from 'react';
import api from '../../api/axios';
import { format } from 'date-fns';

type Recon = {
  id: number;
  createdAt: string;
  expected: Record<string, number>;
  actual: Record<string, number>;
  hasDiscrepancy: boolean;
  note?: string | null;
  shift?: { number: string } | null;
  createdBy?: { name: string } | null;
  cashDesk?: { name: string; exchangePoint?: { name: string } | null } | null;
};

// Рядки по валютах однієї звірки (об'єднання валют expected/actual).
function reconRows(r: Recon) {
  const curs = Array.from(new Set([...Object.keys(r.expected || {}), ...Object.keys(r.actual || {})]));
  return curs.map((cur) => {
    const expected = Number(r.expected?.[cur] ?? 0);
    const actual = Number(r.actual?.[cur] ?? 0);
    const diff = actual - expected;
    return { cur, expected, actual, diff, hasDiff: Math.abs(diff) >= 0.01 };
  });
}

export default function ReconciliationsAdmin() {
  const [items, setItems] = useState<Recon[]>([]);
  const [loading, setLoading] = useState(true);
  const [onlyDiff, setOnlyDiff] = useState(false);

  const load = () =>
    api.get('/reconciliations')
      .then(({ data }) => setItems(data))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  const shown = onlyDiff ? items.filter((r) => r.hasDiscrepancy) : items;

  // Групуємо по точці → касі
  const byDesk: Record<string, Recon[]> = {};
  for (const r of shown) {
    const point = r.cashDesk?.exchangePoint?.name ?? 'Невідома точка';
    const desk = r.cashDesk?.name ?? 'Каса';
    const key = `${point} · ${desk}`;
    (byDesk[key] ??= []).push(r);
  }

  if (loading) return <div className="text-center py-10 text-gray-400">Завантаження...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-700">
          Звірки залишку
          <span className="ml-2 bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full">{items.length}</span>
        </h3>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
            <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} />
            лише з розбіжностями
          </label>
          <button onClick={load} className="text-xs text-blue-600 hover:underline">Оновити</button>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="bg-white rounded-xl shadow p-8 text-center text-gray-400">Звірок поки немає</div>
      ) : (
        Object.entries(byDesk).map(([deskKey, list]) => (
          <div key={deskKey} className="bg-white rounded-xl shadow overflow-hidden">
            <div className="bg-blue-700 text-white px-4 py-2 text-sm font-semibold flex items-center justify-between">
              <span>{deskKey}</span>
              <span className="text-blue-100 text-xs">{list.length} звірок</span>
            </div>
            <div className="divide-y">
              {list.map((r) => {
                const rows = reconRows(r);
                return (
                  <div key={r.id} className="px-4 py-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm text-gray-600">
                        <span className="font-semibold text-gray-800">{format(new Date(r.createdAt), 'dd.MM HH:mm')}</span>
                        {r.createdBy?.name && <span className="text-gray-400"> · {r.createdBy.name}</span>}
                        {r.shift?.number && <span className="text-gray-400"> · зміна #{r.shift.number}</span>}
                      </div>
                      {r.hasDiscrepancy ? (
                        <span className="text-xs font-semibold text-red-600 bg-red-50 rounded-full px-2.5 py-0.5">розбіжність</span>
                      ) : (
                        <span className="text-xs font-semibold text-green-600 bg-green-50 rounded-full px-2.5 py-0.5">збіглося</span>
                      )}
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-xs text-gray-400 border-b">
                            <th className="pb-1 text-left">Валюта</th>
                            <th className="pb-1 text-right">Розрахунково</th>
                            <th className="pb-1 text-right">Фактично</th>
                            <th className="pb-1 text-right">Різниця</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((row) => (
                            <tr key={row.cur} className={`border-b last:border-0 ${row.hasDiff ? 'bg-red-50' : ''}`}>
                              <td className="py-1.5 font-bold text-gray-800">{row.cur}</td>
                              <td className="py-1.5 text-right text-gray-500">{row.expected.toFixed(2)}</td>
                              <td className="py-1.5 text-right font-medium text-gray-700">{row.actual.toFixed(2)}</td>
                              <td className={`py-1.5 text-right font-semibold ${
                                !row.hasDiff ? 'text-gray-300' : row.diff > 0 ? 'text-green-600' : 'text-red-600'
                              }`}>
                                {row.hasDiff ? (row.diff > 0 ? '+' : '') + row.diff.toFixed(2) : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {r.note && <p className="text-xs text-gray-400 mt-1.5">Примітка: {r.note}</p>}
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
