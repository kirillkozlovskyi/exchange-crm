import { useEffect, useState } from 'react';
import api from '../../api/axios';

type Period = 'daily' | 'weekly' | 'monthly';

export default function FinanceAdmin() {
  const [period, setPeriod] = useState<Period>('daily');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.get(`/finance/${period}`).then(({ data }) => setData(data)).finally(() => setLoading(false));
  }, [period]);

  const periodLabel = { daily: 'За сьогодні', weekly: 'За тиждень', monthly: 'За місяць' };

  return (
    <div className="space-y-4">
      {/* Period selector */}
      <div className="bg-white rounded-xl shadow p-4 flex gap-2">
        {(['daily', 'weekly', 'monthly'] as Period[]).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${
              period === p ? 'bg-blue-700 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {periodLabel[p]}
          </button>
        ))}
      </div>

      {loading && <div className="text-center py-10 text-gray-400">Завантаження...</div>}

      {!loading && data && (
        <>
          {/* Total */}
          <div className="bg-blue-700 text-white rounded-xl shadow p-5">
            <div className="text-sm opacity-80">{periodLabel[period]} — мережа</div>
            <div className="text-3xl font-bold mt-1">{Number(data.totalProfit).toFixed(2)} ₴</div>
            <div className="text-sm opacity-70 mt-1">загальний прибуток</div>
          </div>

          {/* By point */}
          {data.points?.map((pt: any, i: number) => (
            <div key={i} className="bg-white rounded-xl shadow p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-lg">{pt.pointName}</h3>
                <div>
                  <span className="text-green-600 font-bold">{Number(pt.totalProfit).toFixed(2)} ₴</span>
                  <span className="text-xs text-gray-400 ml-2">({pt.operationsCount} оп.)</span>
                </div>
              </div>
              {Object.keys(pt.byCurrency || {}).length > 0 && (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-500 border-b text-left">
                      <th className="pb-1">Валюта</th>
                      <th className="pb-1 text-right">Обсяг</th>
                      <th className="pb-1 text-right">Прибуток</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(pt.byCurrency).map(([cur, d]: any) => (
                      <tr key={cur} className="border-b last:border-0">
                        <td className="py-1.5 font-bold">{cur}</td>
                        <td className="py-1.5 text-right">{Number(d.volume).toFixed(2)}</td>
                        <td className="py-1.5 text-right text-green-600">{Number(d.profit).toFixed(2)} ₴</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
