import { useEffect, useState, useRef } from 'react';
import api from '../../api/axios';
import { format } from 'date-fns';
import { useAuth } from '../../context/AuthContext';
import OperationEditModal from './OperationEditModal';
import Flag from '../Flag';
import { WORLD_CURRENCIES } from '../../data/currencyMeta';

// Дані для шапки/підвалу чека (з налаштувань точки та організації).
export type ReceiptInfo = { orgName?: string; address?: string; deskNo?: number | string };

type Op = {
  id: number;
  number: string;
  type: 'BUY' | 'SELL' | 'EXCHANGE';
  currency: string;
  amount: string | number;
  rate: string | number;
  totalUah: string | number;
  profit: string | number;
  createdAt: string;
  payCurrency?: string;
  payAmount?: string | number;
  cancelled?: boolean;
  cancelNote?: string;
  _count?: { edits: number };
};

type Rate = { currency: string; buy: string | number; sell: string | number };

function getMarketRate(op: Op, rates: Rate[]): number {
  const getR = (cur: string, side: 'buy' | 'sell') => {
    if (cur === 'UAH') return 1;
    const r = rates.find((x) => x.currency === cur);
    return r ? Number(r[side]) : 0;
  };
  const isCross = !!op.payCurrency && op.payCurrency !== 'UAH' && op.currency !== 'UAH';
  if (isCross) {
    const buyR  = getR(op.payCurrency!, 'buy');
    const sellR = getR(op.currency, 'sell');
    return buyR && sellR ? buyR / sellR : 0;
  }
  if (op.type === 'SELL') return getR(op.currency, 'sell');
  return getR(op.payCurrency ?? op.currency, 'buy');
}

// Потоки операції з погляду каси: що каса ВИДАЛА клієнту і що ПРИЙНЯЛА.
//  • Купівля: каса купує валюту → видала UAH, прийняла валюту.
//  • Продаж:  каса продає валюту → видала валюту, прийняла UAH.
//  • Крос:    видала op.currency, прийняла payCurrency.
function opFlows(op: Op) {
  const isCross = !!op.payCurrency && op.payCurrency !== 'UAH' && op.currency !== 'UAH';
  if (isCross) {
    return {
      gaveAmt: Number(op.amount), gaveCur: op.currency,
      gotAmt: Number(op.payAmount ?? 0), gotCur: op.payCurrency!,
    };
  }
  if (op.type === 'SELL') {
    return {
      gaveAmt: Number(op.amount), gaveCur: op.currency,
      gotAmt: Number(op.totalUah), gotCur: 'UAH',
    };
  }
  return {
    gaveAmt: Number(op.totalUah), gaveCur: 'UAH',
    gotAmt: Number(op.amount), gotCur: op.currency,
  };
}

function CurCell({ cur }: { cur: string }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <Flag currency={cur} /><span className="text-xs text-gray-500 font-medium">{cur}</span>
    </span>
  );
}

// Довідники для чека: назва, ISO-номер та відображуваний код валюти.
const CUR_NAME_UK: Record<string, string> = {
  UAH: 'Гривня',
  ...Object.fromEntries(WORLD_CURRENCIES.map((c) => [c.code, c.name])),
};
const CUR_ISO_NUM: Record<string, string> = {
  UAH: '980', USD: '840', EUR: '978', GBP: '826', PLN: '985', CHF: '756',
  CZK: '203', CAD: '124', HUF: '348', SEK: '752', NOK: '578', DKK: '208',
  JPY: '392', CNY: '156', AUD: '036', NZD: '554', TRY: '949', RON: '946',
  BGN: '975', AED: '784', SAR: '682', ILS: '376', KZT: '398', GEL: '981',
  MDL: '498', BYN: '933', AMD: '051', AZN: '944', ISK: '352', MXN: '484',
  BRL: '986', ZAR: '710', INR: '356', KRW: '410', THB: '764', IDR: '360',
  MYR: '458', SGD: '702', HKD: '344',
};
const CUR_DISPLAY: Record<string, string> = { UAH: 'ГРН' };

const escHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Рядок валюти у форматі чека: "978,EUR,Євро" (ISO-номер, код, назва).
function curLine(cur: string) {
  const iso = CUR_ISO_NUM[cur] ?? '';
  const disp = CUR_DISPLAY[cur] ?? cur;
  const name = CUR_NAME_UK[cur] ?? cur;
  return `${iso ? iso + ',' : ''}${disp},${name}`;
}
const dispCode = (cur: string) => CUR_DISPLAY[cur] ?? cur;

// Друк чека операції через прихований iframe (без спливних вікон).
export function printReceipt(op: Op, info: ReceiptInfo = {}) {
  const isCross = !!op.payCurrency && op.payCurrency !== 'UAH' && op.currency !== 'UAH';
  const typeLabel = isCross
    ? 'ОБМІН ІНОЗЕМНОЇ ВАЛЮТИ'
    : op.type === 'SELL' ? 'ПРОДАЖ ІНОЗЕМНОЇ ВАЛЮТИ' : 'КУПІВЛЯ ІНОЗЕМНОЇ ВАЛЮТИ';
  const f = opFlows(op); // got = прийнято касою, gave = видано касою
  const money = (n: number) => n.toFixed(2).replace('.', ',');
  const rate = Number(op.rate).toFixed(6).replace('.', ',');
  const uahAmount = f.gaveCur === 'UAH' ? f.gaveAmt : f.gotCur === 'UAH' ? f.gotAmt : Number(op.totalUah);
  const fiscal = String(Math.floor(1000000000 + Math.random() * 9000000000)); // рандомні 10 цифр
  const dt = format(new Date(op.createdAt), 'dd.MM.yyyy HH:mm:ss');

  const org = (info.orgName ?? '').trim();
  const addr = (info.address ?? '').trim();
  const deskNo = info.deskNo;

  const row = (label: string, value: string) =>
    `<div class="row"><span>${escHtml(label)}</span><span class="v">${escHtml(value)}</span></div>`;

  const html = `<!doctype html><html lang="uk"><head><meta charset="utf-8"><title>Чек ${escHtml(op.number)}</title>
  <style>
    @page { size: 80mm auto; margin: 3mm; }
    * { font-family: 'Courier New', monospace; box-sizing: border-box; }
    body { width: 74mm; margin: 0 auto; color: #000; font-size: 12px; line-height: 1.35; }
    .center { text-align: center; }
    .right { text-align: right; }
    .b { font-weight: bold; }
    .row { display: flex; justify-content: space-between; gap: 10px; }
    .row .v { font-weight: bold; text-align: right; white-space: nowrap; }
    hr { border: none; border-top: 1px solid #000; margin: 5px 0; }
    .small { font-size: 11px; }
  </style></head><body>
    ${org ? `<div class="center b">${escHtml(org)}</div>` : ''}
    ${deskNo != null ? `<div class="center b">Операційна каса № ${escHtml(String(deskNo))}</div>` : ''}
    ${addr ? `<div class="center">${escHtml(addr)}</div>` : ''}
    <div class="center">ІД ${escHtml(op.number)}</div>
    <div class="center b">ОПЕРАЦІЯ</div>
    <div class="center b">${typeLabel}</div>
    <hr>
    ${row('Прийнято:', curLine(f.gotCur))}
    ${row('Сума:', `${money(f.gotAmt)} ${dispCode(f.gotCur)}`)}
    ${row('Курс операції:', rate)}
    ${row('Видано:', curLine(f.gaveCur))}
    ${row('Сума:', `${money(f.gaveAmt)} ${dispCode(f.gaveCur)}`)}
    ${row('Комісія:', '0,00 ГРН')}
    <div class="row"><span>Дані про клієнта *:</span><span class="v">______________</span></div>
    <div class="center small">* проставляються згідно<br>законодавства або вимоги клієнта</div>
    ${row('Сума заокруглення:', '0,00 ГРН')}
    ${row('Сума після заокруглення:', `${money(uahAmount)} ГРН`)}
    <div class="center b">Фіскальний номер чека ${fiscal}</div>
    <div class="center">ДЧ ${dt} Он-лайн</div>
    <hr>
    <div class="center b">ЧЕК З ТОРГІВЛІ<br>ВАЛЮТНИМИ ЦІННОСТЯМИ</div>
  </body></html>`;

  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (!doc) { document.body.removeChild(iframe); return; }
  doc.open();
  doc.write(html);
  doc.close();
  const win = iframe.contentWindow!;
  win.focus();
  win.onafterprint = () => { try { document.body.removeChild(iframe); } catch { /* already removed */ } };
  setTimeout(() => {
    win.print();
    setTimeout(() => { try { document.body.removeChild(iframe); } catch { /* noop */ } }, 60_000);
  }, 150);
}

function OpRow({
  op, seq, rates, onEdit, onStorno, onPrint, isLast, canEdit, stornoWindowMin, now,
}: {
  op: Op; seq: number; rates: Rate[]; onEdit: (op: Op) => void;
  onStorno: (op: Op) => void; onPrint: (op: Op) => void; isLast: boolean; canEdit: boolean;
  stornoWindowMin: number; now: number;
}) {
  const isCross  = !!op.payCurrency && op.payCurrency !== 'UAH' && op.currency !== 'UAH';
  const opRate   = Number(op.rate);
  const marketRate = getMarketRate(op, rates);
  const isCustom = marketRate > 0 && Math.abs(opRate - marketRate) > 0.005;

  const ageMin = (now - new Date(op.createdAt).getTime()) / 60_000;
  const withinWindow = ageMin <= stornoWindowMin;

  const f = opFlows(op);
  const ratePair = isCross
    ? `${op.payCurrency}/${op.currency}`
    : `UAH/${op.type === 'SELL' ? op.currency : (op.payCurrency ?? op.currency)}`;
  const numStr = op.cancelled ? 'line-through text-gray-400' : 'text-gray-800';

  return (
    <tr className={`border-b border-gray-100 last:border-0 group ${op.cancelled ? 'opacity-50' : ''}`}>
      <td className={`w-10 py-1.5 px-0.5 text-center whitespace-nowrap tabular-nums text-xs font-semibold ${numStr}`} title={`№ транзакції: ${op.number}`}>
        {op.cancelled ? (
          <span className="text-red-500 text-[10px] font-semibold" title={op.cancelNote || 'Сторно'}>СТОРНО</span>
        ) : seq}
      </td>
      <td className={`py-1.5 px-1 text-right font-semibold tabular-nums ${numStr}`}>{f.gaveAmt.toFixed(0)}</td>
      <td className="py-1.5 px-1"><CurCell cur={f.gaveCur} /></td>
      <td className={`py-1.5 px-1 text-right font-semibold tabular-nums ${numStr}`}>{f.gotAmt.toFixed(0)}</td>
      <td className="py-1.5 px-1"><CurCell cur={f.gotCur} /></td>
      <td className={`py-1.5 px-1 text-right text-xs whitespace-nowrap font-medium ${isCustom ? 'text-orange-500' : 'text-gray-500'}`} title={ratePair}>
        {isCustom && '✱'}{opRate.toFixed(2)}
        {(op._count?.edits ?? 0) > 0 && (
          <span className="ml-1 text-[10px] bg-amber-100 text-amber-700 font-semibold px-1 py-0.5 rounded" title="Відредаговано">ред.</span>
        )}
      </td>
      <td className="py-1.5 px-1 text-right text-xs text-gray-400 whitespace-nowrap">{format(new Date(op.createdAt), 'HH:mm')}</td>
      <td className="w-16 py-1.5 px-0.5 text-center whitespace-nowrap">
        <span className="inline-flex gap-0.5 items-center">
          {!op.cancelled && (
            <button
              onClick={() => onPrint(op)}
              title={`Друк чека № ${op.number}`}
              className="p-1 rounded text-gray-500 hover:text-blue-600 hover:bg-blue-50 transition inline-flex"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 6 2 18 2 18 9" />
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                <rect x="6" y="14" width="12" height="8" />
              </svg>
            </button>
          )}
          {!op.cancelled && canEdit && (
            <button onClick={() => onEdit(op)}
              className="p-1 rounded text-gray-600 hover:text-blue-600 hover:bg-blue-50 transition text-sm leading-none font-bold"
              title="Редагувати операцію">✎</button>
          )}
          {!op.cancelled && isLast && withinWindow && (
            <button onClick={() => onStorno(op)}
              className="p-1 rounded text-red-500 hover:text-red-700 hover:bg-red-50 transition text-sm leading-none font-black"
              title={`Сторно — дозволено ${stornoWindowMin} хв після операції`}>✕</button>
          )}
        </span>
      </td>
    </tr>
  );
}

function OpsBlock({
  title, ops, colorClass, fullHeight, hideTitle, seqMap, rates, onEdit, onStorno, onPrint, lastOpId, canEdit, stornoWindowMin, now,
}: {
  title: string; ops: Op[]; colorClass: string; fullHeight?: boolean; hideTitle?: boolean;
  seqMap: Map<number, number>;
  rates: Rate[]; onEdit: (op: Op) => void; onStorno: (op: Op) => void; onPrint: (op: Op) => void;
  lastOpId: number | null; canEdit: boolean;
  stornoWindowMin: number; now: number;
}) {
  const head = (
    <thead className="sticky top-0 bg-white z-10">
      <tr className="text-[11px] text-gray-900 uppercase tracking-wide border-b">
        <th className="w-10 py-1.5 px-1 text-center font-medium text-[10px]">№</th>
        <th className="py-1.5 px-1 text-right font-medium">Видав</th>
        <th className="py-1.5 px-1 text-left font-medium">Валюта</th>
        <th className="py-1.5 px-1 text-right font-medium">Прийняв</th>
        <th className="py-1.5 px-1 text-left font-medium">Валюта</th>
        <th className="py-1.5 px-1 text-right font-medium">Курс</th>
        <th className="py-1.5 px-1 text-right font-medium">Час</th>
        <th className="w-16 py-1.5 px-0.5 text-center font-medium text-[10px]">Чек / Дії</th>
      </tr>
    </thead>
  );

  return (
    <div className={`flex flex-col ${fullHeight ? 'flex-1 min-h-0 overflow-hidden' : 'bg-white rounded-xl shadow p-4'}`}>
      {!hideTitle && (
        <div className={`flex items-center justify-between ${fullHeight ? 'px-3 pt-2 pb-1.5 border-b border-gray-100' : 'mb-3'}`}>
          <h3 className={`font-semibold text-sm ${colorClass}`}>{title}</h3>
        </div>
      )}
      <div className={`${fullHeight ? 'flex-1 overflow-auto px-3' : 'overflow-auto max-h-72 flex-1'}`}>
        {ops.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-6">Немає</p>
        ) : (
          <table className="w-full text-sm border-collapse border border-gray-200 [&_th]:border [&_th]:border-gray-200 [&_td]:border [&_td]:border-gray-200">
            {head}
            <tbody>
              {ops.map((op) => (
                <OpRow
                  key={op.id} op={op} seq={seqMap.get(op.id) ?? 0} rates={rates}
                  onEdit={onEdit} onStorno={onStorno} onPrint={onPrint}
                  isLast={op.id === lastOpId}
                  canEdit={canEdit}
                  stornoWindowMin={stornoWindowMin}
                  now={now}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className={`${fullHeight ? 'px-3 py-1.5 border-t' : 'mt-2 pt-2 border-t'} text-xs text-gray-400 text-right`}>
        {ops.length} операц{ops.length === 1 ? 'ія' : ops.length < 5 ? 'ії' : 'ій'}
      </div>
    </div>
  );
}

// Модальне вікно підтвердження сторно
function StornoModal({ op, onConfirm, onClose }: {
  op: Op; onConfirm: (note: string) => void; onClose: () => void;
}) {
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);

  const isCross     = !!op.payCurrency && op.payCurrency !== 'UAH' && op.currency !== 'UAH';
  const isClientBuy = !isCross && op.type === 'SELL';

  const handleConfirm = async () => {
    setLoading(true);
    await onConfirm(note);
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="text-center">
          <div className="text-3xl mb-2">⚠️</div>
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Підтвердження сторно</div>
          <div className="font-bold text-red-600 text-lg">Скасувати операцію #{op.number}?</div>
        </div>

        <div className="bg-gray-50 rounded px-4 py-3 text-sm text-gray-700 text-center">
          {isCross ? (
            <>{Number(op.payAmount).toFixed(2)} <Flag currency={op.payCurrency!} /> → {Number(op.amount).toFixed(2)} <Flag currency={op.currency} /></>
          ) : isClientBuy ? (
            <>{Number(op.totalUah).toFixed(2)} <Flag currency="UAH" /> → {Number(op.amount).toFixed(2)} <Flag currency={op.currency} /></>
          ) : (
            <>{Number(op.payAmount ?? op.amount).toFixed(2)} <Flag currency={op.payCurrency ?? op.currency} /> → {Number(op.totalUah).toFixed(2)} <Flag currency="UAH" /></>
          )}
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Причина (необов'язково)</label>
          <input
            type="text" value={note} onChange={e => setNote(e.target.value)}
            placeholder="Помилка касира, клієнт відмовився..."
            className="mt-1 w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
          />
        </div>

        <div className="flex gap-2">
          <button onClick={onClose}
            className="flex-1 py-2 rounded border border-gray-300 text-gray-700 font-medium text-sm hover:bg-gray-50 transition">
            Скасувати
          </button>
          <button onClick={handleConfirm} disabled={loading}
            className="flex-1 py-2 rounded bg-red-600 hover:bg-red-700 text-white font-semibold text-sm disabled:opacity-50 transition">
            {loading ? 'Обробка...' : 'Сторно'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function OperationsList({
  shiftId, refresh, fullHeight, rates = [], onRefresh, receipt = {},
}: {
  shiftId: number;
  refresh: number;
  fullHeight?: boolean;
  rates?: Rate[];
  onRefresh?: () => void;
  receipt?: ReceiptInfo;
}) {
  const { user } = useAuth();
  const [ops, setOps] = useState<Op[]>([]);
  const [editingOp, setEditingOp] = useState<Op | null>(null);
  const [stornoOp, setStornoOp] = useState<Op | null>(null);
  const [filterCurs, setFilterCurs] = useState<string[]>([]);
  const [stornoWindowMin, setStornoWindowMin] = useState<number>(5);
  const [now, setNow] = useState<number>(Date.now());
  const [opTab, setOpTab] = useState<'buy' | 'sell'>('buy');

  const canEdit = user?.role === 'ADMIN';

  const load = () => {
    api.get(`/operations/shift/${shiftId}`).then(({ data }) => setOps(data));
  };

  useEffect(() => { load(); }, [shiftId, refresh]);

  // Завантажуємо вікно сторно один раз
  useEffect(() => {
    api.get('/settings/storno-window').then(({ data }) => setStornoWindowMin(data.minutes));
  }, []);

  // Оновлюємо `now` кожну хвилину щоб кнопка сторно зникала автоматично
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const handleSaved = () => {
    load();
    onRefresh?.();
  };

  const handleStorno = async (note: string) => {
    if (!stornoOp) return;
    try {
      await api.post(`/operations/${stornoOp.id}/storno`, { note });
      setStornoOp(null);
      load();
      onRefresh?.();
    } catch (e: any) {
      alert(e.response?.data?.message || 'Помилка сторно');
      setStornoOp(null);
    }
  };

  const allOps = ops;

  // Нумерація операцій зміни в хронологічному порядку (перша операція = №1)
  const seqMap = new Map<number, number>();
  [...allOps]
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .forEach((o, i) => seqMap.set(o.id, i + 1));

  // Валюти для фільтру: усі валюти точки (з курсів) + будь-які, що трапились в операціях
  const allCurrencies = Array.from(new Set([
    ...rates.map((r) => r.currency),
    ...allOps.flatMap((o) => [o.currency, o.payCurrency].filter(Boolean) as string[]),
  ])).filter((c) => c !== 'UAH').sort();

  // Остання НЕ скасована операція зміни (ops відсортовані desc)
  const lastActiveOp = allOps.find(o => !o.cancelled);
  // Сторно тільки якщо lastActiveOp є також НАЙНОВІШОЮ операцією взагалі
  const stornoAllowed = lastActiveOp != null && allOps[0]?.id === lastActiveOp.id;
  const lastOpId = stornoAllowed ? lastActiveOp.id : null;

  // Мультіселект фільтр: показуємо якщо currency або payCurrency входить у вибрані
  const filteredOps = filterCurs.length === 0
    ? allOps
    : allOps.filter((o) => filterCurs.includes(o.currency) || filterCurs.includes(o.payCurrency ?? ''));

  const clientBuyOps  = filteredOps.filter((o) => o.type === 'BUY');
  const clientSellOps = filteredOps.filter((o) => o.type === 'SELL' || o.type === 'EXCHANGE');

  const handlePrint = (op: Op) => printReceipt(op, receipt);

  const blockProps = { seqMap, rates, onEdit: setEditingOp, onStorno: setStornoOp, onPrint: handlePrint, lastOpId, canEdit, stornoWindowMin, now };

  return (
    <>
      {editingOp && (
        <OperationEditModal
          op={editingOp}
          onClose={() => setEditingOp(null)}
          onSaved={handleSaved}
        />
      )}
      {stornoOp && (
        <StornoModal
          op={stornoOp}
          onConfirm={handleStorno}
          onClose={() => setStornoOp(null)}
        />
      )}

      {fullHeight ? (
        <div className="flex flex-col h-full overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-100 flex-shrink-0">
            <div className="flex items-baseline gap-2">
              <h2 className="font-bold text-sm text-gray-800">Операції зміни</h2>
              <span className="text-xs text-gray-400">Всього: {ops.length}</span>
            </div>
            {/* Таби Купівля / Продаж */}
            <div className="flex gap-1 mt-1.5 bg-gray-100 rounded p-0.5">
              <button
                onClick={() => setOpTab('buy')}
                className={`flex-1 py-1 rounded text-sm font-semibold transition ${opTab === 'buy' ? 'bg-white shadow text-green-700' : 'text-gray-500'}`}>
                🟢 Купівля ({clientBuyOps.length})
              </button>
              <button
                onClick={() => setOpTab('sell')}
                className={`flex-1 py-1 rounded text-sm font-semibold transition ${opTab === 'sell' ? 'bg-white shadow text-red-600' : 'text-gray-500'}`}>
                🔴 Продаж ({clientSellOps.length})
              </button>
            </div>
            {/* Фільтри */}
            {allCurrencies.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                <button
                  onClick={() => setFilterCurs([])}
                  className={`px-2.5 py-1 text-xs font-bold rounded border transition ${
                    filterCurs.length === 0
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                  }`}>
                  Всі
                </button>
                {allCurrencies.map((c) => {
                  const active = filterCurs.includes(c);
                  return (
                    <button key={c}
                      onClick={() => setFilterCurs((prev) =>
                        active ? prev.filter((x) => x !== c) : [...prev, c]
                      )}
                      className={`px-2.5 py-1 text-xs font-bold rounded border transition ${
                        active
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                      }`}>
                      {c}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="flex flex-1 min-h-0">
            <OpsBlock
              title=""
              ops={opTab === 'buy' ? clientBuyOps : clientSellOps}
              colorClass=""
              fullHeight
              hideTitle
              {...blockProps}
            />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <OpsBlock title="🟢 Купівля" ops={clientBuyOps} colorClass="text-green-700" {...blockProps} />
          <OpsBlock title="🔴 Продаж"  ops={clientSellOps} colorClass="text-red-600"  {...blockProps} />
        </div>
      )}
    </>
  );
}
