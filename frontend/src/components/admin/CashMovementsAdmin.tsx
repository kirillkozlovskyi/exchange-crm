import { useEffect, useState, useMemo } from 'react';
import api from '../../api/axios';
import { format } from 'date-fns';

type Filter = 'all' | 'IN' | 'OUT';

type Movement = {
  id: number;
  number: string;
  direction: 'IN' | 'OUT';
  currency: string;
  amount: string | number;
  source?: string;
  note?: string;
  createdAt: string;
  createdBy?: { name: string };
  cashDesk?: { name: string; exchangePoint?: { name: string } };
  shift?: { number: string };
};

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Усі' },
  { key: 'IN', label: 'Підкріплення' },
  { key: 'OUT', label: 'Інкасації' },
];

// Групуємо рухи по календарних днях (найновіший день — першим).
function groupByDay(items: Movement[]) {
  const map = new Map<string, Movement[]>();
  for (const m of items) {
    const key = format(new Date(m.createdAt), 'yyyy-MM-dd');
    (map.get(key) ?? map.set(key, []).get(key)!).push(m);
  }
  return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
}

export default function CashMovementsAdmin() {
  const [items, setItems] = useState<Movement[]>([]);
  const [currencies, setCurrencies] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [dir, setDir] = useState<Filter>('all');
  const [cur, setCur] = useState<string>('all');

  // Тягнемо всі рухи одразу — напрям/валюту фільтруємо на клієнті.
  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get('/cash-movements'),
      api.get('/currencies').catch(() => ({ data: [] })),
    ])
      .then(([mv, cc]) => {
        setItems(mv.data);
        setCurrencies((cc.data as any[]).map((c) => c.code));
      })
      .finally(() => setLoading(false));
  }, []);

  // Повний перелік валют для фільтру: довідник валют + ті, що вже трапились у рухах.
  const curOptions = useMemo(() => {
    const set = new Set<string>([...currencies, ...items.map((m) => m.currency)]);
    return Array.from(set).sort((a, b) => (a === 'UAH' ? -1 : b === 'UAH' ? 1 : a.localeCompare(b)));
  }, [currencies, items]);

  const filtered = items.filter(
    (m) => (dir === 'all' || m.direction === dir) && (cur === 'all' || m.currency === cur),
  );
  const days = groupByDay(filtered);

  // Підсумок по валютах у відфільтрованому наборі (IN − OUT).
  const totals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const m of filtered) {
      const v = Number(m.amount) * (m.direction === 'IN' ? 1 : -1);
      t[m.currency] = (t[m.currency] ?? 0) + v;
    }
    return Object.entries(t).filter(([, v]) => Math.abs(v) > 0.005);
  }, [filtered]);

  const chip = (active: boolean) =>
    `px-3 py-1 rounded text-sm font-medium transition ${
      active ? 'bg-white shadow text-blue-700' : 'text-gray-600 hover:text-gray-800'
    }`;

  return (
    <div className="bg-white rounded-xl shadow p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h3 className="font-semibold text-lg">🏦 Рух готівки</h3>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
            {FILTERS.map((f) => (
              <button key={f.key} onClick={() => setDir(f.key)} className={chip(dir === f.key)}>
                {f.label}
              </button>
            ))}
          </div>
          <select
            value={cur}
            onChange={(e) => setCur(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">Усі валюти</option>
            {curOptions.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Підсумок по валютах */}
      {totals.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {totals.map(([c, v]) => (
            <span key={c} className="text-xs px-2.5 py-1 rounded-lg bg-gray-50 border border-gray-200">
              {c}: <span className={`font-semibold ${v >= 0 ? 'text-green-700' : 'text-purple-700'}`}>
                {v >= 0 ? '+' : '−'}{Math.abs(v).toFixed(2)}
              </span>
            </span>
          ))}
        </div>
      )}

      {loading ? (
        <div className="text-center py-10 text-gray-400">Завантаження...</div>
      ) : days.length === 0 ? (
        <p className="text-gray-400 text-sm text-center py-6">Немає записів</p>
      ) : (
        <div className="space-y-6">
          {days.map(([day, list]) => (
            <div key={day}>
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                {format(new Date(day), 'dd.MM.yyyy')} · {list.length} запис{list.length === 1 ? '' : list.length < 5 ? 'и' : 'ів'}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="text-[11px] text-gray-500 uppercase tracking-wide border-b">
                      <th className="py-1.5 px-2 text-left font-medium">Час</th>
                      <th className="py-1.5 px-2 text-left font-medium">Тип</th>
                      <th className="py-1.5 px-2 text-left font-medium">Точка / Каса</th>
                      <th className="py-1.5 px-2 text-right font-medium">Сума</th>
                      <th className="py-1.5 px-2 text-left font-medium">Вал.</th>
                      <th className="py-1.5 px-2 text-left font-medium">Джерело</th>
                      <th className="py-1.5 px-2 text-left font-medium">Касир</th>
                      <th className="py-1.5 px-2 text-left font-medium">№ / Примітка</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((m) => {
                      const isIn = m.direction === 'IN';
                      return (
                        <tr key={m.id} className="border-b last:border-0 hover:bg-gray-50">
                          <td className="py-1.5 px-2 text-gray-500 whitespace-nowrap">
                            {format(new Date(m.createdAt), 'HH:mm')}
                          </td>
                          <td className="py-1.5 px-2">
                            <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
                              isIn ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700'
                            }`}>
                              {isIn ? 'Підкріплення' : 'Інкасація'}
                            </span>
                          </td>
                          <td className="py-1.5 px-2 text-gray-700 whitespace-nowrap">
                            {m.cashDesk?.exchangePoint?.name && (
                              <span className="text-gray-400">{m.cashDesk.exchangePoint.name} · </span>
                            )}
                            {m.cashDesk?.name}
                          </td>
                          <td className={`py-1.5 px-2 text-right font-semibold tabular-nums whitespace-nowrap ${
                            isIn ? 'text-green-700' : 'text-purple-700'
                          }`}>
                            {isIn ? '+' : '−'}{Number(m.amount).toFixed(2)}
                          </td>
                          <td className="py-1.5 px-2 text-gray-600">{m.currency}</td>
                          <td className="py-1.5 px-2 text-gray-500">{m.source || '—'}</td>
                          <td className="py-1.5 px-2 text-gray-500 whitespace-nowrap">{m.createdBy?.name || '—'}</td>
                          <td className="py-1.5 px-2 text-gray-400">
                            <span className="text-gray-500">{m.number}</span>
                            {m.note && <span className="italic"> · {m.note}</span>}
                            {m.shift?.number && <span className="text-gray-300"> · зміна {m.shift.number}</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
