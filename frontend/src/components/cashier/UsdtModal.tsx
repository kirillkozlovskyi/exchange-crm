import { useEffect, useMemo, useState } from 'react';
import api from '../../api/axios';
import { suggestUsdtSettle, type UsdtSide } from '../../lib/usdt';

type Rate = { currency: string; buy: number | string; sell: number | string };

// USDT — окремий віртуальний банк (1:1 до USD), торгівля через %-комісію.
//  SELL — каса ПРОДАЄ USDT клієнту: гаманець −USDT, каса приймає фізичну готівку.
//  BUY  — каса КУПУЄ USDT у клієнта: гаманець +USDT, каса видає фізичну готівку.
export default function UsdtModal({
  shiftId, pointId, rates, balance, operations = [], onClose, onSaved,
}: {
  shiftId: number;
  pointId: number;
  rates: Rate[];
  balance: Record<string, number>;
  operations?: any[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(t); }, []);
  const [stornoing, setStornoing] = useState<number | null>(null);
  const [stornoWindowMin, setStornoWindowMin] = useState(5);
  useEffect(() => {
    api.get('/settings/storno-window').then(({ data }) => setStornoWindowMin(data.minutes)).catch(() => {});
  }, []);
  const [wallet, setWallet] = useState<{ balance: number } | null>(null);
  const [config, setConfig] = useState<{ source: 'POINT' | 'GLOBAL'; globalBalance: number } | null>(null);
  const [side, setSide] = useState<UsdtSide>('BUY');
  const [usdtAmount, setUsdtAmount] = useState('');
  const [pctRaw, setPctRaw] = useState('');
  const [pctTouched, setPctTouched] = useState(false);
  const [settleCurrency, setSettleCurrency] = useState('USD');
  const [settleAmount, setSettleAmount] = useState('');
  const [touchedSettle, setTouchedSettle] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [quickAmounts, setQuickAmounts] = useState<number[]>([]);

  useEffect(() => {
    api.get(`/usdt/wallet/${pointId}`).then(({ data }) =>
      setWallet({ balance: Number(data.balance) }),
    ).catch(() => setWallet({ balance: 0 }));
    api.get('/usdt/config').then(({ data }) =>
      setConfig({ source: data.source, globalBalance: Number(data.globalBalance) }),
    ).catch(() => setConfig({ source: 'POINT', globalBalance: 0 }));
  }, [pointId]);

  // Окремі швидкі суми USDT (налаштовуються в адмінці USDT).
  useEffect(() => {
    api.get('/settings/usdt-quick-amounts').then(({ data }) => setQuickAmounts(data)).catch(() => {});
  }, []);

  // Доступний баланс USDT для продажу — залежно від джерела (точка/глобал).
  const isGlobal = config?.source === 'GLOBAL';
  const availableUsdt = isGlobal ? (config?.globalBalance ?? 0) : (wallet?.balance ?? 0);

  // Комісія за замовчуванням 0 (касир за потреби вводить вручну).
  const defaultPct = 0;
  useEffect(() => {
    if (!pctTouched) setPctRaw(String(defaultPct));
  }, [defaultPct, pctTouched]);

  const currencies = useMemo(
    () => Array.from(new Set(['USD', 'UAH', ...rates.map((r) => r.currency)])),
    [rates],
  );

  const pct = parseFloat(pctRaw) || 0;
  const usdt = parseFloat(usdtAmount) || 0;

  // Кнопки −/+ швидких сум: додають/віднімають число від «Сума USDT» (не менше 0).
  const addUsdt = (delta: number) => {
    const next = Math.max(0, Math.round(((parseFloat(usdtAmount) || 0) + delta) * 10000) / 10000);
    setUsdtAmount(next ? String(next) : '');
  };

  const usdMid = useMemo(() => {
    const r = rates.find((x) => x.currency === 'USD');
    return r ? (Number(r.buy) + Number(r.sell)) / 2 : 0;
  }, [rates]);

  const { settleAmount: suggested } = useMemo(
    () => suggestUsdtSettle({ side, usdtAmount: usdt, pct, settleCurrency, rates }),
    [side, usdt, pct, settleCurrency, rates],
  );

  useEffect(() => {
    if (!touchedSettle) setSettleAmount(suggested ? String(suggested) : '');
  }, [suggested, touchedSettle]);

  const settle = parseFloat(settleAmount) || 0;

  // Маржа — з ФАКТИЧНОЇ суми розрахунку проти бази 1:1 (дзеркало бекенду):
  // касир може вписати будь-яку суму — прибуток завжди відповідає реальним грошам.
  const profitUah = useMemo(() => {
    if (!usdt || !settle) return 0;
    const midOf = (cur: string) => {
      const r = rates.find((x) => x.currency === cur);
      return r ? (Number(r.buy) + Number(r.sell)) / 2 : 0;
    };
    const settleUsd =
      settleCurrency === 'USD' ? settle
      : settleCurrency === 'UAH' ? (usdMid > 0 ? settle / usdMid : NaN)
      : usdMid > 0 && midOf(settleCurrency) > 0 ? (settle * midOf(settleCurrency)) / usdMid : NaN;
    const marginUsd = side === 'SELL' ? settleUsd - usdt : usdt - settleUsd;
    return Number.isFinite(marginUsd) ? marginUsd * usdMid : 0;
  }, [usdt, settle, settleCurrency, side, rates, usdMid]);

  // Нестача USDT (продаж) → підсвічуємо поле «Сума USDT»;
  // нестача готівки розрахунку (купівля) → підсвічуємо поле «Клієнт платить/Каса видає».
  const insufficientUsdt = side === 'SELL' && !!config && usdt > availableUsdt;
  const insufficientSettle = side === 'BUY' && settle > (balance[settleCurrency] ?? 0);
  const warning = insufficientUsdt
    ? `Недостатньо USDT у ${isGlobal ? 'глобальному банку' : 'гаманці точки'}: є ${availableUsdt.toFixed(4)}, продаєте ${usdt.toFixed(4)}`
    : insufficientSettle
    ? `Недостатньо ${settleCurrency} у касі: є ${(balance[settleCurrency] ?? 0).toFixed(2)}, видаєте ${settle.toFixed(2)}`
    : '';

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

  // Сторно USDT-операції (у межах часового вікна — як у валютних).
  const doStorno = async (op: any) => {
    setStornoing(op.id);
    setError('');
    try {
      await api.post(`/usdt/${op.id}/storno`, {});
      onSaved();
    } catch (e: any) {
      setError(e.response?.data?.message ?? 'Не вдалося скасувати');
    } finally {
      setStornoing(null);
    }
  };

  const sideBtn = (s: UsdtSide, label: string) => {
    const active = side === s;
    const isBuy = s === 'BUY';
    // Купівля — бірюзова, Продаж — червона. Неактивні — бордер у відповідному кольорі.
    const cls = active
      ? isBuy ? 'bg-teal-600 text-white border-teal-600' : 'bg-red-600 text-white border-red-600'
      : isBuy ? 'border-teal-600 text-teal-700 hover:bg-teal-50' : 'border-red-600 text-red-700 hover:bg-red-50';
    return (
      <button
        onClick={() => { setSide(s); setPctTouched(false); setTouchedSettle(false); }}
        className={`flex-1 rounded px-2 py-2 text-sm font-semibold border transition ${cls}`}
      >
        {label}
      </button>
    );
  };

  const inputCls = 'w-full border border-gray-300 rounded px-2 py-1 text-right text-sm font-medium focus:outline-none focus:ring-2 focus:ring-teal-500';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3">
      <div className="bg-white rounded shadow-xl w-full max-w-2xl flex flex-col max-h-[90vh]">
        <div className="p-4 pb-2 border-b border-gray-100 relative">
          <button onClick={onClose} aria-label="Закрити"
            className="absolute top-2.5 right-2.5 w-7 h-7 flex items-center justify-center rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 text-2xl leading-none">
            ×
          </button>
          <div className="text-sm font-semibold text-teal-700 uppercase tracking-wider pr-8">₮ USDT — операція</div>
          {config && (
            <p className="text-xs text-gray-500 mt-1">
              Джерело: <span className="font-semibold text-gray-700">{isGlobal ? 'глобальний банк' : 'гаманець точки'}</span>
              {' · '}баланс: <span className="text-lg font-bold text-teal-700">{availableUsdt.toFixed(4)} USDT</span>
            </p>
          )}
        </div>

        <div className="p-3 space-y-2 overflow-y-auto">
          <div className="flex gap-2">
            {sideBtn('BUY', 'Купівля USDT')}
            {sideBtn('SELL', 'Продаж USDT')}
          </div>

          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-0.5">Сума USDT</label>
              <input type="number" min="0" step="0.0001" value={usdtAmount}
                onChange={(e) => setUsdtAmount(e.target.value)} placeholder="0.0000"
                className={`w-full border rounded px-2 py-1 text-right text-sm font-medium focus:outline-none focus:ring-2 ${
                  insufficientUsdt ? 'border-red-300 focus:ring-red-400 bg-red-50' : 'border-gray-300 focus:ring-teal-500'
                }`} />
            </div>
            <div className="w-28">
              <label className="block text-xs text-gray-500 mb-0.5">Комісія %</label>
              <input type="number" step="0.01" value={pctRaw}
                onChange={(e) => { setPctRaw(e.target.value); setPctTouched(true); }}
                placeholder="0.0000" className={inputCls} />
            </div>
          </div>

          {quickAmounts.length > 0 && (
            <div className="flex flex-wrap gap-1.5 justify-between">
              {quickAmounts.map((v) => (
                <div key={v} className="flex items-stretch rounded-lg border border-gray-200 overflow-hidden">
                  <button type="button" onClick={() => addUsdt(-v)}
                    className="px-2 bg-red-50 text-red-600 hover:bg-red-100 font-bold text-sm">−</button>
                  <span className="px-1 py-1 text-sm font-semibold text-gray-700 text-center tabular-nums">{v}</span>
                  <button type="button" onClick={() => addUsdt(v)}
                    className="px-2 bg-green-50 text-green-600 hover:bg-green-100 font-bold text-sm">+</button>
                </div>
              ))}
            </div>
          )}

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
                  insufficientSettle ? 'border-red-300 focus:ring-red-400 bg-red-50' : 'border-gray-300 focus:ring-teal-500'
                }`} />
            </div>
          </div>
          {touchedSettle && (
            <button onClick={() => setTouchedSettle(false)} className="text-xs text-gray-400 hover:text-gray-600">
              ↺ авто-сума ({suggested.toFixed(2)} {settleCurrency})
            </button>
          )}

          <div className="flex justify-between text-sm border-t pt-1.5">
            <span className="text-gray-500">Маржа (прибуток, з фактичної суми):</span>
            <span className={`font-semibold ${profitUah >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {profitUah >= 0 ? '+' : '−'}{Math.abs(profitUah).toFixed(2)} ₴
            </span>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Примітка</label>
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="необовʼязково"
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </div>

          {warning && <div className="text-xs text-red-600 bg-red-50 rounded px-2 py-1.5">{warning}</div>}
          {error && <div className="text-xs text-red-600 bg-red-50 rounded px-2 py-1.5">{error}</div>}

          {/* USDT-операції зміни + сторно (у межах часового вікна) */}
          {operations.length > 0 && (
            <div className="pt-1 border-t border-gray-100">
              <div className="text-xs font-semibold text-gray-500 mb-1">USDT-операції зміни</div>
              <div className="space-y-1 max-h-40 overflow-auto">
                {operations.map((op: any) => {
                  const isSell = op.side === 'SELL';
                  const canStorno = !op.cancelled &&
                    now - new Date(op.createdAt).getTime() <= stornoWindowMin * 60_000;
                  return (
                    <div key={op.id} className={`flex items-center gap-2 text-xs border-b border-gray-50 last:border-0 py-1 ${op.cancelled ? 'opacity-40 line-through' : ''}`}>
                      <span className="text-gray-400 w-10">{new Date(op.createdAt).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}</span>
                      <span className={`font-semibold ${isSell ? 'text-red-600' : 'text-teal-700'}`}>{isSell ? 'Продаж' : 'Купівля'}</span>
                      <span className="font-medium">{Number(op.usdtAmount).toFixed(2)} ₮</span>
                      <span className="text-gray-500">{Number(op.settleAmount).toFixed(2)} {op.settleCurrency}</span>
                      <span className="ml-auto">
                        {op.cancelled ? (
                          <span className="text-gray-400 no-underline">скасовано</span>
                        ) : canStorno ? (
                          <button onClick={() => doStorno(op)} disabled={stornoing === op.id}
                            className="text-red-600 hover:underline disabled:opacity-50">
                            {stornoing === op.id ? '…' : 'Сторно'}
                          </button>
                        ) : (
                          <span className="text-gray-300" title={`Сторно можливе ${stornoWindowMin} хв`}>—</span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="p-3 pt-2 border-t border-gray-100 flex gap-2">
          <button onClick={onClose} className="flex-1 py-1.5 rounded border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50">
            Скасувати
          </button>
          <button onClick={handleSave} disabled={saving || !usdt || !settle || !!warning}
            className={`flex-1 py-1.5 rounded text-white text-sm font-semibold disabled:opacity-50 ${
              side === 'SELL' ? 'bg-red-600 hover:bg-red-700' : 'bg-teal-600 hover:bg-teal-700'
            }`}>
            {saving ? 'Збереження...' : side === 'SELL' ? 'Продати USDT' : 'Купити USDT'}
          </button>
        </div>
      </div>
    </div>
  );
}
