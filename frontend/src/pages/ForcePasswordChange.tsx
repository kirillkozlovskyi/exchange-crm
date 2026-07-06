import { useState } from 'react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

// Блокуючий екран: показується одразу після входу, поки користувач не змінить
// виданий/дефолтний пароль. Без нього далі в застосунок не пускаємо.
export default function ForcePasswordChange() {
  const { user, logout, passwordChanged } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    if (next.length < 8) { setError('Новий пароль — щонайменше 8 символів'); return; }
    if (next !== confirm) { setError('Паролі не збігаються'); return; }
    if (next === current) { setError('Новий пароль має відрізнятися від поточного'); return; }
    setSaving(true);
    try {
      await api.post('/auth/change-password', { currentPassword: current, newPassword: next });
      passwordChanged();
    } catch (e: any) {
      setError(e.response?.data?.message ?? 'Не вдалося змінити пароль');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-md">
        <h2 className="text-xl font-bold text-gray-800 mb-1">Змініть пароль</h2>
        <p className="text-sm text-gray-500 mb-6">
          Вхід під <span className="font-medium">{user?.login}</span>. З міркувань безпеки
          потрібно встановити власний пароль, перш ніж продовжити.
        </p>

        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Поточний пароль</label>
            <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Новий пароль</label>
            <input type="password" value={next} onChange={(e) => setNext(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="щонайменше 8 символів" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Повторіть новий пароль</label>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>

        {error && <p className="text-red-500 text-sm mt-3">{error}</p>}

        <button onClick={submit} disabled={saving}
          className="mt-6 w-full bg-blue-700 hover:bg-blue-800 text-white font-medium py-2.5 rounded-lg disabled:opacity-50 transition">
          {saving ? 'Збереження...' : 'Змінити пароль і увійти'}
        </button>
        <button onClick={logout}
          className="mt-2 w-full text-gray-400 hover:text-gray-600 text-sm py-1">
          Вийти
        </button>
      </div>
    </div>
  );
}
