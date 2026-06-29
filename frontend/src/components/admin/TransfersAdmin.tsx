import { useEffect, useState } from 'react';
import api from '../../api/axios';
import { format } from 'date-fns';

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Очікує',
  CONFIRMED: 'Підтверджено',
  REJECTED: 'Відхилено',
};
const STATUS_COLOR: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-700',
  CONFIRMED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-700',
};

export default function TransfersAdmin() {
  const [transfers, setTransfers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/transfers').then(({ data }) => setTransfers(data)).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center py-10 text-gray-400">Завантаження...</div>;

  return (
    <div className="bg-white rounded-xl shadow p-5">
      <h3 className="font-semibold text-lg mb-4">Всі передачі</h3>
      {transfers.length === 0 && <p className="text-gray-400 text-sm text-center py-6">Немає передач</p>}
      <div className="space-y-2">
        {transfers.map((t) => (
          <div key={t.id} className="flex items-center justify-between py-2 border-b last:border-0">
            <div>
              <div className="text-sm font-medium">
                {t.fromDesk?.exchangePoint?.name} → {t.toDesk?.exchangePoint?.name}
              </div>
              <div className="text-xs text-gray-500">
                {Number(t.amount).toFixed(2)} {t.currency}
                {t.counterCurrency && (
                  <span className="text-blue-600"> ↔ {Number(t.counterAmount).toFixed(2)} {t.counterCurrency}</span>
                )}
                {' · '}{t.sentBy?.name}
              </div>
              {t.note && <div className="text-xs text-gray-400 italic">{t.note}</div>}
            </div>
            <div className="text-right">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[t.status]}`}>
                {STATUS_LABEL[t.status]}
              </span>
              <div className="text-xs text-gray-400 mt-1">
                {format(new Date(t.createdAt), 'dd.MM HH:mm')}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
