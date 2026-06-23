import { useEffect, useState } from 'react';
import api from '../../api/axios';
import { WORLD_CURRENCIES } from '../../data/currencyMeta';

type NbuRate = { cc: string; rate: number; exchangedate: string };

export default function NbuWidget() {
  const [rates, setRates] = useState<NbuRate[]>([]);
  const [activeCodes, setActiveCodes] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(true);
  const [date, setDate] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [cRes, nbuRes] = await Promise.all([
        api.get('/currencies'),
        fetch('https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json').then((r) => r.json()),
      ]);
      const codes = new Set<string>(
        (cRes.data as { code: string; active: boolean }[])
          .filter((c) => c.active)
          .map((c) => c.code)
      );
      setActiveCodes(codes);
      const nbu: NbuRate[] = nbuRes;
      setRates(nbu.filter((r) => codes.has(r.cc)));
      if (nbu.length) setDate(nbu[0].exchangedate);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="fixed bottom-4 right-4 z-50 shadow-2xl rounded-xl overflow-hidden w-44 border border-gray-200">
      {/* header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 bg-blue-800 hover:bg-blue-900 text-white text-xs font-semibold transition"
      >
        <span className="flex items-center gap-1">
          🏦 <span>НБУ</span>
          {date && <span className="opacity-60 font-normal">{date}</span>}
        </span>
        <span className="opacity-70 text-[10px]">{open ? '▼' : '▲'}</span>
      </button>

      {/* body */}
      {open && (
        <div className="bg-white">
          {loading ? (
            <div className="py-3 text-center text-xs text-gray-400">Завантаження...</div>
          ) : rates.length === 0 ? (
            <div className="py-3 text-center text-xs text-gray-400">Немає валют</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {rates.map((r) => {
                const meta = WORLD_CURRENCIES.find((w) => w.code === r.cc);
                return (
                  <div key={r.cc} className="flex items-center justify-between px-3 py-1 text-xs">
                    <span className="flex items-center gap-1">
                      {meta?.flag && <span className="text-sm leading-none">{meta.flag}</span>}
                      <span className="font-bold text-gray-700">{r.cc}</span>
                    </span>
                    <span className="font-mono text-gray-600">{r.rate.toFixed(2)}</span>
                  </div>
                );
              })}
            </div>
          )}
          <button
            onClick={load}
            disabled={loading}
            className="w-full text-center text-[11px] text-blue-500 hover:underline disabled:opacity-40 py-1 border-t border-gray-100"
          >
            ↻ оновити
          </button>
        </div>
      )}
    </div>
  );
}
