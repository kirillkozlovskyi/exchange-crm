import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import api from '../../api/axios';
import { expectedBasis, basisWarning } from '../../lib/profit';

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
  // Сер. курс (курс оцінки каси) по валютах — власник вводить щоранку;
  // дефолт — востаннє введені значення. Порожнє поле — не чіпаємо.
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

  // Орієнтир сер. курсу рахуємо від уже введеної гривні — інакше знаменником
  // кросу став би поточний продаж USD, а він може відрізнятись від бази каси.
  const uahBasis = parseFloat(costBasis.UAH ?? '') || 0;
  const warnFor = (cur: string) =>
    basisWarning(cur, parseFloat(costBasis[cur] ?? '') || 0, expectedBasis(cur, rates, uahBasis));
  const warnings = currencies
    .filter((c) => !c.startsWith('USD'))
    .map((cur) => [cur, warnFor(cur)] as const)
    .filter((x): x is readonly [string, string] => x[1] != null);

  const handleSubmit = async () => {
    setLoading(true);
    setError('');
    try {
      const startBalance = Object.fromEntries(
        Object.entries(balances).map(([k, v]) => [k, parseFloat(v) || 0])
      );
      // Сер. курс вводиться для гривні та всіх недоларових валют — курси
      // оцінки каси задає власник щоранку. Долари (USD*) — 1:1, без курсу.
      const basis: Record<string, number> = {};
      for (const [cur, raw] of Object.entries(costBasis)) {
        if (cur.startsWith('USD')) continue;
        const v = parseFloat(raw);
        if (v > 0) basis[cur] = v;
      }
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
              {!cur.startsWith('USD') ? (
                <input
                  type="number"
                  min="0"
                  step={cur === 'UAH' ? '0.01' : '0.0001'}
                  // Плейсхолдер — очікуване значення: касир бачить порядок числа
                  // ще до вводу («≈0.2610»), а не абстрактний прочерк.
                  placeholder={
                    expectedBasis(cur, rates, uahBasis) > 0
                      ? `≈${expectedBasis(cur, rates, uahBasis).toFixed(cur === 'UAH' ? 2 : 4)}`
                      : '—'
                  }
                  value={costBasis[cur] ?? ''}
                  onChange={(e) => setCostBasis((b) => ({ ...b, [cur]: e.target.value }))}
                  className={`w-28 border rounded px-3 py-2 text-right focus:outline-none focus:ring-2 ${
                    warnFor(cur)
                      ? 'border-red-400 bg-red-50 text-red-700 focus:ring-red-400'
                      : 'border-gray-300 focus:ring-blue-500'
                  }`}
                />
              ) : (
                <span className="w-28 text-right text-xs text-gray-400 self-center">1:1</span>
              )}
            </div>
          ))}
        </div>
        {warnings.length > 0 && (
          <div className="mt-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2">
            <p className="text-xs font-semibold text-red-700 mb-1">Перевірте сер. курс:</p>
            {warnings.map(([cur, msg]) => (
              <p key={cur} className="text-xs text-red-700">
                <b>{cur}</b> — {msg}
              </p>
            ))}
          </div>
        )}
        <p className="text-xs text-gray-400 mt-3">
          <b>Сер. курс</b> — курс оцінки каси, задається на ранок: гривня — ₴ за 1 $
          (напр. 44.95), інші валюти — вартість одиниці в доларах (напр. EUR 1.1420,
          PLN 0.2610). Долари всіх видів (USD, білий, ветошь) рахуються по факту 1:1
          без курсу. За замовчуванням підставлено востаннє введені значення.
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
