import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useShiftHeader } from '../context/ShiftHeaderContext';
import { format } from 'date-fns';

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { info, actions } = useShiftHeader();

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
          {user?.role !== 'ADMIN' && (
            <NavLink to="/cashier" className={({ isActive }) =>
              `text-sm px-3 py-1 rounded flex-shrink-0 ${isActive ? 'bg-blue-900' : 'hover:bg-blue-600'}`
            }>
              Каса
            </NavLink>
          )}
          {user?.role === 'ADMIN' && (
            <NavLink to="/admin" className={({ isActive }) =>
              `text-sm px-3 py-1 rounded flex-shrink-0 ${isActive ? 'bg-blue-900' : 'hover:bg-blue-600'}`
            }>
              Адмін панель
            </NavLink>
          )}

          {/* Інфо активної зміни — у лівій частині хедера */}
          {info && (
            <div className="hidden sm:flex flex-col leading-tight min-w-0">
              <div className="font-bold text-base text-white leading-tight truncate">
                {info.pointName && <span className="text-blue-200 font-normal mr-1">{info.pointName} ·</span>}
                {info.deskName}
                {user?.name && (
                  <span className="text-blue-200 font-normal ml-1">
                    · {roleLabel[user.role || ''] || 'Касир'}: {user.name}
                  </span>
                )}
              </div>
              <div className="text-sm text-blue-200 truncate">
                Зміна #{info.shiftNumber} · відкрита {format(new Date(info.openedAt), 'HH:mm dd.MM')}
              </div>
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
      <main className="flex-1 overflow-hidden flex flex-col">
        <Outlet />
      </main>
    </div>
  );
}
