export const WORLD_CURRENCIES = [
  { code: 'USD', name: 'Долар США',                flag: '🇺🇸' },
  { code: 'USDT', name: 'Tether (USDT)',           flag: '🪙' },
  { code: 'EUR', name: 'Євро',                      flag: '🇪🇺' },
  { code: 'PLN', name: 'Польський злотий',          flag: '🇵🇱' },
  { code: 'GBP', name: 'Британський фунт',          flag: '🇬🇧' },
  { code: 'CHF', name: 'Швейцарський франк',        flag: '🇨🇭' },
  { code: 'CAD', name: 'Канадський долар',          flag: '🇨🇦' },
  { code: 'CZK', name: 'Чеська крона',              flag: '🇨🇿' },
  { code: 'HUF', name: 'Угорський форинт',          flag: '🇭🇺' },
  { code: 'SEK', name: 'Шведська крона',            flag: '🇸🇪' },
  { code: 'NOK', name: 'Норвезька крона',           flag: '🇳🇴' },
  { code: 'DKK', name: 'Данська крона',             flag: '🇩🇰' },
  { code: 'JPY', name: 'Японська єна',              flag: '🇯🇵' },
  { code: 'CNY', name: 'Китайський юань',           flag: '🇨🇳' },
  { code: 'AUD', name: 'Австралійський долар',      flag: '🇦🇺' },
  { code: 'NZD', name: 'Новозеландський долар',     flag: '🇳🇿' },
  { code: 'SGD', name: 'Сінгапурський долар',       flag: '🇸🇬' },
  { code: 'HKD', name: 'Гонконгський долар',        flag: '🇭🇰' },
  { code: 'TRY', name: 'Турецька ліра',             flag: '🇹🇷' },
  { code: 'RON', name: 'Румунський лей',            flag: '🇷🇴' },
  { code: 'BGN', name: 'Болгарський лев',           flag: '🇧🇬' },
  { code: 'AED', name: 'Дирхам ОАЕ',               flag: '🇦🇪' },
  { code: 'SAR', name: 'Саудівський ріял',          flag: '🇸🇦' },
  { code: 'ILS', name: 'Ізраїльський шекель',       flag: '🇮🇱' },
  { code: 'KZT', name: 'Казахстанський тенге',      flag: '🇰🇿' },
  { code: 'GEL', name: 'Грузинський ларі',          flag: '🇬🇪' },
  { code: 'MDL', name: 'Молдавський лей',           flag: '🇲🇩' },
  { code: 'BYN', name: 'Білоруський рубль',         flag: '🇧🇾' },
  { code: 'AMD', name: 'Вірменський драм',          flag: '🇦🇲' },
  { code: 'AZN', name: 'Азербайджанський манат',    flag: '🇦🇿' },
  { code: 'ISK', name: 'Ісландська крона',          flag: '🇮🇸' },
  { code: 'MXN', name: 'Мексиканський песо',        flag: '🇲🇽' },
  { code: 'BRL', name: 'Бразильський реал',         flag: '🇧🇷' },
  { code: 'ZAR', name: 'Південноафриканський ренд', flag: '🇿🇦' },
  { code: 'INR', name: 'Індійська рупія',           flag: '🇮🇳' },
  { code: 'KRW', name: 'Південнокорейська вона',    flag: '🇰🇷' },
  { code: 'THB', name: 'Тайський бат',              flag: '🇹🇭' },
  { code: 'IDR', name: 'Індонезійська рупія',       flag: '🇮🇩' },
  { code: 'MYR', name: 'Малайзійський рингіт',      flag: '🇲🇾' },
];

const FLAG_BY_CODE: Record<string, string> = Object.fromEntries(
  WORLD_CURRENCIES.map((c) => [c.code, c.flag]),
);
FLAG_BY_CODE.UAH ??= '🇺🇦';

/** Емодзі-прапор для коду валюти ('💱' як фолбек). */
export function flagOf(code: string): string {
  return FLAG_BY_CODE[code] ?? '💱';
}
