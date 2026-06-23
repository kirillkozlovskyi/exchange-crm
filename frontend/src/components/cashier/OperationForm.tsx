import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import api from '../../api/axios';

const FLAG: Record<string, string> = {
  USD: '🇺🇸', EUR: '🇪🇺', PLN: '🇵🇱', GBP: '🇬🇧',
  CHF: '🇨🇭', CAD: '🇨🇦', CZK: '🇨🇿', UAH: '🇺🇦',
  HUF: '🇭🇺', RON: '🇷🇴', NOK: '🇳🇴', SEK: '🇸🇪',
};

type OpMode = 'BUY' | 'SELL';

export default function OperationForm({
  shiftId,
  rates,
  balance,
  onCreated,
}: {
  shiftId: number;
  rates: any[];
  balance: Record<string, number>;
  onCreated: () => void;
}) {
  const foreignCurrencies = rates.map((r) => r.currency);
  const allCurrencies = ['UAH', ...foreignCurrencies];
  const firstForeign = foreignCurrencies[0] ?? 'USD';

  const [mode, setMode] = useState<OpMode>('BUY');
  const [giveCurrency, setGiveCurrency] = useState<string>(firstForeign);
  const [giveAmount, setGiveAmount] = useState('');
  const [wantCurrency, setWantCurrency] = useState<string>('UAH');
  const [maxAmount, setMaxAmount] = useState('');
  const [quantity, setQuantity] = useState('');
  const [valueAmountRaw, setValueAmountRaw] = useState('');
  const [changeCurrency, setChangeCurrency] = useState<string>('UAH');
  const [customRateRaw, setCustomRateRaw] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [lastOp, setLastOp] = useState<any>(null);
  const [rateEditedByUser, setRateEditedByUser] = useState(false); // true лише якщо касир явно змінив курс

  const skipRateEffectRef  = useRef(false);
  const pinnedRateRef      = useRef<string | null>(null); // зберігає курс під час свапу

  const getBuyRate = useCallback((cur: string) => {
    if (cur === 'UAH') return 1;
    return Number(rates.find((x: any) => x.currency === cur)?.buy ?? 0);
  }, [rates]);

  const getSellRate = useCallback((cur: string) => {
    if (cur === 'UAH') return 1;
    return Number(rates.find((x: any) => x.currency === cur)?.sell ?? 0);
  }, [rates]);

  // Курс залежить виключно від напрямку валют, не від вкладки BUY/SELL
  // give=foreign → want=UAH: exchange купує → r.buy(foreign)
  // give=UAH → want=foreign: exchange продає → r.sell(foreign)
  // крос-обмін: r.buy(give) / r.sell(want)
  const marketRate = useMemo(() => {
    if (giveCurrency === wantCurrency) return 0;
    if (giveCurrency === 'UAH') {
      const r = getSellRate(wantCurrency);
      return r || 0;
    }
    if (wantCurrency === 'UAH') {
      const r = getBuyRate(giveCurrency);
      return r || 0;
    }
    // крос-обмін
    const buyR  = getBuyRate(giveCurrency);
    const sellR = getSellRate(wantCurrency);
    return buyR && sellR ? buyR / sellR : 0;
  }, [giveCurrency, wantCurrency, getBuyRate, getSellRate]);

  const customRateNum = parseFloat(customRateRaw) || marketRate;
  // Амбер-підсвітка тільки якщо касир САМ змінив курс (не при свапі, не при зміні вкладки)
  const isRateEdited  = rateEditedByUser && Math.abs(customRateNum - marketRate) > 0.005 && marketRate > 0;

  // При зміні ринкового курсу — скидаємо customRate і перераховуємо залежні поля
  useEffect(() => {
    if (marketRate <= 0) return;

    // При свапі — відновлюємо збережений курс (не даємо новому marketRate перезаписати)
    if (skipRateEffectRef.current) {
      skipRateEffectRef.current = false;
      if (pinnedRateRef.current !== null) {
        setCustomRateRaw(pinnedRateRef.current);
        pinnedRateRef.current = null;
      }
      return;
    }

    setCustomRateRaw(marketRate.toFixed(2));
    setRateEditedByUser(false); // ринковий курс оновився — скидаємо прапор редагування

    // Перераховуємо maxAmount з giveAmount (за напрямком валют)
    const give = parseFloat(giveAmount) || 0;
    if (give > 0) {
      // give=foreign → max=UAH = give*rate; give=UAH → max=foreign = give/rate
      const max = giveCurrency !== 'UAH' ? give * marketRate : give / marketRate;
      setMaxAmount(max.toFixed(2));
    }
    // Перераховуємо valueAmount з quantity
    const qty = parseFloat(quantity) || 0;
    if (qty > 0) {
      setValueAmountRaw((qty * marketRate).toFixed(2));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketRate]);

  const isSame  = giveCurrency === wantCurrency;
  const isCross = giveCurrency !== 'UAH' && wantCurrency !== 'UAH' && !isSame;

  // ── Хендлери для взаємозалежних полів ────────────────────────────────────

  // "Сума" → перераховуємо Конвертацію (за напрямком валют)
  const handleGiveAmountChange = (val: string) => {
    setGiveAmount(val);
    const num = parseFloat(val) || 0;
    if (num > 0 && !isSame && customRateNum > 0) {
      const max = giveCurrency !== 'UAH' ? num * customRateNum : num / customRateNum;
      setMaxAmount(max.toFixed(2));
    } else {
      setMaxAmount('');
    }
  };

  // "Конвертація" → перераховуємо "Суму"
  const handleMaxAmountChange = (val: string) => {
    setMaxAmount(val);
    const num = parseFloat(val) || 0;
    if (num > 0 && !isSame && customRateNum > 0) {
      const give = giveCurrency !== 'UAH' ? num / customRateNum : num * customRateNum;
      setGiveAmount(give.toFixed(2));
    } else {
      setGiveAmount('');
    }
  };

  // Swap валют і сум між полями Сума ↔ Конвертація
  // Таб (BUY/SELL) НЕ міняється, курс НЕ міняється — зберігаємо обидва
  const handleSwap = () => {
    pinnedRateRef.current = customRateRaw;  // фіксуємо поточний курс
    skipRateEffectRef.current = true;
    setRateEditedByUser(false); // свап не є редагуванням курсу — прибираємо амбер
    const prevGive = giveCurrency;
    const prevWant = wantCurrency;
    const prevGiveAmount = giveAmount;
    const prevMaxAmount = maxAmount;
    setGiveCurrency(prevWant);
    setWantCurrency(prevGive);
    setGiveAmount(prevMaxAmount);
    setMaxAmount(prevGiveAmount);
  };

  // "Кількість" → перераховуємо Вартість
  const handleQuantityChange = (val: string) => {
    setQuantity(val);
    const num = parseFloat(val) || 0;
    if (num > 0 && customRateNum > 0) {
      setValueAmountRaw((num * customRateNum).toFixed(2));
    } else {
      setValueAmountRaw('');
    }
  };

  // "Вартість" → перераховуємо курс (зворотня формула: rate = value / qty)
  const handleValueAmountChange = (val: string) => {
    setValueAmountRaw(val);
    const valNum = parseFloat(val) || 0;
    const qty    = parseFloat(quantity) || 0;
    if (valNum > 0 && qty > 0) {
      const newRate = valNum / qty;
      setCustomRateRaw(newRate.toFixed(2));
    }
  };

  // "Курс" → перераховуємо Вартість і Конвертацію
  const handleRateChange = (val: string) => {
    setRateEditedByUser(true); // касир явно змінив курс
    setCustomRateRaw(val);
    const rateNum = parseFloat(val) || 0;
    const qty = parseFloat(quantity) || 0;
    if (qty > 0 && rateNum > 0) {
      setValueAmountRaw((qty * rateNum).toFixed(2));
    }
    // Перераховуємо Конвертацію з Суми при зміні курсу
    const give = parseFloat(giveAmount) || 0;
    if (give > 0 && rateNum > 0) {
      const max = giveCurrency !== 'UAH' ? give * rateNum : give / rateNum;
      setMaxAmount(max.toFixed(2));
    }
  };

  const handleModeChange = (m: OpMode) => {
    setMode(m);
    setRateEditedByUser(false);
    setGiveAmount('');
    setMaxAmount('');
    setQuantity('');
    setValueAmountRaw('');
    setError('');
    if (m === 'BUY') {
      // Купівля: каса купує у клієнта → клієнт дає іноземну, отримує UAH
      setGiveCurrency(firstForeign);
      setWantCurrency('UAH');
      setChangeCurrency(firstForeign); // решта в іноземній (якщо клієнт дав більше)
    } else {
      // Продаж: каса продає клієнту → клієнт дає UAH, отримує іноземну
      setGiveCurrency('UAH');
      setWantCurrency(firstForeign);
      setChangeCurrency('UAH'); // решта в UAH
    }
  };

  const giveAmountNum    = parseFloat(giveAmount) || 0;
  const maxAmountNum     = parseFloat(maxAmount) || 0;
  const quantityNum      = parseFloat(quantity) || 0;
  const valueAmountNum   = parseFloat(valueAmountRaw) || 0;
  // Кількість — завжди іноземна валюта; Вартість — завжди UAH (для крос-режиму — залежить від вкладки)
  // Визначаємо за напрямком валют, а НЕ за вкладкою mode — так правильно після свапу в тому ж табі
  const quantityCurrency = isCross
    ? (mode === 'BUY' ? giveCurrency : wantCurrency)
    : (giveCurrency !== 'UAH' ? giveCurrency : wantCurrency);
  const valueCurrency = isCross
    ? (mode === 'BUY' ? wantCurrency : giveCurrency)
    : (giveCurrency !== 'UAH' ? wantCurrency : giveCurrency);
  const valueLabel = isCross
    ? (mode === 'BUY' ? 'Отримує' : 'Вартість')
    : (giveCurrency !== 'UAH' ? 'Отримує' : 'Вартість');

  // give=foreign → "витрачено" з суми = qty(foreign); give=UAH → витрачено UAH = valueAmount
  const spentInGive = giveCurrency !== 'UAH' ? quantityNum : valueAmountNum;
  const changeInBase: number | null =
    giveAmountNum > 0 && spentInGive > 0 ? giveAmountNum - spentInGive : null;

  const changeConverted = useMemo(() => {
    if (changeInBase === null) return null;
    if (changeCurrency === giveCurrency) return changeInBase;
    const baseUAH = giveCurrency === 'UAH' ? changeInBase : changeInBase * getBuyRate(giveCurrency);
    const targetR = getSellRate(changeCurrency);
    return targetR ? baseUAH / targetR : null;
  }, [changeInBase, giveCurrency, changeCurrency, getBuyRate, getSellRate]);

  // want=UAH → каса дає UAH = перевіряємо valueAmountNum; want=foreign → перевіряємо quantityNum
  const neededFromBalance = wantCurrency !== 'UAH' ? quantityNum : valueAmountNum;
  const balanceWarning = useMemo(() => {
    if (!neededFromBalance) return '';
    const have = balance[wantCurrency] ?? 0;
    if (have < neededFromBalance)
      return `Не вистачає ${(neededFromBalance - have).toFixed(2)} ${wantCurrency}`;
    return '';
  }, [neededFromBalance, wantCurrency, balance]);

  const handleSubmit = async () => {
    if (!quantityNum || isSame || !!balanceWarning) return;
    setLoading(true);
    setError('');
    try {
      let currency: string;
      let amount: number;
      let rate: number;
      let payC: string | undefined;
      let payA: number | undefined;

      if (giveCurrency === 'UAH') {
        currency = wantCurrency; amount = quantityNum; rate = customRateNum;
      } else if (wantCurrency === 'UAH') {
        currency = 'UAH'; amount = quantityNum; rate = customRateNum;
        payC = giveCurrency; payA = quantityNum;
      } else {
        // Крос-обмін: обидві валюти іноземні
        // BUY (exchange buys giveCurrency): клієнт дає qty(give), отримує value(want)
        // SELL (exchange sells wantCurrency): клієнт дає value(give), отримує qty(want)
        currency = wantCurrency;
        amount   = mode === 'BUY' ? valueAmountNum : quantityNum;
        rate     = customRateNum;
        payC     = giveCurrency;
        payA     = mode === 'BUY' ? quantityNum : valueAmountNum;
      }

      const { data } = await api.post('/operations', {
        shiftId, currency, amount, rate, payCurrency: payC, payAmount: payA,
      });

      setLastOp(data);
      setShowConfirm(false);
      setGiveAmount('');
      setMaxAmount('');
      setQuantity('');
      setValueAmountRaw('');
      setError('');
      onCreated();
    } catch (e: any) {
      setError(e.response?.data?.message || 'Помилка');
    } finally {
      setLoading(false);
    }
  };

  const btnActive   = mode === 'BUY' ? 'bg-green-600 text-white border-green-600' : 'bg-red-600 text-white border-red-600';
  const submitColor = mode === 'BUY' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700';

  return (
    <div className="bg-white shadow p-4 space-y-4">

      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Нова операція</div>

      {/* Режим */}
      <div className="flex gap-2">
        {(['BUY', 'SELL'] as OpMode[]).map((m) => (
          <button key={m} onClick={() => handleModeChange(m)}
            className={`flex-1 py-2 rounded-lg text-lg font-semibold border transition ${
              mode === m ? btnActive :
              m === 'BUY' ? 'border-green-200 text-green-700 hover:bg-green-50' :
                            'border-red-200 text-red-700 hover:bg-red-50'
            }`}
          >
            {m === 'BUY' ? '🟢 Купівля' : '🔴 Продаж'}
          </button>
        ))}
      </div>

      {/* Курс — редагований касиром до введення сум */}
      {!isSame && (
        <div className="space-y-1">
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Курс</div>
          <div className="flex items-center gap-2">
            <label className="text-lg font-semibold text-gray-700 whitespace-nowrap">
              {giveCurrency !== 'UAH' ? `1 ${giveCurrency} =` : `1 ${wantCurrency} =`}
            </label>
            <input type="number" min="0" step="0.01" value={customRateRaw}
              onChange={(e) => handleRateChange(e.target.value)}
              className={`w-36 border rounded-lg px-3 py-2 text-right text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-blue-400 transition ${
                isRateEdited ? 'border-amber-400 bg-amber-50 text-amber-800' : 'border-gray-300'
              }`}
            />
            <span className="text-lg text-gray-500">{valueCurrency}</span>
            {isRateEdited && (
              <button onClick={() => {
                setRateEditedByUser(false);
                setCustomRateRaw(marketRate.toFixed(2));
                const give = parseFloat(giveAmount) || 0;
                if (give > 0) {
                  const max = giveCurrency !== 'UAH' ? give * marketRate : give / marketRate;
                  setMaxAmount(max.toFixed(2));
                }
                const qty = parseFloat(quantity) || 0;
                if (qty > 0) setValueAmountRaw((qty * marketRate).toFixed(2));
              }}
                className="text-xs text-blue-500 hover:underline whitespace-nowrap">
                ↺ ринковий
              </button>
            )}
          </div>
        </div>
      )}

      {isSame && <p className="text-amber-600 text-xs bg-amber-50 rounded-lg p-2">Оберіть різні валюти</p>}

      {/* Рядок 1: Сума | ⇄ | Конвертація */}
      <div className="flex items-end gap-2">

        <div className="flex-1 min-w-0 space-y-1">
          <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Сума</label>
          <div className="pb-4 flex gap-1">
            <select value={giveCurrency} onChange={(e) => setGiveCurrency(e.target.value)}
              className="w-28 border border-gray-300 rounded-lg px-2 py-2 text-lg font-bold focus:outline-none focus:ring-2 focus:ring-blue-400">
              {allCurrencies.map((c) => <option key={c} value={c}>{FLAG[c] ?? ''} {c}</option>)}
            </select>
            <input type="number" min="0" step="1" value={giveAmount}
              onChange={(e) => handleGiveAmountChange(e.target.value)}
              className="flex-1 min-w-0 border border-gray-300 rounded-lg px-3 py-2 text-right text-xl font-semibold focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder="0" autoFocus />
          </div>
        </div>

        <button
          onClick={handleSwap}
          className="flex-shrink-0 pb-6 text-gray-900 hover:text-blue-600 select-none transition"
          title="Поміняти місцями"
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 4l4 4-4 4"/>
            <path d="M3 8h18"/>
            <path d="M7 20l-4-4 4-4"/>
            <path d="M21 16H3"/>
          </svg>
        </button>

        <div className="flex-1 min-w-0 space-y-1">
          <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Конвертація</label>
          <div className="relative pb-4">
            <div className="flex gap-1">
              <select value={wantCurrency} onChange={(e) => setWantCurrency(e.target.value)}
                className="w-28 border border-gray-300 rounded-lg px-2 py-2 text-lg font-bold focus:outline-none focus:ring-2 focus:ring-blue-400">
                {allCurrencies.map((c) => <option key={c} value={c}>{FLAG[c] ?? ''} {c}</option>)}
              </select>
              <div className="flex-1 flex gap-1">
                <input type="number" min="0" step="1" value={maxAmount}
                  onChange={(e) => handleMaxAmountChange(e.target.value)}
                  className={`flex-1 min-w-0 border rounded-lg px-3 py-2 text-right text-xl font-semibold bg-gray-50 focus:outline-none focus:ring-2 focus:bg-white focus:border-solid transition ${
                    maxAmountNum > 0 && maxAmountNum > (balance[wantCurrency] ?? 0)
                      ? 'border-red-400 focus:ring-red-300'
                      : 'border-dashed border-gray-300 focus:ring-blue-400'
                  }`}
                  placeholder="0" />
                {maxAmountNum > 0 && (
                  <button onClick={() => setQuantity(maxAmount)}
                    className="px-2 text-blue-400 hover:text-blue-600 text-sm transition"
                    title="Перенести в Кількість">↓</button>
                )}
              </div>
            </div>
            {maxAmountNum > 0 && maxAmountNum > (balance[wantCurrency] ?? 0) && (
              <p className="absolute bottom-0 left-0 text-xs text-red-500 leading-none">
                В касі {(balance[wantCurrency] ?? 0).toFixed(2)} {wantCurrency} · не вистачає {(maxAmountNum - (balance[wantCurrency] ?? 0)).toFixed(2)}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Рядок 2: Кількість | Вартість/Отримує | Решта */}
      <div className="flex items-end gap-2">

        {/* Кількість */}
        <div className="flex-1 min-w-0 space-y-1">
          <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
            Кількість <span className="font-normal normal-case text-gray-400">({quantityCurrency})</span>
          </label>
          <div className="relative pb-4">
            <input type="number" min="0" step="1" value={quantity}
              onChange={(e) => handleQuantityChange(e.target.value)}
              className={`w-full border rounded-lg px-3 py-2 text-right text-xl font-semibold focus:outline-none focus:ring-2 transition ${
                balanceWarning ? 'border-red-400 bg-red-50 focus:ring-red-300' : 'border-gray-300 focus:ring-blue-400'
              }`}
              placeholder="0" />
            {/* Показуємо помилку під Кількістю коли want=foreign (каса дає іноземну) */}
            {wantCurrency !== 'UAH' && neededFromBalance > 0 && neededFromBalance > (balance[wantCurrency] ?? 0) && (
              <p className="absolute bottom-0 left-0 text-xs text-red-500 leading-none">
                В касі {(balance[wantCurrency] ?? 0).toFixed(2)} {wantCurrency} · не вистачає {(neededFromBalance - (balance[wantCurrency] ?? 0)).toFixed(2)}
              </p>
            )}
          </div>
        </div>

        {/* Вартість / Отримує */}
        <div className="flex-1 min-w-0 space-y-1">
          <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
            {valueLabel} <span className="font-normal normal-case text-gray-400">({valueCurrency})</span>
          </label>
          <div className="relative pb-4">
            <div className={`border rounded-lg ${balanceWarning ? 'border-red-300 bg-red-50' : 'border-dashed border-gray-300 bg-gray-50'}`}>
              <input
                type="number" min="0" step="1"
                value={valueAmountRaw}
                onChange={(e) => handleValueAmountChange(e.target.value)}
                className={`w-full px-3 py-2 text-right text-xl font-semibold bg-transparent focus:outline-none rounded-lg ${
                  valueAmountNum > 0 ? (balanceWarning ? 'text-red-700' : 'text-gray-800') : 'text-gray-300'
                } ${isRateEdited ? 'text-amber-800' : ''}`}
                placeholder="0"
              />
            </div>
            {/* Показуємо помилку під Отримує коли want=UAH (каса дає UAH) */}
            {wantCurrency === 'UAH' && neededFromBalance > 0 && neededFromBalance > (balance[wantCurrency] ?? 0) && (
              <p className="absolute bottom-0 left-0 text-xs text-red-500 leading-none">
                В касі {(balance[wantCurrency] ?? 0).toFixed(2)} {wantCurrency} · не вистачає {(neededFromBalance - (balance[wantCurrency] ?? 0)).toFixed(2)}
              </p>
            )}
          </div>
        </div>

        {/* Решта */}
        <div className="flex-1 min-w-0 space-y-1">
          <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Решта</label>
          <div className="relative pb-4">
            <div className="flex gap-1">
              <select value={changeCurrency} onChange={(e) => setChangeCurrency(e.target.value)}
                className="w-28 border border-gray-300 rounded-lg px-1 py-2 text-lg font-bold focus:outline-none focus:ring-2 focus:ring-blue-400">
                {allCurrencies.map((c) => <option key={c} value={c}>{FLAG[c] ?? ''} {c}</option>)}
              </select>
              <div className={`flex-1 flex items-center justify-end rounded-lg px-3 py-2 font-bold text-xl border ${
                changeConverted === null ? 'border-gray-200 bg-gray-50 text-gray-300' :
                changeConverted < 0     ? 'border-red-300 bg-red-50 text-red-700' :
                                          'border-green-200 bg-green-50 text-green-700'
              }`}>
                {changeConverted === null ? '—' :
                 changeConverted < 0 ? `⚠ ${Math.abs(changeConverted).toFixed(2)}` :
                 changeConverted.toFixed(2)}
              </div>
            </div>
            {changeConverted !== null && changeConverted < 0 && (
              <p className="absolute bottom-0 left-0 text-xs text-red-500 leading-none">не вистачає</p>
            )}
          </div>
        </div>

      </div>
      {error && <p className="text-red-500 text-sm">{error}</p>}

      <button onClick={() => setShowConfirm(true)}
        disabled={!quantityNum || isSame || !!balanceWarning}
        className={`w-full font-semibold py-2.5 rounded-lg disabled:opacity-50 transition text-sm text-white ${submitColor}`}>
        {quantityNum && !isSame && valueAmountNum > 0
          ? (!isCross ? giveCurrency !== 'UAH' : mode === 'BUY')
            ? `Купівля: ${quantityNum.toFixed(2)} ${quantityCurrency} → ${valueAmountNum.toFixed(2)} ${valueCurrency}`
            : `Продаж: ${valueAmountNum.toFixed(2)} ${valueCurrency} → ${quantityNum.toFixed(2)} ${quantityCurrency}`
          : mode === 'BUY' ? 'Провести купівлю' : 'Провести продаж'
        }
      </button>

      {/* Модальне підтвердження операції */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setShowConfirm(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}>

            <div className="text-center">
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Підтвердження операції</div>
              <div className={`text-xl font-bold ${(!isCross ? giveCurrency !== 'UAH' : mode === 'BUY') ? 'text-green-700' : 'text-red-600'}`}>
                {(!isCross ? giveCurrency !== 'UAH' : mode === 'BUY') ? '🟢 Купівля' : '🔴 Продаж'}
              </div>
            </div>

            {/* Напрямок */}
            <div className="bg-gray-50 rounded-xl p-4 text-center space-y-1">
              {(!isCross ? giveCurrency !== 'UAH' : mode === 'BUY') ? (
                <>
                  <div className="text-2xl font-bold text-gray-800">
                    {quantityNum.toFixed(2)} <span className="text-gray-500 text-lg">{quantityCurrency}</span>
                  </div>
                  <div className="text-gray-400 text-lg">↓</div>
                  <div className="text-2xl font-bold text-gray-800">
                    {valueAmountNum.toFixed(2)} <span className="text-gray-500 text-lg">{valueCurrency}</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="text-2xl font-bold text-gray-800">
                    {valueAmountNum.toFixed(2)} <span className="text-gray-500 text-lg">{valueCurrency}</span>
                  </div>
                  <div className="text-gray-400 text-lg">↓</div>
                  <div className="text-2xl font-bold text-gray-800">
                    {quantityNum.toFixed(2)} <span className="text-gray-500 text-lg">{quantityCurrency}</span>
                  </div>
                </>
              )}
            </div>

            {/* Деталі */}
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Курс</span>
                <span className="font-semibold text-gray-800">
                  1 {giveCurrency !== 'UAH' ? giveCurrency : wantCurrency} = {customRateNum.toFixed(2)} {giveCurrency !== 'UAH' ? wantCurrency : giveCurrency}
                </span>
              </div>
              {giveAmountNum > 0 && changeConverted !== null && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Решта клієнту</span>
                  <span className={`font-semibold ${changeConverted < 0 ? 'text-red-600' : 'text-green-700'}`}>
                    {changeConverted < 0 ? '⚠ ' : ''}{Math.abs(changeConverted).toFixed(2)} {changeCurrency}
                  </span>
                </div>
              )}
              {isRateEdited && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Курс</span>
                  <span className="text-amber-600 font-semibold text-xs">✱ індивідуальний</span>
                </div>
              )}
            </div>

            {error && <p className="text-red-500 text-sm text-center">{error}</p>}

            <div className="flex gap-2 pt-1">
              <button onClick={() => setShowConfirm(false)}
                className="flex-1 py-2.5 rounded-lg border border-gray-300 text-gray-700 font-medium text-sm hover:bg-gray-50 transition">
                Скасувати
              </button>
              <button onClick={handleSubmit} disabled={loading}
                className={`flex-1 py-2.5 rounded-lg text-white font-semibold text-sm disabled:opacity-50 transition ${submitColor}`}>
                {loading ? 'Збереження...' : 'Підтвердити'}
              </button>
            </div>
          </div>
        </div>
      )}

      {lastOp && (
        <div className="border border-green-200 bg-green-50 rounded-lg p-3 text-sm">
          <div className="flex justify-between items-center">
            <div>
              <div className="font-semibold text-green-700">✓ Операція #{lastOp.number}</div>
              <div className="text-gray-600 text-xs mt-0.5">
                {lastOp.payCurrency
                  ? `${Number(lastOp.payAmount ?? 0).toFixed(2)} ${lastOp.payCurrency} → ${Number(lastOp.amount).toFixed(2)} ${lastOp.currency}`
                  : lastOp.type === 'BUY'
                    ? `${Number(lastOp.amount).toFixed(2)} ${lastOp.currency} → ${Number(lastOp.totalUah).toFixed(2)} UAH`
                    : `${Number(lastOp.totalUah).toFixed(2)} UAH → ${Number(lastOp.amount).toFixed(2)} ${lastOp.currency}`
                }
              </div>
            </div>
            <button onClick={() => window.print()} className="text-blue-600 hover:underline text-xs">🖨 Друк</button>
          </div>
        </div>
      )}
    </div>
  );
}
