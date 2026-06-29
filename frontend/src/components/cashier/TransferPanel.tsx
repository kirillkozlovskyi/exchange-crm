import { useState, useEffect, useCallback } from 'react';
import api from '../../api/axios';

const CURRENCIES = ['UAH', 'USD', 'EUR', 'PLN', 'GBP', 'CHF', 'CAD', 'CZK'];

export default function TransferPanel({
  cashDeskId,
  balance,
  onBalanceChange,
  onPendingCountChange,
}: {
  cashDeskId: number;
  balance: Record<string, number>;
  onBalanceChange?: () => void;
  onPendingCountChange?: (count: number) => void;
}) {
  const [desks, setDesks] = useState<any[]>([]);
  const [pending, setPending] = useState<any[]>([]);
  const [toDeskId, setToDeskId] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  // Своп (Б2): зустрічне плече — отримувач віддає назад іншу валюту.
  const [isSwap, setIsSwap] = useState(false);
  const [counterCurrency, setCounterCurrency] = useState('UAH');
  const [counterAmount, setCounterAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Модалка відмови
  const [rejectTarget, setRejectTarget] = useState<{ id: number; amount: string; currency: string } | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [rejectLoading, setRejectLoading] = useState(false);

  const loadPending = useCallback(async () => {
    const { data } = await api.get(`/transfers/pending?deskId=${cashDeskId}`);
    setPending(data);
    onPendingCountChange?.(data.length);
  }, [cashDeskId, onPendingCountChange]);

  useEffect(() => {
    api.get('/cash-desks').then(({ data }) =>
      setDesks(data.filter((d: any) => d.id !== cashDeskId))
    );
    loadPending();
    const interval = setInterval(loadPending, 15000);
    return () => clearInterval(interval);
  }, [cashDeskId, loadPending]);

  const parsedAmount = parseFloat(amount) || 0;
  const balanceWarning = (() => {
    if (!parsedAmount) return '';
    const have = balance[currency] ?? 0;
    if (have < parsedAmount) {
      return `Недостатньо ${currency}: потрібно ${parsedAmount.toFixed(2)}, в касі ${have.toFixed(2)}`;
    }
    return '';
  })();

  const handleSend = async () => {
    if (!toDeskId || !amount) return;
    if (isSwap && (!counterAmount || counterCurrency === currency)) {
      setError(counterCurrency === currency ? 'Валюти свопу мають відрізнятися' : 'Вкажіть суму зустрічного плеча');
      return;
    }
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      await api.post('/transfers', {
        fromDeskId: cashDeskId,
        toDeskId: parseInt(toDeskId),
        currency,
        amount: parseFloat(amount),
        counterCurrency: isSwap ? counterCurrency : undefined,
        counterAmount: isSwap ? parseFloat(counterAmount) : undefined,
        note: note || undefined,
      });
      setAmount('');
      setCounterAmount('');
      setNote('');
      setSuccess(isSwap ? 'Своп відправлено, очікує підтвердження' : 'Передачу відправлено, очікує підтвердження');
      loadPending();
    } catch (e: any) {
      setError(e.response?.data?.message || 'Помилка');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async (id: number) => {
    await api.patch(`/transfers/${id}/confirm`);
    loadPending();
    onBalanceChange?.();
  };

  const openRejectModal = (t: any) => {
    setRejectTarget({ id: t.id, amount: Number(t.amount).toFixed(2), currency: t.currency });
    setRejectNote('');
  };

  const handleRejectConfirm = async () => {
    if (!rejectTarget) return;
    setRejectLoading(true);
    try {
      await api.patch(`/transfers/${rejectTarget.id}/reject`, { rejectNote: rejectNote || undefined });
      setRejectTarget(null);
      loadPending();
    } finally {
      setRejectLoading(false);
    }
  };

  return (
    <>
      {/* Модалка відмови */}
      {rejectTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h3 className="font-bold text-gray-800 text-lg">Відхилити передачу</h3>
            <p className="text-sm text-gray-600">
              Передача <span className="font-semibold">{rejectTarget.amount} {rejectTarget.currency}</span> буде відхилена.
              Відправник отримає сповіщення.
            </p>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Причина відмови (необов'язково)</label>
              <textarea
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                rows={3}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                placeholder="Вкажіть причину..."
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setRejectTarget(null)}
                className="flex-1 border border-gray-300 text-gray-700 py-2 rounded-lg text-sm hover:bg-gray-50"
              >
                Скасувати
              </button>
              <button
                onClick={handleRejectConfirm}
                disabled={rejectLoading}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {rejectLoading ? 'Відхилення...' : 'Підтвердити відмову'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Send form */}
        <div className="bg-white rounded-xl shadow p-5 space-y-3">
          <h3 className="font-semibold text-gray-800">Відправити гроші</h3>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Куди</label>
            <select
              value={toDeskId}
              onChange={(e) => setToDeskId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Оберіть касу</option>
              {desks.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.exchangePoint?.name} — {d.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-sm text-gray-600 mb-1">Валюта</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-sm text-gray-600 mb-1">Сума</label>
              <input
                type="number"
                min="0"
                step="1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0.00"
              />
            </div>
          </div>
          {/* Своп (Б2): отримувач віддає назад іншу валюту */}
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={isSwap}
              onChange={(e) => setIsSwap(e.target.checked)}
              className="w-4 h-4 accent-blue-600"
            />
            Обмін (своп) — отримати іншу валюту назад
          </label>
          {isSwap && (
            <div className="flex gap-2 bg-blue-50 border border-blue-200 rounded-lg p-2">
              <div className="flex-1">
                <label className="block text-xs text-gray-600 mb-1">Отримуєте назад: валюта</label>
                <select
                  value={counterCurrency}
                  onChange={(e) => setCounterCurrency(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="flex-1">
                <label className="block text-xs text-gray-600 mb-1">Сума</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={counterAmount}
                  onChange={(e) => setCounterAmount(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="0.00"
                />
              </div>
            </div>
          )}
          <div>
            <label className="block text-sm text-gray-600 mb-1">Примітка (необов'язково)</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="..."
            />
          </div>
          {balanceWarning && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-2.5 text-sm text-red-700">
              <span className="mt-0.5">⚠️</span>
              <span>{balanceWarning}</span>
            </div>
          )}
          {error && <p className="text-red-500 text-sm">{error}</p>}
          {success && <p className="text-green-600 text-sm">{success}</p>}
          <button
            onClick={handleSend}
            disabled={loading || !toDeskId || !amount || !!balanceWarning || (isSwap && !counterAmount)}
            className="w-full bg-blue-700 hover:bg-blue-800 text-white font-medium py-2 rounded-lg disabled:opacity-50"
          >
            {loading ? 'Відправлення...' : isSwap ? 'Відправити своп' : 'Відправити'}
          </button>
        </div>

        {/* Incoming pending */}
        <div className="bg-white rounded-xl shadow p-5">
          <h3 className="font-semibold text-gray-800 mb-3">
            Вхідні передачі
            {pending.length > 0 && (
              <span className="ml-2 bg-red-100 text-red-600 text-xs font-bold px-2 py-0.5 rounded-full">
                {pending.length}
              </span>
            )}
          </h3>
          <div className="space-y-3">
            {pending.length === 0 && (
              <p className="text-gray-400 text-sm text-center py-6">Немає вхідних передач</p>
            )}
            {pending.map((t) => (
              <div key={t.id} className="border border-yellow-200 bg-yellow-50 rounded-lg p-3">
                <div className="text-sm font-medium">
                  {Number(t.amount).toFixed(2)} {t.currency}
                  {t.counterCurrency && (
                    <span className="text-gray-500"> ↔ {Number(t.counterAmount).toFixed(2)} {t.counterCurrency}</span>
                  )}
                </div>
                {t.counterCurrency && (
                  <div className="text-xs text-blue-700 mb-1">
                    Своп: отримаєте {Number(t.amount).toFixed(2)} {t.currency}, віддасте {Number(t.counterAmount).toFixed(2)} {t.counterCurrency}
                  </div>
                )}
                <div className="text-xs text-gray-500 mb-2">
                  від: {t.fromDesk?.exchangePoint?.name} — {t.sentBy?.name}
                </div>
                {t.note && <div className="text-xs text-gray-600 mb-2 italic">{t.note}</div>}
                <div className="flex gap-2">
                  <button
                    onClick={() => handleConfirm(t.id)}
                    className="flex-1 bg-green-600 hover:bg-green-700 text-white text-sm py-1 rounded"
                  >
                    Прийняти
                  </button>
                  <button
                    onClick={() => openRejectModal(t)}
                    className="flex-1 bg-red-600 hover:bg-red-700 text-white text-sm py-1 rounded"
                  >
                    Відхилити
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
