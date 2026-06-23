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

  return (
    <div ref={ref} className="relative">
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          onChange({ code: '', name: '' });
        }}
        onFocus={() => setOpen(true)}
        placeholder="Пошук: USD, Євро..."
        className="border rounded px-2 py-1.5 text-sm w-52 focus:outline-none focus:ring-2 focus:ring-blue-300"
      />
      {open && filtered.length > 0 && (
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
        </div>
      )}
    </div>
  );
}
