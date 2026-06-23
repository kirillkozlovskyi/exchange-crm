import { useEffect, useState } from 'react';
import api from '../../api/axios';

const ROLES = ['CASHIER', 'SENIOR_CASHIER', 'ADMIN'];
const ROLE_LABEL: Record<string, string> = {
  CASHIER: 'Касир',
  SENIOR_CASHIER: 'Старший касир',
  ADMIN: 'Адміністратор',
};

const EMPTY_FORM = { name: '', login: '', password: '', role: 'CASHIER', exchangePointId: '' };

export default function UsersAdmin() {
  const [users, setUsers] = useState<any[]>([]);
  const [points, setPoints] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editId, setEditId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    const [u, p] = await Promise.all([api.get('/users'), api.get('/exchange-points')]);
    setUsers(u.data);
    setPoints(p.data);
  };

  useEffect(() => { load(); }, []);

  const handleSubmit = async () => {
    setLoading(true);
    setError('');
    try {
      const payload = {
        ...form,
        exchangePointId: form.exchangePointId ? parseInt(form.exchangePointId) : undefined,
        password: form.password || undefined,
      };
      if (editId) {
        await api.patch(`/users/${editId}`, payload);
      } else {
        await api.post('/users', payload);
      }
      setShowForm(false);
      setForm(EMPTY_FORM);
      setEditId(null);
      load();
    } catch (e: any) {
      setError(e.response?.data?.message || 'Помилка');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Видалити користувача?')) return;
    await api.delete(`/users/${id}`);
    load();
  };

  const handleEdit = (u: any) => {
    setEditId(u.id);
    setForm({ name: u.name, login: u.login, password: '', role: u.role, exchangePointId: u.exchangePointId ? String(u.exchangePointId) : '' });
    setShowForm(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => { setShowForm(true); setEditId(null); setForm(EMPTY_FORM); }}
          className="bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          + Новий користувач
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl shadow p-5 space-y-3">
          <h3 className="font-semibold">{editId ? 'Редагувати' : 'Новий'} користувач</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-600 mb-1">ПІБ</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Логін</label>
              <input value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Пароль {editId && '(залишити порожнім = не змінювати)'}</label>
              <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Роль</label>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Точка обміну</label>
              <select value={form.exchangePointId} onChange={(e) => setForm({ ...form, exchangePointId: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                <option value="">— будь-яка —</option>
                {points.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <div className="flex gap-2">
            <button onClick={handleSubmit} disabled={loading}
              className="bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
              {loading ? '...' : editId ? 'Зберегти' : 'Створити'}
            </button>
            <button onClick={() => setShowForm(false)} className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm">
              Скасувати
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow p-5">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b">
              <th className="pb-2">Ім'я</th>
              <th className="pb-2">Логін</th>
              <th className="pb-2">Роль</th>
              <th className="pb-2">Точка</th>
              <th className="pb-2 w-20"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b last:border-0">
                <td className="py-2 font-medium">{u.name}</td>
                <td className="py-2 text-gray-500">{u.login}</td>
                <td className="py-2">
                  <span className="bg-gray-100 px-2 py-0.5 rounded text-xs">{ROLE_LABEL[u.role]}</span>
                </td>
                <td className="py-2 text-gray-500 text-xs">{u.exchangePoint?.name || '—'}</td>
                <td className="py-2">
                  <div className="flex gap-1">
                    <button onClick={() => handleEdit(u)} className="text-blue-600 text-xs hover:underline">✎</button>
                    <button onClick={() => handleDelete(u.id)} className="text-red-500 text-xs hover:underline ml-1">✕</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
