import { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { computeCurrentBalance } from '../../lib/balance';
import { midRates, shiftProfit } from '../../lib/profit';

type Operation = {
  id: number;
  type: 'BUY' | 'SELL';
  currency: string;
  amount: string | number;
  rate: string | number;
  totalUah: string | number;
  payCurrency?: string | null;
  payAmount?: string | number | null;
  cancelled?: boolean;
  createdAt: string;
};

type Shift = {
  id: number;
  number: string;
  openedAt: string;
  startBalance: Record<string, number>;
  operations: Operation[];
};

type Rate = { currency: string; buy: number | string; sell: number | string };

export default function CloseShiftForm({
  shift,
  rates = [],
  onClose,
  onCancel,
}: {
  shift: Shift;
  rates?: Rate[];
  onClose: (endBalance: Record<string, number>) => Promise<void>;
  onCancel: () => void;
}) {
  const startBal = (shift.startBalance as Record<string, number>) || {};

  // ── Розрахунковий залишок (спільна логіка з бекендом, lib/balance) ─────────
  const calcBalance = useMemo(
    () => computeCurrentBalance({ UAH: 0, ...startBal }, shift.operations),
    [shift],
  );

  // Всі валюти: UAH + всі з балансу + всі з операцій
  const currencies = useMemo(() => {
    const set = new Set<string>(['UAH']);
    for (const k of Object.keys(startBal)) set.add(k);
    for (const op of shift.operations) set.add(op.currency);
    return Array.from(set);
  }, [shift, startBal]);

  // Фактичний залишок (вводить касир) — prefill з calcBalance
  const [endBal, setEndBal] = useState<Record<string, string>>(
    Object.fromEntries(currencies.map((c) => [c, String(calcBalance[c]?.toFixed(2) ?? '0')]))
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // ── Прибуток = приріст вартості каси за серединним курсом ───────────────────
  const valuation = useMemo(() => midRates(rates), [rates]);
  const startValued = useMemo(() => ({ UAH: 0, ...startBal }), [startBal]);
  // Торговий — за розрахунковим залишком; фактичний — за введеним касиром
  const tradingProfit = useMemo(
    () => shiftProfit(startValued, calcBalance, valuation),
    [startValued, calcBalance, valuation],
  );
  const endBalParsed = useMemo(
    () => Object.fromEntries(Object.entries(endBal).map(([k, v]) => [k, parseFloat(v) || 0])),
    [endBal],
  );
  const factualProfit = shiftProfit(startValued, endBalParsed, valuation);

  const handleSubmit = async () => {
    setSaving(true);
    setError('');
    try {
      const balanceObj = Object.fromEntries(
        Object.entries(endBal).map(([k, v]) => [k, parseFloat(v) || 0])
      );
      await onClose(balanceObj);
    } catch (e: any) {
      setError(e.response?.data?.message ?? 'Помилка закриття зміни');
    } finally {
      setSaving(false);
    }
  };

  const hasDiscrepancy = currencies.some((c) => {
    const actual = parseFloat(endBal[c]) || 0;
    const expected = calcBalance[c] ?? 0;
    return Math.abs(actual - expected) >= 0.01;
  });

  return (
    <div className="max-w-3xl mx-auto space-y-4 pb-8">

      {/* ── Заголовок ── */}
      <div className="bg-white rounded-xl shadow p-4 flex items-center justify-between">
        <div>
          <h2 className="font-bold text-lg text-red-700">Закриття зміни</h2>
          <div className="text-sm text-gray-500 mt-0.5">
            Зміна #{shift.number} · відкрита {format(new Date(shift.openedAt), 'dd.MM.yyyy HH:mm')}
          </div>
        </div>
        <button onClick={onCancel} className="text-sm text-gray-400 hover:text-gray-600">
          ← Скасувати
        </button>
      </div>

      {/* ── Підсумок прибутку (приріст вартості каси за серединним курсом) ── */}
      <div className="bg-white rounded-xl shadow p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <span className="font-semibold text-gray-700">Торговий прибуток</span>
            <div className="text-xs text-gray-400">за розрахунковим залишком · {shift.operations.length} операцій</div>
          </div>
          <span className={`text-xl font-bold ${tradingProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {tradingProfit >= 0 ? '+' : ''}{tradingProfit.toFixed(2)} ₴
          </span>
        </div>
        <div className="flex items-center justify-between border-t pt-2">
          <div>
            <span className="font-semibold text-gray-700">Фактичний результат</span>
            <div className="text-xs text-gray-400">за введеним залишком (з нестачею/надлишком)</div>
          </div>
          <span className={`text-xl font-bold ${factualProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {factualProfit >= 0 ? '+' : ''}{factualProfit.toFixed(2)} ₴
          </span>
        </div>
        {Math.abs(factualProfit - tradingProfit) >= 0.01 && (
          <div className="text-sm text-amber-600 bg-amber-50 rounded-lg px-3 py-1.5">
            Розбіжність каси: {(factualProfit - tradingProfit) >= 0 ? '+' : ''}{(factualProfit - tradingProfit).toFixed(2)} ₴
          </div>
        )}
      </div>

      {/* ── Баланс: залишок по валютах ── */}
      <div className="bg-white rounded-xl shadow p-4">
        <h3 className="font-semibold text-gray-800 mb-3">Підрахунок залишку</h3>
        <p className="text-xs text-gray-400 mb-3">
          Введіть фактичний залишок у касі. Система порівняє з розрахунковим.
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-400 border-b">
              <th className="pb-2 text-left">Валюта</th>
              <th className="pb-2 text-right">На початок</th>
              <th className="pb-2 text-right">Очікувано</th>
              <th className="pb-2 text-right">Фактично</th>
              <th className="pb-2 text-right">Різниця</th>
            </tr>
          </thead>
          <tbody>
            {currencies.map((cur) => {
              const start = Number(startBal[cur] ?? 0);
              const expected = calcBalance[cur] ?? 0;
              const actual = parseFloat(endBal[cur]) || 0;
              const diff = actual - expected;
              const hasDiff = Math.abs(diff) >= 0.01;
              return (
                <tr key={cur} className={`border-b last:border-0 ${hasDiff ? 'bg-red-50' : ''}`}>
                  <td className="py-2 font-bold text-gray-800">{cur}</td>
                  <td className="py-2 text-right text-gray-500">{start.toFixed(2)}</td>
                  <td className="py-2 text-right font-medium text-blue-700">{expected.toFixed(2)}</td>
                  <td className="py-2 text-right">
                    <input
                      type="number"
                      step="0.01"
                      value={endBal[cur]}
                      onChange={(e) => setEndBal((b) => ({ ...b, [cur]: e.target.value }))}
                      className={`w-28 border rounded px-2 py-1 text-right focus:outline-none focus:ring-2 ${
                        hasDiff ? 'border-red-300 focus:ring-red-400 bg-red-50' : 'focus:ring-blue-400'
                      }`}
                    />
                  </td>
                  <td className={`py-2 text-right font-semibold ${
                    !hasDiff ? 'text-gray-300' : diff > 0 ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {hasDiff ? (diff > 0 ? '+' : '') + diff.toFixed(2) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {hasDiscrepancy && (
          <div className="mt-3 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
            ⚠️ Виявлено розбіжності. Перевірте касу та виправте значення або підтвердіть з розбіжністю.
          </div>
        )}
      </div>

      {/* ── Список операцій ── */}
      <div className="bg-white rounded-xl shadow p-4">
        <h3 className="font-semibold text-gray-800 mb-3">Операції зміни</h3>
        {shift.operations.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-4">Операцій не було</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 border-b">
                  <th className="pb-2 text-left">Час</th>
                  <th className="pb-2 text-left">Тип</th>
                  <th className="pb-2 text-right">Сума</th>
                  <th className="pb-2 text-right">Курс</th>
                  <th className="pb-2 text-right">UAH</th>
                </tr>
              </thead>
              <tbody>
                {[...shift.operations].reverse().map((op) => (
                  <tr key={op.id} className="border-b last:border-0">
                    <td className="py-1.5 text-gray-400 text-xs">
                      {format(new Date(op.createdAt), 'HH:mm')}
                    </td>
                    <td className="py-1.5">
                      <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
                        op.type === 'BUY' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                      }`}>
                        {op.type === 'BUY' ? 'Купівля' : 'Продаж'}
                      </span>
                    </td>
                    <td className="py-1.5 text-right font-medium">
                      {Number(op.amount).toFixed(2)} <span className="text-gray-400 text-xs">{op.currency}</span>
                    </td>
                    <td className="py-1.5 text-right text-gray-500">
                      {Number(op.rate).toFixed(2)}
                    </td>
                    <td className="py-1.5 text-right">
                      {Number(op.totalUah).toFixed(2)} ₴
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Підтвердження ── */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-700 text-sm">
          {error}
        </div>
      )}
      <div className="flex gap-3">
        <button
          onClick={handleSubmit}
          disabled={saving}
          className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold py-3 rounded-xl disabled:opacity-50 transition"
        >
          {saving ? 'Закриваємо...' : hasDiscrepancy ? '⚠️ Закрити зміну з розбіжністю' : '✓ Закрити зміну'}
        </button>
        <button
          onClick={onCancel}
          className="px-6 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-medium transition"
        >
          Скасувати
        </button>
      </div>
    </div>
  );
}
