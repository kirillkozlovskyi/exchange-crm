import { useState } from 'react';
import CurrenciesAdmin from './CurrenciesAdmin';
import ExchangePointsAdmin from './ExchangePointsAdmin';
import UsersAdmin from './UsersAdmin';

type SubTab = 'currencies' | 'points' | 'users';

const SUBTABS: { key: SubTab; label: string }[] = [
  { key: 'currencies', label: '💱 Курс / Валюти' },
  { key: 'points',     label: '🏢 Точки та каси' },
  { key: 'users',      label: '👥 Користувачі' },
];

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
    </div>
  );
}
