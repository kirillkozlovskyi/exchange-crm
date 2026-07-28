import { useState, useEffect } from 'react';
import api from '../../api/axios';

function CashDeskRow({ desk, onUpdate }: { desk: any; onUpdate: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(desk.name);

  const save = async () => {
    if (!name.trim()) return;
    try {
      await api.patch(`/cash-desks/${desk.id}`, { name: name.trim() });
      setEditing(false);
      onUpdate();
    } catch (err: any) {
      alert(err.response?.data?.message ?? 'Помилка');
    }
  };

  const toggle = async () => {
    try {
      await api.patch(`/cash-desks/${desk.id}`, { active: !desk.active });
      onUpdate();
    } catch (err: any) {
      alert(err.response?.data?.message ?? 'Помилка');
    }
  };

  const remove = async () => {
    if (!window.confirm(`Видалити "${desk.name}"?`)) return;
    try {
      await api.delete(`/cash-desks/${desk.id}`);
      onUpdate();
    } catch (err: any) {
      alert(err.response?.data?.message ?? 'Помилка');
    }
  };

  return (
    <div className={`flex items-center gap-2 py-2 border-b last:border-0 ${!desk.active ? 'opacity-50' : ''}`}>
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${desk.isOccupied ? 'bg-red-400' : 'bg-green-400'}`} />

      {editing ? (
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="border rounded px-2 py-1 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-blue-300"
          autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
        />
      ) : (
        <span className="flex-1 text-sm">{desk.name}</span>
      )}

      {desk.isOccupied && (
        <span className="text-xs text-red-400">{desk.activeShift?.openedBy?.name}</span>
      )}

      <div className="flex gap-1 flex-shrink-0">
        {editing ? (
          <>
            <button onClick={save} className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded hover:bg-green-200">Зберегти</button>
            <button onClick={() => { setEditing(false); setName(desk.name); }} className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded hover:bg-gray-200">✕</button>
          </>
        ) : (
          <>
            <button onClick={() => setEditing(true)} className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded hover:bg-gray-200">Ред.</button>
            <button onClick={toggle} className={`text-xs px-2 py-1 rounded ${desk.active ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200' : 'bg-green-100 text-green-700 hover:bg-green-200'}`}>
              {desk.active ? 'Вимкн.' : 'Увімкн.'}
            </button>
            <button onClick={remove} disabled={desk.isOccupied} className="text-xs bg-red-100 text-red-500 px-2 py-1 rounded hover:bg-red-200 disabled:opacity-40 disabled:cursor-not-allowed">Видал.</button>
          </>
        )}
      </div>
    </div>
  );
}

// Рядок «підпис — значення — Ред.» для необов'язкових полів точки (шапка чека).
// Порожнє значення зберігається як null і в чеку рядок не друкується.
function PointField({
  pointId, field, label, value, placeholder, empty, onUpdate,
}: {
  pointId: number;
  field: 'address' | 'receiptName' | 'phone';
  label: string;
  value: string;
  placeholder: string;
  empty: string;
  onUpdate: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  const cancel = () => { setEditing(false); setDraft(value); };
  const save = async () => {
    setSaving(true);
    try {
      await api.patch(`/exchange-points/${pointId}`, { [field]: draft.trim() });
      setEditing(false);
      onUpdate();
    } catch (err: any) {
      alert(err.response?.data?.message ?? 'Помилка');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500 flex-shrink-0 w-28">{label}</span>
      {editing ? (
        <>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder}
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel(); }}
            className="border rounded px-2 py-1 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
          <button onClick={save} disabled={saving} className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded hover:bg-green-200 disabled:opacity-50">Зберегти</button>
          <button onClick={cancel} className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded hover:bg-gray-200">✕</button>
        </>
      ) : (
        <>
          <span className={`flex-1 text-sm ${value ? 'text-gray-700' : 'text-gray-400 italic'}`}>
            {value || empty}
          </span>
          <button onClick={() => { setDraft(value); setEditing(true); }} className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded hover:bg-gray-200">Ред.</button>
        </>
      )}
    </div>
  );
}

function PointCard({ point, onUpdate }: { point: any; onUpdate: () => void }) {
  const deletePoint = async () => {
    if (!window.confirm(`Видалити точку "${point.name}"? Це також видалить всі каси та дані точки.`)) return;
    try {
      await api.delete(`/exchange-points/${point.id}`);
      onUpdate();
    } catch (err: any) {
      alert(err.response?.data?.message ?? 'Помилка видалення');
    }
  };
  const [desks, setDesks] = useState<any[]>([]);
  const [newDeskName, setNewDeskName] = useState('');
  const [addingDesk, setAddingDesk] = useState(false);
  const [open, setOpen] = useState(true);

  // Редагування назви точки
  const [editingName, setEditingName] = useState(false);
  const [pointName, setPointName] = useState(point.name);
  const [savingName, setSavingName] = useState(false);

  const saveName = async () => {
    if (!pointName.trim()) return;
    setSavingName(true);
    try {
      await api.patch(`/exchange-points/${point.id}`, { name: pointName.trim() });
      setEditingName(false);
      onUpdate();
    } catch (err: any) {
      alert(err.response?.data?.message ?? 'Помилка');
    } finally {
      setSavingName(false);
    }
  };

  const loadDesks = async () => {
    const { data } = await api.get(`/cash-desks?pointId=${point.id}`);
    setDesks(data);
  };

  useEffect(() => { loadDesks(); }, []);

  const addDesk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDeskName.trim()) return;
    setAddingDesk(true);
    try {
      await api.post('/cash-desks', { name: newDeskName.trim(), exchangePointId: point.id });
      setNewDeskName('');
      await loadDesks();
    } catch (err: any) {
      alert(err.response?.data?.message ?? 'Помилка');
    } finally {
      setAddingDesk(false);
    }
  };

  return (
    <div className="border rounded-xl overflow-hidden">
      {/* Point header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition"
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {editingName ? (
            <>
              <input
                value={pointName}
                onChange={(e) => setPointName(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); saveName(); }
                  if (e.key === 'Escape') { setEditingName(false); setPointName(point.name); }
                }}
                className="border rounded px-2 py-1 text-sm font-semibold w-48 focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
              <button
                onClick={(e) => { e.stopPropagation(); saveName(); }}
                disabled={savingName || !pointName.trim()}
                className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded hover:bg-green-200 disabled:opacity-50"
              >
                Зберегти
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setEditingName(false); setPointName(point.name); }}
                className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded hover:bg-gray-200"
              >
                ✕
              </button>
            </>
          ) : (
            <>
              <span className="font-semibold text-gray-800">{point.name}</span>
              <button
                onClick={(e) => { e.stopPropagation(); setEditingName(true); }}
                title="Редагувати назву точки"
                className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded hover:bg-gray-200"
              >
                Ред.
              </button>
            </>
          )}
          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-mono">{point.code}</span>
          <span className="text-xs text-gray-400">{desks.length} кас(и)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-gray-400 text-sm">{open ? '▲' : '▼'}</span>
          <button
            onClick={(e) => { e.stopPropagation(); deletePoint(); }}
            className="text-xs bg-red-100 text-red-500 hover:bg-red-200 px-2 py-1 rounded"
          >
            Видалити
          </button>
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-2">
          {/* Шапка чека: назва для друку, адреса, телефон. Порожні поля в чек не йдуть. */}
          <div className="mb-3 pb-3 border-b space-y-2">
            <PointField
              pointId={point.id}
              field="receiptName"
              label="🧾 Назва в чеку:"
              value={point.receiptName ?? ''}
              placeholder="Обмін валют «Курсок»"
              empty="не вказано — друкується назва точки"
              onUpdate={onUpdate}
            />
            <PointField
              pointId={point.id}
              field="address"
              label="📍 Адреса:"
              value={point.address ?? ''}
              placeholder="вул. Хрещатик, 1, Київ"
              empty="не вказано — рядок у чеку не друкується"
              onUpdate={onUpdate}
            />
            <PointField
              pointId={point.id}
              field="phone"
              label="☎️ Телефон:"
              value={point.phone ?? ''}
              placeholder="+380 67 123 45 67"
              empty="не вказано — рядок у чеку не друкується"
              onUpdate={onUpdate}
            />
          </div>

          {/* Список кас */}
          {desks.length === 0
            ? <p className="text-sm text-gray-400 py-2">Немає кас</p>
            : desks.map((d) => <CashDeskRow key={d.id} desk={d} onUpdate={loadDesks} />)
          }

          {/* Додати касу */}
          <form onSubmit={addDesk} className="flex gap-2 mt-3">
            <input
              value={newDeskName}
              onChange={(e) => setNewDeskName(e.target.value)}
              placeholder="Назва нової каси"
              className="border rounded-lg px-3 py-1.5 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
            <button
              type="submit"
              disabled={addingDesk || !newDeskName.trim()}
              className="bg-blue-700 hover:bg-blue-800 text-white px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              + Каса
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

export default function ExchangePointsAdmin() {
  const [points, setPoints] = useState<any[]>([]);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [address, setAddress] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const loadPoints = () => api.get('/exchange-points').then(({ data }) => setPoints(data));

  useEffect(() => { loadPoints(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name.trim() || !code.trim()) return;
    setSaving(true);
    try {
      await api.post('/exchange-points', { name: name.trim(), code: code.trim(), address: address.trim() || undefined });
      setName('');
      setCode('');
      setAddress('');
      await loadPoints();
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Помилка');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Форма додавання точки */}
      <div className="bg-white rounded-xl shadow p-4">
        <h3 className="font-semibold text-gray-700 mb-3">Додати обмінний пункт</h3>
        <form onSubmit={handleCreate} className="flex gap-3 flex-wrap items-end">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Назва</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Точка 3"
              className="border rounded-lg px-3 py-2 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Код (унікальний)</label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="T3"
              maxLength={10}
              className="border rounded-lg px-3 py-2 text-sm w-32 font-mono focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Адреса</label>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="вул. Хрещатик, 1, Київ"
              className="border rounded-lg px-3 py-2 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="bg-blue-700 hover:bg-blue-800 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {saving ? 'Збереження...' : 'Додати точку'}
          </button>
        </form>
        {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
      </div>

      {/* Точки з касами */}
      <div className="bg-white rounded-xl shadow p-4 space-y-3">
        <h3 className="font-semibold text-gray-700">Обмінні пункти та каси</h3>
        {points.length === 0
          ? <p className="text-gray-400 text-sm">Немає точок</p>
          : points.map((p) => <PointCard key={p.id} point={p} onUpdate={loadPoints} />)
        }
      </div>
    </div>
  );
}
