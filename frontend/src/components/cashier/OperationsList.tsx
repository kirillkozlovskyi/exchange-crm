import { useEffect, useState, useRef } from 'react';
import api from '../../api/axios';
import { format } from 'date-fns';
import { useAuth } from '../../context/AuthContext';
import OperationEditModal from './OperationEditModal';
import Flag from '../Flag';

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

function OpRow({
  op, rates, onEdit, onStorno, isLast, canEdit, stornoWindowMin, now,
}: {
  op: Op; rates: Rate[]; onEdit: (op: Op) => void;
  onStorno: (op: Op) => void; isLast: boolean; canEdit: boolean;
  stornoWindowMin: number; now: number;
}) {
  // Крос = є payCurrency (foreign) І валюта операції теж іноземна (не класичний BUY/SELL)
  const isCross     = !!op.payCurrency && op.payCurrency !== 'UAH' && op.currency !== 'UAH';
  const isClientBuy = !isCross && op.type === 'SELL';

  const opRate     = Number(op.rate);
  const marketRate = getMarketRate(op, rates);
  const isCustom   = marketRate > 0 && Math.abs(opRate - marketRate) > 0.005;

  // Сторно дозволено тільки якщо операція в межах вікна часу
  const ageMin = (now - new Date(op.createdAt).getTime()) / 60_000;
  const withinWindow = ageMin <= stornoWindowMin;

  const rateStr = isCross
    ? `${opRate.toFixed(2)} ${op.payCurrency}/${op.currency}`
    : isClientBuy
      ? `${opRate.toFixed(2)} UAH/${op.currency}`
      : `${opRate.toFixed(2)} UAH/${op.payCurrency ?? op.currency}`;

  return (
    <div className={`flex items-center justify-between py-1.5 border-b border-gray-100 last:border-0 group ${op.cancelled ? 'opacity-50' : ''}`}>
      <div className="flex-1 min-w-0">
        {op.cancelled && (
          <div className="text-xs text-red-500 font-semibold mb-0.5">СТОРНО{op.cancelNote ? ` · ${op.cancelNote}` : ''}</div>
        )}
        {/* Рядок 1: суми операції */}
        <div className={`font-semibold text-sm ${op.cancelled ? 'line-through text-gray-400' : 'text-gray-800'}`}>
          {isCross ? (
            <>
              {Number(op.payAmount).toFixed(2)}
              <Flag currency={op.payCurrency!} className="mx-1" />
              <span className="text-gray-400 mx-1">→</span>
              {Number(op.amount).toFixed(2)}
              <Flag currency={op.currency} className="mx-1" />
            </>
          ) : isClientBuy ? (
            <>
              {Number(op.totalUah).toFixed(2)}
              <Flag currency="UAH" className="mx-1" />
              <span className="text-gray-400 mx-1">→</span>
              {Number(op.amount).toFixed(2)}
              <Flag currency={op.currency} className="mx-1" />
            </>
          ) : (
            <>
              {Number(op.payAmount ?? op.amount).toFixed(2)}
              <Flag currency={op.payCurrency ?? op.currency} className="mx-1" />
              <span className="text-gray-400 mx-1">→</span>
              {Number(op.totalUah).toFixed(2)}
              <Flag currency="UAH" className="mx-1" />
            </>
          )}
        </div>
        {/* Рядок 2: час + курс */}
        <div className="flex items-center gap-2 text-xs text-gray-400 mt-0.5">
          <span>{format(new Date(op.createdAt), 'HH:mm')}</span>
          <span className={`font-medium ${isCustom ? 'text-orange-500' : ''}`}>
            {isCustom && <span className="mr-0.5">✱</span>}{rateStr}
          </span>
          {(op._count?.edits ?? 0) > 0 && (
            <span className="text-[10px] bg-amber-100 text-amber-700 font-semibold px-1 py-0.5 rounded" title="Операцію відредаговано">
              ред.
            </span>
          )}
        </div>
      </div>

      {!op.cancelled && (
        <div className="flex flex-col gap-1 flex-shrink-0 ml-2">
          {canEdit && (
            <button
              onClick={() => onEdit(op)}
              className="p-2 rounded-lg text-gray-700 hover:text-blue-600 hover:bg-blue-50 transition text-xl leading-none font-bold"
              title="Редагувати операцію"
            >
              ✎
            </button>
          )}
          {isLast && withinWindow && (
            <button
              onClick={() => onStorno(op)}
              className="p-2 rounded-lg text-red-500 hover:text-red-700 hover:bg-red-50 transition text-xl leading-none font-black"
              title={`Сторно — дозволено ${stornoWindowMin} хв після операції`}
            >
              ✕
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function OpsBlock({
  title, ops, colorClass, fullHeight, hideTitle, rates, onEdit, onStorno, lastOpId, canEdit, stornoWindowMin, now,
}: {
  title: string; ops: Op[]; colorClass: string; fullHeight?: boolean; hideTitle?: boolean;
  rates: Rate[]; onEdit: (op: Op) => void; onStorno: (op: Op) => void;
  lastOpId: number | null; canEdit: boolean;
  stornoWindowMin: number; now: number;
}) {
  return (
    <div className={`flex flex-col ${fullHeight ? 'flex-1 min-h-0 overflow-hidden' : 'bg-white rounded-xl shadow p-4'}`}>
      {!hideTitle && (
        <div className={`flex items-center justify-between ${fullHeight ? 'px-3 pt-2 pb-1.5 border-b border-gray-100' : 'mb-3'}`}>
          <h3 className={`font-semibold text-sm ${colorClass}`}>{title}</h3>
        </div>
      )}
      <div className={`${fullHeight ? 'flex-1 overflow-y-auto px-3' : 'space-y-1.5 overflow-y-auto max-h-72 flex-1'}`}>
        {ops.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-6">Немає</p>
        ) : (
          ops.map((op) => (
            <OpRow
              key={op.id} op={op} rates={rates}
              onEdit={onEdit} onStorno={onStorno}
              isLast={op.id === lastOpId}
              canEdit={canEdit}
              stornoWindowMin={stornoWindowMin}
              now={now}
            />
          ))
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

        <div className="bg-gray-50 rounded-lg px-4 py-3 text-sm text-gray-700 text-center">
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
            className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
          />
        </div>

        <div className="flex gap-2">
          <button onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-gray-300 text-gray-700 font-medium text-sm hover:bg-gray-50 transition">
            Скасувати
          </button>
          <button onClick={handleConfirm} disabled={loading}
            className="flex-1 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold text-sm disabled:opacity-50 transition">
            {loading ? 'Обробка...' : 'Сторно'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function OperationsList({
  shiftId, refresh, fullHeight, rates = [], onRefresh,
}: {
  shiftId: number;
  refresh: number;
  fullHeight?: boolean;
  rates?: Rate[];
  onRefresh?: () => void;
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

  // Унікальні валюти з усіх операцій зміни (для кнопок фільтру)
  const usedCurrencies = Array.from(new Set(
    allOps.flatMap((o) => [o.currency, o.payCurrency].filter(Boolean) as string[])
  )).filter((c) => c !== 'UAH').sort();

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

  const blockProps = { rates, onEdit: setEditingOp, onStorno: setStornoOp, lastOpId, canEdit, stornoWindowMin, now };

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
            <div className="flex gap-1 mt-1.5 bg-gray-100 rounded-lg p-0.5">
              <button
                onClick={() => setOpTab('buy')}
                className={`flex-1 py-1.5 rounded-md text-sm font-semibold transition ${opTab === 'buy' ? 'bg-white shadow text-green-700' : 'text-gray-500'}`}>
                🟢 Купівля ({clientBuyOps.length})
              </button>
              <button
                onClick={() => setOpTab('sell')}
                className={`flex-1 py-1.5 rounded-md text-sm font-semibold transition ${opTab === 'sell' ? 'bg-white shadow text-red-600' : 'text-gray-500'}`}>
                🔴 Продаж ({clientSellOps.length})
              </button>
            </div>
            {/* Фільтри */}
            {usedCurrencies.length > 0 && (
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
                {usedCurrencies.map((c) => {
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
