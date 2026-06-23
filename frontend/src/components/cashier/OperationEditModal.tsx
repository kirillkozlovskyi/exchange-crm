import { useState } from 'react';
import api from '../../api/axios';

type Op = {
  id: number;
  number: string;
  type: 'BUY' | 'SELL' | 'EXCHANGE';
  currency: string;
  amount: string | number;
  rate: string | number;
  totalUah: string | number;
  payCurrency?: string;
  payAmount?: string | number;
};

export default function OperationEditModal({
  op,
  onClose,
  onSaved,
}: {
  op: Op;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState(Number(op.amount).toFixed(2));
  const [rate, setRate] = useState(Number(op.rate).toFixed(2));
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const amountNum = parseFloat(amount) || 0;
  const rateNum = parseFloat(rate) || 0;
  const totalUah = amountNum > 0 && rateNum > 0 ? (amountNum * rateNum).toFixed(2) : '—';

  const isCross = op.type === 'EXCHANGE' && op.payCurrency;

  const handleSave = async () => {
    if (!amountNum || !rateNum) return;
    setLoading(true);
    setError('');
    try {
      await api.patch(`/operations/${op.id}`, { amount: amountNum, rate: rateNum, note });
      onSaved();
      onClose();
    } catch (e: any) {
      setError(e.response?.data?.message || 'Помилка збереження');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>

        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Редагування операції</div>
            <div className="font-bold text-gray-800 mt-0.5">#{op.number}</div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        {/* Тип і валюта */}
        <div className="bg-gray-50 rounded-lg px-4 py-2 text-sm text-gray-600 flex items-center gap-3">
          <span className={`font-semibold ${op.type === 'SELL' ? 'text-green-700' : 'text-red-700'}`}>
            {op.type === 'SELL' ? '🟢 Купівля' : op.type === 'BUY' ? '🔴 Продаж' : '🔄 Обмін'}
          </span>
          {isCross
            ? <span>{op.payCurrency} → {op.currency}</span>
            : <span>{op.currency}</span>
          }
        </div>

        {/* Поля редагування */}
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
              Кількість ({op.currency})
            </label>
            <input
              type="number" min="0" step="0.01" value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-right text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Курс</label>
            <input
              type="number" min="0" step="0.01" value={rate}
              onChange={(e) => setRate(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-right text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>

          <div className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-2.5">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Сума UAH</span>
            <span className="text-lg font-bold text-gray-800">{totalUah} ₴</span>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
              Причина зміни <span className="font-normal normal-case text-gray-400">(необов'язково)</span>
            </label>
            <input
              type="text" value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Коментар..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
        </div>

        {error && <p className="text-red-500 text-sm">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-gray-300 text-gray-700 font-medium text-sm hover:bg-gray-50 transition">
            Скасувати
          </button>
          <button onClick={handleSave} disabled={loading || !amountNum || !rateNum}
            className="flex-1 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm disabled:opacity-50 transition">
            {loading ? 'Збереження...' : 'Зберегти'}
          </button>
        </div>
      </div>
    </div>
  );
}
