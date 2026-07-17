import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import api from '../../api/axios';

export default function OpenShiftForm({
  rates,
  cashDeskId,
  onOpen,
}: {
  rates: any[];
  cashDeskId?: number | null;
  onOpen: (balance: Record<string, number>, costBasis?: Record<string, number>) => Promise<void>;
}) {
  // UAH always first, then point-specific currencies from rates
  const baseCurrencies = ['UAH', ...rates.map((r) => r.currency)];
  const [balances, setBalances] = useState<Record<string, string>>(
    Object.fromEntries(baseCurrencies.map((c) => [c, '0']))
  );
  // Початкова собівартість (сер. курс) валют — застосується лише там, де
  // собівартості ще нема (перша зміна / після скидання). Порожнє — не чіпаємо.
  const [costBasis, setCostBasis] = useState<Record<string, string>>({});
  const [prevInfo, setPrevInfo] = useState<{ number: string; closedAt: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Підтягуємо залишок із закриття попередньої зміни цієї каси
  useEffect(() => {
    if (!cashDeskId) return;
    api.get(`/shifts/last-balance/desk/${cashDeskId}`)
      .then(({ data }) => {
        // Дефолт сер. курсу — поточна перенесена собівартість каси (редагується).
        const cb: Record<string, number> = data.costBasis || {};
        if (Object.keys(cb).length > 0) {
          setCostBasis((prev) => {
            const merged = { ...prev };
            for (const [k, v] of Object.entries(cb)) merged[k] = String(Number(v));
            return merged;
          });
        }
        const eb: Record<string, number> = data.endBalance || {};
        if (Object.keys(eb).length === 0) return;
        setBalances((prev) => {
          const merged = { ...prev };
          for (const [k, v] of Object.entries(eb)) merged[k] = String(Number(v).toFixed(2));
          return merged;
        });
        setPrevInfo(data.from);
      })
      .catch(() => { /* немає попередньої зміни — лишаємо нулі */ });
  }, [cashDeskId]);

  // Валюти для показу: базові + будь-які з підтягнутого залишку (щоб нічого не загубити)
  const currencies = Array.from(new Set([...baseCurrencies, ...Object.keys(balances)]));

  const resetZero = () =>
    setBalances(Object.fromEntries(currencies.map((c) => [c, '0'])));

  const handleSubmit = async () => {
    setLoading(true);
    setError('');
    try {
      const startBalance = Object.fromEntries(
        Object.entries(balances).map(([k, v]) => [k, parseFloat(v) || 0])
      );
      // Єдине редаговане поле собівартості — сер. курс гривні (₴ за $).
      // Кроси валют рахуються автоматично від нього (buy(cur) ÷ сер. курс).
      const basis: Record<string, number> = {};
      const uah = parseFloat(costBasis.UAH ?? '');
      if (uah > 0) basis.UAH = uah;
      await onOpen(startBalance, Object.keys(basis).length ? basis : undefined);
    } catch (e: any) {
      setError(e.response?.data?.message || 'Помилка відкриття зміни');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto mt-2">
      <div className="bg-white rounded-2xl shadow-lg p-8">
        <h2 className="text-xl font-bold text-blue-700 mb-2">Відкрити зміну</h2>
        {prevInfo ? (
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-green-700 bg-green-50 rounded-lg px-3 py-1.5">
              Підтягнуто із закриття зміни #{prevInfo.number} ({format(new Date(prevInfo.closedAt), 'dd.MM.yyyy HH:mm')})
            </p>
            <button onClick={resetZero} className="text-xs text-gray-400 hover:text-gray-600 ml-2 whitespace-nowrap">
              обнулити
            </button>
          </div>
        ) : (
          <p className="text-sm text-gray-500 mb-4">Введіть залишки готівки на початок зміни:</p>
        )}
        <div className="space-y-3">
          <div className="flex items-center gap-3 text-xs text-gray-400">
            <span className="w-12" />
            <span className="flex-1 text-right">Залишок</span>
            <span className="w-28 text-right">Сер. курс</span>
          </div>
          {currencies.map((cur) => (
            <div key={cur} className="flex items-center gap-3">
              <span className="w-12 font-semibold text-gray-700">{cur}</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={balances[cur] ?? '0'}
                onChange={(e) => setBalances((b) => ({ ...b, [cur]: e.target.value }))}
                className="flex-1 border border-gray-300 rounded px-3 py-2 text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {cur === 'UAH' ? (
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="—"
                  value={costBasis.UAH ?? ''}
                  onChange={(e) => setCostBasis((b) => ({ ...b, UAH: e.target.value }))}
                  className="w-28 border border-gray-300 rounded px-3 py-2 text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              ) : (
                <span className="w-28" />
              )}
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-3">
          <b>Сер. курс</b> — середній курс проданого долара (₴ за 1 $, напр. 44.95):
          каса міряється в доларах, і прибуток рахується від цього курсу. Вартість
          валют у доларах рахується автоматично (курс купівлі ÷ сер. курс, напр. EUR
          51.30/44.90 = 1.1420). За замовчуванням підставлено поточний (перенесений);
          змінюйте лише за потреби — напр. після скидання.
        </p>
        {error && <p className="text-red-500 text-sm mt-3">{error}</p>}
        <button
          onClick={handleSubmit}
          disabled={loading}
          className="mt-6 w-full bg-blue-700 hover:bg-blue-800 text-white font-medium py-2 rounded-lg disabled:opacity-50"
        >
          {loading ? 'Відкриваємо...' : 'Відкрити зміну'}
        </button>
      </div>
    </div>
  );
}
