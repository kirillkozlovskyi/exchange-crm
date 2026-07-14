/**
 * Картка курсів для Telegram-каналу — рендериться на сервері у PNG.
 *
 * Макет відтворено за зразком замовника (зелено-золота тема, таблиця курсів зі
 * стрілками тренду, блоки послуг/адреси/контактів). Дизайн описаний як SVG і
 * рендериться через resvg (без браузера) — швидко й без важких залежностей.
 *
 * Динамічне: курси, стрілки тренду, дата/час. Решта (адреса, телефони, графік,
 * послуги) — з налаштувань, щоб змінювати без правки коду.
 */
import { Resvg } from '@resvg/resvg-js';
import * as path from 'path';
import * as fs from 'fs';

export type Trend = 'up' | 'down' | 'flat';

export interface RateCardRow {
  currency: string;
  name: string;       // «ДОЛАР США»
  buy: number;
  sell: number;
  trend: Trend;
}

export interface RateCardConfig {
  brand: string;        // KURSOK
  brandSuffix: string;  // EXCHANGE
  tagline: string;      // КРАЩИЙ КУРС У МІСТІ
  address: string;
  addressNote: string;
  hoursWeek: string;
  hoursWeekend: string;
  phones: string[];
  bot: string;
  channel: string;
  services: string[];
  footer: string;
}

export const DEFAULT_CARD_CONFIG: RateCardConfig = {
  brand: 'KURSOK',
  brandSuffix: 'EXCHANGE',
  tagline: 'КРАЩИЙ КУРС У МІСТІ',
  address: 'просп. Соборний, 95',
  addressNote: '(біля арки, з торця будинку)',
  hoursWeek: 'Пн–Пт   09:15–19:00',
  hoursWeekend: 'Сб–Нд   09:30–18:00',
  phones: ['068 330 92 87', '066 422 80 37'],
  bot: '@kursok_exchange_bot',
  channel: '@kurs_ok_zp',
  services: [
    'Купівля та продаж валюти',
    'USDT (TRC20)',
    'Перекази по Україні та світу',
    'Прийом старих, пошкоджених і надірваних купюр',
    'Бронювання валюти від 1000 USD/EUR (до 30 хв)',
  ],
  footer: 'KURSOK EXCHANGE — кращий курс у місті!',
};

/** Повні назви валют для підпису під кодом. */
export const CURRENCY_NAMES: Record<string, string> = {
  USD: 'ДОЛАР США',
  EUR: 'ЄВРО',
  PLN: 'ПОЛЬСЬКИЙ ЗЛОТИЙ',
  GBP: 'ФУНТ СТЕРЛІНГІВ',
  CHF: 'ШВЕЙЦАРСЬКИЙ ФРАНК',
  CZK: 'ЧЕСЬКА КРОНА',
  CAD: 'КАНАДСЬКИЙ ДОЛАР',
  USDT: 'ТЕЗЕР (TRC20)',
};

// ── Теми оформлення ─────────────────────────────────────────────────────────
export type CardTheme = 'classic' | 'dark' | 'minimal';

interface Palette {
  bg: string; bgGrad2: string; panel: string; panelSoft: string; rowAlt: string;
  brand: string; brandSub: string; accent: string; accentSoft: string;
  title: string; rateText: string; text: string; muted: string; line: string;
  footerBg: string; footerText: string; badgeBg: string;
  iconRing: string; iconInner: string; iconText: string;
  up: string; down: string; flat: string;
}

export const THEMES: Record<CardTheme, Palette> = {
  // Класика — за зразком замовника: зелень + золото, тепле світле тло.
  classic: {
    bg: '#F7FAF5', bgGrad2: '#E7EFE4', panel: '#FFFFFF', panelSoft: '#F4F7F1', rowAlt: '#FAFCF9',
    brand: '#C9962E', brandSub: '#C9962E', accent: '#14512E', accentSoft: '#E3EDE2',
    title: '#14512E', rateText: '#14512E', text: '#1B2A20', muted: '#6B7A6F', line: '#EDF1EB',
    footerBg: '#14512E', footerText: '#EAF6EC', badgeBg: '#14512E',
    iconRing: '#C9962E', iconInner: '#14512E', iconText: '#E8C36A',
    up: '#1E9E4A', down: '#C0392B', flat: '#9AA5A0',
  },
  // Преміум-темна: графіт + золото. Виглядає дорого, добре читається в стрічці.
  dark: {
    bg: '#12161C', bgGrad2: '#0B0E13', panel: '#1B212B', panelSoft: '#232B37', rowAlt: '#1F2631',
    brand: '#E3B85C', brandSub: '#E3B85C', accent: '#E3B85C', accentSoft: '#2A3340',
    title: '#F2F5F8', rateText: '#F2F5F8', text: '#E6EAF0', muted: '#93A0B0', line: '#2C3542',
    footerBg: '#E3B85C', footerText: '#12161C', badgeBg: '#E3B85C',
    iconRing: '#E3B85C', iconInner: '#1B212B', iconText: '#E3B85C',
    up: '#2ECC71', down: '#E74C3C', flat: '#7F8C99',
  },
  // Мінімалізм: білий + синій акцент, без золота. Строго й сучасно.
  minimal: {
    bg: '#FFFFFF', bgGrad2: '#F2F5F9', panel: '#FFFFFF', panelSoft: '#F5F7FA', rowAlt: '#FBFCFE',
    brand: '#0F2B4B', brandSub: '#5B7DA3', accent: '#1F6FEB', accentSoft: '#E8F0FE',
    title: '#0F2B4B', rateText: '#0F2B4B', text: '#1A2733', muted: '#7A8899', line: '#EAEEF3',
    footerBg: '#0F2B4B', footerText: '#FFFFFF', badgeBg: '#1F6FEB',
    iconRing: '#1F6FEB', iconInner: '#E8F0FE', iconText: '#1F6FEB',
    up: '#12A150', down: '#E5484D', flat: '#98A2B3',
  },
};

// Поточна тема рендера. Рендер синхронний і однопотоковий, тож глобальна змінна
// безпечна: buildRateCardSvg виставляє її на початку кожного виклику.
let C: Palette = THEMES.classic;

const esc = (s: string) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const n2 = (v: number) => Number(v).toFixed(2);

// ── Прапори (кола) ──────────────────────────────────────────────────────────
function flag(cur: string, cx: number, cy: number, r: number): string {
  const id = `clip_${cur}_${Math.round(cx)}_${Math.round(cy)}`;
  const clip = `<clipPath id="${id}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>`;
  const ring = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${C.line}" stroke-width="1.5"/>`;
  const g = (inner: string) => `${clip}<g clip-path="url(#${id})">${inner}</g>${ring}`;
  const x = cx - r, y = cy - r, d = r * 2;

  switch (cur) {
    case 'USD': {
      const stripes = Array.from({ length: 7 }, (_, i) =>
        `<rect x="${x}" y="${y + (i * d) / 13 * 2}" width="${d}" height="${d / 13}" fill="#B22234"/>`,
      ).join('');
      return g(
        `<rect x="${x}" y="${y}" width="${d}" height="${d}" fill="#FFFFFF"/>${stripes}` +
        `<rect x="${x}" y="${y}" width="${d * 0.42}" height="${d * 0.54}" fill="#3C3B6E"/>`,
      );
    }
    case 'EUR': {
      const stars = Array.from({ length: 12 }, (_, i) => {
        const a = (i * Math.PI) / 6 - Math.PI / 2;
        return `<circle cx="${cx + Math.cos(a) * r * 0.55}" cy="${cy + Math.sin(a) * r * 0.55}" r="${r * 0.09}" fill="#FFCC00"/>`;
      }).join('');
      return g(`<rect x="${x}" y="${y}" width="${d}" height="${d}" fill="#003399"/>${stars}`);
    }
    case 'PLN':
      return g(
        `<rect x="${x}" y="${y}" width="${d}" height="${d / 2}" fill="#FFFFFF"/>` +
        `<rect x="${x}" y="${cy}" width="${d}" height="${d / 2}" fill="#DC143C"/>`,
      );
    case 'GBP':
      return g(
        `<rect x="${x}" y="${y}" width="${d}" height="${d}" fill="#012169"/>` +
        `<path d="M${x},${y} L${x + d},${y + d} M${x + d},${y} L${x},${y + d}" stroke="#FFFFFF" stroke-width="${r * 0.42}"/>` +
        `<path d="M${x},${y} L${x + d},${y + d} M${x + d},${y} L${x},${y + d}" stroke="#C8102E" stroke-width="${r * 0.2}"/>` +
        `<path d="M${cx},${y} L${cx},${y + d} M${x},${cy} L${x + d},${cy}" stroke="#FFFFFF" stroke-width="${r * 0.55}"/>` +
        `<path d="M${cx},${y} L${cx},${y + d} M${x},${cy} L${x + d},${cy}" stroke="#C8102E" stroke-width="${r * 0.3}"/>`,
      );
    case 'CHF':
      return g(
        `<rect x="${x}" y="${y}" width="${d}" height="${d}" fill="#D52B1E"/>` +
        `<rect x="${cx - r * 0.13}" y="${cy - r * 0.45}" width="${r * 0.26}" height="${r * 0.9}" fill="#FFFFFF"/>` +
        `<rect x="${cx - r * 0.45}" y="${cy - r * 0.13}" width="${r * 0.9}" height="${r * 0.26}" fill="#FFFFFF"/>`,
      );
    case 'CZK':
      return g(
        `<rect x="${x}" y="${y}" width="${d}" height="${d / 2}" fill="#FFFFFF"/>` +
        `<rect x="${x}" y="${cy}" width="${d}" height="${d / 2}" fill="#D7141A"/>` +
        `<path d="M${x},${y} L${cx},${cy} L${x},${y + d} Z" fill="#11457E"/>`,
      );
    case 'CAD':
      return g(
        `<rect x="${x}" y="${y}" width="${d}" height="${d}" fill="#FFFFFF"/>` +
        `<rect x="${x}" y="${y}" width="${d * 0.25}" height="${d}" fill="#FF0000"/>` +
        `<rect x="${x + d * 0.75}" y="${y}" width="${d * 0.25}" height="${d}" fill="#FF0000"/>` +
        `<circle cx="${cx}" cy="${cy}" r="${r * 0.3}" fill="#FF0000"/>`,
      );
    default:
      return g(`<rect x="${x}" y="${y}" width="${d}" height="${d}" fill="${C.accentSoft}"/>`) +
        `<text x="${cx}" y="${cy + 6}" text-anchor="middle" font-family="Montserrat" font-weight="700" font-size="16" fill="${C.accent}">${esc(cur.slice(0, 3))}</text>`;
  }
}

/** Кругла позначка тренду: ↑ зростання, ↓ падіння, — без змін. */
function trendBadge(t: Trend, cx: number, cy: number, r = 22): string {
  const fill = t === 'up' ? C.up : t === 'down' ? C.down : C.flat;
  const arrow =
    t === 'up'
      ? `<path d="M${cx},${cy - 9} L${cx + 8},${cy + 2} L${cx + 3},${cy + 2} L${cx + 3},${cy + 9} L${cx - 3},${cy + 9} L${cx - 3},${cy + 2} L${cx - 8},${cy + 2} Z" fill="#fff"/>`
      : t === 'down'
        ? `<path d="M${cx},${cy + 9} L${cx + 8},${cy - 2} L${cx + 3},${cy - 2} L${cx + 3},${cy - 9} L${cx - 3},${cy - 9} L${cx - 3},${cy - 2} L${cx - 8},${cy - 2} Z" fill="#fff"/>`
        : `<rect x="${cx - 8}" y="${cy - 2.5}" width="16" height="5" rx="2.5" fill="#fff"/>`;
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>${arrow}`;
}

function panel(x: number, y: number, w: number, h: number, r = 16, fill = C.panel): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"/>`;
}

function check(x: number, y: number): string {
  return `<circle cx="${x}" cy="${y}" r="7" fill="${C.up}"/><path d="M${x - 3.2},${y} L${x - 1},${y + 2.6} L${x + 3.4},${y - 2.8}" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
}

export interface RateCardData {
  rows: RateCardRow[];
  date: string; // 14.07.2026
  time: string; // 19:21
  config: RateCardConfig;
  theme?: CardTheme; // classic (за замовч.) | dark | minimal
}

/** Повний SVG картки. Ширина 1000, висота залежить від кількості валют. */
export function buildRateCardSvg(data: RateCardData): string {
  C = THEMES[data.theme ?? 'classic'];
  const cfg = data.config;
  const W = 1000;
  const rowH = 92;
  const tableTop = 372;
  const tableH = 60 + data.rows.length * rowH; // шапка + рядки
  const afterTable = tableTop + tableH + 24;
  const H = afterTable + 660;

  const t: string[] = [];
  const txt = (
    x: number, y: number, s: string,
    o: { size?: number; w?: number; fill?: string; anchor?: string; ls?: number } = {},
  ) =>
    t.push(
      `<text x="${x}" y="${y}" font-family="Montserrat" font-size="${o.size ?? 20}" font-weight="${o.w ?? 500}" ` +
      `fill="${o.fill ?? C.text}" text-anchor="${o.anchor ?? 'start'}"${o.ls ? ` letter-spacing="${o.ls}"` : ''}>${esc(s)}</text>`,
    );

  // Фон
  t.push(`<rect width="${W}" height="${H}" fill="url(#bgGrad)"/>`);

  // ── Шапка: бренд ──────────────────────────────────────────────────────────
  // Корона
  t.push(
    `<path d="M470,42 L482,66 L500,30 L518,66 L530,42 L524,74 L476,74 Z" fill="${C.brand}"/>`,
  );
  txt(W / 2, 132, cfg.brand, { size: 78, w: 900, fill: C.brand, anchor: 'middle', ls: 4 });
  txt(W / 2, 176, cfg.brandSuffix, { size: 30, w: 600, fill: C.brand, anchor: 'middle', ls: 14 });
  txt(W / 2, 208, cfg.tagline, { size: 19, w: 600, fill: C.accent, anchor: 'middle', ls: 3 });

  // Ліворуч: бейдж «обмін без ризику»
  t.push(panel(28, 30, 168, 190, 18));
  t.push(
    `<path d="M112,58 L146,72 L146,104 C146,126 130,142 112,150 C94,142 78,126 78,104 L78,72 Z" fill="${C.accent}"/>`,
    `<path d="M100,105 L109,115 L126,95" stroke="#fff" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  );
  txt(112, 178, 'ОБМІН', { size: 16, w: 800, fill: C.accent, anchor: 'middle' });
  txt(112, 198, 'БЕЗ РИЗИКУ', { size: 16, w: 800, fill: C.accent, anchor: 'middle' });
  t.push(
    Array.from({ length: 5 }, (_, i) => {
      const sx = 44 + i * 27;
      return `<path d="M${sx},204 l4,8 9,1 -6.5,6 1.5,9 -8,-4.5 -8,4.5 1.5,-9 -6.5,-6 9,-1 Z" fill="${C.brand}"/>`;
    }).join(''),
  );

  // Праворуч: оновлено / дата / час
  t.push(panel(W - 268, 30, 240, 190, 18));
  txt(W - 200, 66, 'ОНОВЛЕНО', { size: 17, w: 800, fill: C.accent });
  txt(W - 200, 88, 'ЩОЙНО', { size: 17, w: 800, fill: C.accent });
  t.push(`<circle cx="${W - 228}" cy="72" r="14" fill="none" stroke="${C.accent}" stroke-width="3"/>`);
  t.push(`<path d="M${W - 228},64 L${W - 228},72 L${W - 222},76" stroke="${C.accent}" stroke-width="3" fill="none" stroke-linecap="round"/>`);
  t.push(`<line x1="${W - 248}" y1="112" x2="${W - 48}" y2="112" stroke="${C.line}" stroke-width="2"/>`);
  txt(W - 200, 148, data.date, { size: 27, w: 800, fill: C.text });
  t.push(`<rect x="${W - 242}" y="126" width="26" height="26" rx="4" fill="none" stroke="${C.accent}" stroke-width="2.5"/>`);
  t.push(`<line x1="${W - 242}" y1="134" x2="${W - 216}" y2="134" stroke="${C.accent}" stroke-width="2.5"/>`);
  txt(W - 200, 198, data.time, { size: 27, w: 800, fill: C.text });
  t.push(`<circle cx="${W - 229}" cy="189" r="13" fill="none" stroke="${C.accent}" stroke-width="2.5"/>`);
  t.push(`<path d="M${W - 229},181 L${W - 229},189 L${W - 223},193" stroke="${C.accent}" stroke-width="2.5" fill="none" stroke-linecap="round"/>`);

  // ── Заголовок «КУРСИ ВАЛЮТ» ───────────────────────────────────────────────
  t.push(`<circle cx="96" cy="300" r="52" fill="${C.iconRing}"/>`);
  t.push(`<circle cx="96" cy="300" r="43" fill="${C.iconInner}"/>`);
  txt(96, 314, '$€', { size: 40, w: 900, fill: C.iconText, anchor: 'middle' });
  txt(174, 326, 'КУРСИ ВАЛЮТ', { size: 68, w: 900, fill: C.title });

  // ── Таблиця курсів ────────────────────────────────────────────────────────
  t.push(panel(28, tableTop, W - 56, tableH, 20));
  // Шапка таблиці
  t.push(panel(28, tableTop, W - 56, 60, 20, C.panelSoft));
  txt(170, tableTop + 38, 'ВАЛЮТА', { size: 19, w: 800, fill: C.muted, anchor: 'middle', ls: 2 });
  txt(490, tableTop + 38, 'КУПІВЛЯ', { size: 19, w: 800, fill: C.muted, anchor: 'middle', ls: 2 });
  txt(750, tableTop + 38, 'ПРОДАЖ', { size: 19, w: 800, fill: C.muted, anchor: 'middle', ls: 2 });

  data.rows.forEach((r, i) => {
    const y = tableTop + 60 + i * rowH;
    const cy = y + rowH / 2;
    if (i % 2 === 1) t.push(`<rect x="28" y="${y}" width="${W - 56}" height="${rowH}" fill="${C.rowAlt}"/>`);
    if (i > 0) t.push(`<line x1="60" y1="${y}" x2="${W - 60}" y2="${y}" stroke="${C.line}" stroke-width="1.5"/>`);

    t.push(flag(r.currency, 90, cy, 27));
    txt(132, cy - 2, r.currency, { size: 34, w: 800, fill: C.text });
    txt(132, cy + 22, r.name, { size: 13, w: 600, fill: C.muted, ls: 0.5 });

    txt(490, cy + 14, n2(r.buy), { size: 44, w: 800, fill: C.rateText, anchor: 'middle' });
    t.push(`<line x1="608" y1="${cy - 26}" x2="608" y2="${cy + 26}" stroke="${C.line}" stroke-width="2"/>`);
    txt(750, cy + 14, n2(r.sell), { size: 44, w: 800, fill: C.rateText, anchor: 'middle' });

    t.push(trendBadge(r.trend, W - 92, cy, 22));
  });

  // ── Три бейджі переваг ────────────────────────────────────────────────────
  const fy = afterTable;
  const fw = (W - 56 - 24) / 3;
  const fx = (i: number) => 28 + i * (fw + 12);
  t.push(panel(fx(0), fy, fw, 108, 16), panel(fx(1), fy, fw, 108, 16), panel(fx(2), fy, fw, 108, 16));

  // 1 — надійно/вигідно/професійно
  ['НАДІЙНО', 'ВИГІДНО', 'ПРОФЕСІЙНО'].forEach((s, i) => {
    t.push(check(fx(0) + 82, fy + 32 + i * 26));
    txt(fx(0) + 96, fy + 37 + i * 26, s, { size: 14, w: 700, fill: C.text });
  });
  t.push(
    `<path d="M${fx(0) + 44},${fy + 26} L${fx(0) + 64},${fy + 34} L${fx(0) + 64},${fy + 58} C${fx(0) + 64},${fy + 74} ${fx(0) + 54},${fy + 84} ${fx(0) + 44},${fy + 90} C${fx(0) + 34},${fy + 84} ${fx(0) + 24},${fy + 74} ${fx(0) + 24},${fy + 58} L${fx(0) + 24},${fy + 34} Z" fill="${C.accent}"/>`,
  );

  // 2 — прийом старих купюр
  txt(fx(1) + fw / 2, fy + 40, 'ПРИЙОМ СТАРИХ,', { size: 14, w: 700, fill: C.text, anchor: 'middle' });
  txt(fx(1) + fw / 2, fy + 62, 'ПОШКОДЖЕНИХ ТА', { size: 14, w: 700, fill: C.text, anchor: 'middle' });
  txt(fx(1) + fw / 2, fy + 84, 'USD 1996–1999 РОКІВ', { size: 14, w: 700, fill: C.text, anchor: 'middle' });

  // 3 — бронювання
  txt(fx(2) + fw / 2, fy + 48, 'БРОНЮВАННЯ ВАЛЮТИ', { size: 14, w: 700, fill: C.text, anchor: 'middle' });
  txt(fx(2) + fw / 2, fy + 72, 'ВІД 1000 USD/EUR', { size: 14, w: 700, fill: C.text, anchor: 'middle' });
  txt(fx(2) + fw / 2, fy + 94, 'ДО 30 ХВИЛИН', { size: 14, w: 700, fill: C.text, anchor: 'middle' });

  // ── Послуги (ліворуч) + адреса/графік (праворуч) ──────────────────────────
  const sy = fy + 124;
  const leftW = 600;
  const rightX = 28 + leftW + 12;
  const rightW = W - 56 - leftW - 12;
  const svcH = 60 + cfg.services.length * 30 + 46;

  t.push(panel(28, sy, leftW, svcH, 16));
  t.push(`<path d="M52,${sy + 32} l7,-13 7,13 Z" fill="${C.brand}"/>`);
  txt(72, sy + 30, 'Курси на каналі є інформаційними. Остаточний курс', { size: 13, w: 500, fill: C.muted });
  txt(72, sy + 50, 'узгоджується телефоном або у відділенні.', { size: 13, w: 500, fill: C.muted });
  txt(48, sy + 82, 'Послуги:', { size: 16, w: 800, fill: C.accent });
  cfg.services.forEach((s, i) => {
    const y = sy + 108 + i * 30;
    t.push(check(58, y - 5));
    txt(76, y, s, { size: 14, w: 500, fill: C.text });
  });

  // Адреса
  t.push(panel(rightX, sy, rightW, 132, 16));
  t.push(`<path d="M${rightX + 28},${sy + 30} C${rightX + 40},${sy + 30} ${rightX + 46},${sy + 40} ${rightX + 40},${sy + 52} L${rightX + 30},${sy + 66} L${rightX + 20},${sy + 52} C${rightX + 14},${sy + 40} ${rightX + 20},${sy + 30} ${rightX + 28},${sy + 30} Z" fill="${C.accent}"/>`);
  t.push(`<circle cx="${rightX + 30}" cy="${sy + 44}" r="5" fill="#fff"/>`);
  txt(rightX + 56, sy + 46, cfg.address, { size: 17, w: 700, fill: C.text });
  txt(rightX + 56, sy + 70, cfg.addressNote, { size: 12, w: 500, fill: C.muted });

  // Графік
  t.push(panel(rightX, sy + 144, rightW, 118, 16));
  t.push(`<circle cx="${rightX + 30}" cy="${sy + 176}" r="13" fill="none" stroke="${C.accent}" stroke-width="2.5"/>`);
  t.push(`<path d="M${rightX + 30},${sy + 168} L${rightX + 30},${sy + 176} L${rightX + 36},${sy + 180}" stroke="${C.accent}" stroke-width="2.5" fill="none" stroke-linecap="round"/>`);
  txt(rightX + 54, sy + 182, 'ПРАЦЮЄМО БЕЗ ВИХІДНИХ', { size: 13, w: 800, fill: C.text });
  txt(rightX + 30, sy + 216, cfg.hoursWeek, { size: 14, w: 600, fill: C.text });
  txt(rightX + 30, sy + 242, cfg.hoursWeekend, { size: 14, w: 600, fill: C.text });

  // ── Контакти ──────────────────────────────────────────────────────────────
  const cy2 = sy + svcH + 24;
  cfg.phones.forEach((p, i) => {
    const y = cy2 + 34 + i * 46;
    t.push(`<circle cx="52" cy="${y - 8}" r="17" fill="#1E9E4A"/>`);
    t.push(`<path d="M45,${y - 15} q3,-3 6,0 l2,4 q1,2 -1,3 l-2,1 q1,4 5,7 l1,-2 q1,-2 3,-1 l4,2 q3,3 0,6 -6,3 -14,-5 -8,-8 -4,-15 Z" fill="#fff"/>`);
    txt(80, y, p, { size: 26, w: 800, fill: C.accent });
  });
  t.push(`<circle cx="352" cy="${cy2 + 26}" r="15" fill="${C.accent}"/>`);
  txt(376, cy2 + 33, cfg.bot, { size: 17, w: 600, fill: C.text });
  t.push(`<circle cx="352" cy="${cy2 + 72}" r="15" fill="#29A9EB"/>`);
  t.push(`<path d="M345,${cy2 + 72} l14,-6 -5,13 -3,-5 z" fill="#fff"/>`);
  txt(376, cy2 + 79, cfg.channel, { size: 17, w: 600, fill: C.text });

  txt(W - 40, cy2 + 40, cfg.brand, { size: 30, w: 900, fill: C.brand, anchor: 'end', ls: 2 });
  txt(W - 40, cy2 + 66, cfg.brandSuffix, { size: 13, w: 600, fill: C.brand, anchor: 'end', ls: 6 });

  // ── Нижня плашка ──────────────────────────────────────────────────────────
  const by = H - 62;
  t.push(`<rect x="28" y="${by}" width="${W - 56}" height="46" rx="14" fill="${C.footerBg}"/>`);
  // Сердечка малюємо фігурами: emoji у шрифті немає, і текст рендериться «квадратиками».
  const heart = (hx: number, hy: number) =>
    `<path d="M${hx},${hy + 6} C${hx - 9},${hy - 3} ${hx - 3},${hy - 10} ${hx},${hy - 4} C${hx + 3},${hy - 10} ${hx + 9},${hy - 3} ${hx},${hy + 6} Z" fill="${C.footerText}" opacity="0.85"/>`;
  // Півширина тексту (19px bold Montserrat ≈ 11.2 px/символ) + відступ.
  const halfW = Math.min(cfg.footer.length * 5.6 + 24, (W - 120) / 2);
  t.push(heart(W / 2 - halfW, by + 22), heart(W / 2 + halfW, by + 22));
  txt(W / 2, by + 30, cfg.footer, { size: 19, w: 800, fill: C.footerText, anchor: 'middle' });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.bg}"/>
      <stop offset="1" stop-color="${C.bgGrad2}"/>
    </linearGradient>
  </defs>
  ${t.join('\n  ')}
</svg>`;
}

/** Шляхи до вбудованих шрифтів (Montserrat) — щоб рендер не залежав від системних. */
function fontFiles(): string[] {
  try {
    const base = path.dirname(require.resolve('@expo-google-fonts/montserrat/package.json'));
    const files = [
      '500Medium/Montserrat_500Medium.ttf',
      '600SemiBold/Montserrat_600SemiBold.ttf',
      '700Bold/Montserrat_700Bold.ttf',
      '800ExtraBold/Montserrat_800ExtraBold.ttf',
      '900Black/Montserrat_900Black.ttf',
    ].map((f) => path.join(base, f));
    return files.filter((f) => fs.existsSync(f));
  } catch {
    return [];
  }
}

/** Рендер картки у PNG. */
export function renderRateCardPng(data: RateCardData): Buffer {
  const svg = buildRateCardSvg(data);
  const resvg = new Resvg(svg, {
    font: { fontFiles: fontFiles(), loadSystemFonts: true, defaultFontFamily: 'Montserrat' },
    fitTo: { mode: 'width', value: 1000 },
  });
  return Buffer.from(resvg.render().asPng());
}
