import { useState, FormEvent, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/axios';

export default function LoginPage() {
  const { login, user, isLoading } = useAuth();
  const navigate = useNavigate();
  const [loginVal, setLoginVal] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Setup (перший запуск)
  const [setupNeeded, setSetupNeeded] = useState<boolean | null>(null);
  const [setupName, setSetupName] = useState('');
  const [setupLogin, setSetupLogin] = useState('');
  const [setupPassword, setSetupPassword] = useState('');
  const [setupPassword2, setSetupPassword2] = useState('');

  useEffect(() => {
    if (!isLoading && user) {
      navigate(user.role === 'ADMIN' ? '/admin' : '/cashier', { replace: true });
    }
  }, [user, isLoading, navigate]);

  useEffect(() => {
    api.get('/auth/setup-needed')
      .then(({ data }) => setSetupNeeded(data.needed))
      .catch(() => setSetupNeeded(false));
  }, []);

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(loginVal, password);
      navigate('/', { replace: true });
    } catch {
      setError('Невірний логін або пароль');
    } finally {
      setLoading(false);
    }
  };

  const handleSetup = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (setupPassword !== setupPassword2) {
      setError('Паролі не співпадають');
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.post('/auth/setup', {
        name: setupName,
        login: setupLogin,
        password: setupPassword,
      });
      // Зберігаємо токен і логінимо
      localStorage.setItem('token', data.access_token);
      await login(setupLogin, setupPassword);
      navigate('/admin', { replace: true });
    } catch (err: any) {
      setError(err.response?.data?.message || 'Помилка створення адміна');
    } finally {
      setLoading(false);
    }
  };

  // Поки перевіряємо
  if (setupNeeded === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-blue-100">
        <div className="text-gray-400 text-lg">Завантаження...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-blue-100">
      <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-5xl mb-2">💱</div>
          <h1 className="text-2xl font-bold text-blue-700">CurrencyExchange CRM</h1>
          <p className="text-gray-500 text-sm mt-1">
            {setupNeeded ? 'Перше налаштування системи' : 'Система управління обміном валют'}
          </p>
        </div>

        {setupNeeded ? (
          /* ── Форма першого адміна ── */
          <form onSubmit={handleSetup} className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-700">
              База порожня. Створіть першого адміністратора.
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Ім'я</label>
              <input
                type="text"
                value={setupName}
                onChange={(e) => setSetupName(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Іван Іванов"
                required
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Логін</label>
              <input
                type="text"
                value={setupLogin}
                onChange={(e) => setSetupLogin(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="admin"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Пароль</label>
              <input
                type="password"
                value={setupPassword}
                onChange={(e) => setSetupPassword(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="••••••••"
                required
                minLength={6}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Повторіть пароль</label>
              <input
                type="password"
                value={setupPassword2}
                onChange={(e) => setSetupPassword2(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="••••••••"
                required
                minLength={6}
              />
            </div>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-700 hover:bg-blue-800 text-white font-medium py-2 rounded-lg transition disabled:opacity-50"
            >
              {loading ? 'Створення...' : 'Створити адміністратора'}
            </button>
          </form>
        ) : (
          /* ── Звичайна форма входу ── */
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Логін</label>
              <input
                type="text"
                value={loginVal}
                onChange={(e) => setLoginVal(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="admin"
                required
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Пароль</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-10 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="••••••••"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-lg select-none"
                  tabIndex={-1}
                >
                  {showPassword ? '🙈' : '👁'}
                </button>
              </div>
            </div>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-700 hover:bg-blue-800 text-white font-medium py-2 rounded-lg transition disabled:opacity-50"
            >
              {loading ? 'Вхід...' : 'Увійти'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
