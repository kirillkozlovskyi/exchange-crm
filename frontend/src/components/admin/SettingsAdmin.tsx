import { useState, useEffect } from 'react';
import CurrenciesAdmin from './CurrenciesAdmin';
import ExchangePointsAdmin from './ExchangePointsAdmin';
import UsersAdmin from './UsersAdmin';
import api from '../../api/axios';

type SubTab = 'currencies' | 'points' | 'users' | 'operations';

const SUBTABS: { key: SubTab; label: string }[] = [
  { key: 'currencies', label: '💱 Курс / Валюти' },
  { key: 'points',     label: '🏢 Точки та каси' },
  { key: 'users',      label: '👥 Користувачі' },
  { key: 'operations', label: '⚙️ Операції' },
];

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${enabled ? 'bg-blue-600' : 'bg-gray-300'}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  );
}

function OperationsSettings() {
  const [minutes, setMinutes] = useState<number>(5);
  const [balanceEdit, setBalanceEdit] = useState<boolean>(true);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get('/settings/storno-window'),
      api.get('/settings/balance-edit'),
    ]).then(([s, b]) => {
      setMinutes(s.data.minutes);
      setBalanceEdit(b.data.enabled);
    });
  }, []);

  const handleSave = async () => {
    setLoading(true);
    setSaved(false);
    try {
      await Promise.all([
        api.put('/settings/storno-window', { minutes }),
        api.put('/settings/balance-edit', { enabled: balanceEdit }),
      ]);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow p-6 max-w-md space-y-5">
      <h3 className="font-semibold text-gray-800 text-base">Налаштування операцій</h3>

      {/* Вікно сторно */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-700">Вікно сторно (хвилин)</label>
        <p className="text-xs text-gray-400">
          Касир може скасувати останню операцію протягом вказаного часу після її підтвердження.
        </p>
        <div className="flex items-center gap-3">
          <input
            type="number" min="1" max="60" value={minutes}
            onChange={(e) => setMinutes(Math.max(1, parseInt(e.target.value) || 1))}
            className="w-24 border border-gray-300 rounded-lg px-3 py-2 text-center text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          <span className="text-gray-500 text-sm">хвилин</span>
        </div>
      </div>

      <div className="border-t border-gray-100" />

      {/* Редагування залишків */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm font-medium text-gray-700">Редагування залишків каси</p>
          <p className="text-xs text-gray-400">
            Дозволити касиру коригувати фактичний залишок впродовж зміни.
          </p>
        </div>
        <Toggle enabled={balanceEdit} onChange={setBalanceEdit} />
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={handleSave} disabled={loading}
          className="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition">
          {loading ? 'Збереження...' : 'Зберегти'}
        </button>
        {saved && <p className="text-green-600 text-sm">✓ Збережено</p>}
      </div>
    </div>
  );
}

export default function SettingsAdmin() {
  const [tab, setTab] = useState<SubTab>('currencies');

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow p-1 flex gap-1 w-fit">
        {SUBTABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              tab === t.key
                ? 'bg-blue-700 text-white'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'currencies' && <CurrenciesAdmin />}
      {tab === 'points'     && <ExchangePointsAdmin />}
      {tab === 'users'      && <UsersAdmin />}
      {tab === 'operations' && <OperationsSettings />}
    </div>
  );
}
