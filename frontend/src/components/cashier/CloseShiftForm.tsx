import { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { computeCurrentBalance } from '../../lib/balance';
import { midRates, shiftProfit } from '../../lib/profit';
import { netTransfers, type TransferRow } from '../../lib/transfers';

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
  deskId,
  transfers = [],
  onClose,
  onCancel,
}: {
  shift: Shift;
  rates?: Rate[];
  deskId?: number;
  transfers?: TransferRow[];
  onClose: (endBalance: Record<string, number>) => Promise<void>;
  onCancel: () => void;
}) {
  const startBal = (shift.startBalance as Record<string, number>) || {};

  // Нетто-передачі каси за зміну (отримано − відправлено) по валютах.
  // Це рух готівки між касами, а не прибуток — вилучаємо з фактичного результату.
  const net = useMemo(
    () => (deskId != null ? netTransfers(transfers, deskId) : {}),
    [transfers, deskId],
  );

  // ── Розрахунковий залишок (спільна логіка з бекендом, lib/balance) ─────────
  const calcBalance = useMemo(
    () => computeCurrentBalance({ UAH: 0, ...startBal }, shift.operations),
    [shift],
  );

  // Всі валюти: UAH + всі з балансу + всі з операцій + всі з передач
  const currencies = useMemo(() => {
    const set = new Set<string>(['UAH']);
    for (const k of Object.keys(startBal)) set.add(k);
    for (const op of shift.operations) set.add(op.currency);
    for (const k of Object.keys(net)) set.add(k);
    return Array.from(set);
  }, [shift, startBal, net]);

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
  // Фактичний результат — за введеним залишком МІНУС нетто-передачі (їх вилучаємо,
  // бо отримана/відправлена валюта не є прибутком каси).
  const factualEnd = useMemo(() => {
    const eff: Record<string, number> = { ...endBalParsed };
    for (const [cur, amt] of Object.entries(net)) eff[cur] = (eff[cur] ?? 0) - amt;
    return eff;
  }, [endBalParsed, net]);
  const factualProfit = shiftProfit(startValued, factualEnd, valuation);

  // Чи були передачі взагалі (для умовного показу колонки/рядка)
  const hasTransfers = Object.values(net).some((v) => Math.abs(v) >= 0.005);

  // Порозрядна розбивка торгового прибутку по валютах (для зрозумілого блоку).
  // Внесок у прибуток = (розрахунковий залишок − відкриття) × серединний курс.
  // Передачі показуються окремо й у прибуток НЕ входять (їх немає в calcBalance).
  const profitRows = useMemo(() => {
    return currencies
      .map((cur) => {
        const open = Number(startBal[cur] ?? 0);
        const close = calcBalance[cur] ?? 0;
        const transfer = net[cur] ?? 0;
        const mid = valuation[cur] ?? 0;
        const profitUah = (close - open) * mid;
        return { cur, open, close, transfer, profitUah };
      })
      .filter((r) =>
        Math.abs(r.open) >= 0.005 ||
        Math.abs(r.close) >= 0.005 ||
        Math.abs(r.transfer) >= 0.005 ||
        Math.abs(r.profitUah) >= 0.005,
      );
  }, [currencies, startBal, calcBalance, net, valuation]);

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

  const cashDiff = factualProfit - tradingProfit;

  return (
    <div className="w-full space-y-4 pb-28">

      {/* ── Заголовок (липкий) ── */}
      <div className="sticky top-0 z-20 bg-white/95 backdrop-blur rounded-xl shadow p-4 flex items-center justify-between">
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

      {/* ── Основна сітка: зліва підрахунок (головна дія), справа підсумки ── */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">

        {/* ── Ліва колонка: Підрахунок залишку ── */}
        <div className="xl:col-span-8 bg-white rounded-xl shadow p-5">
          <div className="flex items-baseline justify-between mb-1">
            <h3 className="font-semibold text-gray-800">Підрахунок залишку</h3>
            {hasDiscrepancy && (
              <span className="text-xs font-semibold text-red-600 bg-red-50 rounded-full px-2.5 py-0.5">
                є розбіжності
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400 mb-4">
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
                    <td className="py-2.5 font-bold text-gray-800">{cur}</td>
                    <td className="py-2.5 text-right text-gray-500">{start.toFixed(2)}</td>
                    <td className="py-2.5 text-right font-medium text-blue-700">{expected.toFixed(2)}</td>
                    <td className="py-2.5 text-right">
                      <input
                        type="number"
                        step="0.01"
                        value={endBal[cur]}
                        onChange={(e) => setEndBal((b) => ({ ...b, [cur]: e.target.value }))}
                        className={`w-32 border rounded-lg px-3 py-1.5 text-right font-medium focus:outline-none focus:ring-2 ${
                          hasDiff ? 'border-red-300 focus:ring-red-400 bg-red-50' : 'focus:ring-blue-400'
                        }`}
                      />
                    </td>
                    <td className={`py-2.5 text-right font-semibold ${
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
            <div className="mt-4 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
              ⚠️ Виявлено розбіжності. Перевірте касу та виправте значення або підтвердіть з розбіжністю.
            </div>
          )}
        </div>

        {/* ── Права колонка: прибуток + операції ── */}
        <div className="xl:col-span-4 space-y-4">

          {/* Підсумок прибутку — розбивка по валютах */}
          <div className="bg-white rounded-xl shadow p-5">
            <h3 className="font-semibold text-gray-800 mb-1">Прибуток за зміну</h3>
            <p className="text-xs text-gray-400 mb-3">
              Зміна залишку кожної валюти від відкриття до закриття, за серединним курсом.
              {hasTransfers && ' Передачі між касами не входять у прибуток.'}
            </p>

            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 border-b">
                  <th className="pb-2 text-left">Валюта</th>
                  <th className="pb-2 text-right">Відкриття</th>
                  {hasTransfers && <th className="pb-2 text-right">Передачі</th>}
                  <th className="pb-2 text-right">Закриття</th>
                  <th className="pb-2 text-right">Прибуток&nbsp;₴</th>
                </tr>
              </thead>
              <tbody>
                {profitRows.map((r) => (
                  <tr key={r.cur} className="border-b last:border-0">
                    <td className="py-2 font-bold text-gray-800">{r.cur}</td>
                    <td className="py-2 text-right text-gray-500">{r.open.toFixed(2)}</td>
                    {hasTransfers && (
                      <td className={`py-2 text-right ${
                        Math.abs(r.transfer) < 0.005 ? 'text-gray-300' :
                        r.transfer > 0 ? 'text-blue-600' : 'text-orange-600'
                      }`}>
                        {Math.abs(r.transfer) < 0.005 ? '—' : (r.transfer > 0 ? '+' : '') + r.transfer.toFixed(2)}
                      </td>
                    )}
                    <td className="py-2 text-right font-medium text-gray-700">{r.close.toFixed(2)}</td>
                    <td className={`py-2 text-right font-semibold ${
                      Math.abs(r.profitUah) < 0.005 ? 'text-gray-300' :
                      r.profitUah > 0 ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {Math.abs(r.profitUah) < 0.005 ? '—' : (r.profitUah > 0 ? '+' : '') + r.profitUah.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200">
                  <td colSpan={hasTransfers ? 4 : 3} className="pt-2.5 font-semibold text-gray-700">
                    Торговий прибуток
                  </td>
                  <td className={`pt-2.5 text-right text-lg font-bold ${tradingProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {tradingProfit >= 0 ? '+' : ''}{tradingProfit.toFixed(2)}
                  </td>
                </tr>
              </tfoot>
            </table>

            {/* Фактичний результат (за введеним залишком, передачі вилучено) */}
            <div className="flex items-center justify-between mt-4 pt-3 border-t">
              <div>
                <span className="font-semibold text-gray-700">Фактичний результат</span>
                <div className="text-xs text-gray-400">
                  за введеним залишком{hasTransfers ? ' (без передач)' : ''}
                </div>
              </div>
              <span className={`text-lg font-bold ${factualProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {factualProfit >= 0 ? '+' : ''}{factualProfit.toFixed(2)} ₴
              </span>
            </div>
            {Math.abs(cashDiff) >= 0.01 && (
              <div className="text-sm text-amber-600 bg-amber-50 rounded-lg px-3 py-1.5 mt-2">
                Розбіжність каси (нестача/надлишок): {cashDiff >= 0 ? '+' : ''}{cashDiff.toFixed(2)} ₴
              </div>
            )}
          </div>

          {/* Операції зміни (скрол при великій кількості) */}
          <div className="bg-white rounded-xl shadow p-5">
            <h3 className="font-semibold text-gray-800 mb-3">
              Операції зміни <span className="text-gray-400 font-normal">· {shift.operations.length}</span>
            </h3>
            {shift.operations.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-4">Операцій не було</p>
            ) : (
              <div className="overflow-auto max-h-[28rem]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white">
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
        </div>
      </div>

      {/* ── Підтвердження (липка панель дій) ── */}
      <div className="fixed bottom-0 left-0 right-0 z-20 bg-white/95 backdrop-blur border-t border-gray-200 px-4 sm:px-6 py-3">
        <div className="w-full space-y-2">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-red-700 text-sm">
              {error}
            </div>
          )}
          <div className="flex justify-end gap-3">
            <button
              onClick={onCancel}
              className="px-6 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-medium transition"
            >
              Скасувати
            </button>
            <button
              onClick={handleSubmit}
              disabled={saving}
              className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-xl disabled:opacity-50 transition"
            >
              {saving ? 'Закриваємо...' : hasDiscrepancy ? '⚠️ Закрити зміну з розбіжністю' : '✓ Закрити зміну'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
