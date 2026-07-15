import { useEffect, useState } from 'react';
import api from '../../api/axios';

/**
 * Картка курсів для Telegram-каналу: вибір стилю, живе прев'ю (PNG рендериться
 * на сервері — рівно те, що піде в канал), редагування статичних текстів і
 * перемикач «постити картинкою замість тексту».
 */

const THEMES: { key: string; label: string; hint: string }[] = [
  { key: 'classic', label: 'Класика', hint: 'Зелень + золото, як на зразку' },
  { key: 'dark', label: 'Преміум', hint: 'Та сама розкладка, графіт + золото' },
  { key: 'minimal', label: 'Мінімалізм', hint: 'Та сама розкладка, білий + синій' },
  { key: 'board', label: 'Табло', hint: 'Величезні цифри на чорному — читається навіть у прев\'ю стрічки' },
  { key: 'editorial', label: 'Журнал', hint: 'Двоколонка: ліворуч про нас, праворуч курси. Багато повітря' },
  { key: 'grid', label: 'Плитки', hint: 'Кожна валюта — окрема картка. Зручно з телефона' },
  { key: 'story', label: 'Сторіз 9:16', hint: 'Вертикальний формат для сторіз/статусів' },
];

type Cfg = {
  brand: string; brandSuffix: string; tagline: string;
  address: string; addressNote: string;
  hoursWeek: string; hoursWeekend: string;
  phones: string[]; bot: string; channel: string;
  services: string[]; footer: string;
};

export default function RateCardAdmin() {
  const [points, setPoints] = useState<any[]>([]);
  const [pointId, setPointId] = useState<number | null>(null);
  const [theme, setTheme] = useState('classic');
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [preview, setPreview] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [publishing, setPublishing] = useState(false);

  // Вміст глобальний чи по точці: перемикач нижче. Тема й asImage — глобальні.
  const [scope, setScope] = useState<'global' | 'point'>('global');

  useEffect(() => {
    api.get('/exchange-points').then(({ data }) => {
      setPoints(data);
      if (data.length) setPointId(data[0].id);
    });
  }, []);

  // Вміст картки: глобальний або точки (scope + pointId).
  const loadConfig = (sc = scope, p = pointId) => {
    const q = sc === 'point' && p ? `?pointId=${p}` : '';
    api.get(`/settings/rate-card${q}`).then(({ data }) => {
      setTheme(data.theme);
      setCfg(data.config);
    }).catch(() => {});
  };
  useEffect(() => {
    loadConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, pointId]);


  // Прев'ю — PNG із сервера (та сама картинка, що піде в Telegram).
  const loadPreview = async (t = theme, p = pointId) => {
    if (!p) return;
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get(`/rates/card/${p}?theme=${t}`, { responseType: 'blob' });
      setPreview((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(data);
      });
    } catch {
      setError('Немає активних курсів для цієї точки — картку нема з чого зібрати');
      setPreview('');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (pointId) loadPreview(theme, pointId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointId, theme]);

  const save = async () => {
    setSaved(false);
    // Вміст пишемо в глобальний або в точку (за scope); тему — глобально.
    const body: any = { theme, config: cfg };
    if (scope === 'point' && pointId) body.pointId = pointId;
    await api.put('/settings/rate-card', body);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
    loadPreview();
  };

  const publish = async () => {
    if (!pointId) return;
    setPublishing(true);
    try {
      const { data } = await api.post(`/rates/publish/${pointId}`);
      alert(`Надіслано в ${data.sent} з ${data.total} каналів`);
    } catch (e: any) {
      alert(e.response?.data?.message ?? 'Не вдалося опублікувати');
    } finally {
      setPublishing(false);
    }
  };

  const field = (label: string, value: string, onChange: (v: string) => void) => (
    <div>
      <label className="text-xs text-gray-500 block mb-1">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
      />
    </div>
  );

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px] gap-6 items-start">
      {/* Ліворуч: стиль + тексти */}
      <div className="space-y-6">
        <div className="bg-white rounded-xl shadow p-6 space-y-4">
          <div>
            <h3 className="font-semibold text-gray-800 text-base">🖼 Картка курсів для Telegram</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Картинка рендериться на сервері й публікується в канали замість тексту.
              Курси, дата/час і стрілки тренду підставляються автоматично.
            </p>
          </div>

          <p className="text-xs text-gray-400 border-t border-gray-100 pt-4 mt-1">
            Публікація в канали — вручну кнопкою «Опублікувати» (праворуч), окремо по кожній точці.
          </p>
        </div>

        {/* Тексти картки */}
        {cfg && (
          <div className="bg-white rounded-xl shadow p-6 space-y-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h3 className="font-semibold text-gray-800 text-base">Вміст картки</h3>
              {/* Глобальний вміст або перекриття по точці (адреси точок різні). */}
              <div className="flex items-center gap-1 text-sm">
                <button
                  onClick={() => setScope('global')}
                  className={`px-3 py-1 rounded-lg ${scope === 'global' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                  Загальний
                </button>
                <button
                  onClick={() => setScope('point')}
                  className={`px-3 py-1 rounded-lg ${scope === 'point' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                  По точці
                </button>
              </div>
            </div>
            <p className="text-xs text-gray-400">
              {scope === 'global'
                ? 'Спільний вміст для всіх точок (бренд, слоган, послуги…).'
                : `Перекриття для «${points.find((p) => p.id === pointId)?.name ?? ''}»: заповнене тут замінює загальне (адреса, телефони, графік).`}
            </p>
            <div className="grid grid-cols-2 gap-3">
              {field('Бренд', cfg.brand, (v) => setCfg({ ...cfg, brand: v }))}
              {field('Підпис бренду', cfg.brandSuffix, (v) => setCfg({ ...cfg, brandSuffix: v }))}
              {field('Слоган', cfg.tagline, (v) => setCfg({ ...cfg, tagline: v }))}
              {field('Адреса', cfg.address, (v) => setCfg({ ...cfg, address: v }))}
              {field('Уточнення адреси', cfg.addressNote, (v) => setCfg({ ...cfg, addressNote: v }))}
              {field('Графік Пн–Пт', cfg.hoursWeek, (v) => setCfg({ ...cfg, hoursWeek: v }))}
              {field('Графік Сб–Нд', cfg.hoursWeekend, (v) => setCfg({ ...cfg, hoursWeekend: v }))}
              {field('Бот', cfg.bot, (v) => setCfg({ ...cfg, bot: v }))}
              {field('Канал', cfg.channel, (v) => setCfg({ ...cfg, channel: v }))}
              {field('Нижній рядок', cfg.footer, (v) => setCfg({ ...cfg, footer: v }))}
            </div>
            {field('Телефони (через кому)', cfg.phones.join(', '), (v) =>
              setCfg({ ...cfg, phones: v.split(',').map((s) => s.trim()).filter(Boolean) }),
            )}
            <div>
              <label className="text-xs text-gray-500 block mb-1">Послуги (кожна з нового рядка)</label>
              <textarea
                value={cfg.services.join('\n')}
                onChange={(e) => setCfg({ ...cfg, services: e.target.value.split('\n').filter((s) => s.trim()) })}
                rows={5}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>

            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={save}
                className="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white text-sm font-medium rounded-lg transition"
              >
                Зберегти
              </button>
              {saved && <p className="text-green-600 text-sm">✓ Збережено</p>}
            </div>
          </div>
        )}
      </div>

      {/* Праворуч: стиль + живе прев'ю (в одному блоці) */}
      <div className="bg-white rounded-xl shadow p-4 space-y-3 xl:sticky xl:top-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold text-gray-800 text-sm">Стиль і прев'ю</h3>
          <select
            value={pointId ?? ''}
            onChange={(e) => setPointId(Number(e.target.value))}
            title="Точка для прев'ю"
            className="border border-gray-300 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            {points.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        {/* Вибір стилю — дропдаун */}
        <div>
          <select
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            {THEMES.map((t) => (
              <option key={t.key} value={t.key}>{t.label}</option>
            ))}
          </select>
          <p className="text-[11px] text-gray-400 mt-1">
            {THEMES.find((t) => t.key === theme)?.hint}
          </p>
        </div>

        <div className="rounded-lg overflow-hidden border border-gray-200 bg-gray-50 min-h-[300px] flex items-center justify-center">
          {loading ? (
            <span className="text-gray-400 text-sm py-16">Рендер...</span>
          ) : error ? (
            <span className="text-gray-400 text-sm text-center px-6 py-16">{error}</span>
          ) : preview ? (
            <img src={preview} alt="Картка курсів" className="w-full" />
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => loadPreview()}
            className="flex-1 px-3 py-2 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50"
          >
            ↻ Оновити
          </button>
          <button
            onClick={publish}
            disabled={publishing || !preview}
            className="flex-1 px-3 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg disabled:opacity-50"
          >
            {publishing ? 'Публікація...' : '📤 Опублікувати'}
          </button>
        </div>
        <p className="text-[11px] text-gray-400">
          Це точна копія того, що піде в канал. Стрілки: ↑ курс продажу виріс, ↓ впав, — без змін.
        </p>
      </div>
    </div>
  );
}
