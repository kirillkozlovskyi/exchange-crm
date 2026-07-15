import { useState } from 'react';
import api from '../../api/axios';
import { WORLD_CURRENCIES } from '../../data/currencyMeta';

/**
 * Прибуток за розрахунком касира — довідкове поле (не впливає на облік).
 * Викликається окремою іконкою біля операції. Три поля у два ряди:
 *   ряд 1 — сума (number, від'ємні дозволені, крок 1) + валюта (дефолт UAH);
 *   ряд 2 — опис «як рахував» (textarea).
 */
export default function CashierProfitModal({
  op, onClose, onSaved,
}: {
  op: {
    id: number; number: string;
    cashierProfit?: string | number | null;
    cashierProfitCurrency?: string | null;
    cashierProfitNote?: string | null;
  };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [profit, setProfit] = useState(
    op.cashierProfit != null && op.cashierProfit !== '' ? String(op.cashierProfit) : '',
  );
  const [currency, setCurrency] = useState(op.cashierProfitCurrency || 'UAH');
  const [note, setNote] = useState(op.cashierProfitNote || '');
  const [saving, setSaving] = useState(false);

  // Валюта — гривня першою, далі решта довідника.
  const currencies = ['UAH', ...WORLD_CURRENCIES.map((c) => c.code).filter((c) => c !== 'UAH')];

  const save = async () => {
    setSaving(true);
    try {
      await api.patch(`/operations/${op.id}/cashier-profit`, {
        profit: profit.trim() === '' ? null : parseFloat(profit),
        currency,
        note,
      });
      onSaved();
      onClose();
    } catch {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-lg w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div>
          <h3 className="font-semibold text-gray-800">Прибуток з операції</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            Ваш розрахунок для операції № {op.number}. Довідково — на облік не впливає.
          </p>
        </div>

        {/* Ряд 1: сума + валюта */}
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="text-xs text-gray-500 block mb-1">Прибуток</label>
            <input
              type="number"
              step={1}
              inputMode="numeric"
              value={profit}
              onChange={(e) => setProfit(e.target.value)}
              placeholder="напр. 200 або -50"
              autoFocus
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          <div className="w-32">
            <label className="text-xs text-gray-500 block mb-1">Валюта</label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        {/* Ряд 2: опис */}
        <div>
          <label className="text-xs text-gray-500 block mb-1">Як рахували (необов'язково)</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="Напр.: продав по 44.80, відкупив по 44.60 → 0.20 × 1000"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 rounded-lg hover:bg-gray-100">
            Скасувати
          </button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 text-sm font-medium bg-blue-700 hover:bg-blue-800 text-white rounded-lg disabled:opacity-50">
            {saving ? 'Збереження...' : 'Зберегти'}
          </button>
        </div>
      </div>
    </div>
  );
}
