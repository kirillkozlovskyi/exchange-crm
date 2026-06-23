import { useEffect, useState } from 'react';
import api from '../../api/axios';
import { WORLD_CURRENCIES } from '../../data/currencyMeta';
import { useCurrencyOrder } from '../../hooks/useCurrencyOrder';

type Currency = { code: string; name: string; active: boolean };
type RateVal = { buy: string; sell: string };
type EditMap = Record<string, RateVal>;

function DragHandle() {
  return (
    <span className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 select-none" title="Перетягни">
      ⠿
    </span>
  );
}

export default function RatesAdmin() {
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [points, setPoints] = useState<any[]>([]);
  const [rates, setRates] = useState<any[]>([]);
  const [pointCurrencies, setPointCurrencies] = useState<Record<number, Set<string>>>({});
  const [editing, setEditing] = useState<EditMap>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadAll = async () => {
    const [c, p, r] = await Promise.all([
      api.get('/currencies'),
      api.get('/exchange-points'),
      api.get('/rates'),
    ]);
    setCurrencies(c.data);
    setPoints(p.data);
    setRates(r.data);

    const entries = await Promise.all(
      p.data.map((pt: any) =>
        api.get(`/exchange-points/${pt.id}/currencies`).then((res) => ({
          id: pt.id,
          codes: new Set<string>(res.data.map((pc: any) => pc.currencyCode as string)),
        }))
      )
    );
    const map: Record<number, Set<string>> = {};
    for (const e of entries) map[e.id] = e.codes;
    setPointCurrencies(map);
  };

  useEffect(() => { loadAll(); }, []);

  const activeCurrencies = currencies.filter((c) => c.active);

  // ── Drag-and-drop order (shared with CurrenciesAdmin via localStorage) ────────
  const { sorted: sortedActive, onDragStart, onDragOver, onDragEnd } = useCurrencyOrder(activeCurrencies);

  const getRate = (pointId: number, currency: string) =>
    rates.find((r) => r.exchangePointId === pointId && r.currency === currency);

  const togglePointCurrency = async (pointId: number, code: string, enabled: boolean) => {
    if (enabled) {
      await api.delete(`/exchange-points/${pointId}/currencies/${code}`);
    } else {
      await api.post(`/exchange-points/${pointId}/currencies`, { currencyCode: code });
    }
    await loadAll();
  };

  const startEdit = (pointId: number, currency: string) => {
    const r = getRate(pointId, currency);
    setEditing((e) => ({
      ...e,
      [`${pointId}-${currency}`]: {
        buy: r ? String(Number(r.buy).toFixed(2)) : '',
        sell: r ? String(Number(r.sell).toFixed(2)) : '',
      },
    }));
  };

  const cancelEdit = (key: string) =>
    setEditing((e) => { const n = { ...e }; delete n[key]; return n; });

  const saveRate = async (pointId: number, currency: string) => {
    const key = `${pointId}-${currency}`;
    const val = editing[key];
    if (!val) return;
    setSaving(key);
    try {
      await api.post('/rates', {
        exchangePointId: pointId,
        currency,
        buy: parseFloat(val.buy),
        sell: parseFloat(val.sell),
      });
      await loadAll();
      cancelEdit(key);
      setSuccess(key);
      setTimeout(() => setSuccess(null), 2000);
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-4">
      {points.map((point) => {
        const ptCodes = pointCurrencies[point.id] ?? new Set<string>();
        // Apply global drag order, filtered to this point's active currencies
        const pointSorted = sortedActive.filter((c) => ptCodes.has(c.code));

        return (
          <div key={point.id} className="bg-white rounded-xl shadow p-4">
            <div className="flex items-center gap-2 mb-3">
              <h3 className="font-semibold text-gray-800">{point.name}</h3>
              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-mono">{point.code}</span>
            </div>

            {/* Toggle currencies */}
            <div className="flex flex-wrap gap-1.5 mb-3 pb-3 border-b">
              {sortedActive.map((cur) => {
                const enabled = ptCodes.has(cur.code);
                return (
                  <button
                    key={cur.code}
                    onClick={() => togglePointCurrency(point.id, cur.code, enabled)}
                    className={`text-xs px-2.5 py-1 rounded-full font-medium border transition ${
                      enabled
                        ? 'bg-blue-700 text-white border-blue-700'
                        : 'bg-white text-gray-400 border-gray-200 hover:border-gray-400'
                    }`}
                  >
                    {cur.code}
                  </button>
                );
              })}
              <span className="text-xs text-gray-400 self-center ml-1">— клік щоб увімкнути/вимкнути</span>
            </div>

            {ptCodes.size === 0 ? (
              <p className="text-sm text-gray-400">Немає активних валют для цієї точки</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b text-xs">
                    <th className="pb-2 w-6"></th>
                    <th className="pb-2 w-28">Валюта</th>
                    <th className="pb-2">Купівля</th>
                    <th className="pb-2">Продаж</th>
                    <th className="pb-2 w-32"></th>
                  </tr>
                </thead>
                <tbody>
                  {pointSorted.map((cur) => {
                    const key = `${point.id}-${cur.code}`;
                    const r = getRate(point.id, cur.code);
                    const ed = editing[key];
                    const isSaved = success === key;
                    const meta = WORLD_CURRENCIES.find((w) => w.code === cur.code);
                    // Find index in global sorted list for drag
                    const globalIdx = sortedActive.findIndex((c) => c.code === cur.code);
                    return (
                      <tr
                        key={cur.code}
                        draggable
                        onDragStart={() => onDragStart(globalIdx)}
                        onDragOver={(e) => onDragOver(e, globalIdx)}
                        onDragEnd={onDragEnd}
                        className="border-b last:border-0 hover:bg-gray-50"
                      >
                        <td className="py-2"><DragHandle /></td>
                        <td className="py-2">
                          <span className="flex items-center gap-1">
                            {meta && <span className="text-base leading-none">{meta.flag}</span>}
                            <span className="font-bold text-gray-800">{cur.code}</span>
                          </span>
                        </td>
                        <td className="py-2">
                          {ed ? (
                            <input type="number" step="0.01" value={ed.buy}
                              onChange={(e) => setEditing((p) => ({ ...p, [key]: { ...p[key], buy: e.target.value } }))}
                              className="w-28 border rounded px-2 py-1 text-right focus:outline-none focus:ring-2 focus:ring-blue-400"
                            />
                          ) : (
                            <span className="text-green-700 font-medium">{r ? Number(r.buy).toFixed(2) : '—'}</span>
                          )}
                        </td>
                        <td className="py-2">
                          {ed ? (
                            <input type="number" step="0.01" value={ed.sell}
                              onChange={(e) => setEditing((p) => ({ ...p, [key]: { ...p[key], sell: e.target.value } }))}
                              className="w-28 border rounded px-2 py-1 text-right focus:outline-none focus:ring-2 focus:ring-blue-400"
                            />
                          ) : (
                            <span className="text-red-600 font-medium">{r ? Number(r.sell).toFixed(2) : '—'}</span>
                          )}
                        </td>
                        <td className="py-2">
                          {ed ? (
                            <div className="flex gap-1">
                              <button onClick={() => saveRate(point.id, cur.code)} disabled={saving === key}
                                className="bg-blue-700 text-white px-2 py-1 rounded text-xs disabled:opacity-50">
                                {saving === key ? '...' : 'Зберегти'}
                              </button>
                              <button onClick={() => cancelEdit(key)}
                                className="bg-gray-200 text-gray-700 px-2 py-1 rounded text-xs">✕</button>
                            </div>
                          ) : (
                            <button onClick={() => startEdit(point.id, cur.code)}
                              className={`text-xs px-2 py-1 rounded ${isSaved ? 'bg-green-100 text-green-700' : 'text-blue-600 hover:bg-blue-50'}`}>
                              {isSaved ? '✓ Збережено' : 'Редагувати'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </div>
  );
}
