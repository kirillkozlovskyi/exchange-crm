import { useState, useRef, useEffect } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useShiftHeader } from '../context/ShiftHeaderContext';
import { format } from 'date-fns';

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { info, actions } = useShiftHeader();

  const [cashOpen, setCashOpen] = useState(false);
  const cashRef = useRef<HTMLDivElement>(null);

  // Закриваємо дропдаун при кліку поза ним
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (cashRef.current && !cashRef.current.contains(e.target as Node)) setCashOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const roleLabel: Record<string, string> = {
    CASHIER: 'Касир',
    SENIOR_CASHIER: 'Старший касир',
    ADMIN: 'Адміністратор',
  };

  return (
    <div className="h-full flex flex-col">
      <header className="bg-blue-700 text-white px-6 py-3 flex items-center justify-between shadow">
        <div className="flex items-center gap-4 min-w-0">
          {user?.role === 'ADMIN' ? (
            <NavLink to="/admin" className={({ isActive }) =>
              `text-sm px-3 py-1 rounded flex-shrink-0 ${isActive ? 'bg-blue-900' : 'hover:bg-blue-600'}`
            }>
              Адмін панель
            </NavLink>
          ) : (
            /* Бейдж «Каса» — клік відкриває дропдаун з інформацією про касу */
            <div className="relative flex-shrink-0" ref={cashRef}>
              <button
                onClick={() => setCashOpen((o) => !o)}
                className={`text-sm px-3 py-1 rounded flex items-center gap-1.5 transition max-w-[220px] ${cashOpen ? 'bg-blue-900' : 'hover:bg-blue-600'}`}
              >
                <span className="truncate font-medium">
                  {info?.pointName || info?.deskName || 'Робоче місце'}
                </span>
                <span className={`text-[10px] opacity-80 transition-transform flex-shrink-0 ${cashOpen ? 'rotate-180' : ''}`}>▾</span>
              </button>

              {cashOpen && (
                <div className="absolute left-0 top-full mt-1 w-64 bg-white text-gray-800 rounded-lg shadow-xl border border-gray-100 p-3 z-50">
                  {info ? (
                    <div className="space-y-1.5">
                      <div className="font-bold text-gray-900">
                        {info.pointName && <span className="text-gray-400 font-normal">{info.pointName} · </span>}
                        {info.deskName}
                      </div>
                      <div className="text-sm text-gray-600">
                        {roleLabel[user?.role || ''] || 'Касир'}: <span className="font-medium text-gray-800">{user?.name}</span>
                      </div>
                      <div className="text-sm text-gray-600">
                        Зміна відкрита {format(new Date(info.openedAt), 'HH:mm dd.MM.yyyy')}
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-gray-500">
                      Немає активної зміни
                      <NavLink
                        to="/cashier"
                        onClick={() => setCashOpen(false)}
                        className="block pt-1.5 mt-1 border-t border-gray-100 text-blue-600 hover:underline"
                      >
                        → Перейти до каси
                      </NavLink>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 text-sm">
          {actions && <div className="flex items-center gap-2">{actions}</div>}
          <NavLink
            to="/profile"
            title={user?.name}
            className={({ isActive }) =>
              `sm:hidden opacity-80 hover:opacity-100 hover:bg-blue-600 px-3 py-1 rounded transition ${isActive ? 'bg-blue-900 opacity-100' : ''}`
            }
          >
            👤 {user?.name}
          </NavLink>
          <button onClick={handleLogout} className="bg-blue-900 hover:bg-blue-800 px-3 py-1 rounded">
            Вийти
          </button>
        </div>
      </header>
      <main className="flex-1 min-h-0 overflow-y-auto flex flex-col">
        <Outlet />
      </main>
    </div>
  );
}
