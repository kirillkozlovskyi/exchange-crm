import { useEffect, useMemo, useState } from 'react';
import api from '../../api/axios';
import { suggestUsdtSettle, type UsdtSide } from '../../lib/usdt';

type Rate = { currency: string; buy: number | string; sell: number | string };

// USDT — окремий віртуальний банк (1:1 до USD), торгівля через %-комісію.
//  SELL — каса ПРОДАЄ USDT клієнту: гаманець −USDT, каса приймає фізичну готівку.
//  BUY  — каса КУПУЄ USDT у клієнта: гаманець +USDT, каса видає фізичну готівку.
export default function UsdtModal({
  shiftId, pointId, rates, balance, onClose, onSaved,
}: {
  shiftId: number;
  pointId: number;
  rates: Rate[];
  balance: Record<string, number>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [wallet, setWallet] = useState<{ balance: number; buyPct: number; sellPct: number } | null>(null);
  const [side, setSide] = useState<UsdtSide>('SELL');
  const [usdtAmount, setUsdtAmount] = useState('');
  const [pctRaw, setPctRaw] = useState('');
  const [pctTouched, setPctTouched] = useState(false);
  const [settleCurrency, setSettleCurrency] = useState('USD');
  const [settleAmount, setSettleAmount] = useState('');
  const [touchedSettle, setTouchedSettle] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/usdt/wallet/${pointId}`).then(({ data }) =>
      setWallet({ balance: Number(data.balance), buyPct: Number(data.buyPct), sellPct: Number(data.sellPct) }),
    ).catch(() => setWallet({ balance: 0, buyPct: 0, sellPct: 0 }));
  }, [pointId]);

  const defaultPct = side === 'SELL' ? (wallet?.sellPct ?? 0) : (wallet?.buyPct ?? 0);
  // Доки касир не редагував % вручну — тримаємо дефолт гаманця для поточної сторони.
  useEffect(() => {
    if (!pctTouched) setPctRaw(String(defaultPct));
  }, [defaultPct, pctTouched]);

  const currencies = useMemo(
    () => Array.from(new Set(['USD', 'UAH', ...rates.map((r) => r.currency)])),
    [rates],
  );

  const pct = parseFloat(pctRaw) || 0;
  const usdt = parseFloat(usdtAmount) || 0;

  const usdMid = useMemo(() => {
    const r = rates.find((x) => x.currency === 'USD');
    return r ? (Number(r.buy) + Number(r.sell)) / 2 : 0;
  }, [rates]);

  const { usdValue, settleAmount: suggested } = useMemo(
    () => suggestUsdtSettle({ side, usdtAmount: usdt, pct, settleCurrency, rates }),
    [side, usdt, pct, settleCurrency, rates],
  );

  useEffect(() => {
    if (!touchedSettle) setSettleAmount(suggested ? String(suggested) : '');
  }, [suggested, touchedSettle]);

  const settle = parseFloat(settleAmount) || 0;
  const profitUah = usdt * (pct / 100) * usdMid;

  const warning = (() => {
    if (side === 'SELL' && wallet && usdt > wallet.balance)
      return `Недостатньо USDT у гаманці: є ${wallet.balance.toFixed(4)}, продаєте ${usdt.toFixed(4)}`;
    if (side === 'BUY' && settle > (balance[settleCurrency] ?? 0))
      return `Недостатньо ${settleCurrency} у касі: є ${(balance[settleCurrency] ?? 0).toFixed(2)}, видаєте ${settle.toFixed(2)}`;
    return '';
  })();

  const handleSave = async () => {
    if (!usdt || !settle || warning) return;
    setSaving(true);
    setError('');
    try {
      await api.post('/usdt', {
        shiftId, side, usdtAmount: usdt, settleCurrency,
        settleAmount: settle, pct, note: note || undefined,
      });
      onSaved();
      onClose();
    } catch (e: any) {
      setError(e.response?.data?.message ?? 'Помилка');
    } finally {
      setSaving(false);
    }
  };

  const sideBtn = (s: UsdtSide, label: string, hint: string) => (
    <button
      onClick={() => { setSide(s); setPctTouched(false); setTouchedSettle(false); }}
      className={`flex-1 rounded px-2 py-1.5 text-sm font-semibold border transition ${
        side === s ? 'bg-teal-600 text-white border-teal-600' : 'border-gray-300 text-gray-600 hover:bg-gray-50'
      }`}
    >
      {label}
      <span className={`block text-[10px] font-normal ${side === s ? 'text-teal-50' : 'text-gray-400'}`}>{hint}</span>
    </button>
  );

  const inputCls = 'w-full border border-gray-300 rounded px-2 py-1 text-right text-sm font-medium focus:outline-none focus:ring-2 focus:ring-teal-500';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3" onClick={onClose}>
      <div className="bg-white rounded shadow-xl w-full max-w-md flex flex-col max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        <div className="p-3 pb-2 border-b border-gray-100">
          <div className="text-sm font-semibold text-teal-700 uppercase tracking-wider">₮ USDT — операція</div>
          <p className="text-xs text-gray-500 mt-0.5">
            Гаманець 1:1 до USD, торгівля через %-комісію.
            {wallet && <> Баланс: <span className="font-semibold text-gray-700">{wallet.balance.toFixed(4)} USDT</span>.</>}
          </p>
        </div>

        <div className="p-3 space-y-2 overflow-y-auto">
          <div className="flex gap-2">
            {sideBtn('SELL', 'Продаж USDT', 'каса приймає готівку')}
            {sideBtn('BUY', 'Купівля USDT', 'каса видає готівку')}
          </div>

          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-0.5">Сума USDT</label>
              <input type="number" min="0" step="0.0001" value={usdtAmount}
                onChange={(e) => setUsdtAmount(e.target.value)} placeholder="0.0000" className={inputCls} />
            </div>
            <div className="w-28">
              <label className="block text-xs text-gray-500 mb-0.5">Комісія %</label>
              <input type="number" step="0.0001" value={pctRaw}
                onChange={(e) => { setPctRaw(e.target.value); setPctTouched(true); }}
                placeholder="0.0000" className={inputCls} />
            </div>
          </div>

          <div className="bg-teal-50 rounded px-2 py-1.5 text-xs text-teal-800 flex justify-between">
            <span>USD-еквівалент {side === 'SELL' ? '(+%)' : '(−%)'}:</span>
            <span className="font-bold">{usdValue.toFixed(2)} USD</span>
          </div>

          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-0.5">Валюта розрахунку</label>
              <select value={settleCurrency}
                onChange={(e) => { setSettleCurrency(e.target.value); setTouchedSettle(false); }}
                className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                {currencies.map((c) => (
                  <option key={c} value={c}>{c} (в касі {Number(balance[c] ?? 0).toFixed(0)})</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-0.5">
                {side === 'SELL' ? 'Клієнт платить' : 'Каса видає'}
              </label>
              <input type="number" min="0" step="0.01" value={settleAmount}
                onChange={(e) => { setSettleAmount(e.target.value); setTouchedSettle(true); }}
                placeholder="0.00"
                className={`w-full border rounded px-2 py-1 text-right text-sm font-medium focus:outline-none focus:ring-2 ${
                  warning ? 'border-red-300 focus:ring-red-400 bg-red-50' : 'border-gray-300 focus:ring-teal-500'
                }`} />
            </div>
          </div>
          {touchedSettle && (
            <button onClick={() => setTouchedSettle(false)} className="text-xs text-gray-400 hover:text-gray-600">
              ↺ авто-сума ({suggested.toFixed(2)} {settleCurrency})
            </button>
          )}

          <div className="flex justify-between text-sm border-t pt-1.5">
            <span className="text-gray-500">Маржа (прибуток):</span>
            <span className="font-semibold text-green-600">+{profitUah.toFixed(2)} ₴</span>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Примітка</label>
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="необовʼязково"
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </div>

          {warning && <div className="text-xs text-red-600 bg-red-50 rounded px-2 py-1.5">{warning}</div>}
          {error && <div className="text-xs text-red-600 bg-red-50 rounded px-2 py-1.5">{error}</div>}
        </div>

        <div className="p-3 pt-2 border-t border-gray-100 flex gap-2">
          <button onClick={onClose} className="flex-1 py-1.5 rounded border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50">
            Скасувати
          </button>
          <button onClick={handleSave} disabled={saving || !usdt || !settle || !!warning}
            className="flex-1 py-1.5 rounded bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold disabled:opacity-50">
            {saving ? 'Збереження...' : side === 'SELL' ? 'Продати USDT' : 'Купити USDT'}
          </button>
        </div>
      </div>
    </div>
  );
}
