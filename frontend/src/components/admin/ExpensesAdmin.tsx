import { useEffect, useState } from 'react';
import api from '../../api/axios';
import { format } from 'date-fns';

const CATEGORIES = ['Оренда', 'Зарплата', 'Комунальні', 'Податки', 'Обладнання', 'Інше'];
const fmt = (v: any) => Number(v ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function ExpensesAdmin() {
  const [points, setPoints] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [pointFilter, setPointFilter] = useState('');
  const [loading, setLoading] = useState(false);

  // Форма нової витрати.
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [note, setNote] = useState('');
  const [pointId, setPointId] = useState('');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/exchange-points').then(({ data }) => setPoints(data)).catch(() => {});
  }, []);

  const load = () => {
    setLoading(true);
    const q = pointFilter ? `?pointId=${pointFilter}` : '';
    api.get(`/expenses${q}`).then(({ data }) => setItems(data)).finally(() => setLoading(false));
  };
  useEffect(load, [pointFilter]);

  const add = async () => {
    setError('');
    if (!(Number(amount) > 0)) { setError('Вкажіть суму більшу за 0'); return; }
    if (!pointId) { setError('Оберіть точку'); return; }
    setSaving(true);
    try {
      await api.post('/expenses', {
        amount: Number(amount), category, note: note.trim() || undefined,
        exchangePointId: Number(pointId), date,
      });
      setAmount(''); setNote('');
      load();
    } catch (e: any) {
      setError(e.response?.data?.message ?? 'Помилка збереження');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    await api.delete(`/expenses/${id}`).catch(() => {});
    load();
  };

  const total = items.reduce((s, e) => s + Number(e.amount), 0);
  const inputCls = 'border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400';

  const exportCsv = () => {
    const head = ['Дата', 'Категорія', 'Точка', 'Примітка', 'Сума ₴'];
    const rows = items.map((e) => [
      format(new Date(e.date), 'dd.MM.yyyy'), e.category,
      e.exchangePoint?.name ?? '', e.note ?? '', Number(e.amount).toFixed(2),
    ]);
    const csv = '﻿' + [head, ...rows]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';'))
      .join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `expenses_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-4">
      {/* Додати витрату */}
      <div className="bg-white rounded-xl shadow p-4">
        <h3 className="font-semibold text-lg mb-3">Додати витрату</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-2">
          <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Сума ₴" className={inputCls} />
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={pointId} onChange={(e) => setPointId(e.target.value)} className={inputCls}>
            <option value="">Точка…</option>
            {points.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Примітка" className={`${inputCls} xl:col-span-1`} />
          <button onClick={add} disabled={saving}
            className="bg-blue-700 hover:bg-blue-800 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
            {saving ? '…' : '+ Додати'}
          </button>
        </div>
        {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
      </div>

      {/* Список */}
      <div className="bg-white rounded-xl shadow p-4">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <h3 className="font-semibold text-lg">Витрати <span className="text-gray-400 font-normal text-sm">· разом {fmt(total)} ₴</span></h3>
          <div className="flex items-center gap-2">
            <select value={pointFilter} onChange={(e) => setPointFilter(e.target.value)} className={inputCls}>
              <option value="">Усі точки</option>
              {points.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button onClick={exportCsv} disabled={items.length === 0}
              className="px-3 py-2 rounded-lg text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              ⬇ CSV
            </button>
          </div>
        </div>
        {loading ? (
          <div className="text-center py-8 text-gray-400">Завантаження...</div>
        ) : items.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-6">Витрат немає</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="pb-2 pr-4">Дата</th>
                  <th className="pb-2 pr-4">Категорія</th>
                  <th className="pb-2 pr-4">Точка</th>
                  <th className="pb-2 pr-4">Примітка</th>
                  <th className="pb-2 pr-4 text-right">Сума</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((e) => (
                  <tr key={e.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="py-2 pr-4 text-gray-500 whitespace-nowrap">{format(new Date(e.date), 'dd.MM.yyyy')}</td>
                    <td className="py-2 pr-4"><span className="bg-gray-100 px-2 py-0.5 rounded text-xs">{e.category}</span></td>
                    <td className="py-2 pr-4">{e.exchangePoint?.name ?? '—'}</td>
                    <td className="py-2 pr-4 text-gray-500">{e.note ?? ''}</td>
                    <td className="py-2 pr-4 text-right font-medium text-red-600">−{fmt(e.amount)} ₴</td>
                    <td className="py-2 text-right">
                      <button onClick={() => remove(e.id)} className="text-gray-400 hover:text-red-600 text-xs" title="Видалити">✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
