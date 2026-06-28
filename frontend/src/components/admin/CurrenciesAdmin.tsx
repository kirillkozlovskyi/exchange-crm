import { useEffect, useState } from 'react';
import api from '../../api/axios';
import { WORLD_CURRENCIES } from '../../data/currencyMeta';
import CurrencyAutocomplete from './CurrencyAutocomplete';
import { useCurrencyOrder } from '../../hooks/useCurrencyOrder';

type Currency = { code: string; name: string; active: boolean };
type RateVal = { buy: string; sell: string };
type EditMap = Record<string, RateVal>;
type NbuRate = { cc: string; rate: number };

function DragHandle() {
  return (
    <span className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 select-none mr-1" title="Перетягни для сортування">
      ⠿
    </span>
  );
}

export default function CurrenciesAdmin() {
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [points, setPoints] = useState<any[]>([]);
  const [rates, setRates] = useState<any[]>([]);
  const [nbuRates, setNbuRates] = useState<NbuRate[]>([]);
  const [newCur, setNewCur] = useState({ code: '', name: '' });
  const [addingCur, setAddingCur] = useState(false);
  const [curError, setCurError] = useState('');
  const [globalEdit, setGlobalEdit] = useState<EditMap | null>(null);
  const [globalSaving, setGlobalSaving] = useState(false);

  const loadAll = async () => {
    const [c, p, r] = await Promise.all([
      api.get('/currencies'),
      api.get('/exchange-points'),
      api.get('/rates'),
    ]);
    setCurrencies(c.data);
    setPoints(p.data);
    setRates(r.data);
  };

  const fetchNbu = async () => {
    try {
      const data: NbuRate[] = await fetch(
        'https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json'
      ).then((r) => r.json());
      setNbuRates(data);
    } catch { /* ігнорується */ }
  };

  useEffect(() => {
    loadAll();
    fetchNbu();
  }, []);

  const activeCurrencies = currencies.filter((c) => c.active);
  const { sorted: sortedAll, onDragStart, onDragOver, onDragEnd } = useCurrencyOrder(currencies);
  const sortedActive = sortedAll.filter((c) => c.active);

  const getRate = (pointId: number, currency: string) =>
    rates.find((r) => r.exchangePointId === pointId && r.currency === currency);

  const getAnyRate = (code: string) => {
    const first = points[0];
    if (!first) return null;
    return getRate(first.id, code) ?? rates.find((r) => r.currency === code) ?? null;
  };

  const getNbu = (code: string): number | null =>
    nbuRates.find((r) => r.cc === code)?.rate ?? null;

  // ── Розрахунок курсів від НБУ ± % ─────────────────────────────────────────
  // Поточні встановлені курси з бази підставляються в режимі редагування.
  const buildFromCurrent = (): EditMap => {
    const map: EditMap = {};
    for (const cur of sortedActive) {
      const r = getAnyRate(cur.code);
      map[cur.code] = {
        buy: r ? Number(r.buy).toFixed(2) : '',
        sell: r ? Number(r.sell).toFixed(2) : '',
      };
    }
    return map;
  };

  const startGlobalEdit = () => setGlobalEdit(buildFromCurrent());

  // ── CRUD валют ─────────────────────────────────────────────────────────────

  const addCurrency = async () => {
    setCurError('');
    if (!newCur.code.trim()) { setCurError('Оберіть або введіть код валюти'); return; }
    if (!newCur.name.trim()) { setCurError('Вкажіть назву валюти'); return; }
    try {
      await api.post('/currencies', { code: newCur.code, name: newCur.name.trim() });
      setNewCur({ code: '', name: '' });
      setAddingCur(false);
      await loadAll();
    } catch (e: any) {
      setCurError(e.response?.data?.message ?? 'Помилка');
    }
  };

  const toggleActive = async (code: string, active: boolean) => {
    await api.patch(`/currencies/${code}`, { active: !active });
    await loadAll();
  };

  const removeCurrency = async (code: string) => {
    if (!confirm(`Видалити валюту ${code}? Це видалить її з усіх точок.`)) return;
    try {
      await api.delete(`/currencies/${code}`);
      await loadAll();
    } catch (e: any) {
      alert(e.response?.data?.message ?? 'Помилка');
    }
  };

  // ── Збереження глобального курсу ──────────────────────────────────────────

  const saveGlobal = async () => {
    if (!globalEdit) return;
    setGlobalSaving(true);
    try {
      for (const point of points) {
        for (const cur of sortedActive) {
          const val = globalEdit[cur.code];
          if (!val?.buy || !val?.sell) continue;
          await api.post('/rates', {
            exchangePointId: point.id,
            currency: cur.code,
            buy: parseFloat(val.buy),
            sell: parseFloat(val.sell),
          });
        }
      }
      await loadAll();
      setGlobalEdit(null);
    } finally {
      setGlobalSaving(false);
    }
  };

  return (
    <div className="space-y-4">

      {/* ── Список валют ── */}
      <div className="bg-white rounded-xl shadow p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-semibold text-gray-800">Список валют</h3>
            <p className="text-xs text-gray-400 mt-0.5">Глобальний довідник валют системи</p>
          </div>
          {!addingCur && (
            <button onClick={() => setAddingCur(true)}
              className="bg-blue-700 hover:bg-blue-800 text-white px-3 py-1.5 rounded-lg text-sm font-medium">
              + Додати валюту
            </button>
          )}
        </div>

        {addingCur && (
          <div className="flex gap-2 mb-3 items-end flex-wrap">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Валюта / код</label>
              <CurrencyAutocomplete
                value={newCur}
                onChange={(v) => setNewCur(v)}
                excludeCodes={new Set(currencies.map((c) => c.code))}
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Назва</label>
              <input
                value={newCur.name}
                onChange={(e) => setNewCur((p) => ({ ...p, name: e.target.value }))}
                placeholder="Напр. Долар (старий зразок)"
                className="border rounded px-2 py-1.5 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
            <button onClick={addCurrency} disabled={!newCur.code || !newCur.name.trim()}
              className="bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg text-sm disabled:opacity-50">
              Додати
            </button>
            <button onClick={() => { setAddingCur(false); setCurError(''); setNewCur({ code: '', name: '' }); }}
              className="bg-gray-100 hover:bg-gray-200 text-gray-600 px-3 py-1.5 rounded-lg text-sm">
              Скасувати
            </button>
            {curError && <span className="text-red-500 text-xs">{curError}</span>}
          </div>
        )}

        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b text-xs">
              <th className="pb-2 w-6"></th>
              <th className="pb-2">Код</th>
              <th className="pb-2">Назва</th>
              <th className="pb-2 w-20">Статус</th>
              <th className="pb-2 w-20"></th>
            </tr>
          </thead>
          <tbody>
            {sortedAll.map((c, idx) => {
              const meta = WORLD_CURRENCIES.find((w) => w.code === c.code);
              return (
                <tr key={c.code} draggable
                  onDragStart={() => onDragStart(idx)}
                  onDragOver={(e) => onDragOver(e, idx)}
                  onDragEnd={onDragEnd}
                  className="border-b last:border-0 hover:bg-gray-50">
                  <td className="py-1.5"><DragHandle /></td>
                  <td className="py-1.5">
                    <span className="flex items-center gap-1.5">
                      {meta && <span className="text-base leading-none">{meta.flag}</span>}
                      <span className="font-mono font-bold text-gray-800">{c.code}</span>
                    </span>
                  </td>
                  <td className="py-1.5 text-gray-600">{c.name}</td>
                  <td className="py-1.5">
                    <button onClick={() => toggleActive(c.code, c.active)}
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        c.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'
                      }`}>
                      {c.active ? 'Активна' : 'Вимкнена'}
                    </button>
                  </td>
                  <td className="py-1.5 text-right">
                    <button onClick={() => removeCurrency(c.code)}
                      className="text-red-400 hover:text-red-600 text-xs">
                      Видалити
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Встановити курс для всіх точок ── */}
      <div className="bg-white rounded-xl shadow p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-semibold text-gray-800">Встановити курс для всіх точок</h3>
            <p className="text-xs text-gray-400 mt-0.5">Одночасно застосується до кожної точки мережі</p>
          </div>
          {!globalEdit ? (
            <button onClick={startGlobalEdit}
              className="bg-blue-700 hover:bg-blue-800 text-white px-4 py-2 rounded-lg text-sm font-medium">
              Редагувати всі
            </button>
          ) : (
            <div className="flex gap-2">
              <button onClick={saveGlobal} disabled={globalSaving}
                className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
                {globalSaving ? 'Збереження...' : 'Зберегти для всіх'}
              </button>
              <button onClick={() => setGlobalEdit(null)}
                className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-2 rounded-lg text-sm">
                Скасувати
              </button>
            </div>
          )}
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b text-xs">
              <th className="pb-2 w-40">Валюта</th>
              {globalEdit
                ? <th className="pb-2 text-right pr-2 text-blue-500">НБУ</th>
                : null}
              <th className="pb-2 text-right pr-4">Купівля</th>
              <th className="pb-2 text-right">Продаж</th>
            </tr>
          </thead>
          <tbody>
            {sortedActive.map((cur) => {
              const meta = WORLD_CURRENCIES.find((w) => w.code === cur.code);
              const existing = getAnyRate(cur.code);
              const nbu = getNbu(cur.code);

              if (!globalEdit) {
                return (
                  <tr key={cur.code} className="border-b last:border-0">
                    <td className="py-2">
                      <span className="flex items-center gap-1.5">
                        {meta && <span className="text-base leading-none">{meta.flag}</span>}
                        <span className="font-bold">{cur.code}</span>
                        <span className="text-xs text-gray-400">{cur.name}</span>
                      </span>
                    </td>
                    <td className="py-2 text-right pr-4">
                      {existing
                        ? <span className="text-green-700 font-medium">{Number(existing.buy).toFixed(2)}</span>
                        : <span className="text-gray-300 text-xs">—</span>}
                    </td>
                    <td className="py-2 text-right">
                      {existing
                        ? <span className="text-red-600 font-medium">{Number(existing.sell).toFixed(2)}</span>
                        : <span className="text-gray-300 text-xs">—</span>}
                    </td>
                  </tr>
                );
              }

              return (
                <tr key={cur.code} className="border-b last:border-0">
                  <td className="py-2">
                    <span className="flex items-center gap-1.5">
                      {meta && <span className="text-base leading-none">{meta.flag}</span>}
                      <span className="font-bold">{cur.code}</span>
                      <span className="text-xs text-gray-400">{cur.name}</span>
                    </span>
                  </td>
                  {/* НБУ reference */}
                  <td className="py-2 text-right pr-2">
                    {nbu
                      ? <span className="text-xs text-blue-500 font-mono">{nbu.toFixed(2)}</span>
                      : <span className="text-xs text-gray-300">—</span>}
                  </td>
                  <td className="py-2 pr-4 text-right">
                    <input type="number" step="0.01"
                      value={globalEdit[cur.code]?.buy ?? ''}
                      onChange={(e) => setGlobalEdit((prev) => prev && ({
                        ...prev, [cur.code]: { ...prev[cur.code], buy: e.target.value },
                      }))}
                      className="w-28 border rounded px-2 py-1 text-right focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  </td>
                  <td className="py-2 text-right">
                    <input type="number" step="0.01"
                      value={globalEdit[cur.code]?.sell ?? ''}
                      onChange={(e) => setGlobalEdit((prev) => prev && ({
                        ...prev, [cur.code]: { ...prev[cur.code], sell: e.target.value },
                      }))}
                      className="w-28 border rounded px-2 py-1 text-right focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  </td>
                </tr>
              );
            })}
            {sortedActive.length === 0 && (
              <tr>
                <td colSpan={4} className="py-4 text-center text-gray-400 text-xs">Немає активних валют</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

    </div>
  );
}
