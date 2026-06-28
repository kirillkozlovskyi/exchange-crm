import { useState, useEffect, useRef } from 'react';
import { WORLD_CURRENCIES } from '../../data/currencyMeta';

export default function CurrencyAutocomplete({
  value,
  onChange,
  excludeCodes,
}: {
  value: { code: string; name: string };
  onChange: (v: { code: string; name: string }) => void;
  excludeCodes: Set<string>;
}) {
  const [query, setQuery] = useState(value.code || '');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const available = WORLD_CURRENCIES.filter((c) => !excludeCodes.has(c.code));

  const filtered = query.trim()
    ? available.filter(
        (c) =>
          c.code.toLowerCase().includes(query.toLowerCase()) ||
          c.name.toLowerCase().includes(query.toLowerCase())
      )
    : available;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const select = (c: (typeof WORLD_CURRENCIES)[0]) => {
    onChange({ code: c.code, name: c.name });
    setQuery(c.code);
    setOpen(false);
  };

  // Кастомна валюта (USDT, образці тощо): код, якого немає у світовому списку
  const customCode = query.trim().toUpperCase();
  const isValidCustom = /^[A-Z0-9]{2,10}$/.test(customCode);
  const exactMatch = WORLD_CURRENCIES.some((c) => c.code === customCode);
  const showCustom = isValidCustom && !exactMatch;

  const selectCustom = () => {
    onChange({ code: customCode, name: value.name }); // назву вводять окремо
    setQuery(customCode);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          onChange({ code: '', name: value.name }); // код скидаємо, назву лишаємо
        }}
        onFocus={() => setOpen(true)}
        placeholder="Пошук або власний код: USDT..."
        className="border rounded px-2 py-1.5 text-sm w-52 focus:outline-none focus:ring-2 focus:ring-blue-300"
      />
      {open && (filtered.length > 0 || showCustom) && (
        <div className="absolute z-50 top-full left-0 mt-1 bg-white border rounded-lg shadow-lg max-h-60 overflow-y-auto w-72">
          {filtered.map((c) => (
            <button
              key={c.code}
              type="button"
              onMouseDown={() => select(c)}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-blue-50 text-left text-sm"
            >
              <span className="text-lg leading-none">{c.flag}</span>
              <span className="font-mono font-bold text-gray-800 w-10">{c.code}</span>
              <span className="text-gray-500 truncate">{c.name}</span>
            </button>
          ))}
          {showCustom && (
            <button
              type="button"
              onMouseDown={selectCustom}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-green-50 text-left text-sm border-t"
            >
              <span className="text-lg leading-none">➕</span>
              <span className="font-mono font-bold text-green-700 w-10">{customCode}</span>
              <span className="text-gray-500 truncate">Інша валюта (вкажіть назву)</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
