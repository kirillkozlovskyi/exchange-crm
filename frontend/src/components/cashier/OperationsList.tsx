import { useEffect, useState } from 'react';
import api from '../../api/axios';
import { format } from 'date-fns';
import OperationEditModal from './OperationEditModal';

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
  _count?: { edits: number };
};

type Rate = { currency: string; buy: string | number; sell: string | number };

function getMarketRate(op: Op, rates: Rate[]): number {
  const getR = (cur: string, side: 'buy' | 'sell') => {
    if (cur === 'UAH') return 1;
    const r = rates.find((x) => x.currency === cur);
    return r ? Number(r[side]) : 0;
  };
  const isCross = op.type === 'EXCHANGE' && op.payCurrency;
  if (isCross) {
    const buyR  = getR(op.payCurrency!, 'buy');
    const sellR = getR(op.currency, 'sell');
    return buyR && sellR ? sellR / buyR : 0;
  }
  if (op.type === 'SELL') return getR(op.currency, 'sell');
  return getR(op.payCurrency ?? op.currency, 'buy');
}

function OpRow({
  op, rates, onEdit,
}: {
  op: Op; rates: Rate[]; onEdit: (op: Op) => void;
}) {
  const isCross     = op.type === 'EXCHANGE' && op.payCurrency;
  const isClientBuy = op.type === 'SELL';

  const opRate     = Number(op.rate);
  const marketRate = getMarketRate(op, rates);
  const isCustom   = marketRate > 0 && Math.abs(opRate - marketRate) > 0.005;

  const rateStr = isCross
    ? `${opRate.toFixed(2)} ${op.payCurrency}/${op.currency}`
    : isClientBuy
      ? `${opRate.toFixed(2)} UAH/${op.currency}`
      : `${opRate.toFixed(2)} UAH/${op.payCurrency ?? op.currency}`;

  return (
    <div className="flex items-center justify-between py-2.5 border-b border-gray-100 last:border-0 group">
      <div className="flex-1 min-w-0">
        {isCross ? (
          <span className="font-bold text-base text-gray-800">
            {Number(op.payAmount).toFixed(2)}
            <span className="text-gray-400 font-normal text-sm ml-1">{op.payCurrency}</span>
            <span className="text-gray-400 mx-1">→</span>
            {Number(op.amount).toFixed(2)}
            <span className="text-gray-400 font-normal text-sm ml-1">{op.currency}</span>
          </span>
        ) : isClientBuy ? (
          <span className="font-bold text-base text-gray-800">
            {Number(op.totalUah).toFixed(2)} ₴
            <span className="text-gray-400 mx-1">→</span>
            {Number(op.amount).toFixed(2)}
            <span className="text-gray-400 font-normal text-sm ml-1">{op.currency}</span>
          </span>
        ) : (
          <span className="font-bold text-base text-gray-800">
            {Number(op.payAmount ?? op.amount).toFixed(2)}
            <span className="text-gray-400 font-normal text-sm ml-1">{op.payCurrency ?? op.currency}</span>
            <span className="text-gray-400 mx-1">→</span>
            {Number(op.totalUah).toFixed(2)} ₴
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0 ml-2">
        <div className="text-right">
          <div className="flex items-center justify-end gap-1.5">
            <div className="text-sm text-gray-400">{format(new Date(op.createdAt), 'HH:mm')}</div>
            {(op._count?.edits ?? 0) > 0 && (
              <span className="text-xs bg-amber-100 text-amber-700 font-semibold px-1.5 py-0.5 rounded" title="Операцію відредаговано">
                ред.
              </span>
            )}
          </div>
          <div className={`text-xs font-medium ${isCustom ? 'text-orange-500' : 'text-gray-400'}`}>
            {isCustom && <span className="mr-0.5">✱</span>}
            {rateStr}
          </div>
          <div className="text-sm text-green-600 font-medium">+{Number(op.profit).toFixed(2)} ₴</div>
        </div>

        <button
          onClick={() => onEdit(op)}
          className="p-2 rounded-lg text-gray-800 hover:text-blue-600 hover:bg-blue-50 transition text-lg leading-none"
          title="Редагувати операцію"
        >
          ✎
        </button>
      </div>
    </div>
  );
}

function OpsBlock({
  title, ops, colorClass, fullHeight, rates, onEdit,
}: {
  title: string; ops: Op[]; colorClass: string; fullHeight?: boolean;
  rates: Rate[]; onEdit: (op: Op) => void;
}) {
  const total = ops.reduce((s, o) => s + Number(o.profit || 0), 0);

  return (
    <div className={`flex flex-col ${fullHeight ? 'flex-1' : 'bg-white rounded-xl shadow p-4'}`}>
      <div className={`flex items-center justify-between ${fullHeight ? 'px-4 pt-3 pb-2 border-b border-gray-100' : 'mb-3'}`}>
        <h3 className={`font-semibold text-base ${colorClass}`}>{title}</h3>
        <span className="text-xs text-gray-500">
          Прибуток: <span className="text-green-600 font-medium">{total.toFixed(2)} ₴</span>
        </span>
      </div>
      <div className={`${fullHeight ? 'flex-1 overflow-y-auto px-4' : 'space-y-1.5 overflow-y-auto max-h-72 flex-1'}`}>
        {ops.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-8">Немає</p>
        ) : (
          ops.map((op) => <OpRow key={op.id} op={op} rates={rates} onEdit={onEdit} />)
        )}
      </div>
      <div className={`${fullHeight ? 'px-4 py-2 border-t' : 'mt-2 pt-2 border-t'} text-xs text-gray-400 text-right`}>
        {ops.length} операц{ops.length === 1 ? 'ія' : ops.length < 5 ? 'ії' : 'ій'}
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
  const [ops, setOps] = useState<Op[]>([]);
  const [editingOp, setEditingOp] = useState<Op | null>(null);

  const load = () => {
    api.get(`/operations/shift/${shiftId}`).then(({ data }) => setOps(data));
  };

  useEffect(() => { load(); }, [shiftId, refresh]);

  const handleSaved = () => {
    load();
    onRefresh?.();
  };

  // Купівля = каса купує іноземну (backend BUY)
  // Продаж  = каса продає іноземну (backend SELL / EXCHANGE)
  const clientBuyOps  = ops.filter((o) => o.type === 'BUY');
  const clientSellOps = ops.filter((o) => o.type === 'SELL' || o.type === 'EXCHANGE');

  const blockProps = { rates, onEdit: setEditingOp };

  return (
    <>
      {editingOp && (
        <OperationEditModal
          op={editingOp}
          onClose={() => setEditingOp(null)}
          onSaved={handleSaved}
        />
      )}

      {fullHeight ? (
        <div className="flex flex-col h-full">
          <div className="px-4 py-3 border-b border-gray-100">
            <h2 className="font-bold text-lg text-gray-800">Операції зміни</h2>
            <div className="text-sm text-gray-400 mt-0.5">
              Всього: {ops.length} · Прибуток:{' '}
              <span className="text-green-600 font-medium">
                {ops.reduce((s, o) => s + Number(o.profit || 0), 0).toFixed(2)} ₴
              </span>
            </div>
          </div>
          <div className="flex flex-1 overflow-hidden divide-x divide-gray-100">
            <OpsBlock title="🟢 Купівля" ops={clientBuyOps} colorClass="text-green-700" fullHeight {...blockProps} />
            <OpsBlock title="🔴 Продаж"  ops={clientSellOps} colorClass="text-red-600"  fullHeight {...blockProps} />
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
