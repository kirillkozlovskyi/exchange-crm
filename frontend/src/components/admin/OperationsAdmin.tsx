import { useState, useEffect } from 'react';
import api from '../../api/axios';
import { format } from 'date-fns';

type OpType = 'BUY' | 'SELL';

type Edit = {
  id: number;
  editedAt: string;
  prevAmount: string | number;
  prevRate: string | number;
  newAmount: string | number;
  newRate: string | number;
  note?: string;
  editedBy: { name: string };
};

function EditHistoryModal({ opNumber, opId, onClose }: { opNumber: string; opId: number; onClose: () => void }) {
  const [edits, setEdits] = useState<Edit[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/operations/${opId}/edits`)
      .then(({ data }) => setEdits(data))
      .finally(() => setLoading(false));
  }, [opId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Історія змін</div>
            <div className="font-bold text-gray-800 mt-0.5">#{opNumber}</div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        {loading ? (
          <div className="text-center py-8 text-gray-400 text-sm">Завантаження...</div>
        ) : edits.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm">Змін не було</div>
        ) : (
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {edits.map((e, i) => (
              <div key={e.id} className="border border-gray-100 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-500">
                    Зміна #{i + 1} · {e.editedBy.name}
                  </span>
                  <span className="text-xs text-gray-400">
                    {format(new Date(e.editedAt), 'dd.MM.yy HH:mm')}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="bg-red-50 rounded p-2">
                    <div className="text-xs text-gray-400 mb-1">Було</div>
                    <div>Кількість: <span className="font-semibold">{Number(e.prevAmount).toFixed(2)}</span></div>
                    <div>Курс: <span className="font-semibold">{Number(e.prevRate).toFixed(2)}</span></div>
                  </div>
                  <div className="bg-green-50 rounded p-2">
                    <div className="text-xs text-gray-400 mb-1">Стало</div>
                    <div>Кількість: <span className="font-semibold">{Number(e.newAmount).toFixed(2)}</span></div>
                    <div>Курс: <span className="font-semibold">{Number(e.newRate).toFixed(2)}</span></div>
                  </div>
                </div>
                {e.note && (
                  <div className="text-xs text-gray-500 bg-gray-50 rounded px-2 py-1">
                    💬 {e.note}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function OperationsAdmin() {
  const [tab, setTab] = useState<OpType>('BUY');
  const [ops, setOps] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [historyOp, setHistoryOp] = useState<{ id: number; number: string } | null>(null);

  useEffect(() => {
    setLoading(true);
    api.get(`/operations?type=${tab}`)
      .then(({ data }) => setOps(data))
      .finally(() => setLoading(false));
  }, [tab]);

  return (
    <>
      {historyOp && (
        <EditHistoryModal
          opId={historyOp.id}
          opNumber={historyOp.number}
          onClose={() => setHistoryOp(null)}
        />
      )}

      <div className="bg-white rounded-xl shadow p-4 space-y-4">
        <div className="flex gap-2">
          <button
            onClick={() => setTab('BUY')}
            className={`px-4 py-2 rounded-lg font-medium text-sm ${tab === 'BUY' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
          >
            Купівля
          </button>
          <button
            onClick={() => setTab('SELL')}
            className={`px-4 py-2 rounded-lg font-medium text-sm ${tab === 'SELL' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
          >
            Продаж
          </button>
        </div>

        {loading ? (
          <div className="text-center py-8 text-gray-400">Завантаження...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="pb-2 pr-4">№</th>
                  <th className="pb-2 pr-4">Дата</th>
                  <th className="pb-2 pr-4">Валюта</th>
                  <th className="pb-2 pr-4">Кількість</th>
                  <th className="pb-2 pr-4">Курс</th>
                  <th className="pb-2 pr-4">Сума UAH</th>
                  <th className="pb-2 pr-4">Касир</th>
                  <th className="pb-2 pr-4">Точка</th>
                  <th className="pb-2">Зміни</th>
                </tr>
              </thead>
              <tbody>
                {ops.length === 0 && (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-gray-400">Операцій немає</td>
                  </tr>
                )}
                {ops.map((op) => (
                  <tr key={op.id} className="border-b hover:bg-gray-50">
                    <td className="py-2 pr-4 font-mono text-xs text-gray-500">{op.number}</td>
                    <td className="py-2 pr-4 text-gray-500 whitespace-nowrap">
                      {format(new Date(op.createdAt), 'dd.MM.yy HH:mm')}
                    </td>
                    <td className="py-2 pr-4 font-bold">{op.currency}</td>
                    <td className="py-2 pr-4">{Number(op.amount).toFixed(2)}</td>
                    <td className="py-2 pr-4">{Number(op.rate).toFixed(2)}</td>
                    <td className="py-2 pr-4">{Number(op.totalUah).toFixed(2)}</td>
                    <td className="py-2 pr-4">{op.cashier?.name ?? '—'}</td>
                    <td className="py-2 pr-4">{op.shift?.cashDesk?.exchangePoint?.name ?? '—'}</td>
                    <td className="py-2">
                      <button
                        onClick={() => setHistoryOp({ id: op.id, number: op.number })}
                        className="text-xs text-blue-600 hover:underline whitespace-nowrap"
                      >
                        Історія →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
