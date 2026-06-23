import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

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
        <div className="flex items-center gap-6">
          <span className="font-bold text-lg">💱 CurrencyExchange CRM</span>
          {user?.role !== 'ADMIN' && (
            <NavLink to="/cashier" className={({ isActive }) =>
              `text-sm px-3 py-1 rounded ${isActive ? 'bg-blue-900' : 'hover:bg-blue-600'}`
            }>
              Каса
            </NavLink>
          )}
          {user?.role === 'ADMIN' && (
            <NavLink to="/admin" className={({ isActive }) =>
              `text-sm px-3 py-1 rounded ${isActive ? 'bg-blue-900' : 'hover:bg-blue-600'}`
            }>
              Адмін панель
            </NavLink>
          )}
        </div>
        <div className="flex items-center gap-3 text-sm">
          <NavLink
            to="/profile"
            className={({ isActive }) =>
              `opacity-80 hover:opacity-100 hover:bg-blue-600 px-3 py-1 rounded transition ${isActive ? 'bg-blue-900 opacity-100' : ''}`
            }
          >
            👤 {user?.name}
          </NavLink>
          <span className="opacity-40">·</span>
          <span className="opacity-60">{roleLabel[user?.role || '']}</span>
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
