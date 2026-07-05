import { useEffect, useState, useMemo } from 'react';
import api from '../../api/axios';
import { format } from 'date-fns';

type Wallet = {
  exchangePointId: number;
  pointName: string;
  pointCode: string;
  balance: number;
};

type UsdtOp = {
  id: number;
  number: string;
  side: 'BUY' | 'SELL';
  usdtAmount: string | number;
  pct: string | number;
  usdValue: string | number;
  settleCurrency: string;
  settleAmount: string | number;
  profitUah: string | number;
  createdAt: string;
  createdBy?: { name: string };
  cashDesk?: { name: string; exchangePoint?: { name: string } };
  shift?: { number: string };
};

type SideFilter = 'all' | 'BUY' | 'SELL';

// Журнал USDT-операцій (керування USDT-банком — на сторінці «Банк»).
export default function UsdtAdmin() {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [ops, setOps] = useState<UsdtOp[]>([]);
  const [loading, setLoading] = useState(true);
  const [side, setSide] = useState<SideFilter>('all');
  const [pointId, setPointId] = useState<number | 'all'>('all');

  const load = () => {
    setLoading(true);
    Promise.all([api.get('/usdt/wallets'), api.get('/usdt')])
      .then(([w, o]) => {
        setWallets(w.data);
        setOps(o.data);
      })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const filtered = ops.filter(
    (o) => (side === 'all' || o.side === side) &&
      (pointId === 'all' || o.cashDesk?.exchangePoint?.name === wallets.find((w) => w.exchangePointId === pointId)?.pointName),
  );

  const totalMargin = useMemo(
    () => filtered.reduce((s, o) => s + Number(o.profitUah), 0),
    [filtered],
  );

  const chip = (active: boolean) =>
    `px-3 py-1 rounded text-sm font-medium transition ${active ? 'bg-white shadow text-teal-700' : 'text-gray-600'}`;

  return (
    <div className="space-y-4">
      {/* Історія операцій */}
      <div className="bg-white rounded-xl shadow p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <h3 className="font-semibold text-lg">₮ USDT — операції</h3>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
              <button onClick={() => setSide('all')} className={chip(side === 'all')}>Усі</button>
              <button onClick={() => setSide('SELL')} className={chip(side === 'SELL')}>Продаж</button>
              <button onClick={() => setSide('BUY')} className={chip(side === 'BUY')}>Купівля</button>
            </div>
            <select value={String(pointId)} onChange={(e) => setPointId(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
              <option value="all">Усі точки</option>
              {wallets.map((w) => <option key={w.exchangePointId} value={w.exchangePointId}>{w.pointName}</option>)}
            </select>
          </div>
        </div>

        <div className="mb-3 text-sm text-gray-600">
          Сумарна маржа:{' '}
          <span className={`font-semibold ${totalMargin >= 0 ? 'text-green-700' : 'text-red-600'}`}>
            {totalMargin >= 0 ? '+' : '−'}{Math.abs(totalMargin).toFixed(2)} ₴
          </span>
        </div>

        {loading ? (
          <div className="text-center py-6 text-gray-400">Завантаження...</div>
        ) : filtered.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-6">Немає записів</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-[11px] text-gray-500 uppercase tracking-wide border-b">
                  <th className="py-1.5 px-2 text-left font-medium">Дата</th>
                  <th className="py-1.5 px-2 text-left font-medium">Точка / Каса</th>
                  <th className="py-1.5 px-2 text-left font-medium">Тип</th>
                  <th className="py-1.5 px-2 text-right font-medium">USDT</th>
                  <th className="py-1.5 px-2 text-right font-medium">%</th>
                  <th className="py-1.5 px-2 text-right font-medium">Готівка</th>
                  <th className="py-1.5 px-2 text-right font-medium">Маржа&nbsp;₴</th>
                  <th className="py-1.5 px-2 text-left font-medium">Касир</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((o) => {
                  const isSell = o.side === 'SELL';
                  return (
                    <tr key={o.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="py-1.5 px-2 text-gray-500 whitespace-nowrap">{format(new Date(o.createdAt), 'dd.MM HH:mm')}</td>
                      <td className="py-1.5 px-2 text-gray-700 whitespace-nowrap">
                        {o.cashDesk?.exchangePoint?.name && <span className="text-gray-400">{o.cashDesk.exchangePoint.name} · </span>}
                        {o.cashDesk?.name}
                      </td>
                      <td className="py-1.5 px-2">
                        <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-teal-100 text-teal-700">
                          {isSell ? 'Продаж' : 'Купівля'}
                        </span>
                      </td>
                      <td className={`py-1.5 px-2 text-right font-medium tabular-nums ${isSell ? 'text-red-600' : 'text-green-600'}`}>
                        {isSell ? '−' : '+'}{Number(o.usdtAmount).toFixed(2)}
                      </td>
                      <td className="py-1.5 px-2 text-right text-gray-500">{Number(o.pct).toFixed(4)}</td>
                      <td className="py-1.5 px-2 text-right text-gray-700 whitespace-nowrap">
                        {Number(o.settleAmount).toFixed(2)} {o.settleCurrency}
                      </td>
                      <td className={`py-1.5 px-2 text-right font-medium ${Number(o.profitUah) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {Number(o.profitUah) >= 0 ? '+' : '−'}{Math.abs(Number(o.profitUah)).toFixed(2)}
                      </td>
                      <td className="py-1.5 px-2 text-gray-500 whitespace-nowrap">{o.createdBy?.name || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
