// Вбудовані призначення руху готівки — спільні для форми касира
// (CashierPage) і адмінського блоку «Призначення інкасації» (SettingsAdmin),
// щоб адмін бачив УСІ опції в одному місці й не плодив дублікати серед
// кастомних (напр. свій «Кешбек» поверх уже вбудованого).
export const CARD_SOURCE = 'Карта';
export const OTHER_SOURCE = 'Інше';
export const CASHBACK_SOURCE = 'Кешбек';
export const EXPENSE_SOURCE = 'Витрата';
export const ADJUST_SOURCE = 'Коригування';

// Показуються в підкріпленні й інкасації (Карта вимикається окремим налаштуванням).
export const SOURCE_CATEGORIES = [CARD_SOURCE, OTHER_SOURCE];

// Лише для інкасації (OUT): Кешбек/Витрата — з автостворенням Expense;
// Коригування — доступне лише якщо адмін дозволив редагування залишків.
export const OUT_ONLY_BUILTIN = [CASHBACK_SOURCE, EXPENSE_SOURCE];

// Повний список вбудованих — для показу в адмінці (щоб не дублювали кастомними).
export const ALL_BUILTIN_SOURCES = [CARD_SOURCE, OTHER_SOURCE, CASHBACK_SOURCE, EXPENSE_SOURCE, ADJUST_SOURCE];

export const isBuiltinSource = (s: string) =>
  ALL_BUILTIN_SOURCES.some((b) => b.toLowerCase() === s.trim().toLowerCase());
