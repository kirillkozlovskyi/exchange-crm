import { useState, useMemo, useCallback, useEffect } from 'react';
import api from '../../api/axios';

type OpMode = 'BUY' | 'SELL';

// Курси >=10 (валюта/UAH) — 2 знаки; крос-курси <10 (напр. 0.8561) — 4 знаки для точності
const fmtRate = (r: number) => (r >= 10 ? r.toFixed(2) : r.toFixed(4));

function CurSelect({
  value, onChange, currencies, placeholder = false, className = '',
}: {
  value: string; onChange: (v: string) => void;
  currencies: string[]; placeholder?: boolean; className?: string;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className={`border border-gray-300 rounded-lg px-2 py-2 font-bold focus:outline-none focus:ring-2 focus:ring-blue-400 ${className}`}>
      {placeholder && <option value="">—</option>}
      {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
    </select>
  );
}

export default function OperationForm({
  shiftId, rates, balance, quickAmounts = [], activeCur, onCreated,
}: {
  shiftId: number;
  rates: any[];
  balance: Record<string, number>;
  quickAmounts?: number[];
  activeCur?: string;
  onCreated: () => void;
}) {
  const foreignCurrencies = rates.map((r) => r.currency);
  const allCurrencies = ['UAH', ...foreignCurrencies];
  // Валюта за замовчуванням — долар (якщо є серед курсів), інакше перша зі списку
  const defForeign = foreignCurrencies.includes('USD') ? 'USD' : (foreignCurrencies[0] ?? 'USD');

  // ── Mode ──────────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<OpMode>('BUY');

  // В режимі BUY клієнт завжди приносить іноземну валюту → UAH виключено
  const clientCurrencies = mode === 'BUY' ? foreignCurrencies : allCurrencies;

  // ── Row 1: Курс + Клієнт приніс ───────────────────────────────────────────
  const [rateRaw, setRateRaw] = useState('');
  const [rateManual, setRateManual] = useState(false);
  const [clientCur, setClientCur] = useState(defForeign);
  const [clientAmt, setClientAmt] = useState('');

  // ── Row 2: Helpers ────────────────────────────────────────────────────────
  const [hSumCur, setHSumCur] = useState(defForeign);
  const [hSumAmt, setHSumAmt] = useState('');
  const [hConvCur, setHConvCur] = useState('UAH'); // BUY за замовч.: конвертація в гривні
  const [hConvAmt, setHConvAmt] = useState('');    // manually typed conv
  const [hConvManual, setHConvManual] = useState(false); // true = cashier typed in conv

  // ── Row 3: Кількість | Отримує | Решта ────────────────────────────────────
  const [qtyCur, setQtyCur] = useState(defForeign);
  const [qtyAmt, setQtyAmt] = useState('');
  const [rcvCur, setRcvCur] = useState('UAH');    // BUY за замовч.: отримує гривні
  const [rcvAmt, setRcvAmt] = useState('');
  const [rcvCurSeeded, setRcvCurSeeded] = useState(false); // set once from hConvCur
  const [chgCur, setChgCur] = useState('UAH');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [lastOp, setLastOp] = useState<any>(null);

  // ── Rate helpers ──────────────────────────────────────────────────────────
  const getBuyRate = useCallback((cur: string) => {
    if (cur === 'UAH') return 1;
    return Number(rates.find((x) => x.currency === cur)?.buy ?? 0);
  }, [rates]);

  const getSellRate = useCallback((cur: string) => {
    if (cur === 'UAH') return 1;
    return Number(rates.find((x) => x.currency === cur)?.sell ?? 0);
  }, [rates]);

  // Курс для блоку «Допоміжний розрахунок»: один курс на валюту відповідно до
  // режиму (BUY → купівля, SELL → продаж). Робить конвертацію оборотною й узгодженою
  // з курсом операції (а не buy в один бік / sell в інший, як було).
  const convRate = useCallback((cur: string) => {
    if (cur === 'UAH') return 1;
    return mode === 'BUY' ? getBuyRate(cur) : getSellRate(cur);
  }, [mode, getBuyRate, getSellRate]);

  // Ринковий курс операції: "скільки rcvCur за 1 qtyCur".
  // qtyCur — валюта, що обмінюється: «Кількість» (Купівля) / «Сума продажу» (Продаж).
  const marketRate = useMemo(() => {
    const from = qtyCur;
    const to = rcvCur || 'UAH';
    if (!from || from === to) return 0;
    if (mode === 'BUY') {
      // Каса купує іноземну `from`, видає `to`
      if (to === 'UAH') return getBuyRate(from);
      return getBuyRate(from) / getSellRate(to) || 0; // крос
    } else {
      // Продаж: каса продає іноземну `from`, отримує `to` (курс продажу)
      if (to === 'UAH') return getSellRate(from);
      return getBuyRate(from) / getSellRate(to) || 0; // крос
    }
  }, [mode, qtyCur, rcvCur, getBuyRate, getSellRate]);

  const rateNum = parseFloat(rateRaw) || 0;

  // При зміні marketRate → оновити рядок курсу (якщо не ручний)
  useEffect(() => {
    if (marketRate > 0 && !rateManual) {
      setRateRaw(fmtRate(marketRate));
    }
  }, [marketRate, rateManual]);

  // Функція розрахунку "Отримує" з qty та rate
  const calcRcv = useCallback((qty: number, rate: number): string => {
    if (!qty || !rate || !rcvCur) return '';
    // SELL (clientCur=UAH → rcvCur=foreign): foreign = UAH / rate
    if (clientCur === 'UAH' && rcvCur !== 'UAH') return (qty / rate).toFixed(2);
    // BUY (clientCur=foreign → rcvCur=UAH) або крос: rcv = qty * rate
    return (qty * rate).toFixed(2);
  }, [clientCur, rcvCur]);

  // ── Авто-перерахунок "Отримує" при зміні qty або rate ─────────────────────
  // (не при прямому редагуванні rcvAmt)
  const recalcRcv = useCallback(() => {
    const qty = parseFloat(qtyAmt) || 0;
    const rate = parseFloat(rateRaw) || 0;
    if (qty > 0 && rate > 0 && rcvCur) {
      setRcvAmt(calcRcv(qty, rate));
    } else {
      setRcvAmt('');
    }
  }, [qtyAmt, rateRaw, rcvCur, calcRcv]);

  // ── Helper конвертація (авто-розрахунок) ──────────────────────────────────
  // Скільки `to` за 1 `from`. Якщо пара помічника збігається з парою операції —
  // рахуємо за КУРСОМ ОПЕРАЦІЇ (включно з кастомним), щоб помічник і операція
  // не розходились. Інакше: UAH↔валюта — оборотний робочий курс; крос — buy/sell.
  const hConvFactor = useCallback((from: string, to: string): number => {
    if (clientCur && rcvCur && rateNum > 0) {
      const opRcvPerClient = clientCur === 'UAH' ? 1 / rateNum : rateNum;
      if (from === clientCur && to === rcvCur) return opRcvPerClient;
      if (from === rcvCur && to === clientCur) return 1 / opRcvPerClient;
    }
    const crossPair = from !== 'UAH' && to !== 'UAH';
    const rFrom = crossPair ? getBuyRate(from) : convRate(from);
    const rTo = crossPair ? getSellRate(to) : convRate(to);
    return rFrom && rTo ? rFrom / rTo : 0;
  }, [clientCur, rcvCur, rateNum, convRate, getBuyRate, getSellRate]);

  const hConvCalc = useMemo(() => {
    const sum = parseFloat(hSumAmt) || 0;
    if (!sum || !hConvCur || !hSumCur || hConvCur === hSumCur) return '';
    const factor = hConvFactor(hSumCur, hConvCur);
    return factor ? (sum * factor).toFixed(2) : '';
  }, [hSumAmt, hSumCur, hConvCur, hConvFactor]);

  // Відображення helper конвертації: ручне або авто
  const hConvDisplay = hConvManual ? hConvAmt : hConvCalc;

  // ── Решта ─────────────────────────────────────────────────────────────────
  // Решта (здача) = недоотримане клієнтом, переведене у валюту здачі.
  // Базується на КУРСІ ОПЕРАЦІЇ: повна конвертація «Кількості» дає рівно 0,
  // а коли касир видає менше («Отримує» < повного) — залишок іде здачею.
  const changeAmt = useMemo(() => {
    const rcv = parseFloat(rcvAmt) || 0;

    // Продаж за гривні (Сума продажу = валюта, Отримує = UAH): клієнт платить
    // готівкою (Клієнт приніс, UAH), решта = приніс − гривнева вартість угоди.
    if (mode === 'SELL' && clientCur === 'UAH' && rcvCur === 'UAH' && qtyCur !== 'UAH') {
      const paid = parseFloat(clientAmt) || 0;
      if (!paid || !rcv) return null;
      const diff = paid - rcv; // у гривні
      if (Math.abs(diff) < 0.005) return 0;
      const chgRate = chgCur === 'UAH' ? 1 : getSellRate(chgCur);
      return chgRate ? diff / chgRate : null;
    }

    const qty = parseFloat(qtyAmt) || 0;
    if (!qty || !rcv || !qtyCur || !rcvCur || rateNum <= 0) return null;

    // Скільки клієнт мав би отримати при повній конвертації за курсом операції.
    // Без проміжного округлення (.toFixed) — інакше втрата точності спотворює здачу:
    // напр. 4520/45.10 = 100.2217 → округлення до 100.22 дає здачу 9.92 замість 10.00.
    const fullRcv = clientCur === 'UAH' && rcvCur !== 'UAH' ? qty / rateNum : qty * rateNum;
    const shortfall = fullRcv - rcv; // >0 → винні клієнту здачу (у валюті «Отримує»)
    if (Math.abs(shortfall) < 0.005) return 0;

    // Переводимо недоотримане у валюту здачі (каса продає валюту → курс продажу/операції)
    const cross = clientCur !== 'UAH' && rcvCur !== 'UAH' && clientCur !== rcvCur;
    const operFx = clientCur !== 'UAH' ? clientCur : rcvCur;
    const sellRateOf = (cur: string) =>
      cur === 'UAH' ? 1 : (!cross && cur === operFx && rateNum > 0 ? rateNum : getSellRate(cur));

    const uah = shortfall * sellRateOf(rcvCur);
    const chgRate = sellRateOf(chgCur);
    return chgRate ? uah / chgRate : null;
  }, [qtyAmt, rcvAmt, qtyCur, rcvCur, chgCur, clientCur, clientAmt, mode, rateNum, getSellRate]);

  // ── Balance warning ───────────────────────────────────────────────────────
  const rcvAmtNum = parseFloat(rcvAmt) || 0;
  const qtyAmtNum = parseFloat(qtyAmt) || 0;
  // Продаж за гривні: каса видає клієнту валюту «Сума продажу» (qtyCur), а не UAH.
  const sellNewFx = mode === 'SELL' && clientCur === 'UAH' && rcvCur === 'UAH' && qtyCur !== 'UAH';
  const payoutCur = sellNewFx ? qtyCur : rcvCur;
  const payoutAmt = sellNewFx ? qtyAmtNum : rcvAmtNum;
  const balanceWarning = useMemo(() => {
    if (!payoutAmt || !payoutCur) return '';
    const have = balance[payoutCur] ?? 0;
    return have < payoutAmt
      ? `В касі ${have.toFixed(2)} ${payoutCur} · не вистачає ${(payoutAmt - have).toFixed(2)}`
      : '';
  }, [payoutAmt, payoutCur, balance]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleModeChange = (m: OpMode) => {
    setMode(m);
    setRateManual(false);
    setError('');
    // «Клієнт приніс»: Купівля → іноземна валюта; Продаж → гривні (клієнт платить UAH).
    setClientCur(m === 'BUY' ? defForeign : 'UAH');
    // «Кількість»/«Сума продажу» — завжди іноземна валюта операції (за замовч. долар).
    setQtyCur(defForeign); setHSumCur(defForeign);
    // «Отримує» — завжди гривні (Купівля: клієнт отримує UAH; Продаж: гривнева вартість).
    setRcvCur('UAH'); setHConvCur('UAH'); setRcvCurSeeded(true);
    setClientAmt(''); setHSumAmt(''); setHConvAmt(''); setHConvManual(false);
    setQtyAmt(''); setRcvAmt(''); setChgCur('UAH');
    setRateRaw('');
  };

  // Клієнт приніс: currency. «Сума продажу»/«Кількість» — завжди іноземна, тож
  // синхронізуємо лише коли клієнт приносить валюту (Купівля, крос), не UAH (Продаж).
  const handleClientCurChange = (cur: string) => {
    setClientCur(cur);
    if (cur !== 'UAH') { setHSumCur(cur); setQtyCur(cur); }
    setRateManual(false); // refresh rate for new currency
  };

  // Клік на валюту в блоці курсів — обирає іноземну валюту операції:
  //  BUY  → «Клієнт приніс» (валюта, яку клієнт здає);
  //  SELL → «Сума продажу» (валюта, яку каса продає).
  useEffect(() => {
    if (!activeCur || !foreignCurrencies.includes(activeCur)) return;
    if (mode === 'BUY') handleClientCurChange(activeCur);
    else handleQtyCurChange(activeCur);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCur]);

  // Клієнт приніс: amount.
  //  • Купівля/крос (Клієнт приніс = валюта операції) → синхронізує «Кількість» і
  //    перераховує «Отримує».
  //  • Продаж (Клієнт приніс = UAH готівка) → незалежне поле лише для розрахунку решти,
  //    нічого не перераховує («Сума продажу» вводиться окремо).
  const handleClientAmtChange = (val: string) => {
    setClientAmt(val);
    if (clientCur !== qtyCur) return; // Продаж за гривні: тільки готівка для решти
    setHSumAmt(val);
    setHConvManual(false); // reset conv to auto-calc
    setQtyAmt(val);
    const qty = parseFloat(val) || 0;
    const rate = parseFloat(rateRaw) || 0;
    if (qty > 0 && rate > 0 && rcvCur) {
      setRcvAmt(calcRcv(qty, rate));
    } else {
      setRcvAmt('');
    }
  };

  // Кількість: amount → перераховуємо Отримує (зміна суми обміну балансує угоду,
  // Решта = 0). Здача виникає лише коли касир далі вручну заокруглює «Отримує».
  const handleQtyAmtChange = (val: string) => {
    setQtyAmt(val);
    const qty = parseFloat(val) || 0;
    const rate = parseFloat(rateRaw) || 0;
    if (qty > 0 && rate > 0 && rcvCur) {
      setRcvAmt(calcRcv(qty, rate));
    } else {
      setRcvAmt('');
    }
  };

  // Кількість/Сума продажу: currency.
  //  • Купівля — це валюта, яку приніс клієнт, тож синхронізуємо з «Клієнт приніс».
  //  • Продаж — це валюта, яку каса продає (незалежна від UAH-готівки клієнта).
  const handleQtyCurChange = (cur: string) => {
    if (mode === 'BUY') { handleClientCurChange(cur); return; }
    setQtyCur(cur); setHSumCur(cur);
    setRateManual(false);
    setQtyAmt(''); setRcvAmt('');
  };

  // Курс: ручне редагування
  const handleRateChange = (val: string) => {
    setRateRaw(val);
    setRateManual(true);
    const rate = parseFloat(val) || 0;
    const qty = parseFloat(qtyAmt) || 0;
    if (rate > 0 && qty > 0 && rcvCur) {
      setRcvAmt(calcRcv(qty, rate));
    }
  };

  const handleRateReset = () => {
    setRateManual(false);
    if (marketRate > 0) {
      setRateRaw(fmtRate(marketRate));
      const qty = parseFloat(qtyAmt) || 0;
      if (qty > 0 && rcvCur) setRcvAmt(calcRcv(qty, marketRate));
    }
  };

  // Отримує: currency → reset rate (нова валюта = новий курс)
  const handleRcvCurChange = (cur: string) => {
    setRcvCur(cur);
    setRateManual(false); // дозволяємо ринковому курсу оновитись через useEffect
    setRcvAmt('');        // очищаємо — буде перераховано після оновлення rateRaw
  };

  // Після оновлення rateRaw (через marketRate useEffect) → перерахувати rcvAmt
  useEffect(() => {
    if (rateManual) return;
    recalcRcv();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rateRaw]);

  // Отримує: ручне редагування суми (не перераховує нічого)
  const handleRcvAmtChange = (val: string) => {
    setRcvAmt(val);
  };

  // Helper Сума: ручне редагування
  const handleHSumAmtChange = (val: string) => {
    setHSumAmt(val);
    setHConvManual(false); // reset conv to auto-calc
  };

  // Helper Конвертація: currency → перший раз встановлює rcvCur
  const handleHConvCurChange = (cur: string) => {
    setHConvCur(cur);
    setHConvManual(false);
    if (!rcvCurSeeded && cur) {
      setRcvCur(cur);
      setRcvCurSeeded(true);
      setRateManual(false);
    }
  };

  // Helper Конвертація: ручне введення → зворотня конвертація в Сума
  const handleHConvAmtChange = (val: string) => {
    setHConvAmt(val);
    setHConvManual(true);
    const conv = parseFloat(val) || 0;
    if (!conv || !hConvCur || !hSumCur || hConvCur === hSumCur) return;
    // Інверс прямої: sum = conv / factor(from → to)
    const factor = hConvFactor(hSumCur, hConvCur);
    if (factor) setHSumAmt((conv / factor).toFixed(2));
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const qtyNum = parseFloat(qtyAmt) || 0;
  const isCross = clientCur !== 'UAH' && rcvCur !== 'UAH' && clientCur !== rcvCur;
  const isRateEdited = rateManual && Math.abs(rateNum - marketRate) > 0.005 && marketRate > 0;

  // Суми операції для підсумку: «з» = Сума продажу/Кількість (валюта), «у» = Отримує.
  //  Купівля: USD → UAH;  Продаж: USD → UAH (гривнева вартість);  Крос: F1 → F2.
  const summary = isCross
    ? { fromAmt: qtyNum, fromCur: clientCur, toAmt: rcvAmtNum, toCur: rcvCur }
    : { fromAmt: qtyNum, fromCur: qtyCur, toAmt: rcvAmtNum, toCur: rcvCur };

  const handleSubmit = async () => {
    if (!qtyNum || !rcvAmtNum || !rcvCur || !!balanceWarning) return;
    setLoading(true);
    setError('');
    try {
      let currency: string;
      let amount: number;
      let rate = rateNum;
      let payC: string | undefined;
      let payA: number | undefined;

      if (isCross) {
        // Крос: clientCur → rcvCur
        currency = rcvCur; amount = rcvAmtNum;
        payC = clientCur; payA = qtyNum;
      } else {
        // Купівля та Продаж: валюта операції = іноземна «Кількість»/«Сума продажу».
        // Тип (BUY/SELL) визначає напрямок на бекенді; курс = операційний.
        currency = qtyCur; amount = qtyNum;
      }

      const { data } = await api.post('/operations', {
        shiftId, currency, amount, rate, payCurrency: payC, payAmount: payA, mode,
      });

      setLastOp(data);
      setShowConfirm(false);
      setClientAmt(''); setHSumAmt(''); setHConvAmt(''); setHConvManual(false);
      setQtyAmt(''); setRcvAmt('');
      // Кастомний курс діє лише на одну операцію → повертаємо до ринкового
      setRateManual(false);
      setError('');
      onCreated();
    } catch (e: any) {
      setError(e.response?.data?.message || 'Помилка');
    } finally {
      setLoading(false);
    }
  };

  const modeColor = mode === 'BUY';
  const submitColor = modeColor ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700';
  // Курс завжди "1 (валюта операції) = X (отримує)": qtyCur → rcvCur.
  const rateLabelCur = qtyCur;
  const rateValCur   = rcvCur || 'UAH';
  // Чи показувати «Решту»: крос/Продаж за валюту (rcvCur≠UAH) або Продаж за гривні.
  const showChange = (rcvCur && rcvCur !== 'UAH') || sellNewFx;

  // ── Render ────────────────────────────────────────────────────────────────
  // Попередження балансу: у Продажі за гривні каса видає валюту (qtyCur) → підсвічуємо
  // «Суму продажу»; інакше (Купівля/крос) каса видає «Отримує» (rcvCur).
  const qtyWarn = sellNewFx ? balanceWarning : '';
  const rcvWarn = sellNewFx ? '' : balanceWarning;

  // Швидкі суми — заповнюють вказане поле
  const quickKeys = (current: string, onPick: (v: string) => void) =>
    quickAmounts.length > 0 ? (
      <div className="flex flex-wrap gap-1 pt-0.5">
        {quickAmounts.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onPick(String(v))}
            className={`px-3 py-1.5 rounded-lg text-lg font-semibold border transition ${
              Number(current) === v
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400 hover:text-blue-700'
            }`}
          >
            {v}
          </button>
        ))}
      </div>
    ) : null;

  // ── Поля (фрагменти, переставляються залежно від режиму) ──
  const clientField = (
    <div className="flex-1 space-y-1">
      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Клієнт приніс</div>
      <div className="flex gap-1">
        <CurSelect value={clientCur} onChange={handleClientCurChange} currencies={clientCurrencies} className="w-28 text-lg" />
        <input
          type="number" min="0" step="1" value={clientAmt}
          onChange={(e) => handleClientAmtChange(e.target.value)}
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2.5 text-right text-2xl font-bold focus:outline-none focus:ring-2 focus:ring-blue-400"
          placeholder="0" autoFocus={mode === 'BUY'}
        />
      </div>
      {mode === 'BUY' && quickKeys(clientAmt, handleClientAmtChange)}
    </div>
  );

  const rateField = (
    <div className="space-y-1">
      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Курс</div>
      <div className="flex items-center gap-1.5">
        {rateLabelCur && (
          <span className="text-sm font-semibold text-gray-600 whitespace-nowrap">1 {rateLabelCur} =</span>
        )}
        <input
          type="number" min="0" step="0.01" value={rateRaw}
          onChange={(e) => handleRateChange(e.target.value)}
          className={`w-28 border rounded-lg px-3 py-2.5 text-right text-xl font-bold focus:outline-none focus:ring-2 focus:ring-blue-400 transition ${
            isRateEdited ? 'border-amber-400 bg-amber-50 text-amber-800' : 'border-gray-300'
          }`}
          placeholder="0.00"
        />
        {rateValCur && <span className="text-sm text-gray-500">{rateValCur}</span>}
        {isRateEdited && (
          <button onClick={handleRateReset} className="text-xs text-blue-500 hover:underline whitespace-nowrap" title="Скинути до ринкового">↺</button>
        )}
      </div>
    </div>
  );

  const qtyField = (
    <div className="flex-1 space-y-1">
      <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
        {mode === 'SELL' ? 'Сума продажу' : 'Кількість'}
      </div>
      <div className="flex gap-1">
        <CurSelect value={qtyCur} onChange={handleQtyCurChange} currencies={foreignCurrencies} className={`w-20 text-lg ${qtyWarn ? 'border-red-400' : ''}`} />
        <input
          type="number" min="0" step="1" value={qtyAmt}
          onChange={(e) => handleQtyAmtChange(e.target.value)}
          className={`flex-1 border rounded-lg px-3 py-2.5 text-right text-2xl font-bold focus:outline-none focus:ring-2 focus:ring-blue-400 ${qtyWarn ? 'border-red-400 bg-red-50' : 'border-gray-300'}`}
          placeholder="0" autoFocus={mode === 'SELL'}
        />
      </div>
      {qtyWarn && <p className="text-xs text-red-500 leading-tight">{qtyWarn}</p>}
    </div>
  );

  const rcvField = (
    <div className="flex-1 space-y-1">
      <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Отримує</div>
      <div className="flex gap-1">
        <CurSelect value={rcvCur} onChange={handleRcvCurChange} currencies={allCurrencies} placeholder className={`w-20 text-lg ${rcvWarn ? 'border-red-400' : ''}`} />
        <div className={`flex-1 flex border rounded-lg ${rcvWarn ? 'border-red-400 bg-red-50' : 'border-dashed border-gray-300 bg-gray-50'}`}>
          <input
            type="number" min="0" step="1" value={rcvAmt}
            onChange={(e) => handleRcvAmtChange(e.target.value)}
            className="flex-1 px-3 py-2.5 text-right text-2xl font-bold bg-transparent focus:outline-none rounded-lg"
            placeholder="0"
          />
        </div>
      </div>
      {rcvWarn && <p className="text-xs text-red-500 leading-tight">{rcvWarn}</p>}
    </div>
  );

  const changeField = showChange ? (
    <div className="flex-1 space-y-1">
      <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Решта</div>
      <div className="flex gap-1">
        <CurSelect value={chgCur} onChange={setChgCur} currencies={allCurrencies} className="w-20 text-lg" />
        <div className={`flex-1 flex items-center justify-end rounded-lg px-3 py-2.5 font-bold text-2xl border ${
          changeAmt === null ? 'border-gray-200 bg-gray-50 text-gray-300' :
          changeAmt < -0.005 ? 'border-red-300 bg-red-50 text-red-700' :
          'border-green-200 bg-green-50 text-green-700'
        }`}>
          {changeAmt === null ? '—' :
           changeAmt < -0.005 ? `⚠ ${Math.abs(changeAmt).toFixed(2)}` :
           changeAmt.toFixed(2)}
        </div>
      </div>
      {changeAmt !== null && changeAmt < -0.005 && (
        <p className="text-xs text-red-500 leading-tight">клієнт повинен</p>
      )}
    </div>
  ) : (
    <div className="flex-1" />
  );

  const helpersBlock = (
    <div className="bg-gray-50 rounded-xl p-3 space-y-2">
      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Допоміжний розрахунок</div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 flex gap-1">
          <CurSelect value={hSumCur} onChange={(c) => { setHSumCur(c); setHConvManual(false); }} currencies={allCurrencies} className="w-24 text-sm" />
          <input
            type="number" min="0" step="1" value={hSumAmt}
            onChange={(e) => handleHSumAmtChange(e.target.value)}
            className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-right text-sm font-semibold bg-white focus:outline-none"
            placeholder="Сума"
          />
        </div>
        <button
          type="button"
          onClick={() => {
            const prevSumCur = hSumCur;
            const prevSumAmt = hSumAmt;
            const prevConvCur = hConvCur;
            const prevConvAmt = hConvDisplay;
            setHSumCur(prevConvCur);
            setHSumAmt(prevConvAmt);
            setHConvCur(prevSumCur);
            setHConvAmt(prevSumAmt);
            setHConvManual(!!prevSumAmt);
          }}
          className="text-black font-black text-2xl px-2 hover:text-blue-700 transition leading-none"
          title="Змінити напрямок конвертації"
        >⇄</button>
        <div className="flex-1 flex gap-1">
          <CurSelect value={hConvCur} onChange={handleHConvCurChange} currencies={allCurrencies} placeholder className="w-24 text-sm" />
          <input
            type="number" min="0" step="1"
            value={hConvDisplay}
            onChange={(e) => handleHConvAmtChange(e.target.value)}
            className="flex-1 border border-dashed border-gray-300 rounded-lg px-3 py-1.5 text-right text-sm font-semibold bg-gray-50 focus:outline-none focus:bg-white"
            placeholder="Конвертація"
          />
        </div>
      </div>
    </div>
  );

  return (
    <div className="bg-white shadow p-3 space-y-2.5">
      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Нова операція</div>

      {/* Mode tabs */}
      <div className="flex gap-2">
        {(['BUY', 'SELL'] as OpMode[]).map((m) => (
          <button key={m} onClick={() => handleModeChange(m)}
            className={`flex-1 py-2.5 rounded-lg text-xl font-bold border transition ${
              mode === m
                ? (m === 'BUY' ? 'bg-green-600 text-white border-green-600' : 'bg-red-600 text-white border-red-600')
                : m === 'BUY' ? 'border-green-200 text-green-700 hover:bg-green-50' : 'border-red-200 text-red-700 hover:bg-red-50'
            }`}>
            {m === 'BUY' ? '🟢 Купівля' : '🔴 Продаж'}
          </button>
        ))}
      </div>

      {mode === 'SELL' ? (
        /* ── ПРОДАЖ ── */
        <>
          {/* Ряд 1: Сума продажу | Отримує */}
          <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-start">
            {qtyField}
            {rcvField}
          </div>

          {/* Ряд 2: швидкі суми → заповнюють «Сума продажу» */}
          {quickKeys(qtyAmt, handleQtyAmtChange)}

          {/* Ряд 3: Курс | Клієнт приніс | Решта */}
          <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-start">
            {rateField}
            {clientField}
            {changeField}
          </div>

          {/* Допоміжний розрахунок — приховано (display:none) */}
          <div className="hidden">{helpersBlock}</div>
        </>
      ) : (
        /* ── КУПІВЛЯ ── */
        <>
          {/* Ряд 1: Клієнт приніс + Курс */}
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-start">
            {clientField}
            {rateField}
          </div>

          {/* Ряд 2: Допоміжний розрахунок */}
          {helpersBlock}

          {/* Ряд 3: Кількість | Отримує | Решта */}
          <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-start">
            {qtyField}
            {rcvField}
            {changeField}
          </div>
        </>
      )}

      {error && <p className="text-red-500 text-sm">{error}</p>}

      {/* Submit button */}
      <button
        onClick={() => setShowConfirm(true)}
        disabled={!qtyNum || !rcvAmtNum || !rcvCur || !!balanceWarning}
        className={`w-full font-bold py-3 rounded-lg disabled:opacity-50 transition text-lg text-white ${submitColor}`}>
        {qtyNum && rcvAmtNum && rcvCur
          ? `${mode === 'BUY' ? 'Купівля' : 'Продаж'}: ${summary.fromAmt.toFixed(2)} ${summary.fromCur} → ${summary.toAmt.toFixed(2)} ${summary.toCur}`
          : mode === 'BUY' ? 'Провести купівлю' : 'Провести продаж'
        }
      </button>

      {/* Confirm modal */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowConfirm(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-6 space-y-4" onClick={(e) => e.stopPropagation()}>

            <div className="text-center">
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Підтвердження операції</div>
              <div className={`text-xl font-bold ${mode === 'BUY' ? 'text-green-700' : 'text-red-600'}`}>
                {mode === 'BUY' ? '🟢 Купівля' : '🔴 Продаж'}
              </div>
            </div>

            <div className="bg-gray-50 rounded-xl p-4 text-center space-y-1">
              <div className="text-2xl font-bold text-gray-800">
                {summary.fromAmt.toFixed(2)} <span className="text-gray-500 text-lg">{summary.fromCur}</span>
              </div>
              <div className="text-gray-400 text-lg">↓</div>
              <div className="text-2xl font-bold text-gray-800">
                {summary.toAmt.toFixed(2)} <span className="text-gray-500 text-lg">{summary.toCur}</span>
              </div>
            </div>

            <div className="space-y-2 text-sm">
              {rateRaw && rateLabelCur && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Курс</span>
                  <span className="font-semibold text-gray-800">
                    1 {rateLabelCur} = {rateNum.toFixed(2)} {rateValCur}
                    {isRateEdited && <span className="text-amber-600 ml-1 text-xs">✱ інд.</span>}
                  </span>
                </div>
              )}
              {changeAmt !== null && showChange && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Решта клієнту</span>
                  <span className={`font-semibold ${changeAmt < 0 ? 'text-red-600' : 'text-green-700'}`}>
                    {changeAmt < 0 ? '⚠ ' : ''}{Math.abs(changeAmt).toFixed(2)} {chgCur}
                  </span>
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

      {/* Last op confirmation */}
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
