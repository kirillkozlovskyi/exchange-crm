import { useEffect, useState } from 'react';
import api from '../../api/axios';
import { fmtMoney } from '../../lib/format';

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

  // Експорт для бухгалтерії: точка · валюта · обсяг · прибуток ($ і ₴); підсумок
  // по касах; рядок витрат і чистого прибутку. BOM + «;» — відкривається в Excel.
  const exportCsv = () => {
    if (!data) return;
    const rows: (string | number)[][] = [['Точка', 'Каса/Валюта', 'Обсяг', 'Прибуток $', 'Прибуток ₴']];
    for (const pt of data.points ?? []) {
      for (const [cur, d] of Object.entries<any>(pt.byCurrency ?? {})) {
        rows.push([pt.pointName, cur, Number(d.volume).toFixed(2), Number(d.profitUsd ?? 0).toFixed(2), Number(d.profit).toFixed(2)]);
      }
      for (const dk of pt.byDesk ?? []) {
        rows.push([pt.pointName, `Каса: ${dk.deskName}`, '', Number(dk.profitUsd ?? 0).toFixed(2), Number(dk.profit).toFixed(2)]);
      }
      rows.push([pt.pointName, 'Витрати', '', '', (-Number(pt.expenses ?? 0)).toFixed(2)]);
      rows.push([pt.pointName, 'Чистий прибуток', '', '', Number(pt.netProfit ?? pt.totalProfit).toFixed(2)]);
    }
    rows.push([]);
    rows.push(['Мережа', 'Валовий прибуток', '', Number(data.totalProfitUsd ?? 0).toFixed(2), Number(data.totalProfit).toFixed(2)]);
    rows.push(['Мережа', 'Витрати', '', '', (-Number(data.totalExpenses ?? 0)).toFixed(2)]);
    rows.push(['Мережа', 'Чистий прибуток', '', '', Number(data.totalNetProfit ?? data.totalProfit).toFixed(2)]);
    const csv = '﻿' + rows
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';'))
      .join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `finance_${period}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-4">
      {/* Period selector */}
      <div className="bg-white rounded-xl shadow p-4 flex gap-2 items-center">
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
        <button
          onClick={exportCsv}
          disabled={!data}
          className="ml-auto px-4 py-2 rounded-lg text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          title="Експорт для бухгалтерії (CSV/Excel)"
        >
          ⬇ CSV
        </button>
      </div>

      {loading && <div className="text-center py-10 text-gray-400">Завантаження...</div>}

      {!loading && data && (
        <>
          {/* Total */}
          <div className="bg-blue-700 text-white rounded-xl shadow p-5">
            <div className="text-sm opacity-80">{periodLabel[period]} — мережа</div>
            <div className="text-3xl font-bold mt-1">{Number(data.totalProfitUsd ?? 0).toFixed(2)} $</div>
            <div className="text-sm opacity-70 mt-1">валовий прибуток у доларах</div>
            <div className="flex gap-4 mt-3 pt-3 border-t border-white/20 text-sm">
              <div>
                <div className="opacity-70 text-xs">валовий ₴</div>
                <div className="font-semibold">{fmtMoney(data.totalProfit)} ₴</div>
              </div>
              <div>
                <div className="opacity-70 text-xs">витрати</div>
                <div className="font-semibold">−{fmtMoney(data.totalExpenses ?? 0)} ₴</div>
              </div>
              <div>
                <div className="opacity-70 text-xs">чистий ₴</div>
                <div className="font-semibold">{fmtMoney(data.totalNetProfit ?? data.totalProfit)} ₴</div>
              </div>
            </div>
          </div>

          {/* By point */}
          {data.points?.map((pt: any, i: number) => (
            <div key={i} className="bg-white rounded-xl shadow p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-lg">{pt.pointName}</h3>
                <div className="text-right">
                  <div>
                    <span className={`font-bold ${Number(pt.totalProfitUsd ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {Number(pt.totalProfitUsd ?? 0).toFixed(2)} $
                    </span>
                    <span className="text-xs text-gray-400 ml-2">
                      чистий {fmtMoney(pt.netProfit ?? pt.totalProfit)} ₴ · {pt.operationsCount} оп.
                    </span>
                  </div>
                  {Number(pt.expenses ?? 0) > 0 && (
                    <div className="text-xs text-gray-400 mt-0.5">
                      валовий {fmtMoney(pt.totalProfit)} ₴ − витрати {fmtMoney(pt.expenses)} ₴
                    </div>
                  )}
                </div>
              </div>
              {pt.byDesk?.length > 1 && (
                <div className="mb-3">
                  <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1">По касах</div>
                  <div className="flex flex-wrap gap-2">
                    {pt.byDesk.map((dk: any, di: number) => (
                      <div key={di} className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                        <div className="text-xs text-gray-500">{dk.deskName} · {dk.operationsCount} оп.</div>
                        <div className={`text-sm font-bold ${(dk.profitUsd ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {(dk.profitUsd ?? 0) >= 0 ? '+' : ''}{Number(dk.profitUsd ?? 0).toFixed(2)} $
                          <span className="text-xs font-medium text-gray-400 ml-1.5">
                            {dk.profit >= 0 ? '+' : ''}{fmtMoney(dk.profit)} ₴
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* Розріз по касирах — той самий касир може працювати на різних касах. */}
              {pt.byCashier?.length > 0 && (
                <div className="mb-4">
                  <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1">По касирах</div>
                  <div className="flex flex-wrap gap-2">
                    {pt.byCashier.map((ch: any, ci: number) => (
                      <div key={ci} className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                        <div className="text-xs text-gray-600">{ch.cashierName} · {ch.operationsCount} оп.</div>
                        <div className={`text-sm font-bold ${(ch.profitUsd ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {(ch.profitUsd ?? 0) >= 0 ? '+' : ''}{Number(ch.profitUsd ?? 0).toFixed(2)} $
                          <span className="text-xs font-medium text-gray-400 ml-1.5">
                            {ch.profit >= 0 ? '+' : ''}{fmtMoney(ch.profit)} ₴
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {Object.keys(pt.byCurrency || {}).length > 0 && (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-500 border-b text-left">
                      <th className="pb-1">Валюта</th>
                      <th className="pb-1 text-right">Обсяг</th>
                      <th className="pb-1 text-right">Прибуток $</th>
                      <th className="pb-1 text-right">Прибуток ₴</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(pt.byCurrency).map(([cur, d]: any) => (
                      <tr key={cur} className="border-b last:border-0">
                        <td className="py-1.5 font-bold">{cur}</td>
                        <td className="py-1.5 text-right">{fmtMoney(d.volume)}</td>
                        <td className="py-1.5 text-right text-green-600 font-medium">{Number(d.profitUsd ?? 0).toFixed(2)} $</td>
                        <td className="py-1.5 text-right text-gray-500">{fmtMoney(d.profit)} ₴</td>
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
