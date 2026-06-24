import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import api from '../api/axios';

type CurrencyLike = { code: string; [key: string]: any };

function applyOrder<T extends CurrencyLike>(list: T[], order: string[]): T[] {
  if (!order.length) return list;
  const inOrder = order.map((c) => list.find((x) => x.code === c)).filter(Boolean) as T[];
  const rest = list.filter((x) => !order.includes(x.code));
  return [...inOrder, ...rest];
}

export function useCurrencyOrder<T extends CurrencyLike>(currencies: T[]) {
  const [order, setOrder] = useState<string[]>([]);
  const dragIdx = useRef<number | null>(null);
  const pendingOrder = useRef<string[] | null>(null);

  // Завантажити порядок з БД
  useEffect(() => {
    api.get('/settings/currency-order')
      .then(({ data }) => { if (Array.isArray(data)) setOrder(data); })
      .catch(() => {});
  }, []);

  const sorted = useMemo(() => applyOrder(currencies, order), [currencies, order]);

  const onDragStart = useCallback((idx: number) => {
    dragIdx.current = idx;
  }, []);

  const onDragOver = useCallback(
    (e: React.DragEvent, idx: number) => {
      e.preventDefault();
      const from = dragIdx.current;
      if (from === null || from === idx) return;

      setOrder((prevOrder) => {
        const current = applyOrder(currencies, prevOrder);
        const next = [...current];
        const [item] = next.splice(from, 1);
        next.splice(idx, 0, item);
        const newOrder = next.map((c) => c.code);
        pendingOrder.current = newOrder;
        dragIdx.current = idx;
        return newOrder;
      });
    },
    [currencies],
  );

  // Зберегти в БД після завершення перетягування
  const onDragEnd = useCallback(() => {
    dragIdx.current = null;
    if (pendingOrder.current) {
      api.put('/settings/currency-order', { order: pendingOrder.current }).catch(() => {});
      pendingOrder.current = null;
    }
  }, []);

  return { sorted, onDragStart, onDragOver, onDragEnd };
}
