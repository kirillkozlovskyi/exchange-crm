/**
 * Офлайн-черга операцій каси (IndexedDB).
 *
 * Коли API недоступний, операція обміну зберігається тут із власним uuid
 * (clientId) і реальним часом створення. Фоновий синк (CashierPage) надсилає
 * чергу по одній у порядку створення; бекенд ідемпотентний по clientId, тож
 * ретраї безпечні. Після успіху запис видаляється.
 */

export interface QueuedOp {
  clientId: string;
  shiftId: number;
  currency: string;
  amount: number;
  rate: number;
  mode: 'BUY' | 'SELL';
  createdAt: string; // ISO, реальний час створення в офлайні
}

const DB_NAME = 'exchange-crm';
const STORE = 'offline-ops';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'clientId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        t.oncomplete = () => db.close();
      }),
  );
}

export const offlineQueue = {
  async add(op: QueuedOp): Promise<void> {
    await tx('readwrite', (s) => s.put(op));
    window.dispatchEvent(new CustomEvent('offline-queue-changed'));
  },

  async remove(clientId: string): Promise<void> {
    await tx('readwrite', (s) => s.delete(clientId));
    window.dispatchEvent(new CustomEvent('offline-queue-changed'));
  },

  async list(): Promise<QueuedOp[]> {
    const all = await tx<QueuedOp[]>('readonly', (s) => s.getAll());
    return [...all].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },
};

/**
 * «Сервер недоступний» (а не помилка бізнес-логіки):
 *  • справжня мережева помилка (немає відповіді взагалі), АБО
 *  • 502/503/504 від reverse-proxy (nginx живий, бекенд лежить) — на проді
 *    падіння бекенда виглядає саме так.
 */
export function isNetworkError(e: any): boolean {
  if (!e) return false;
  if (!e.response) return true;
  return [502, 503, 504].includes(e.response.status);
}
