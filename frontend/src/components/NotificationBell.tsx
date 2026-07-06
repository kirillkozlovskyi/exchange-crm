import { useState, useRef, useEffect, useCallback } from 'react';
import api from '../api/axios';
import { format } from 'date-fns';

type Note = { id: number; message: string; createdAt: string };

// Центр сповіщень адміна: дзвіночок із лічильником непрочитаних + дропдаун.
// Опитує сервер кожну хвилину; події створюються на бекенді (закриття зміни,
// велика операція тощо).
export default function NotificationBell() {
  const [items, setItems] = useState<Note[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    api.get('/notifications').then(({ data }) => setItems(data)).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const markAll = async () => {
    await api.patch('/notifications/read-all').catch(() => {});
    setItems([]);
  };
  const markOne = async (id: number) => {
    await api.patch(`/notifications/${id}/read`).catch(() => {});
    setItems((prev) => prev.filter((n) => n.id !== id));
  };

  const count = items.length;

  return (
    <div className="relative flex-shrink-0" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`relative px-2.5 py-1 rounded transition ${open ? 'bg-blue-900' : 'hover:bg-blue-600'}`}
        title="Сповіщення"
      >
        <span className="text-lg leading-none">🔔</span>
        {count > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-80 max-w-[90vw] bg-white text-gray-800 rounded-lg shadow-xl border border-gray-100 z-50">
          <div className="flex items-center justify-between px-3 py-2 border-b">
            <span className="font-semibold text-sm">Сповіщення</span>
            {count > 0 && (
              <button onClick={markAll} className="text-xs text-blue-600 hover:underline">Прочитати все</button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {count === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-gray-400">Нових сповіщень немає</div>
            ) : (
              items.map((n) => (
                <div key={n.id} className="px-3 py-2 border-b last:border-0 hover:bg-gray-50 flex gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-800">{n.message}</div>
                    <div className="text-xs text-gray-400 mt-0.5">{format(new Date(n.createdAt), 'dd.MM.yyyy HH:mm')}</div>
                  </div>
                  <button onClick={() => markOne(n.id)} className="text-gray-300 hover:text-gray-600 text-xs self-start" title="Прочитано">✕</button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
