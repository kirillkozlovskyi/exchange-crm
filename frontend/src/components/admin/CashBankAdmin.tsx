import { useEffect, useState } from 'react';
import api from '../../api/axios';
import { fmtMoney } from '../../lib/format';
import { format } from 'date-fns';
import CompanyBalanceCard from './CompanyBalanceCard';
import UsdtBankSection from './UsdtBankSection';

type Balances = { currencies: { currency: string; amount: number }[]; usdt: number };
type Movement = {
  id: number;
  type: string;
  currency: string;
  delta: string | number;
  note?: string | null;
  createdAt: string;
  createdBy?: { name: string };
  cashDesk?: { name: string; exchangePoint?: { name: string } } | null;
};

const TYPE_LABEL: Record<string, string> = {
  DEPOSIT: 'Депозит',
  WITHDRAW: 'Зняття',
  REPLENISH: 'Підкріплення каси',
  COLLECT: 'Інкасація в банк',
};

export default function CashBankAdmin() {
  const [balances, setBalances] = useState<Balances>({ currencies: [], usdt: 0 });
  const [movements, setMovements] = useState<Movement[]>([]);
  const [currencies, setCurrencies] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0); // для CompanyBalanceCard

  const [currency, setCurrency] = useState('UAH');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = () => {
    setLoading(true);
    setRefreshKey((k) => k + 1);
    Promise.all([
      api.get('/cash-bank'),
      api.get('/cash-bank/movements'),
      api.get('/currencies'),
    ])
      .then(([b, m, c]) => {
        setBalances(b.data);
        setMovements(m.data);
        setCurrencies(['UAH', ...c.data.filter((x: any) => x.active).map((x: any) => x.code)]);
      })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const apply = async (kind: 'deposit' | 'withdraw') => {
    const amt = parseFloat(amount) || 0;
    if (!amt) return;
    setBusy(true); setMsg('');
    try {
      await api.post(`/cash-bank/${kind}`, { currency, amount: amt });
      setAmount(''); setMsg(kind === 'deposit' ? 'Додано в банк' : 'Знято з банку');
      load();
    } catch (e: any) {
      setMsg(e.response?.data?.message ?? 'Помилка');
    } finally { setBusy(false); }
  };

  const uniqCurrencies = Array.from(new Set([...currencies, ...balances.currencies.map((c) => c.currency)]));

  return (
    <div className="space-y-4">
      {/* Загальний баланс компанії */}
      <CompanyBalanceCard refreshKey={refreshKey} />

      {/* Баланси банку */}
      <div className="bg-white rounded-xl shadow p-5">
        <h3 className="font-semibold text-lg mb-3">🏦 Банк компанії — готівка</h3>
        {loading ? (
          <div className="text-center py-6 text-gray-400">Завантаження...</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {balances.currencies.length === 0 && (
              <span className="text-gray-400 text-sm italic">Банк порожній</span>
            )}
            {balances.currencies.map((c) => (
              <div key={c.currency} className="border border-gray-200 rounded-lg px-4 py-2 min-w-[120px]">
                <div className="text-xs text-gray-400">{c.currency}</div>
                <div className="font-bold text-gray-800 text-lg tabular-nums">{fmtMoney(c.amount)}</div>
              </div>
            ))}
            {/* USDT — частина банку, візуально відділено */}
            <div className="border border-teal-200 bg-teal-50 rounded-lg px-4 py-2 min-w-[120px]">
              <div className="text-xs text-teal-500">₮ USDT <span className="text-teal-400">(гаманець)</span></div>
              <div className="font-bold text-teal-700 text-lg tabular-nums">{balances.usdt.toFixed(4)}</div>
            </div>
          </div>
        )}

        {/* Депозит / зняття */}
        <div className="mt-4 border-t pt-3">
          <div className="text-xs text-gray-500 mb-1">Депозит / зняття готівки (ззовні)</div>
          <div className="flex gap-2 flex-wrap items-center max-w-2xl">
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
              {uniqCurrencies.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="flex-1 min-w-[140px] border border-gray-300 rounded px-2 py-1.5 text-right text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            <button onClick={() => apply('deposit')} disabled={busy || !amount}
              className="px-4 py-1.5 rounded bg-green-100 text-green-700 font-semibold text-sm hover:bg-green-200 disabled:opacity-50">+ Депозит</button>
            <button onClick={() => apply('withdraw')} disabled={busy || !amount}
              className="px-4 py-1.5 rounded bg-red-100 text-red-700 font-semibold text-sm hover:bg-red-200 disabled:opacity-50">− Зняти</button>
          </div>
          {msg && <div className="text-xs text-gray-500 mt-1.5">{msg}</div>}
          <p className="text-xs text-gray-400 mt-2">
            Підкріплення/інкасація кас із джерелом «Банк» рухають цей баланс автоматично. USDT-банк — нижче на цій сторінці.
          </p>
        </div>
      </div>

      {/* USDT — частина банку: керування гаманцем + швидкі суми */}
      <UsdtBankSection />

      {/* Журнал рухів банку */}
      <div className="bg-white rounded-xl shadow p-5">
        <h3 className="font-semibold text-lg mb-3">Рухи банку</h3>
        {movements.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-6">Немає записів</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-[11px] text-gray-500 uppercase tracking-wide border-b">
                  <th className="py-1.5 px-2 text-left font-medium">Дата</th>
                  <th className="py-1.5 px-2 text-left font-medium">Тип</th>
                  <th className="py-1.5 px-2 text-left font-medium">Каса</th>
                  <th className="py-1.5 px-2 text-right font-medium">Сума</th>
                  <th className="py-1.5 px-2 text-left font-medium">Хто</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => {
                  const d = Number(m.delta);
                  return (
                    <tr key={m.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="py-1.5 px-2 text-gray-500 whitespace-nowrap">{format(new Date(m.createdAt), 'dd.MM HH:mm')}</td>
                      <td className="py-1.5 px-2 text-gray-700 whitespace-nowrap">{TYPE_LABEL[m.type] ?? m.type}</td>
                      <td className="py-1.5 px-2 text-gray-500 whitespace-nowrap">
                        {m.cashDesk ? `${m.cashDesk.exchangePoint?.name ?? ''} · ${m.cashDesk.name}` : '—'}
                      </td>
                      <td className={`py-1.5 px-2 text-right font-medium tabular-nums whitespace-nowrap ${d >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {d >= 0 ? '+' : '−'}{fmtMoney(Math.abs(d))} {m.currency}
                      </td>
                      <td className="py-1.5 px-2 text-gray-500 whitespace-nowrap">{m.createdBy?.name ?? '—'}</td>
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
