import { useState } from 'react';

export default function OpenShiftForm({
  rates,
  onOpen,
}: {
  rates: any[];
  onOpen: (balance: Record<string, number>) => Promise<void>;
}) {
  // UAH always first, then point-specific currencies from rates
  const CURRENCIES = ['UAH', ...rates.map((r) => r.currency)];
  const [balances, setBalances] = useState<Record<string, string>>(
    Object.fromEntries(CURRENCIES.map((c) => [c, '0']))
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    setLoading(true);
    setError('');
    try {
      const startBalance = Object.fromEntries(
        Object.entries(balances).map(([k, v]) => [k, parseFloat(v) || 0])
      );
      await onOpen(startBalance);
    } catch (e: any) {
      setError(e.response?.data?.message || 'Помилка відкриття зміни');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto mt-10">
      <div className="bg-white rounded-2xl shadow-lg p-8">
        <h2 className="text-xl font-bold text-blue-700 mb-6">Відкрити зміну</h2>
        <p className="text-sm text-gray-500 mb-4">Введіть залишки готівки на початок зміни:</p>
        <div className="space-y-3">
          {CURRENCIES.map((cur) => (
            <div key={cur} className="flex items-center gap-3">
              <span className="w-12 font-semibold text-gray-700">{cur}</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={balances[cur]}
                onChange={(e) => setBalances((b) => ({ ...b, [cur]: e.target.value }))}
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          ))}
        </div>
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
