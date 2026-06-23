import { useState, useEffect } from 'react';
import api from '../../api/axios';
import { format, differenceInMinutes } from 'date-fns';

function duration(openedAt: string) {
  const mins = differenceInMinutes(new Date(), new Date(openedAt));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h} год ${m} хв` : `${m} хв`;
}

export default function ActiveShiftsAdmin() {
  const [shifts, setShifts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () =>
    api.get('/shifts/active')
      .then(({ data }) => setShifts(data))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  // Групуємо по точках
  const byPoint: Record<string, any[]> = {};
  for (const s of shifts) {
    const name = s.cashDesk?.exchangePoint?.name ?? 'Невідома точка';
    if (!byPoint[name]) byPoint[name] = [];
    byPoint[name].push(s);
  }

  if (loading) return <div className="text-center py-10 text-gray-400">Завантаження...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-700">
          Активні зміни
          <span className="ml-2 bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-full">
            {shifts.length}
          </span>
        </h3>
        <button onClick={load} className="text-xs text-blue-600 hover:underline">Оновити</button>
      </div>

      {shifts.length === 0 ? (
        <div className="bg-white rounded-xl shadow p-8 text-center text-gray-400">
          Немає відкритих змін
        </div>
      ) : (
        Object.entries(byPoint).map(([pointName, pointShifts]) => (
          <div key={pointName} className="bg-white rounded-xl shadow overflow-hidden">
            <div className="bg-blue-700 text-white px-4 py-2 text-sm font-semibold">
              {pointName}
            </div>
            <div className="divide-y">
              {pointShifts.map((s) => (
                <div key={s.id} className="px-4 py-3 flex items-center gap-4">
                  <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-800">{s.cashDesk?.name}</div>
                    <div className="text-sm text-gray-500">
                      Касир: <span className="font-medium text-gray-700">{s.openedBy?.name}</span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-xs text-gray-400">
                      з {format(new Date(s.openedAt), 'HH:mm')}
                    </div>
                    <div className="text-xs text-blue-600 font-medium">
                      {duration(s.openedAt)}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-xs text-gray-400">Операцій</div>
                    <div className="font-semibold text-gray-800">{s._count?.operations ?? 0}</div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-xs text-gray-400">Зміна</div>
                    <div className="text-xs font-mono text-gray-500">{s.number}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
