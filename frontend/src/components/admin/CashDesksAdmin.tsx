import { useState, useEffect } from 'react';
import api from '../../api/axios';

export default function CashDesksAdmin() {
  const [points, setPoints] = useState<any[]>([]);
  const [desks, setDesks] = useState<any[]>([]);
  const [name, setName] = useState('');
  const [pointId, setPointId] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');

  const loadPoints = () => api.get('/exchange-points').then(({ data }) => setPoints(data));
  const loadDesks = () => api.get('/cash-desks').then(({ data }) => setDesks(data));

  useEffect(() => {
    loadPoints();
    loadDesks();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name.trim() || !pointId) return;
    setSaving(true);
    try {
      await api.post('/cash-desks', { name: name.trim(), exchangePointId: Number(pointId) });
      setName('');
      setPointId('');
      await loadDesks();
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Помилка');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async (id: number) => {
    if (!editName.trim()) return;
    try {
      await api.patch(`/cash-desks/${id}`, { name: editName.trim() });
      setEditId(null);
      setEditName('');
      await loadDesks();
    } catch (err: any) {
      alert(err.response?.data?.message ?? 'Помилка');
    }
  };

  const handleToggleActive = async (desk: any) => {
    try {
      await api.patch(`/cash-desks/${desk.id}`, { active: !desk.active });
      await loadDesks();
    } catch (err: any) {
      alert(err.response?.data?.message ?? 'Помилка');
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Видалити касу?')) return;
    try {
      await api.delete(`/cash-desks/${id}`);
      await loadDesks();
    } catch (err: any) {
      alert(err.response?.data?.message ?? 'Помилка');
    }
  };

  // Group desks by exchange point
  const grouped = points.map((p) => ({
    ...p,
    desks: desks.filter((d) => d.exchangePointId === p.id),
  }));

  return (
    <div className="space-y-4">
      {/* Форма створення */}
      <div className="bg-white rounded-xl shadow p-4">
        <h3 className="font-semibold text-gray-700 mb-3">Додати касу</h3>
        <form onSubmit={handleCreate} className="flex gap-3 flex-wrap items-end">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Обмінний пункт</label>
            <select
              value={pointId}
              onChange={(e) => setPointId(e.target.value)}
              className="border rounded-lg px-3 py-2 text-sm w-44 focus:outline-none focus:ring-2 focus:ring-blue-300"
            >
              <option value="">— оберіть —</option>
              {points.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Назва каси</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Каса №3"
              className="border rounded-lg px-3 py-2 text-sm w-40 focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
          <button
            type="submit"
            disabled={saving || !pointId || !name.trim()}
            className="bg-blue-700 hover:bg-blue-800 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {saving ? 'Збереження...' : 'Додати'}
          </button>
        </form>
        {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
      </div>

      {/* Список по точках */}
      {grouped.map((point) => (
        <div key={point.id} className="bg-white rounded-xl shadow p-4">
          <div className="flex items-center gap-2 mb-3">
            <h3 className="font-semibold text-gray-700">{point.name}</h3>
            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-mono">{point.code}</span>
            <span className="text-xs text-gray-400 ml-auto">{point.desks.length} кас(и)</span>
          </div>

          {point.desks.length === 0 ? (
            <p className="text-sm text-gray-400">Немає кас</p>
          ) : (
            <div className="space-y-2">
              {point.desks.map((desk: any) => (
                <div key={desk.id} className={`flex items-center gap-3 border rounded-lg p-3 ${!desk.active ? 'opacity-50' : ''}`}>
                  {/* Статус зайнятості */}
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${desk.isOccupied ? 'bg-red-400' : 'bg-green-400'}`} />

                  {editId === desk.id ? (
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="border rounded px-2 py-1 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-blue-300"
                      autoFocus
                    />
                  ) : (
                    <span className="flex-1 text-sm font-medium">{desk.name}</span>
                  )}

                  {desk.isOccupied && desk.activeShift && (
                    <span className="text-xs text-red-500">
                      {desk.activeShift.openedBy?.name}
                    </span>
                  )}

                  <div className="flex gap-2">
                    {editId === desk.id ? (
                      <>
                        <button
                          onClick={() => handleEdit(desk.id)}
                          className="text-xs bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700"
                        >
                          Зберегти
                        </button>
                        <button
                          onClick={() => setEditId(null)}
                          className="text-xs bg-gray-200 text-gray-700 px-2 py-1 rounded hover:bg-gray-300"
                        >
                          Скасувати
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => { setEditId(desk.id); setEditName(desk.name); }}
                          className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded hover:bg-gray-200"
                        >
                          Редагувати
                        </button>
                        <button
                          onClick={() => handleToggleActive(desk)}
                          className={`text-xs px-2 py-1 rounded ${desk.active ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200' : 'bg-green-100 text-green-700 hover:bg-green-200'}`}
                        >
                          {desk.active ? 'Деактивувати' : 'Активувати'}
                        </button>
                        <button
                          onClick={() => handleDelete(desk.id)}
                          disabled={desk.isOccupied}
                          className="text-xs bg-red-100 text-red-600 px-2 py-1 rounded hover:bg-red-200 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          Видалити
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
