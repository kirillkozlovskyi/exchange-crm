import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import api from '../api/axios';

const STORAGE_KEY = 'currency_order';

function loadLocalOrder(): string[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  catch { return []; }
}

function saveLocalOrder(codes: string[]) {
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
  const [order, setOrder] = useState<string[]>(loadLocalOrder);
  const dragIdx = useRef<number | null>(null);
  const pendingOrder = useRef<string[] | null>(null);

  // Завантажити порядок з БД при монтуванні; якщо БД пуста — синхронізувати з localStorage
  useEffect(() => {
    api.get('/settings/currency-order').then(({ data }) => {
      if (Array.isArray(data) && data.length) {
        setOrder(data);
        saveLocalOrder(data);
      } else {
        // БД ще не має порядку — зберегти поточний (з localStorage) в БД
        const local = loadLocalOrder();
        if (local.length) {
          api.put('/settings/currency-order', { order: local }).catch(() => {});
        }
      }
    }).catch(() => { /* використовуємо localStorage як є */ });
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
        saveLocalOrder(newOrder);
        pendingOrder.current = newOrder;
        dragIdx.current = idx;
        return newOrder;
      });
    },
    [currencies],
  );

  // Зберегти в БД тільки після завершення перетягування
  const onDragEnd = useCallback(() => {
    dragIdx.current = null;
    if (pendingOrder.current) {
      api.put('/settings/currency-order', { order: pendingOrder.current }).catch(() => {});
      pendingOrder.current = null;
    }
  }, []);

  return { sorted, onDragStart, onDragOver, onDragEnd };
}
