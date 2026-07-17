import { useEffect, useMemo, useState } from 'react';
import api from '../../api/axios';
import { format } from 'date-fns';
import { fmtMoney, fmtNum } from '../../lib/format';

type Point = { date: string; profit: number; profitUsd: number; operations: number };

// Прибуток по днях у $ (полярні бари навколо нульової лінії); ₴ — у тултіпі.
// Кольори пари #16a34a/#dc2626 провалідовані dataviz-валідатором (усі перевірки PASS);
// полярність додатково кодується напрямком бару, тож не «колір-соло».
const POS = '#16a34a'; // green-600
const NEG = '#dc2626'; // red-600

export default function ProfitChart({ days = 14 }: { days?: number }) {
  const [series, setSeries] = useState<Point[]>([]);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    api.get(`/finance/series?days=${days}`).then(({ data }) => setSeries(data)).catch(() => {});
  }, [days]);

  const W = 420, H = 132, PAD_T = 16, PAD_B = 18;
  const plotH = H - PAD_T - PAD_B;

  // Значення бару — прибуток у $ (нативний для $-числовника). Старі дні до
  // беквілу могли б мати 0 — тоді падаємо на ₴ (не має траплятись, лише захист).
  const val = (p: Point) => (p.profitUsd != null ? Number(p.profitUsd) : Number(p.profit));

  const { bars, zeroY, maxIdx } = useMemo(() => {
    const maxAbs = Math.max(1, ...series.map((p) => Math.abs(val(p))));
    const hasNeg = series.some((p) => val(p) < 0);
    const hasPos = series.some((p) => val(p) >= 0);
    // Нульова лінія: якщо збитків немає — унизу; якщо є обидва — пропорційно.
    const posShare = !hasNeg ? 1 : !hasPos ? 0 : 0.5;
    const zeroY = PAD_T + plotH * posShare;
    const step = W / Math.max(series.length, 1);
    const barW = Math.max(4, Math.min(24, step - 2)); // ≥2px проміжок між барами
    const bars = series.map((p, i) => {
      const v = val(p);
      const scale = v >= 0 ? (zeroY - PAD_T) : (H - PAD_B - zeroY);
      const h = Math.abs(v) / maxAbs * Math.max(scale, 1);
      return {
        ...p,
        v,
        x: i * step + (step - barW) / 2,
        y: v >= 0 ? zeroY - h : zeroY,
        w: barW,
        h: Math.max(h, v === 0 ? 0 : 1.5),
      };
    });
    let maxIdx = -1, best = 0;
    series.forEach((p, i) => { if (Math.abs(val(p)) > best) { best = Math.abs(val(p)); maxIdx = i; } });
    return { bars, zeroY, maxIdx };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series]);

  const totalUsd = series.reduce((s, p) => s + val(p), 0);
  const totalUah = series.reduce((s, p) => s + Number(p.profit), 0);
  const hovered = hover != null ? bars[hover] : null;

  return (
    <div className="bg-white rounded-xl shadow p-5">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="font-semibold text-lg">📈 Прибуток по днях</h3>
        <div className="text-right">
          <div className="text-xs text-gray-400">за {days} дн.</div>
          <div className={`font-bold ${totalUsd >= 0 ? 'text-green-700' : 'text-red-600'}`}>
            {totalUsd >= 0 ? '+' : '−'}{fmtNum(Math.abs(totalUsd), 0)} $
            <span className="text-xs font-medium text-gray-400 ml-1.5">
              {totalUah >= 0 ? '+' : '−'}{fmtNum(Math.abs(totalUah), 0)} ₴
            </span>
          </div>
        </div>
      </div>

      {series.length === 0 ? (
        <div className="text-center text-gray-400 text-sm py-8">Завантаження…</div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: H }}
            onMouseLeave={() => setHover(null)}>
            {/* нульова лінія — рецесивна */}
            <line x1="0" x2={W} y1={zeroY} y2={zeroY} stroke="#e5e7eb" strokeWidth="1" />
            {bars.map((b, i) => (
              <g key={b.date}>
                {/* хіт-таргет ширший за бар */}
                <rect x={b.x - 3} y={PAD_T} width={b.w + 6} height={plotH} fill="transparent"
                  onMouseEnter={() => setHover(i)} />
                <rect
                  x={b.x} y={b.y} width={b.w} height={b.h} rx="2"
                  fill={b.v >= 0 ? POS : NEG}
                  opacity={hover === null || hover === i ? 1 : 0.35}
                  style={{ pointerEvents: 'none', transition: 'opacity .1s' }}
                />
                {/* вибіркова пряма мітка — лише пік (текст токеном, не кольором серії) */}
                {i === maxIdx && Math.abs(b.v) > 0 && (
                  <text x={b.x + b.w / 2} y={b.v >= 0 ? b.y - 4 : b.y + b.h + 11}
                    textAnchor="middle" fontSize="10" fill="#374151" fontWeight="600">
                    {b.v >= 0 ? '+' : '−'}{Math.abs(b.v) >= 1000 ? (Math.abs(b.v) / 1000).toFixed(1) + 'k' : Math.abs(b.v).toFixed(0)}
                  </text>
                )}
                {/* підписи днів — кожен другий */}
                {i % 2 === 0 && (
                  <text x={b.x + b.w / 2} y={H - 4} textAnchor="middle" fontSize="9" fill="#9ca3af">
                    {format(new Date(b.date), 'dd.MM')}
                  </text>
                )}
              </g>
            ))}
          </svg>

          {/* HTML-тултіп */}
          {hovered && (
            <div
              className="absolute pointer-events-none bg-gray-900 text-white text-xs rounded-lg px-2.5 py-1.5 shadow-lg z-10"
              style={{
                left: `${((hovered.x + hovered.w / 2) / W) * 100}%`,
                top: 0,
                transform: 'translateX(-50%)',
              }}
            >
              <div className="text-gray-300">{format(new Date(hovered.date), 'dd.MM.yyyy')}</div>
              <div className="font-semibold">
                {hovered.v >= 0 ? '+' : '−'}{fmtMoney(Math.abs(hovered.v))} $
              </div>
              <div className="text-gray-400">
                {hovered.profit >= 0 ? '+' : '−'}{fmtMoney(Math.abs(hovered.profit))} ₴ · {hovered.operations} опер.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
