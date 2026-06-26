// SVG-прапор валюти (flag-icons) — на відміну від емодзі, коректно рендериться
// на Windows. Код валюти → ISO-код країни: перші дві літери майже завжди збігаються
// (USD→us, EUR→eu, UAH→ua, PLN→pl). Винятки — в OVERRIDES.
const OVERRIDES: Record<string, string> = {
  // приклад: XAU/XAG не мають країни — лишимо без прапора (повертаємо '')
};

function countryOf(currency: string): string | null {
  if (currency in OVERRIDES) return OVERRIDES[currency] || null;
  const cc = currency.slice(0, 2).toLowerCase();
  return /^[a-z]{2}$/.test(cc) ? cc : null;
}

export default function Flag({
  currency,
  className = '',
}: {
  currency: string;
  className?: string;
}) {
  const cc = countryOf(currency);
  if (!cc) return <span className={className}>💱</span>;
  // fi масштабується за font-size батьківського елемента (висота 1em)
  return <span className={`fi fi-${cc} rounded-sm ${className}`} title={currency} />;
}
