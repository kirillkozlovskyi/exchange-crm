import { useState } from 'react';
import RatesAdmin from '../components/admin/RatesAdmin';
import FinanceAdmin from '../components/admin/FinanceAdmin';
import TransfersAdmin from '../components/admin/TransfersAdmin';
import OperationsAdmin from '../components/admin/OperationsAdmin';
import ActiveShiftsAdmin from '../components/admin/ActiveShiftsAdmin';
import ReconciliationsAdmin from '../components/admin/ReconciliationsAdmin';
import SettingsAdmin from '../components/admin/SettingsAdmin';
import NbuWidget from '../components/admin/NbuWidget';

type Tab = 'shifts' | 'rates' | 'operations' | 'finance' | 'transfers' | 'reconciliations' | 'settings';

const TABS: { key: Tab; label: string }[] = [
  { key: 'shifts',     label: '🟢 Хто працює' },
  { key: 'rates',      label: '📊 Курси' },
  { key: 'operations', label: '🔄 Операції' },
  { key: 'finance',    label: '💰 Фінанси' },
  { key: 'transfers',  label: '💸 Передачі' },
  { key: 'reconciliations', label: '⚖️ Звірки' },
  { key: 'settings',   label: '⚙️ Налаштування' },
];

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('shifts');

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <NbuWidget />
      <div className="flex gap-2 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg font-medium text-sm transition ${
              tab === t.key ? 'bg-blue-700 text-white' : 'bg-white text-gray-700 hover:bg-gray-100'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div>
        {tab === 'shifts'     && <ActiveShiftsAdmin />}
        {tab === 'rates'      && <RatesAdmin />}
        {tab === 'operations' && <OperationsAdmin />}
        {tab === 'finance'    && <FinanceAdmin />}
        {tab === 'transfers'  && <TransfersAdmin />}
        {tab === 'reconciliations' && <ReconciliationsAdmin />}
        {tab === 'settings'   && <SettingsAdmin />}
      </div>
    </div>
  );
}
