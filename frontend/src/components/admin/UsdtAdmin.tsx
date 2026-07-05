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

// Глобальний банк USDT — єдине джерело для всіх кас.
function GlobalCard({
  globalBalance, onSaved,
}: {
  globalBalance: number;
  onSaved: () => void;
}) {
  const [balanceRaw, setBalanceRaw] = useState(String(globalBalance));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [confirm, setConfirm] = useState(false);

  // Тримаємо поле синхронним із фактичним балансом банку (після завантаження/збереження).
  useEffect(() => { setBalanceRaw(String(globalBalance)); }, [globalBalance]);

  const newBalance = parseFloat(balanceRaw);
  const valid = !Number.isNaN(newBalance);
  const delta = valid ? newBalance - globalBalance : 0;
  const changed = valid && Math.abs(delta) > 1e-9;
  const wouldGoNegative = valid && newBalance < 0;

  const applyAdjust = async () => {
    if (!changed) return;
    setBusy(true); setMsg('');
    try {
      // API приймає дельту; поле — цільовий баланс, тож шлемо різницю.
      await api.post('/usdt/global/adjust', { delta });
      setMsg('Баланс оновлено'); setConfirm(false); onSaved();
    } catch (e: any) {
      setMsg(e.response?.data?.message ?? 'Помилка');
      setConfirm(false);
    } finally { setBusy(false); }
  };

  return (
    <div className="bg-white rounded-xl shadow p-5">
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <h3 className="font-semibold text-lg">₮ USDT — глобальний банк</h3>
        <div className="text-right">
          <div className="text-xs text-gray-400">Баланс глобального банку</div>
          <div className="font-bold text-teal-700 text-lg">{globalBalance.toFixed(4)} USDT</div>
        </div>
      </div>

      <p className="text-xs text-gray-400 mb-3">
        Єдине джерело USDT для всіх кас — касири беруть наявність напряму з глобального банку.
      </p>

      <div>
        <div className="text-xs text-gray-500 mb-1">Баланс банку (коригування)</div>
        <div className="flex gap-1.5 max-w-md">
          <input type="number" step="0.0001" value={balanceRaw} onChange={(e) => setBalanceRaw(e.target.value)}
            placeholder="0.0000"
            className="flex-1 border border-gray-300 rounded px-2 py-1 text-right focus:outline-none focus:ring-2 focus:ring-teal-500" />
          <button onClick={() => changed && setConfirm(true)} disabled={busy || !changed}
            className="px-4 py-1 rounded bg-teal-600 hover:bg-teal-700 text-white font-semibold text-sm disabled:opacity-50">
            Зберегти
          </button>
        </div>
        {msg && <div className="text-xs text-gray-500 mt-1.5">{msg}</div>}
      </div>

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3" onClick={() => setConfirm(false)}>
          <div className="bg-white rounded shadow-xl w-full max-w-sm p-4" onClick={(e) => e.stopPropagation()}>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Підтвердження коригування</div>
            <p className="text-sm text-gray-700">
              Встановити баланс глобального банку.
            </p>
            <p className="text-sm text-gray-500 mt-1">
              Баланс: <span className="font-medium">{globalBalance.toFixed(4)}</span> →{' '}
              <span className={`font-semibold ${wouldGoNegative ? 'text-red-600' : 'text-teal-700'}`}>{valid ? newBalance.toFixed(4) : '—'}</span> USDT
              {changed && <span className="text-gray-400"> ({delta > 0 ? '+' : '−'}{Math.abs(delta).toFixed(4)})</span>}
            </p>
            {wouldGoNegative && (
              <p className="text-xs text-red-600 bg-red-50 rounded px-2 py-1.5 mt-2">
                Баланс не може бути відʼємним.
              </p>
            )}
            <div className="flex gap-2 mt-4">
              <button onClick={() => setConfirm(false)}
                className="flex-1 py-1.5 rounded border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50">
                Скасувати
              </button>
              <button onClick={applyAdjust} disabled={busy || wouldGoNegative}
                className="flex-1 py-1.5 rounded bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold disabled:opacity-50">
                {busy ? 'Збереження...' : 'Підтвердити'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Окремі швидкі суми для USDT-операцій (кнопки −/+ у вікні каси).
function UsdtQuickAmountsSettings() {
  const [amounts, setAmounts] = useState<number[]>([]);
  const [newVal, setNewVal] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get('/settings/usdt-quick-amounts').then(({ data }) => setAmounts(data)).catch(() => {});
  }, []);

  const save = async (next: number[]) => {
    setSaving(true);
    try {
      await api.put('/settings/usdt-quick-amounts', { amounts: next });
      setAmounts([...next].sort((a, b) => a - b));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally { setSaving(false); }
  };

  const handleAdd = () => {
    const v = parseFloat(newVal);
    if (!v || v <= 0 || amounts.includes(v)) { setNewVal(''); return; }
    save([...amounts, v]);
    setNewVal('');
  };

  return (
    <div className="bg-white rounded-xl shadow p-5">
      <h3 className="font-semibold text-lg">⚡ Швидкі суми USDT</h3>
      <p className="text-xs text-gray-400 mt-0.5 mb-3">Кнопки −/+ для поля «Сума USDT» у вікні операції каси.</p>

      <div className="flex flex-wrap gap-2 mb-3">
        {amounts.map((v) => (
          <div key={v} className="flex items-center gap-1 bg-teal-50 border border-teal-200 rounded-lg px-3 py-1.5">
            <span className="font-semibold text-teal-800 text-sm">{v}</span>
            <button onClick={() => save(amounts.filter((a) => a !== v))}
              className="text-teal-300 hover:text-red-500 transition font-bold text-base leading-none ml-1">×</button>
          </div>
        ))}
        {amounts.length === 0 && <span className="text-gray-400 text-sm italic">Список порожній</span>}
      </div>

      <div className="flex gap-2 max-w-md">
        <input type="number" min="1" value={newVal}
          onChange={(e) => setNewVal(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          placeholder="Нова сума"
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
        <button onClick={handleAdd} disabled={saving || !newVal}
          className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition">
          Додати
        </button>
      </div>
      {saved && <p className="text-green-600 text-sm mt-2">✓ Збережено</p>}
    </div>
  );
}

export default function UsdtAdmin() {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [ops, setOps] = useState<UsdtOp[]>([]);
  const [config, setConfig] = useState<{ source: 'POINT' | 'GLOBAL'; globalBalance: number }>({ source: 'POINT', globalBalance: 0 });
  const [loading, setLoading] = useState(true);
  const [side, setSide] = useState<SideFilter>('all');
  const [pointId, setPointId] = useState<number | 'all'>('all');

  const load = () => {
    setLoading(true);
    Promise.all([api.get('/usdt/wallets'), api.get('/usdt'), api.get('/usdt/config')])
      .then(([w, o, c]) => {
        setWallets(w.data);
        setOps(o.data);
        setConfig({ source: c.data.source, globalBalance: Number(c.data.globalBalance) });
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
      {/* Глобальний банк — єдине джерело USDT */}
      <GlobalCard
        globalBalance={config.globalBalance}
        onSaved={load}
      />

      {/* Окремі швидкі суми для USDT-операцій */}
      <UsdtQuickAmountsSettings />

      {/* Історія операцій */}
      <div className="bg-white rounded-xl shadow p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <h3 className="font-semibold text-lg">USDT-операції</h3>
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
          Сумарна маржа: <span className="font-semibold text-green-700">+{totalMargin.toFixed(2)} ₴</span>
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
                      <td className="py-1.5 px-2 text-right font-medium text-green-600">+{Number(o.profitUah).toFixed(2)}</td>
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
