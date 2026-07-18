import { useState, useEffect } from 'react';
import api from '../../api/axios';

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${enabled ? 'bg-blue-600' : 'bg-gray-300'}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  );
}

// Швидкі суми — універсальний блок для операцій (blue) і USDT (teal).
function QuickAmountsSettings({
  endpoint, title, subtitle, accent = 'blue',
}: {
  endpoint: string;
  title: string;
  subtitle: string;
  accent?: 'blue' | 'teal';
}) {
  const [amounts, setAmounts] = useState<number[]>([]);
  const [newVal, setNewVal] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get(endpoint).then(({ data }) => setAmounts(data)).catch(() => {});
  }, [endpoint]);

  const save = async (next: number[]) => {
    setSaving(true);
    try {
      await api.put(endpoint, { amounts: next });
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

  const chip = accent === 'teal'
    ? 'bg-teal-50 border-teal-200 text-teal-800'
    : 'bg-blue-50 border-blue-200 text-blue-800';
  const chipX = accent === 'teal' ? 'text-teal-300' : 'text-blue-300';
  const ring = accent === 'teal' ? 'focus:ring-teal-400' : 'focus:ring-blue-400';
  const btn = accent === 'teal' ? 'bg-teal-600 hover:bg-teal-700' : 'bg-blue-600 hover:bg-blue-700';

  return (
    <div className="bg-white rounded-xl shadow p-6 space-y-4">
      <div>
        <h3 className="font-semibold text-gray-800 text-base">{title}</h3>
        <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {amounts.map((v) => (
          <div key={v} className={`flex items-center gap-1 border rounded-lg px-3 py-1.5 ${chip}`}>
            <span className="font-semibold text-sm">{v}</span>
            <button onClick={() => save(amounts.filter((a) => a !== v))}
              className={`hover:text-red-500 transition font-bold text-base leading-none ml-1 ${chipX}`}>×</button>
          </div>
        ))}
        {amounts.length === 0 && <span className="text-gray-400 text-sm italic">Список порожній</span>}
      </div>

      <div className="flex gap-2">
        <input type="number" min="1" value={newVal}
          onChange={(e) => setNewVal(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          placeholder="Нова сума"
          className={`flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 ${ring}`} />
        <button onClick={handleAdd} disabled={saving || !newVal}
          className={`text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition ${btn}`}>
          Додати
        </button>
      </div>
      {saved && <p className="text-green-600 text-sm">✓ Збережено</p>}
    </div>
  );
}

function OrgSettings() {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get('/settings/org-name').then(({ data }) => setName(data.name ?? '')).catch(() => {});
  }, []);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await api.put('/settings/org-name', { name });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow p-6 space-y-4">
      <div>
        <h3 className="font-semibold text-gray-800 text-base">🏢 Назва організації</h3>
        <p className="text-xs text-gray-400 mt-0.5">Друкується у шапці чека. Залиште порожнім, щоб не друкувати.</p>
      </div>
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          placeholder='ТОВ "Преміум Фінанс"'
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        <button onClick={save} disabled={saving}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition">
          {saving ? '...' : 'Зберегти'}
        </button>
      </div>
      {saved && <p className="text-green-600 text-sm">✓ Збережено</p>}
    </div>
  );
}

// ── Telegram-сповіщення: токен + chat_id зберігаються в БД, інструкція поруч ──
function TelegramSettings() {
  const [tokenMasked, setTokenMasked] = useState('');
  const [chatId, setChatId] = useState('');
  const [configured, setConfigured] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [chatInput, setChatInput] = useState('');
  type Channel = { id: string; label: string; theme?: string; pointId?: number | null };
  const [channels, setChannels] = useState<Channel[]>([]);
  const [points, setPoints] = useState<{ id: number; name: string }[]>([]);
  const [showHelp, setShowHelp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () => {
    api.get('/settings/telegram').then(({ data }) => {
      setTokenMasked(data.tokenMasked);
      setChatId(data.chatId);
      setConfigured(data.configured);
      setChatInput(data.chatId);
      setChannels(data.channels ?? []);
    }).catch(() => {});
  };
  useEffect(() => {
    load();
    api.get('/exchange-points').then(({ data }) => setPoints(data)).catch(() => {});
  }, []);

  const setChannel = (i: number, field: keyof Channel, v: string | number | null) =>
    setChannels((cs) => cs.map((c, idx) => (idx === i ? { ...c, [field]: v } : c)));
  const addChannel = () => setChannels((cs) => [...cs, { id: '', label: '', pointId: null }]);
  const removeChannel = (i: number) => setChannels((cs) => cs.filter((_, idx) => idx !== i));

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      // rateAutopost НЕ шлемо: ним керує сторінка «Картка курсів» (щоб збереження
      // каналів тут не перезаписало його старим значенням).
      const body: any = {
        chatId: chatInput,
        channels: channels.filter((c) => c.id.trim()),
      };
      if (tokenInput.trim()) body.token = tokenInput.trim(); // порожнє поле = не міняти токен
      const { data } = await api.put('/settings/telegram', body);
      setTokenMasked(data.tokenMasked); setConfigured(data.configured); setTokenInput('');
      setChannels(data.channels ?? []);
      setMsg({ ok: true, text: 'Збережено' });
    } catch (e: any) {
      setMsg({ ok: false, text: e.response?.data?.message ?? 'Помилка' });
    } finally { setBusy(false); }
  };

  const test = async () => {
    setBusy(true); setMsg(null);
    try {
      const { data } = await api.post('/settings/telegram/test');
      setMsg(data.ok
        ? { ok: true, text: '✅ Надіслано — перевірте Telegram' }
        : { ok: false, text: 'Не вдалося надіслати. Перевірте токен і chat ID (і чи натиснули Start у бота).' });
    } finally { setBusy(false); }
  };

  return (
    <div className="bg-white rounded-xl shadow p-6 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold text-gray-800 text-base">📨 Telegram-сповіщення</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            Відкриття/закриття змін, розбіжності звірок, великі операції.
          </p>
        </div>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
          configured ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
        }`}>
          {configured ? 'налаштовано' : 'вимкнено'}
        </span>
      </div>

      <button onClick={() => setShowHelp((v) => !v)} className="text-sm text-blue-600 hover:underline">
        {showHelp ? '▲ Сховати інструкцію' : '▼ Як отримати токен і chat ID'}
      </button>
      {showHelp && (
        <ol className="text-xs text-gray-600 bg-blue-50 rounded-lg p-3 space-y-1.5 list-decimal list-inside">
          <li>У Telegram знайдіть <b>@BotFather</b> → команда <code className="bg-white px-1 rounded">/newbot</code> → задайте ім'я і username (закінчується на <code className="bg-white px-1 rounded">bot</code>).</li>
          <li>BotFather видасть <b>токен</b> виду <code className="bg-white px-1 rounded">812345:AAH...</code> — вставте його в поле нижче.</li>
          <li>Відкрийте чат зі <b>своїм</b> ботом і натисніть <b>Start</b> (без цього бот не зможе вам писати).</li>
          <li>Знайдіть <b>@userinfobot</b> → Start → він покаже ваш <b>Id</b> — це chat ID.</li>
          <li>Збережіть і натисніть «Надіслати тестове».</li>
        </ol>
      )}

      <div className="space-y-2">
        <label className="block text-sm text-gray-600">
          Токен бота {tokenMasked && <span className="text-gray-400">(поточний: {tokenMasked})</span>}
          <input
            type="password" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)}
            placeholder={tokenMasked ? 'залиште порожнім, щоб не міняти' : '812345:AAH...'}
            className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </label>
        <label className="block text-sm text-gray-600">
          Chat ID <span className="text-gray-400">(для сповіщень адміну)</span>
          <input
            type="text" value={chatInput} onChange={(e) => setChatInput(e.target.value)}
            placeholder="123456789"
            className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </label>
      </div>

      {/* Канали для постів про курси */}
      <div className="border-t pt-4 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="font-semibold text-gray-800 text-sm">📢 Канали для курсів</h4>
            <p className="text-xs text-gray-400 mt-0.5">
              Пости про зміну курсів. Бот має бути адміном каналу. ID виду <code className="bg-gray-100 px-1 rounded">@channel</code> або <code className="bg-gray-100 px-1 rounded">-1001234567890</code>.
            </p>
          </div>
        </div>

        {channels.length === 0 && <p className="text-xs text-gray-400">Каналів ще немає.</p>}
        {channels.map((c, i) => (
          <div key={i} className="flex items-center gap-2 flex-wrap">
            <input
              type="text" value={c.id} onChange={(e) => setChannel(i, 'id', e.target.value)}
              placeholder="@channel або -100..."
              className="flex-1 min-w-[160px] border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <input
              type="text" value={c.label} onChange={(e) => setChannel(i, 'label', e.target.value)}
              placeholder="назва (необов.)"
              className="w-28 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            {/* Точка каналу: пост іде сюди при зміні курсу саме цієї точки. */}
            <select
              value={c.pointId ?? ''} onChange={(e) => setChannel(i, 'pointId', e.target.value ? Number(e.target.value) : null)}
              title="Точка каналу"
              className="w-32 border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              <option value="">усі точки</option>
              {points.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {/* Стиль картки саме для цього каналу; «— загальний» = глобальна тема. */}
            <select
              value={c.theme ?? ''} onChange={(e) => setChannel(i, 'theme', e.target.value)}
              title="Стиль картки цього каналу"
              className="w-36 border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              <option value="">— загальний стиль</option>
              <option value="classic">Класика</option>
              <option value="dark">Преміум</option>
              <option value="minimal">Мінімалізм</option>
              <option value="board">Табло</option>
              <option value="editorial">Журнал</option>
              <option value="grid">Плитки</option>
              <option value="story">Сторіз 9:16</option>
            </select>
            <button onClick={() => removeChannel(i)} className="text-gray-400 hover:text-red-600 px-1" title="Видалити">✕</button>
          </div>
        ))}
        <button onClick={addChannel} className="text-sm text-blue-600 hover:underline">+ Додати канал</button>
        <p className="text-xs text-gray-400">
          Точка каналу: пост іде сюди при зміні курсу саме цієї точки («усі точки» — при зміні будь-якої).
          Стиль перекриває загальний (зі сторінки «Картка курсів»).
        </p>

        <p className="text-xs text-gray-400 pt-1">
          Автопублікація при зміні курсу вмикається на сторінці «Картка курсів».
        </p>
      </div>

      <div className="flex items-center gap-2">
        <button onClick={save} disabled={busy}
          className="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white text-sm font-medium rounded-lg disabled:opacity-50">
          Зберегти
        </button>
        <button onClick={test} disabled={busy || !configured}
          className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50">
          Надіслати тестове
        </button>
        {msg && <span className={`text-sm ${msg.ok ? 'text-green-600' : 'text-red-600'}`}>{msg.text}</span>}
      </div>
      <p className="text-[11px] text-gray-400">
        chatId: {chatId || '—'} · Токен зберігається на сервері й назовні не показується.
      </p>
    </div>
  );
}

// Курси НБУ: % націнки та автопідтягування за розкладом.
export function NbuSettings() {
  const [buyPct, setBuyPct] = useState<number>(-5);
  const [sellPct, setSellPct] = useState<number>(5);
  const [auto, setAuto] = useState<boolean>(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    Promise.all([api.get('/settings/nbu-rates'), api.get('/settings/nbu-auto')]).then(([r, a]) => {
      setBuyPct(r.data.buyPct); setSellPct(r.data.sellPct); setAuto(a.data.enabled);
    });
  }, []);

  const save = async () => {
    setLoading(true); setSaved(false);
    try {
      await Promise.all([
        api.put('/settings/nbu-rates', { buyPct, sellPct }),
        api.put('/settings/nbu-auto', { enabled: auto }),
      ]);
      setSaved(true); setTimeout(() => setSaved(false), 3000);
    } finally { setLoading(false); }
  };

  const numCls = 'w-24 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400';
  return (
    <div className="bg-white rounded-xl shadow p-6 space-y-5">
      <h3 className="font-semibold text-gray-800 text-base">📊 Курси НБУ</h3>

      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-gray-700">Автопідтягування за розкладом</div>
          <div className="text-xs text-gray-400">Щодня оновлює курси точок як НБУ ± % (нижче). Обережно — змінює живі курси.</div>
        </div>
        <Toggle enabled={auto} onChange={setAuto} />
      </div>

      <div className="flex items-center gap-4">
        <label className="text-sm text-gray-700 flex items-center gap-2">
          Купівля, %<input type="number" step="0.1" value={buyPct} onChange={(e) => setBuyPct(Number(e.target.value))} className={numCls} />
        </label>
        <label className="text-sm text-gray-700 flex items-center gap-2">
          Продаж, %<input type="number" step="0.1" value={sellPct} onChange={(e) => setSellPct(Number(e.target.value))} className={numCls} />
        </label>
      </div>
      <p className="text-xs text-gray-400">
        Курс купівлі = НБУ × (1 + купівля%/100), продаж = НБУ × (1 + продаж%/100). Напр. −5 і +5.
      </p>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={loading}
          className="bg-blue-700 hover:bg-blue-800 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
          {loading ? 'Збереження...' : 'Зберегти'}
        </button>
        {saved && <p className="text-green-600 text-sm">✓ Збережено</p>}
      </div>
    </div>
  );
}

// Сповіщення: Telegram-бот + поріг «великої операції» (він і є порогом
// телеграм-сповіщення, тому живе поруч, а не серед правил операцій).
// Адміни бота: хто (за Telegram ID) може міняти курс командою в чат-боті.
function BotAdmins() {
  type Admin = { tgId: number; userId: number; name: string };
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [users, setUsers] = useState<{ id: number; name: string }[]>([]);
  const [tgId, setTgId] = useState('');
  const [userId, setUserId] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get('/settings/bot-admins').then(({ data }) => setAdmins(data)).catch(() => {});
    api.get('/users').then(({ data }) => setUsers(data.filter((u: any) => u.role === 'ADMIN'))).catch(() => {});
  }, []);

  const persist = async (next: Admin[]) => {
    setAdmins(next);
    await api.put('/settings/bot-admins', { admins: next }).catch(() => {});
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const add = () => {
    const tg = Number(tgId);
    const uid = Number(userId);
    if (!Number.isFinite(tg) || !Number.isFinite(uid) || !uid) return;
    const name = users.find((u) => u.id === uid)?.name ?? '';
    persist([...admins.filter((a) => a.tgId !== tg), { tgId: tg, userId: uid, name }]);
    setTgId(''); setUserId('');
  };

  return (
    <div className="bg-white rounded-xl shadow p-6 space-y-3">
      <div>
        <h3 className="font-semibold text-gray-800 text-base">🤖 Адміни бота (зміна курсу)</h3>
        <p className="text-xs text-gray-400 mt-0.5">
          Хто може міняти курс командою в чат-боті. Дізнатись свій Telegram ID: напишіть боту <code className="bg-gray-100 px-1 rounded">/id</code>.
          Курс міняється від імені обраного користувача.
        </p>
      </div>

      {admins.length === 0 && <p className="text-xs text-gray-400">Ще нікого не додано.</p>}
      {admins.map((a) => (
        <div key={a.tgId} className="flex items-center gap-2 text-sm">
          <span className="font-mono bg-gray-100 px-2 py-1 rounded">{a.tgId}</span>
          <span className="text-gray-600">→ {a.name || `user #${a.userId}`}</span>
          <button
            onClick={() => persist(admins.filter((x) => x.tgId !== a.tgId))}
            className="ml-auto text-gray-400 hover:text-red-600 px-1" title="Прибрати"
          >✕</button>
        </div>
      ))}

      <div className="flex items-center gap-2 flex-wrap pt-1">
        <input
          type="number" value={tgId} onChange={(e) => setTgId(e.target.value)}
          placeholder="Telegram ID"
          className="w-40 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        <select
          value={userId} onChange={(e) => setUserId(e.target.value)}
          className="w-48 border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          <option value="">— користувач системи —</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <button onClick={add} className="text-sm text-blue-600 hover:underline">+ Додати</button>
        {saved && <span className="text-green-600 text-xs">✓ Збережено</span>}
      </div>
    </div>
  );
}

export function NotificationsSettings() {
  const [largeOp, setLargeOp] = useState<number>(0);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get('/settings/large-op').then(({ data }) => setLargeOp(data.amount)).catch(() => {});
  }, []);

  const handleSave = async () => {
    setLoading(true);
    setSaved(false);
    try {
      await api.put('/settings/large-op', { amount: largeOp });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <TelegramSettings />
      <BotAdmins />

      <div className="bg-white rounded-xl shadow p-6 space-y-5">
        <h3 className="font-semibold text-gray-800 text-base">🔔 Поріг великої операції</h3>

        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700">Сума, ₴</label>
          <p className="text-xs text-gray-400">
            Операції з гривневою сумою від цього порога надсилаються в Telegram власнику. 0 — вимкнено.
          </p>
          <input
            type="number" min="0" step="1000" value={largeOp}
            onChange={(e) => setLargeOp(Math.max(0, parseFloat(e.target.value) || 0))}
            className="w-40 border border-gray-300 rounded-lg px-3 py-2 text-right font-semibold focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={handleSave} disabled={loading}
            className="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition">
            {loading ? 'Збереження...' : 'Зберегти'}
          </button>
          {saved && <p className="text-green-600 text-sm">✓ Збережено</p>}
        </div>
      </div>
    </div>
  );
}

// Каса та операції: реквізити для чеків, швидкі суми, правила роботи каси
// й дозволи касиру. Рендериться прямо зі сторінки адмінки (пункт сайдбара).
export default function OperationsSettings() {
  const [minutes, setMinutes] = useState<number>(5);
  const [balanceEdit, setBalanceEdit] = useState<boolean>(true);
  const [seeBank, setSeeBank] = useState<boolean>(false);
  const [seeProfit, setSeeProfit] = useState<boolean>(true);
  const [bankEnabled, setBankEnabled] = useState<boolean>(true);
  const [canExpenses, setCanExpenses] = useState<boolean>(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get('/settings/storno-window'),
      api.get('/settings/balance-edit'),
      api.get('/settings/cashier-see-bank'),
      api.get('/settings/cashier-see-profit'),
      api.get('/settings/cash-bank-enabled'),
      api.get('/settings/cashier-expenses'),
    ]).then(([s, b, k, p, cb, ce]) => {
      setMinutes(s.data.minutes);
      setBalanceEdit(b.data.enabled);
      setSeeBank(k.data.enabled);
      setSeeProfit(p.data.enabled);
      setBankEnabled(cb.data.enabled);
      setCanExpenses(ce.data.enabled);
    });
  }, []);

  const handleSave = async () => {
    setLoading(true);
    setSaved(false);
    try {
      await Promise.all([
        api.put('/settings/storno-window', { minutes }),
        api.put('/settings/balance-edit', { enabled: balanceEdit }),
        api.put('/settings/cashier-see-bank', { enabled: seeBank }),
        api.put('/settings/cashier-see-profit', { enabled: seeProfit }),
        api.put('/settings/cash-bank-enabled', { enabled: bankEnabled }),
        api.put('/settings/cashier-expenses', { enabled: canExpenses }),
      ]);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <OrgSettings />
      <QuickAmountsSettings
        endpoint="/settings/quick-amounts"
        title="⚡ Швидкі суми (операції)"
        subtitle="Кнопки швидкого вводу суми у формі операції касира."
        accent="blue"
      />
      <QuickAmountsSettings
        endpoint="/settings/usdt-quick-amounts"
        title="⚡ Швидкі суми USDT"
        subtitle="Кнопки −/+ для поля «Сума USDT» у вікні операції каси."
        accent="teal"
      />

      <div className="bg-white rounded-xl shadow p-6 space-y-5">
        <h3 className="font-semibold text-gray-800 text-base">Правила та дозволи</h3>

        {/* Вікно сторно */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700">Вікно сторно (хвилин)</label>
          <p className="text-xs text-gray-400">
            Касир може скасувати останню операцію протягом вказаного часу після її підтвердження.
          </p>
          <div className="flex items-center gap-3">
            <input
              type="number" min="1" max="60" value={minutes}
              onChange={(e) => setMinutes(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-24 border border-gray-300 rounded-lg px-3 py-2 text-center text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <span className="text-gray-500 text-sm">хвилин</span>
          </div>
        </div>

        <div className="border-t border-gray-100" />

        {/* Редагування залишків */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="text-sm font-medium text-gray-700">Редагування залишків каси</p>
            <p className="text-xs text-gray-400">
              Дозволити касиру коригувати фактичний залишок впродовж зміни.
            </p>
          </div>
          <Toggle enabled={balanceEdit} onChange={setBalanceEdit} />
        </div>

        <div className="border-t border-gray-100" />

        {/* Видимість карти для касира */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="text-sm font-medium text-gray-700">Касир бачить баланс карти</p>
            <p className="text-xs text-gray-400">
              Показувати касиру залишок карти при виборі джерела «Карта». Рухати карту касир може завжди.
            </p>
          </div>
          <Toggle enabled={seeBank} onChange={setSeeBank} />
        </div>

        <div className="border-t border-gray-100" />

        {/* Видимість прибутку для касира */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="text-sm font-medium text-gray-700">Касир бачить прибуток каси</p>
            <p className="text-xs text-gray-400">
              Показувати касиру живий прибуток на екрані каси та блок «Прибуток за зміну» при закритті (включно з друкованим звітом).
            </p>
          </div>
          <Toggle enabled={seeProfit} onChange={setSeeProfit} />
        </div>

        <div className="border-t border-gray-100" />

        {/* Дозвіл касиру створювати витрати */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="text-sm font-medium text-gray-700">Касир може створювати витрати</p>
            <p className="text-xs text-gray-400">
              Дозволити касиру додавати витрати. Видаляти витрати може лише адмін.
            </p>
          </div>
          <Toggle enabled={canExpenses} onChange={setCanExpenses} />
        </div>

        <div className="border-t border-gray-100" />

        {/* Глобальний банк готівки (ярлик для користувача — «Карта») */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="text-sm font-medium text-gray-700">Використовувати карту компанії</p>
            <p className="text-xs text-gray-400">
              Увімкнено: підкріплення/інкасації рухають спільний баланс карти, є сторінка «Карта».
              Вимкнено: гроші живуть лише по касах, джерело «Карта» у русі готівки не пропонується.
            </p>
          </div>
          <Toggle enabled={bankEnabled} onChange={setBankEnabled} />
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={handleSave} disabled={loading}
            className="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition">
            {loading ? 'Збереження...' : 'Зберегти'}
          </button>
          {saved && <p className="text-green-600 text-sm">✓ Збережено</p>}
        </div>
      </div>

      <DangerZone />
    </div>
  );
}

// Небезпечна зона: обнулення всіх операційних даних (гроші/операції/зміни/
// баланси). Лишає точки, каси, валюти, юзерів, активні курси. Пароль адміна.
function DangerZone() {
  const [counts, setCounts] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const loadCounts = () => {
    api.get('/maintenance/operational-counts').then(({ data }) => setCounts(data)).catch(() => {});
  };
  useEffect(() => { loadCounts(); }, []);

  const reset = async () => {
    setBusy(true); setMsg(null);
    try {
      const { data } = await api.post('/maintenance/reset-operational', { password });
      setMsg({ ok: true, text: `Обнулено: ${data.deleted.operations} операцій, ${data.deleted.shifts} змін.` });
      setOpen(false); setPassword('');
      loadCounts();
    } catch (e: any) {
      setMsg({ ok: false, text: e.response?.data?.message ?? 'Помилка' });
    } finally { setBusy(false); }
  };

  return (
    <div className="bg-white rounded-xl shadow p-6 border-2 border-red-200 space-y-3">
      <div>
        <h3 className="font-semibold text-red-700 text-base">⚠ Небезпечна зона</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Обнулення всіх операційних даних — старт із чистого аркуша.
        </p>
      </div>

      {counts && (
        <p className="text-xs text-gray-500">
          Буде видалено: <b>{counts.operations}</b> операцій, <b>{counts.shifts}</b> змін,{' '}
          <b>{counts.cashMovements}</b> рухів готівки, <b>{counts.transfers}</b> передач,{' '}
          <b>{counts.usdtOperations}</b> USDT, <b>{counts.reconciliations}</b> звірок,{' '}
          <b>{counts.expenses}</b> витрат. Баланс карти й гаманців — обнулиться.
          <br />
          Залишаться: точки, каси, валюти, користувачі, налаштування та активні курси.
        </p>
      )}

      {!open ? (
        <button
          onClick={() => { setOpen(true); setMsg(null); }}
          className="px-4 py-2 bg-white border border-red-300 text-red-700 text-sm font-medium rounded-lg hover:bg-red-50"
        >
          Обнулити операційні дані…
        </button>
      ) : (
        <div className="space-y-2 border-t border-red-100 pt-3">
          <p className="text-sm text-red-700 font-medium">
            Дію не можна скасувати. Для підтвердження введіть свій пароль.
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="Пароль адміна" autoComplete="off"
              className="w-52 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
            />
            <button
              onClick={reset} disabled={busy || !password}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg disabled:opacity-50"
            >
              {busy ? 'Виконання…' : 'Видалити назавжди'}
            </button>
            <button
              onClick={() => { setOpen(false); setPassword(''); }}
              className="px-4 py-2 text-sm text-gray-600 rounded-lg hover:bg-gray-100"
            >
              Скасувати
            </button>
          </div>
        </div>
      )}
      {msg && <p className={`text-sm ${msg.ok ? 'text-green-600' : 'text-red-600'}`}>{msg.text}</p>}
    </div>
  );
}
