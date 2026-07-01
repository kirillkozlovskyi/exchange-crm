import { useEffect, useState, useMemo } from 'react';
import api from '../../api/axios';
import { format } from 'date-fns';

type Wallet = {
  exchangePointId: number;
  pointName: string;
  pointCode: string;
  balance: number;
  buyPct: number;
  sellPct: number;
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

// Глобальний банк USDT + вибір джерела для операцій кас.
function GlobalCard({
  source, globalBalance, onSetSource, onSaved,
}: {
  source: 'POINT' | 'GLOBAL';
  globalBalance: number;
  onSetSource: (s: 'POINT' | 'GLOBAL') => void;
  onSaved: () => void;
}) {
  const [adjust, setAdjust] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const applyAdjust = async (sign: 1 | -1) => {
    const delta = (parseFloat(adjust) || 0) * sign;
    if (!delta) return;
    setBusy(true); setMsg('');
    try {
      await api.post('/usdt/global/adjust', { delta });
      setAdjust(''); setMsg('Баланс оновлено'); onSaved();
    } catch (e: any) {
      setMsg(e.response?.data?.message ?? 'Помилка');
    } finally { setBusy(false); }
  };

  const srcBtn = (s: 'POINT' | 'GLOBAL', label: string) => (
    <button onClick={() => onSetSource(s)}
      className={`flex-1 rounded px-3 py-1.5 text-sm font-semibold border transition ${
        source === s ? 'bg-teal-600 text-white border-teal-600' : 'border-gray-300 text-gray-600 hover:bg-gray-50'
      }`}>
      {label}
    </button>
  );

  return (
    <div className="bg-white rounded-xl shadow p-5">
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <h3 className="font-semibold text-lg">₮ USDT — глобальний банк</h3>
        <div className="text-right">
          <div className="text-xs text-gray-400">Баланс глобального банку</div>
          <div className="font-bold text-teal-700 text-lg">{globalBalance.toFixed(4)} USDT</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <div className="text-xs text-gray-500 mb-1">Джерело USDT для операцій кас</div>
          <div className="flex gap-2">
            {srcBtn('POINT', 'Гаманець точки')}
            {srcBtn('GLOBAL', 'Глобальний банк')}
          </div>
          <p className="text-xs text-gray-400 mt-1.5">
            {source === 'GLOBAL'
              ? 'Каси беруть/повертають USDT напряму з глобального банку.'
              : 'Каси працюють із гаманцем своєї точки (поповнюйте його розподілом нижче).'}
          </p>
        </div>

        <div>
          <div className="text-xs text-gray-500 mb-1">Коригування балансу (депозит/зняття USDT)</div>
          <div className="flex gap-1.5">
            <input type="number" step="0.0001" min="0" value={adjust} onChange={(e) => setAdjust(e.target.value)}
              placeholder="0.0000"
              className="flex-1 border border-gray-300 rounded px-2 py-1 text-right focus:outline-none focus:ring-2 focus:ring-teal-500" />
            <button onClick={() => applyAdjust(1)} disabled={busy}
              className="px-3 py-1 rounded bg-green-100 text-green-700 font-semibold text-sm hover:bg-green-200 disabled:opacity-50">+ Депозит</button>
            <button onClick={() => applyAdjust(-1)} disabled={busy}
              className="px-3 py-1 rounded bg-red-100 text-red-700 font-semibold text-sm hover:bg-red-200 disabled:opacity-50">− Зняти</button>
          </div>
          {msg && <div className="text-xs text-gray-500 mt-1.5">{msg}</div>}
        </div>
      </div>
    </div>
  );
}

function WalletCard({ w, globalBalance, onSaved }: { w: Wallet; globalBalance: number; onSaved: () => void }) {
  const [buyPct, setBuyPct] = useState(String(w.buyPct));
  const [sellPct, setSellPct] = useState(String(w.sellPct));
  const [adjust, setAdjust] = useState('');
  const [distr, setDistr] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  // Синхронізуємо інпути з даними сервера після збереження/оновлення (щоб поля
  // відображали фактично збережені значення, а не залишок локального стану).
  useEffect(() => { setBuyPct(String(w.buyPct)); }, [w.buyPct]);
  useEffect(() => { setSellPct(String(w.sellPct)); }, [w.sellPct]);

  const savePct = async () => {
    setBusy(true); setMsg('');
    try {
      await api.put(`/usdt/wallet/${w.exchangePointId}/pct`, {
        buyPct: parseFloat(buyPct) || 0,
        sellPct: parseFloat(sellPct) || 0,
      });
      setMsg('Збережено'); onSaved();
    } catch (e: any) {
      setMsg(e.response?.data?.message ?? 'Помилка');
    } finally { setBusy(false); }
  };

  const applyAdjust = async (sign: 1 | -1) => {
    const delta = (parseFloat(adjust) || 0) * sign;
    if (!delta) return;
    setBusy(true); setMsg('');
    try {
      await api.post(`/usdt/wallet/${w.exchangePointId}/adjust`, { delta });
      setAdjust(''); setMsg('Баланс оновлено'); onSaved();
    } catch (e: any) {
      setMsg(e.response?.data?.message ?? 'Помилка');
    } finally { setBusy(false); }
  };

  // Розподіл: sign=+1 — з глобального у точку; sign=−1 — з точки в глобальний.
  const applyDistribute = async (sign: 1 | -1) => {
    const amount = (parseFloat(distr) || 0) * sign;
    if (!amount) return;
    setBusy(true); setMsg('');
    try {
      await api.post(`/usdt/wallet/${w.exchangePointId}/distribute`, { amount });
      setDistr(''); setMsg('Розподілено'); onSaved();
    } catch (e: any) {
      setMsg(e.response?.data?.message ?? 'Помилка');
    } finally { setBusy(false); }
  };

  return (
    <div className="border border-gray-200 rounded-xl p-4">
      <div className="flex items-baseline justify-between mb-2">
        <div className="font-semibold text-gray-800">
          <span className="text-gray-400 font-normal">{w.pointCode} · </span>{w.pointName}
        </div>
        <div className="text-right">
          <div className="text-xs text-gray-400">Баланс гаманця</div>
          <div className="font-bold text-teal-700">{w.balance.toFixed(4)} USDT</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-2">
        <label className="text-xs text-gray-500">
          Комісія купівлі %
          <input type="number" step="0.0001" value={buyPct} onChange={(e) => setBuyPct(e.target.value)}
            className="mt-0.5 w-full border border-gray-300 rounded px-2 py-1 text-right focus:outline-none focus:ring-2 focus:ring-teal-500" />
        </label>
        <label className="text-xs text-gray-500">
          Комісія продажу %
          <input type="number" step="0.0001" value={sellPct} onChange={(e) => setSellPct(e.target.value)}
            className="mt-0.5 w-full border border-gray-300 rounded px-2 py-1 text-right focus:outline-none focus:ring-2 focus:ring-teal-500" />
        </label>
      </div>
      <button onClick={savePct} disabled={busy}
        className="w-full mb-3 py-1.5 rounded bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium disabled:opacity-50">
        Зберегти комісії
      </button>

      <div className="border-t pt-2">
        <div className="text-xs text-gray-500 mb-1">Коригування балансу (депозит/зняття USDT)</div>
        <div className="flex gap-1.5">
          <input type="number" step="0.0001" min="0" value={adjust} onChange={(e) => setAdjust(e.target.value)}
            placeholder="0.0000"
            className="flex-1 border border-gray-300 rounded px-2 py-1 text-right focus:outline-none focus:ring-2 focus:ring-teal-500" />
          <button onClick={() => applyAdjust(1)} disabled={busy}
            className="px-3 py-1 rounded bg-green-100 text-green-700 font-semibold text-sm hover:bg-green-200 disabled:opacity-50">+ Депозит</button>
          <button onClick={() => applyAdjust(-1)} disabled={busy}
            className="px-3 py-1 rounded bg-red-100 text-red-700 font-semibold text-sm hover:bg-red-200 disabled:opacity-50">− Зняти</button>
        </div>
      </div>

      <div className="border-t pt-2 mt-2">
        <div className="text-xs text-gray-500 mb-1">
          Розподіл із глобального банку <span className="text-gray-400">(у банку {globalBalance.toFixed(4)})</span>
        </div>
        <div className="flex gap-1.5">
          <input type="number" step="0.0001" min="0" value={distr} onChange={(e) => setDistr(e.target.value)}
            placeholder="0.0000"
            className="flex-1 border border-gray-300 rounded px-2 py-1 text-right focus:outline-none focus:ring-2 focus:ring-teal-500" />
          <button onClick={() => applyDistribute(1)} disabled={busy}
            title="З глобального банку → у точку"
            className="px-3 py-1 rounded bg-teal-100 text-teal-700 font-semibold text-sm hover:bg-teal-200 disabled:opacity-50">← у точку</button>
          <button onClick={() => applyDistribute(-1)} disabled={busy}
            title="З точки → у глобальний банк"
            className="px-3 py-1 rounded bg-gray-100 text-gray-700 font-semibold text-sm hover:bg-gray-200 disabled:opacity-50">у банк →</button>
        </div>
      </div>
      {msg && <div className="text-xs text-gray-500 mt-2">{msg}</div>}
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

  const setSource = async (source: 'POINT' | 'GLOBAL') => {
    await api.put('/usdt/source', { source }).catch(() => {});
    load();
  };

  return (
    <div className="space-y-4">
      {/* Глобальний банк + джерело USDT */}
      <GlobalCard
        source={config.source}
        globalBalance={config.globalBalance}
        onSetSource={setSource}
        onSaved={load}
      />

      {/* Гаманці точок + налаштування */}
      <div className="bg-white rounded-xl shadow p-5">
        <h3 className="font-semibold text-lg mb-3">₮ USDT — гаманці точок</h3>
        {loading ? (
          <div className="text-center py-6 text-gray-400">Завантаження...</div>
        ) : wallets.length === 0 ? (
          <p className="text-gray-400 text-sm">Немає точок</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {wallets.map((w) => (
              <WalletCard key={w.exchangePointId} w={w} globalBalance={config.globalBalance} onSaved={load} />
            ))}
          </div>
        )}
      </div>

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
