import { useState, useEffect } from 'react';
import api from '../api/axios';
import AdminOverview from '../components/admin/AdminOverview';
import RatesAdmin from '../components/admin/RatesAdmin';
import FinanceAdmin from '../components/admin/FinanceAdmin';
import TransfersAdmin from '../components/admin/TransfersAdmin';
import CashMovementsAdmin from '../components/admin/CashMovementsAdmin';
import UsdtAdmin from '../components/admin/UsdtAdmin';
import CashBankAdmin from '../components/admin/CashBankAdmin';
import OperationsAdmin from '../components/admin/OperationsAdmin';
import ShiftsAdmin from '../components/admin/ShiftsAdmin';
import ReconciliationsAdmin from '../components/admin/ReconciliationsAdmin';
import OperationsSettings, { NbuSettings, NotificationsSettings } from '../components/admin/SettingsAdmin';
import CurrenciesAdmin from '../components/admin/CurrenciesAdmin';
import ExchangePointsAdmin from '../components/admin/ExchangePointsAdmin';
import UsersAdmin from '../components/admin/UsersAdmin';
import ExpensesAdmin from '../components/admin/ExpensesAdmin';

type Tab =
  | 'overview' | 'rates' | 'bank'
  | 'finance' | 'expenses' | 'shiftlog' | 'operations' | 'usdt' | 'transfers' | 'cashmovements' | 'reconciliations'
  | 'set-currencies' | 'set-points' | 'set-users' | 'set-operations' | 'set-notifications';

// Сайдбар: групи → пункти. Порядок = частота використання.
const NAV: { header?: string; items: { key: Tab; icon: string; label: string }[] }[] = [
  {
    items: [{ key: 'overview', icon: '🏠', label: 'Огляд' }],
  },
  {
    header: 'Гроші',
    items: [
      { key: 'rates', icon: '📊', label: 'Курси' },
      { key: 'bank', icon: '🏦', label: 'Банк' },
    ],
  },
  {
    header: 'Звіти',
    items: [
      { key: 'finance', icon: '💰', label: 'Фінанси' },
      { key: 'expenses', icon: '🧮', label: 'Витрати' },
      { key: 'shiftlog', icon: '📋', label: 'Зміни' },
      { key: 'operations', icon: '🔄', label: 'Операції' },
      { key: 'usdt', icon: '₮', label: 'USDT' },
      { key: 'transfers', icon: '💸', label: 'Передачі' },
      { key: 'cashmovements', icon: '🧾', label: 'Рух готівки' },
      { key: 'reconciliations', icon: '⚖️', label: 'Звірки' },
    ],
  },
  {
    header: 'Налаштування',
    items: [
      { key: 'set-currencies', icon: '💱', label: 'Валюти та курси' },
      { key: 'set-points', icon: '🏢', label: 'Точки та каси' },
      { key: 'set-users', icon: '👥', label: 'Користувачі' },
      { key: 'set-operations', icon: '⚙️', label: 'Каса та операції' },
      { key: 'set-notifications', icon: '🔔', label: 'Сповіщення' },
    ],
  },
];

const PAGES: Record<Tab, () => JSX.Element> = {
  overview: () => <AdminOverview />,
  rates: () => <RatesAdmin />,
  bank: () => <CashBankAdmin />,
  finance: () => <FinanceAdmin />,
  expenses: () => <ExpensesAdmin />,
  shiftlog: () => <ShiftsAdmin />,
  operations: () => <OperationsAdmin />,
  usdt: () => <UsdtAdmin />,
  transfers: () => <TransfersAdmin />,
  cashmovements: () => <CashMovementsAdmin />,
  reconciliations: () => <ReconciliationsAdmin />,
  // Курси НБУ (автопідтягування, відсотки) — тут, поруч із валютами й курсами.
  'set-currencies': () => (
    <div className="space-y-6">
      <CurrenciesAdmin />
      <NbuSettings />
    </div>
  ),
  'set-points': () => <ExchangePointsAdmin />,
  'set-users': () => <UsersAdmin />,
  'set-operations': () => <OperationsSettings />,
  'set-notifications': () => <NotificationsSettings />,
};

const TAB_KEYS = NAV.flatMap((g) => g.items.map((i) => i.key));

export default function AdminPage() {
  // Останню відкриту сторінку памʼятаємо між сесіями.
  const [tab, setTab] = useState<Tab>(() => {
    const saved = localStorage.getItem('adminTab') as Tab | null;
    return saved && TAB_KEYS.includes(saved) ? saved : 'overview';
  });
  const select = (t: Tab) => {
    setTab(t);
    localStorage.setItem('adminTab', t);
  };

  // Банк можна вимкнути в налаштуваннях — тоді ховаємо його сторінку.
  const [bankEnabled, setBankEnabled] = useState(true);
  useEffect(() => {
    api.get('/settings/cash-bank-enabled')
      .then(({ data }) => setBankEnabled(!!data.enabled))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!bankEnabled && tab === 'bank') select('overview');
  }, [bankEnabled, tab]);

  const Page = PAGES[tab];

  return (
    <div className="flex-1 min-h-0 flex">
      {/* Сайдбар */}
      <aside className="w-52 flex-shrink-0 bg-white border-r border-gray-200 overflow-y-auto py-3">
        {NAV.map((group, gi) => (
          <div key={gi} className={gi > 0 ? 'mt-4' : ''}>
            {group.header && (
              <div className="px-4 pb-1 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                {group.header}
              </div>
            )}
            {group.items.filter((item) => bankEnabled || item.key !== 'bank').map((item) => (
              <button
                key={item.key}
                onClick={() => select(item.key)}
                className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm font-medium transition text-left ${
                  tab === item.key
                    ? 'bg-blue-50 text-blue-700 border-r-2 border-blue-700'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <span className="w-5 text-center">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>
        ))}
      </aside>

      {/* Контент — на всю ширину */}
      <section className="flex-1 min-w-0 overflow-y-auto p-4">
        <Page />
      </section>
    </div>
  );
}
