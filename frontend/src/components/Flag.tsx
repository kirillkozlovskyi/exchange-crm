// SVG-прапор валюти (flag-icons) — на відміну від емодзі, коректно рендериться
// на Windows. Код валюти → ISO-код країни: перші дві літери майже завжди збігаються
// (USD→us, EUR→eu, UAH→ua, PLN→pl). Винятки — в OVERRIDES.
const OVERRIDES: Record<string, string> = {
  // приклад: XAU/XAG не мають країни — лишимо без прапора (повертаємо '')
};

// Криптовалюти та інші не-країнові коди — символ-бейдж замість прапора країни
// (інакше USDT → "us" дав би прапор США).
const CRYPTO: Record<string, string> = {
  USDT: '₮', USDC: '$', BTC: '₿', ETH: 'Ξ', TRX: '⨯', BNB: 'B', DAI: '◈',
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
  const cur = (currency || '').toUpperCase();
  if (cur in CRYPTO) {
    return (
      <span
        className={`inline-flex items-center justify-center rounded-sm bg-emerald-100 text-emerald-700 font-bold leading-none ${className}`}
        style={{ width: '1.33em', height: '1em', fontSize: '0.85em' }}
        title={cur}
      >
        {CRYPTO[cur]}
      </span>
    );
  }
  const cc = countryOf(cur);
  if (!cc) return <span className={className} title={cur}>💱</span>;
  // fi масштабується за font-size батьківського елемента (висота 1em)
  return <span className={`fi fi-${cc} rounded-sm ${className}`} title={cur} />;
}
