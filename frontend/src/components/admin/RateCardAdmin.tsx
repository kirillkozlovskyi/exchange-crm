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
  const [asImage, setAsImage] = useState(false);
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [preview, setPreview] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    api.get('/exchange-points').then(({ data }) => {
      setPoints(data);
      if (data.length) setPointId(data[0].id);
    });
    api.get('/settings/rate-card').then(({ data }) => {
      setTheme(data.theme);
      setAsImage(!!data.asImage);
      setCfg(data.config);
    });
  }, []);

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
    await api.put('/settings/rate-card', { theme, asImage, config: cfg });
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

          {/* Стиль */}
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-2">Стиль</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {THEMES.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTheme(t.key)}
                  className={`text-left border rounded-lg px-3 py-2 transition ${
                    theme === t.key
                      ? 'border-blue-600 bg-blue-50 ring-2 ring-blue-200'
                      : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <div className="text-sm font-semibold text-gray-800">{t.label}</div>
                  <div className="text-[11px] text-gray-500 leading-snug mt-0.5">{t.hint}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Постити картинкою */}
          <div className="flex items-start justify-between gap-4 border-t border-gray-100 pt-4">
            <div className="space-y-1">
              <p className="text-sm font-medium text-gray-700">Постити картинкою</p>
              <p className="text-xs text-gray-400">
                Увімкнено — у канал іде картинка; вимкнено — звичайний текст (як раніше).
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAsImage((v) => !v)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${asImage ? 'bg-blue-600' : 'bg-gray-300'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${asImage ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
        </div>

        {/* Тексти картки */}
        {cfg && (
          <div className="bg-white rounded-xl shadow p-6 space-y-4">
            <h3 className="font-semibold text-gray-800 text-base">Вміст картки</h3>
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

      {/* Праворуч: живе прев'ю */}
      <div className="bg-white rounded-xl shadow p-4 space-y-3 xl:sticky xl:top-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold text-gray-800 text-sm">Прев'ю</h3>
          <select
            value={pointId ?? ''}
            onChange={(e) => setPointId(Number(e.target.value))}
            className="border border-gray-300 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            {points.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
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
