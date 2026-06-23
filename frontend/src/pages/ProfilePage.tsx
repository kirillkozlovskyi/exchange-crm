import { useState, useEffect } from 'react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

export default function ProfilePage() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<any>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    const { data } = await api.get('/auth/me');
    setProfile(data);
    setName(data.name ?? '');
    setPhone(data.phone ?? '');
  };

  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    if (!name.trim()) { setError("ПІБ не може бути порожнім"); return; }
    setSaving(true);
    setError('');
    setSuccess(false);
    try {
      await api.patch('/auth/me', { name: name.trim(), phone: phone.trim() || null });
      await load();
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (e: any) {
      setError(e.response?.data?.message ?? 'Помилка збереження');
    } finally {
      setSaving(false);
    }
  };

  const roleLabel: Record<string, string> = {
    CASHIER: 'Касир',
    SENIOR_CASHIER: 'Старший касир',
    ADMIN: 'Адміністратор',
  };

  if (!profile) return <div className="text-center py-20 text-gray-400">Завантаження...</div>;

  return (
    <div className="max-w-lg mx-auto mt-8">
      <div className="bg-white rounded-2xl shadow-lg p-8">
        <h2 className="text-xl font-bold text-gray-800 mb-1">Мій профіль</h2>
        <p className="text-sm text-gray-400 mb-6">Особисті дані облікового запису</p>

        {/* Незмінні поля */}
        <div className="space-y-3 mb-6 pb-6 border-b">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">Логін</span>
            <span className="font-mono text-gray-700 bg-gray-100 px-3 py-1 rounded text-sm">{profile.login}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">Роль</span>
            <span className="text-sm font-medium text-blue-700">{roleLabel[profile.role] ?? profile.role}</span>
          </div>
          {profile.exchangePoint && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">Точка</span>
              <span className="text-sm text-gray-700">{profile.exchangePoint.name}</span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">Пароль</span>
            <span className="text-xs text-gray-400 bg-gray-50 px-3 py-1 rounded border">Змінюється лише адміністратором</span>
          </div>
        </div>

        {/* Редаговані поля */}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">ПІБ</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              placeholder="Іванов Іван Іванович"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Номер телефону</label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              placeholder="+380 XX XXX XX XX"
              type="tel"
            />
          </div>
        </div>

        {error && <p className="text-red-500 text-sm mt-3">{error}</p>}
        {success && <p className="text-green-600 text-sm mt-3">✓ Дані збережено</p>}

        <button
          onClick={handleSave}
          disabled={saving}
          className="mt-6 w-full bg-blue-700 hover:bg-blue-800 text-white font-medium py-2.5 rounded-lg disabled:opacity-50 transition"
        >
          {saving ? 'Збереження...' : 'Зберегти'}
        </button>
      </div>
    </div>
  );
}
