import { useEffect, useState } from 'react';
import api from '../../api/axios';

/**
 * USDT — частина банку компанії: керування глобальним гаманцем (баланс із
 * підтвердженням) + швидкі суми для вікна USDT у касі. Живе на сторінці «Банк».
 */
export default function UsdtBankSection() {
  const [globalBalance, setGlobalBalance] = useState(0);
  const load = () => {
    api.get('/usdt/config').then(({ data }) => setGlobalBalance(Number(data.globalBalance))).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  return (
    <>
      <UsdtGlobalCard globalBalance={globalBalance} onSaved={load} />
      <UsdtQuickAmountsSettings />
    </>
  );
}

// Глобальний банк USDT — єдине джерело для всіх кас.
function UsdtGlobalCard({ globalBalance, onSaved }: { globalBalance: number; onSaved: () => void }) {
  const [balanceRaw, setBalanceRaw] = useState(String(globalBalance));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [confirm, setConfirm] = useState(false);

  // Тримаємо поле синхронним із фактичним балансом банку (після завантаження/збереження).
  useEffect(() => { setBalanceRaw(String(globalBalance)); }, [globalBalance]);

  const newBalance = parseFloat(balanceRaw);
  const valid = !Number.isNaN(newBalance);
  const delta = valid ? newBalance - globalBalance : 0;
  const changed = valid && Math.abs(delta) > 1e-9;
  const wouldGoNegative = valid && newBalance < 0;

  const applyAdjust = async () => {
    if (!changed) return;
    setBusy(true); setMsg('');
    try {
      // API приймає дельту; поле — цільовий баланс, тож шлемо різницю.
      await api.post('/usdt/global/adjust', { delta });
      setMsg('Баланс оновлено'); setConfirm(false); onSaved();
    } catch (e: any) {
      setMsg(e.response?.data?.message ?? 'Помилка');
      setConfirm(false);
    } finally { setBusy(false); }
  };

  return (
    <div className="bg-white rounded-xl shadow p-5">
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <h3 className="font-semibold text-lg">₮ USDT — банк</h3>
        <div className="text-right">
          <div className="text-xs text-gray-400">Баланс USDT-банку</div>
          <div className="font-bold text-teal-700 text-lg">{globalBalance.toFixed(4)} USDT</div>
        </div>
      </div>

      <p className="text-xs text-gray-400 mb-3">
        Єдине джерело USDT для всіх кас — касири беруть наявність напряму звідси.
      </p>

      <div>
        <div className="text-xs text-gray-500 mb-1">Баланс банку (коригування)</div>
        <div className="flex gap-1.5 max-w-md">
          <input type="number" step="0.0001" value={balanceRaw} onChange={(e) => setBalanceRaw(e.target.value)}
            placeholder="0.0000"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-right text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
          <button onClick={() => changed && setConfirm(true)} disabled={busy || !changed}
            className="px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-semibold text-sm disabled:opacity-50">
            Зберегти
          </button>
        </div>
        {msg && <div className="text-xs text-gray-500 mt-1.5">{msg}</div>}
      </div>

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-4">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Підтвердження коригування</div>
            <p className="text-sm text-gray-700">Встановити баланс USDT-банку.</p>
            <p className="text-sm text-gray-500 mt-1">
              Баланс: <span className="font-medium">{globalBalance.toFixed(4)}</span> →{' '}
              <span className={`font-semibold ${wouldGoNegative ? 'text-red-600' : 'text-teal-700'}`}>{valid ? newBalance.toFixed(4) : '—'}</span> USDT
              {changed && <span className="text-gray-400"> ({delta > 0 ? '+' : '−'}{Math.abs(delta).toFixed(4)})</span>}
            </p>
            {wouldGoNegative && (
              <p className="text-xs text-red-600 bg-red-50 rounded px-2 py-1.5 mt-2">Баланс не може бути відʼємним.</p>
            )}
            <div className="flex gap-2 mt-4">
              <button onClick={() => setConfirm(false)}
                className="flex-1 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50">
                Скасувати
              </button>
              <button onClick={applyAdjust} disabled={busy || wouldGoNegative}
                className="flex-1 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold disabled:opacity-50">
                {busy ? 'Збереження...' : 'Підтвердити'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Окремі швидкі суми для USDT-операцій (кнопки −/+ у вікні каси).
function UsdtQuickAmountsSettings() {
  const [amounts, setAmounts] = useState<number[]>([]);
  const [newVal, setNewVal] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get('/settings/usdt-quick-amounts').then(({ data }) => setAmounts(data)).catch(() => {});
  }, []);

  const save = async (next: number[]) => {
    setSaving(true);
    try {
      await api.put('/settings/usdt-quick-amounts', { amounts: next });
      setAmounts([...next].sort((a, b) => a - b));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally { setSaving(false); }
  };

  const handleAdd = () => {
    const v = parseFloat(newVal);
    if (!v || v <= 0 || amounts.includes(v)) { setNewVal(''); return; }
    save([...amounts, v]);
    setNewVal('');
  };

  return (
    <div className="bg-white rounded-xl shadow p-5">
      <h3 className="font-semibold text-lg">⚡ Швидкі суми USDT</h3>
      <p className="text-xs text-gray-400 mt-0.5 mb-3">Кнопки −/+ для поля «Сума USDT» у вікні операції каси.</p>

      <div className="flex flex-wrap gap-2 mb-3">
        {amounts.map((v) => (
          <div key={v} className="flex items-center gap-1 bg-teal-50 border border-teal-200 rounded-lg px-3 py-1.5">
            <span className="font-semibold text-teal-800 text-sm">{v}</span>
            <button onClick={() => save(amounts.filter((a) => a !== v))}
              className="text-teal-300 hover:text-red-500 transition font-bold text-base leading-none ml-1">×</button>
          </div>
        ))}
        {amounts.length === 0 && <span className="text-gray-400 text-sm italic">Список порожній</span>}
      </div>

      <div className="flex gap-2 max-w-md">
        <input type="number" min="1" value={newVal}
          onChange={(e) => setNewVal(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          placeholder="Нова сума"
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
        <button onClick={handleAdd} disabled={saving || !newVal}
          className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition">
          Додати
        </button>
      </div>
      {saved && <p className="text-green-600 text-sm mt-2">✓ Збережено</p>}
    </div>
  );
}
