import { useEffect, useState } from 'react';
import api from '../../api/axios';
import { format } from 'date-fns';

type Filter = 'all' | 'IN' | 'OUT';

export default function CashMovementsAdmin() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    const q = filter === 'all' ? '' : `?direction=${filter}`;
    setLoading(true);
    api.get(`/cash-movements${q}`).then(({ data }) => setItems(data)).finally(() => setLoading(false));
  }, [filter]);

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'all', label: 'Усі' },
    { key: 'IN', label: 'Підкріплення' },
    { key: 'OUT', label: 'Інкасації' },
  ];

  return (
    <div className="bg-white rounded-xl shadow p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h3 className="font-semibold text-lg">Рух готівки</h3>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1 rounded text-sm font-medium transition ${
                filter === f.key ? 'bg-white shadow text-blue-700' : 'text-gray-600'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-10 text-gray-400">Завантаження...</div>
      ) : items.length === 0 ? (
        <p className="text-gray-400 text-sm text-center py-6">Немає записів</p>
      ) : (
        <div className="space-y-2">
          {items.map((m) => {
            const isIn = m.direction === 'IN';
            return (
              <div key={m.id} className="flex items-center justify-between py-2 border-b last:border-0">
                <div>
                  <div className="text-sm font-medium flex items-center gap-2">
                    <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
                      isIn ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700'
                    }`}>
                      {isIn ? 'Підкріплення' : 'Інкасація'}
                    </span>
                    {m.cashDesk?.exchangePoint?.name} — {m.cashDesk?.name}
                  </div>
                  <div className="text-xs text-gray-500">
                    <span className={`font-semibold ${isIn ? 'text-green-700' : 'text-purple-700'}`}>
                      {isIn ? '+' : '−'}{Number(m.amount).toFixed(2)} {m.currency}
                    </span>
                    {' · '}{m.createdBy?.name}
                    {m.source && <> · {m.source}</>}
                    {m.shift?.number && <> · зміна {m.shift.number}</>}
                  </div>
                  {m.note && <div className="text-xs text-gray-400 italic">{m.note}</div>}
                </div>
                <div className="text-right">
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-600">
                    {m.number}
                  </span>
                  <div className="text-xs text-gray-400 mt-1">
                    {format(new Date(m.createdAt), 'dd.MM HH:mm')}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
