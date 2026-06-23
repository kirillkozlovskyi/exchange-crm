import { useState, useCallback, useRef, useMemo } from 'react';

const STORAGE_KEY = 'currency_order';

function loadOrder(): string[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  catch { return []; }
}

function saveOrder(codes: string[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(codes));
}

type CurrencyLike = { code: string; [key: string]: any };

function applyOrder<T extends CurrencyLike>(list: T[], order: string[]): T[] {
  if (!order.length) return list;
  const inOrder = order.map((c) => list.find((x) => x.code === c)).filter(Boolean) as T[];
  const rest = list.filter((x) => !order.includes(x.code));
  return [...inOrder, ...rest];
}

export function useCurrencyOrder<T extends CurrencyLike>(currencies: T[]) {
  const [order, setOrder] = useState<string[]>(loadOrder);
  const dragIdx = useRef<number | null>(null);

  // Derive sorted list without useState (no infinite-loop risk)
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
        saveOrder(newOrder);
        dragIdx.current = idx;
        return newOrder;
      });
    },
    [currencies],
  );

  const onDragEnd = useCallback(() => {
    dragIdx.current = null;
  }, []);

  return { sorted, onDragStart, onDragOver, onDragEnd };
}
