import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useShiftHeader } from '../context/ShiftHeaderContext';
import api from '../api/axios';
import { format } from 'date-fns';
import OperationForm from '../components/cashier/OperationForm';
import OperationsList from '../components/cashier/OperationsList';
import TransferPanel from '../components/cashier/TransferPanel';
import { fmtInt, fmtMoney } from '../lib/format';
import OpenShiftForm from '../components/cashier/OpenShiftForm';
import CloseShiftForm from '../components/cashier/CloseShiftForm';
import Flag from '../components/Flag';
import { type CashDirection } from '../lib/cash-movements';
import { shiftCashBalanceWithTransfers } from '../lib/shift-balance';
import { usdtProfit } from '../lib/usdt';
import { offlineQueue, isNetworkError, type QueuedOp } from '../lib/offline-queue';
import UsdtModal from '../components/cashier/UsdtModal';

type Tab = 'operations' | 'transfers';

type Desk = {
  id: number;
  name: string;
  isOccupied: boolean;
  activeShift?: { openedBy?: { name: string } };
};

type PointWithDesks = {
  id: number;
  name: string;
  code: string;
  desks: Desk[];
};

export default function CashierPage() {
  const { user } = useAuth();
  const { setInfo, setActions } = useShiftHeader();

  const fixedPointId = user?.exchangePointId ?? null;

  const [loading, setLoading] = useState(true);

  // Дані для екрану вибору
  const [assignedDesks, setAssignedDesks] = useState<Desk[]>([]);          // якщо є fixedPoint
  const [pointsWithDesks, setPointsWithDesks] = useState<PointWithDesks[]>([]); // якщо немає

  // Після вибору каси
  const [selectedDeskId, setSelectedDeskId] = useState<number | null>(null);
  const [selectedPointId, setSelectedPointId] = useState<number | null>(null);
  const [selectedPointName, setSelectedPointName] = useState('');
  const [selectedDeskName, setSelectedDeskName] = useState('');
  const [rates, setRates] = useState<any[]>([]);

  // Зміна
  const [shift, setShift] = useState<any>(null);
  const [tab, setTab] = useState<Tab>('operations');
  const [refreshOps, setRefreshOps] = useState(0);
  const [closingShift, setClosingShift] = useState(false);
  const [closeTransfers, setCloseTransfers] = useState<any[]>([]);
  const [mobileView, setMobileView] = useState<'form' | 'list'>('form');

  const [showReconcileModal, setShowReconcileModal] = useState(false);
  // Модалка руху готівки: null закрита, або напрямок IN (підкріплення)/OUT (інкасація).
  const [cashMoveDir, setCashMoveDir] = useState<CashDirection | null>(null);
  // Модалка USDT-операції
  const [showUsdt, setShowUsdt] = useState(false);
  // Витрати касиру (адмінський дозвіл) + стан модалки.
  const [canExpenses, setCanExpenses] = useState(false);
  const [showExpense, setShowExpense] = useState(false);
  const [quickAmounts, setQuickAmounts] = useState<number[]>([10, 20, 50, 100, 500]);
  const [orgName, setOrgName] = useState('');
  // Чи показувати касиру прибуток (адмінське налаштування). Поки не завантажено —
  // ховаємо, щоб прибуток не «блимав» тим, кому його приховали.
  const [canSeeProfit, setCanSeeProfit] = useState(false);
  const [activeCur, setActiveCur] = useState<string | undefined>(undefined);

  // Передачі та сповіщення
  const [pendingCount, setPendingCount] = useState(0);
  const [notifications, setNotifications] = useState<{ id: number; message: string }[]>([]);

  // ── Завантаження курсів з сортуванням по порядку з бази ──────────────────
  const loadRates = useCallback(async (pointId: number) => {
    const [ratesRes, orderRes] = await Promise.all([
      api.get(`/rates/point/${pointId}`),
      api.get('/settings/currency-order').catch(() => ({ data: [] })),
    ]);
    const order: string[] = orderRes.data ?? [];
    const sorted = order.length
      ? [...ratesRes.data].sort((a: any, b: any) => {
          const ia = order.indexOf(a.currency);
          const ib = order.indexOf(b.currency);
          if (ia === -1 && ib === -1) return 0;
          if (ia === -1) return 1;
          if (ib === -1) return -1;
          return ia - ib;
        })
      : ratesRes.data;
    setRates(sorted);
  }, []);

  // ── Завантаження списку кас (picker) ──────────────────────────────────────
  const loadDeskPicker = useCallback(async () => {
    try {
      if (fixedPointId) {
        const [desksRes, pointRes] = await Promise.all([
          api.get(`/cash-desks?pointId=${fixedPointId}`),
          api.get(`/exchange-points/${fixedPointId}`),
        ]);
        setAssignedDesks(desksRes.data.filter((d: any) => d.active));
        setSelectedPointName(pointRes.data?.name ?? '');
      } else {
        const { data: points } = await api.get('/exchange-points');
        const activePoints = points.filter((p: any) => p.active !== false);
        const desksPerPoint = await Promise.all(
          activePoints.map((p: any) =>
            api.get(`/cash-desks?pointId=${p.id}`).then(({ data }) => ({
              ...p,
              desks: data.filter((d: any) => d.active),
            }))
          )
        );
        setPointsWithDesks(
          desksPerPoint.filter((p) => p.desks.some((d: Desk) => !d.isOccupied))
        );
      }
    } catch (e) {
      console.error('Помилка завантаження кас:', e);
    }
  }, [fixedPointId]);

  // ── Початкове завантаження ─────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;

    const init = async () => {
      try {
        // Завантажуємо налаштування паралельно
        api.get('/settings/quick-amounts').then(({ data }) => setQuickAmounts(data)).catch(() => {});
        api.get('/settings/org-name').then(({ data }) => setOrgName(data.name ?? '')).catch(() => {});
        api.get('/settings/cashier-see-profit').then(({ data }) => setCanSeeProfit(!!data.enabled)).catch(() => {});
        api.get('/settings/cashier-expenses').then(({ data }) => setCanExpenses(!!data.enabled)).catch(() => {});

        // Спочатку перевіряємо — чи є у юзера вже відкрита зміна
        const myShiftRes = await api.get('/shifts/my').catch(() => null);
        const myShift = myShiftRes?.data;

        if (myShift) {
          const desk = myShift.cashDesk;
          const point = desk?.exchangePoint;
          const pointId = point?.id;

          setShift(myShift);
          setSelectedDeskId(desk?.id ?? null);
          setSelectedDeskName(desk?.name ?? '');
          setSelectedPointId(pointId ?? null);
          setSelectedPointName(point?.name ?? '');

          if (pointId) {
            await loadRates(pointId);
          }
          return;
        }

        await loadDeskPicker();
      } catch (e) {
        console.error('Помилка ініціалізації:', e);
      } finally {
        setLoading(false);
      }
    };

    init();
  }, [user, loadDeskPicker]);

  // ── Вибір каси ────────────────────────────────────────────────────────────
  const handleSelectDesk = async (desk: Desk, point: { id: number; name: string }) => {
    setSelectedDeskId(desk.id);
    setSelectedDeskName(desk.name);
    setSelectedPointId(point.id);
    setSelectedPointName(point.name);

    try {
      await loadRates(point.id);
    } catch {
      setRates([]);
    }
  };

  // ── Зміна ─────────────────────────────────────────────────────────────────
  const loadShift = useCallback(async (deskId: number) => {
    try {
      const { data } = await api.get(`/shifts/active/desk/${deskId}`);
      setShift(data);
    } catch (e: any) {
      // Мережа впала — НЕ скидаємо зміну (каса продовжує працювати офлайн);
      // скидаємо лише коли сервер реально відповів (зміни немає/закрита).
      if (!isNetworkError(e)) setShift(null);
    }
  }, []);

  // ── Офлайн-режим: стан мережі + черга несинхронізованих операцій ─────────
  const [online, setOnline] = useState(navigator.onLine);
  const [queued, setQueued] = useState<QueuedOp[]>([]);
  const [syncError, setSyncError] = useState('');

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    const reloadQueue = () => { offlineQueue.list().then(setQueued).catch(() => {}); };
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    window.addEventListener('offline-queue-changed', reloadQueue);
    reloadQueue();
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
      window.removeEventListener('offline-queue-changed', reloadQueue);
    };
  }, []);

  // Фоновий синк черги: по одній, у порядку створення. Бекенд ідемпотентний
  // по clientId, тож повторні надсилання безпечні.
  useEffect(() => {
    const sync = async () => {
      if (!navigator.onLine) return;
      const list = await offlineQueue.list().catch(() => [] as QueuedOp[]);
      if (list.length === 0) return;
      for (const op of list) {
        try {
          await api.post('/operations', op);
          await offlineQueue.remove(op.clientId);
          setSyncError('');
        } catch (e: any) {
          if (isNetworkError(e)) { setQueued(await offlineQueue.list()); return; } // звʼязок знову впав
          // Бізнес-відмова (напр., зміну закрили) — лишаємо в черзі й показуємо
          // причину, щоб касир/адмін вирішив (не видаляємо грошову операцію тихо).
          setSyncError(e.response?.data?.message ?? 'Помилка синхронізації');
          setQueued(await offlineQueue.list());
          return;
        }
      }
      setQueued(await offlineQueue.list()); // явно оновлюємо банер після синку
      if (selectedDeskId) loadShift(selectedDeskId);
    };
    sync();
    const interval = setInterval(sync, 8000);
    return () => clearInterval(interval);
  }, [selectedDeskId, loadShift]);

  useEffect(() => {
    if (!selectedDeskId) return;
    loadShift(selectedDeskId);
    const interval = setInterval(() => loadShift(selectedDeskId), 30000);
    return () => clearInterval(interval);
  }, [selectedDeskId, loadShift]);

  // ── Live-курси: зміна курсу в адмінці підхоплюється без перезавантаження ──
  // Перечитуємо активні курси точки кожні 15 с. Форма операції сама підставить
  // новий ринковий курс, якщо касир не редагував його вручну (rateManual).
  useEffect(() => {
    if (!selectedPointId) return;
    const interval = setInterval(() => {
      loadRates(selectedPointId).catch(() => {});
    }, 15000);
    return () => clearInterval(interval);
  }, [selectedPointId, loadRates]);

  const handleOpenShift = async (
    startBalance: Record<string, number>,
    costBasis?: Record<string, number>,
  ) => {
    await api.post('/shifts/open', { cashDeskId: selectedDeskId, startBalance, costBasis });
    await loadShift(selectedDeskId!);
  };

  // Перехід до екрану закриття: підвантажуємо підтверджені передачі каси за зміну,
  // щоб вилучити їх із прибутку (рух готівки між касами ≠ прибуток).
  const startClosing = async () => {
    setCloseTransfers([]);
    setClosingShift(true);
    if (selectedDeskId && shift?.openedAt) {
      try {
        const { data } = await api.get(
          `/transfers/confirmed?deskId=${selectedDeskId}&since=${encodeURIComponent(shift.openedAt)}`,
        );
        setCloseTransfers(data);
      } catch {
        setCloseTransfers([]);
      }
    }
  };

  const handleCloseShift = async (endBalance: Record<string, number>) => {
    if (!shift) return;
    await api.patch(`/shifts/${shift.id}/close`, { endBalance });
    setShift(null);
    setSelectedDeskId(null);
    setSelectedPointId(null);
    setSelectedDeskName('');
    setClosingShift(false);
    // Перезавантажуємо список кас — після закриття зміни каса знову вільна
    await loadDeskPicker();
  };

  const handleBackToPicker = () => {
    setSelectedDeskId(null);
    setSelectedPointId(null);
    setSelectedPointName('');
    setSelectedDeskName('');
    setShift(null);
  };

  // ── Polling кількості вхідних передач (бедж завжди актуальний) ───────────
  // Нова вхідна передача → короткий звуковий сигнал, щоб касир не пропустив.
  const prevPendingRef = useRef(0);
  useEffect(() => {
    if (!selectedDeskId) return;
    const poll = async () => {
      try {
        const { data } = await api.get(`/transfers/pending?deskId=${selectedDeskId}`);
        if (data.length > prevPendingRef.current) playTransferBeep();
        prevPendingRef.current = data.length;
        setPendingCount(data.length);
      } catch {}
    };
    poll();
    const interval = setInterval(poll, 20000);
    return () => clearInterval(interval);
  }, [selectedDeskId]);

  // ── Polling сповіщень ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!user || !shift) return;
    const poll = async () => {
      try {
        const { data } = await api.get('/notifications');
        if (data.length > 0) setNotifications((prev) => {
          const existingIds = new Set(prev.map((n: any) => n.id));
          const newOnes = data.filter((n: any) => !existingIds.has(n.id));
          return newOnes.length > 0 ? [...prev, ...newOnes] : prev;
        });
      } catch {}
    };
    poll();
    const interval = setInterval(poll, 20000);
    return () => clearInterval(interval);
  }, [user, shift]);

  const dismissNotification = async (id: number) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    await api.patch(`/notifications/${id}/read`).catch(() => {});
  };

  // ── Поточний баланс каси (хук ПЕРЕД будь-якими early return) ────────────
  // Єдиний ledger-розрахунок: початок + операції + рух готівки + USDT-готівка +
  // підтверджені передачі/свопи (дзеркало бекенду).
  const currentBalance = useMemo(() => {
    // Офлайн-черга входить у баланс (як звичайні операції), щоб касир бачив
    // реальну готівку й не міг продати те, чого вже немає. Дублювання після
    // синку немає: операція з черги зникає, щойно зʼявляється на сервері.
    const syncedIds = new Set((shift?.operations ?? []).map((o: any) => o.clientId).filter(Boolean));
    const queuedAsOps = queued
      .filter((q) => q.shiftId === shift?.id && !syncedIds.has(q.clientId))
      .map((q) => ({
        type: q.mode, currency: q.currency, amount: q.amount,
        totalUah: q.amount * q.rate, cancelled: false,
      }));
    return shiftCashBalanceWithTransfers(
      {
        startBalance: shift?.startBalance,
        operations: [...(shift?.operations ?? []), ...queuedAsOps],
        cashMovements: shift?.cashMovements,
        usdtOperations: shift?.usdtOperations,
      },
      shift?.confirmedTransfers ?? [],
      shift?.cashDeskId,
    );
  }, [shift, queued]);

  // Живий прибуток каси за поточну зміну — реалізований WAC (сума op.profit,
  // рахується сервером при кожній операції) + чиста маржа USDT. Без нестачі/
  // надлишку (фактичний перерахунок буде лише на закритті).
  const liveProfit = useMemo(() => {
    const ops = shift?.operations ?? [];
    const trading = ops.reduce((s: number, o: any) => s + (o.cancelled ? 0 : Number(o.profit ?? 0)), 0);
    const usdt = usdtProfit(shift?.usdtOperations ?? []);
    return { total: trading + usdt, trading, usdt };
  }, [shift]);

  // ── Синхронізація інфо зміни в хедер ─────────────────────────────────────
  useEffect(() => {
    if (shift && selectedDeskName) {
      setInfo({
        pointName: selectedPointName,
        deskName: selectedDeskName,
        shiftNumber: shift.number,
        openedAt: shift.openedAt,
      });
    } else {
      setInfo(null);
    }
  }, [shift, selectedPointName, selectedDeskName, setInfo]);

  // ── Кнопки (Операції / Підкріплення / Інкасація / Передачі / Закрити) — хедер ──
  useEffect(() => {
    // Стан відкриття зміни: каса обрана, зміни ще немає — у хедер тайтл + «Змінити касу».
    if (selectedDeskId && !shift && !closingShift) {
      setActions(
        <>
          <span className="text-sm">
            {selectedPointName && <span className="opacity-80">{selectedPointName} · </span>}
            <span className="font-semibold">{selectedDeskName}</span>
          </span>
          <button
            onClick={handleBackToPicker}
            className="text-sm hover:bg-blue-600 px-3 py-1 rounded transition"
          >
            ← Змінити касу
          </button>
        </>
      );
      return () => setActions(null);
    }

    const inWorkingView = !!shift && !closingShift && !!selectedDeskId;
    if (!inWorkingView) { setActions(null); return; }
    const tabCls = (active: boolean) =>
      `px-3 py-1 rounded text-sm font-medium transition ${active ? 'bg-blue-900' : 'hover:bg-blue-600'}`;
    // В офлайні доступні лише операції обміну: банк/USDT/передачі/закриття
    // вимагають сервера (цілісність) — кнопки блокуються.
    const offTitle = online ? undefined : 'Недоступно в офлайні';
    setActions(
      <>
        <button onClick={() => setCashMoveDir('IN')} disabled={!online} title={offTitle}
          className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-sm font-medium disabled:opacity-40">
          Підкріплення
        </button>
        <button onClick={() => setCashMoveDir('OUT')} disabled={!online} title={offTitle}
          className="bg-purple-600 hover:bg-purple-700 text-white px-3 py-1 rounded text-sm font-medium disabled:opacity-40">
          Інкасація
        </button>
        <button onClick={() => setShowUsdt(true)} disabled={!online} title={offTitle}
          className="bg-teal-600 hover:bg-teal-700 text-white px-3 py-1 rounded text-sm font-medium disabled:opacity-40">
          ₮ USDT
        </button>
        {canExpenses && (
          <button onClick={() => setShowExpense(true)} disabled={!online} title={offTitle}
            className="bg-amber-600 hover:bg-amber-700 text-white px-3 py-1 rounded text-sm font-medium disabled:opacity-40">
            Витрата
          </button>
        )}
        <button onClick={() => setTab('operations')} className={tabCls(tab === 'operations')}>
          Операції
        </button>
        <button onClick={() => setTab('transfers')} disabled={!online} title={offTitle}
          className={`relative disabled:opacity-40 ${tabCls(tab === 'transfers')}`}>
          Передачі
          {pendingCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-xs font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
              {pendingCount}
            </span>
          )}
        </button>
        <button onClick={startClosing} disabled={!online} title={offTitle}
          className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-sm font-medium ml-2 disabled:opacity-40">
          Закрити зміну
        </button>
      </>
    );
    return () => setActions(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shift, closingShift, selectedDeskId, tab, pendingCount, selectedPointName, selectedDeskName, online, canExpenses]);

  // ── Рендер ────────────────────────────────────────────────────────────────

  if (loading) {
    return <div className="text-center py-20 text-gray-500 p-6">Завантаження...</div>;
  }

  // ── Вибір каси ─────────────────────────────────────────────────────────────
  if (!selectedDeskId) {
    // Касир прикріплений до точки
    if (fixedPointId) {
      const freeDesks = assignedDesks.filter((d) => !d.isOccupied);
      const busyDesks = assignedDesks.filter((d) => d.isOccupied);
      return (
        <div className="p-6 max-w-lg mx-auto mt-12">
          <div className="bg-white rounded-xl shadow p-6">
            <h2 className="text-xl font-bold text-gray-800 mb-1">Оберіть касу</h2>
            <p className="text-sm text-gray-500 mb-5">Вільні каси вашої точки</p>

            {assignedDesks.length === 0 && (
              <p className="text-gray-400 text-center py-8">
                Немає кас. Зверніться до адміністратора.
              </p>
            )}

            {freeDesks.length === 0 && assignedDesks.length > 0 && (
              <p className="text-amber-600 text-sm text-center py-4 bg-amber-50 rounded">
                Усі каси зайняті
              </p>
            )}

            <div className="space-y-3">
              {freeDesks.map((desk) => (
                <button
                  key={desk.id}
                  onClick={() => handleSelectDesk(desk, { id: fixedPointId, name: selectedPointName })}
                  className="w-full flex items-center justify-between border-2 border-blue-200 hover:border-blue-500 hover:bg-blue-50 rounded-xl px-4 py-4 text-left transition"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-3 h-3 rounded-full bg-green-400 flex-shrink-0" />
                    <span className="font-semibold text-gray-800">{desk.name}</span>
                  </div>
                  <span className="text-sm text-blue-600 font-medium">Обрати →</span>
                </button>
              ))}

              {/* Зайняті каси — показуємо для інформації, не можна обрати */}
              {busyDesks.map((desk) => (
                <div
                  key={desk.id}
                  className="flex items-center justify-between border-2 border-gray-100 bg-gray-50 rounded-xl px-4 py-4 opacity-60"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-3 h-3 rounded-full bg-red-400 flex-shrink-0" />
                    <div>
                      <div className="font-semibold text-gray-700">{desk.name}</div>
                      {desk.activeShift?.openedBy?.name && (
                        <div className="text-xs text-red-500 mt-0.5">
                          {desk.activeShift.openedBy.name}
                        </div>
                      )}
                    </div>
                  </div>
                  <span className="text-xs bg-red-100 text-red-600 px-2 py-1 rounded">Зайнята</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }

    // Касир не прикріплений — показуємо точки з вільними касами
    return (
      <div className="p-6 max-w-lg mx-auto mt-8">
        <div className="mb-5">
          <h2 className="text-xl font-bold text-gray-800">Оберіть касу</h2>
          <p className="text-sm text-gray-500 mt-1">Доступні вільні каси по всіх точках</p>
        </div>

        {pointsWithDesks.length === 0 && (
          <div className="bg-white rounded-xl shadow p-8 text-center">
            <div className="text-3xl mb-3">😔</div>
            <p className="text-gray-500">Немає вільних кас у жодній точці</p>
          </div>
        )}

        <div className="space-y-4">
          {pointsWithDesks.map((point) => {
            const freeDesks = point.desks.filter((d) => !d.isOccupied);
            if (freeDesks.length === 0) return null;
            return (
              <div key={point.id} className="bg-white rounded-xl shadow p-5">
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-xl">🏪</span>
                  <span className="font-bold text-gray-800">{point.name}</span>
                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-mono">
                    {point.code}
                  </span>
                  <span className="ml-auto text-xs text-gray-400">
                    {freeDesks.length} вільн{freeDesks.length === 1 ? 'а' : 'их'}
                  </span>
                </div>
                <div className="space-y-2">
                  {freeDesks.map((desk) => (
                    <button
                      key={desk.id}
                      onClick={() => handleSelectDesk(desk, point)}
                      className="w-full flex items-center justify-between border border-blue-200 hover:border-blue-500 hover:bg-blue-50 rounded px-4 py-3 text-left transition"
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-green-400 flex-shrink-0" />
                        <span className="font-medium text-gray-800">{desk.name}</span>
                      </div>
                      <span className="text-sm text-blue-600 font-medium">Обрати →</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Відкриття зміни ────────────────────────────────────────────────────────
  // «Змінити касу» і тайтл точки/каси — у хедері (див. setActions нижче).
  if (!shift) {
    return (
      <div className="px-6 pt-3 pb-6">
        <OpenShiftForm rates={rates} cashDeskId={selectedDeskId} onOpen={handleOpenShift} />
      </div>
    );
  }

  // ── Закриття зміни ─────────────────────────────────────────────────────────
  if (closingShift) {
    return (
      <div className="px-2 sm:px-3 py-2 w-full h-full overflow-y-auto">
        <CloseShiftForm
          shift={shift}
          rates={rates}
          deskId={selectedDeskId ?? shift.cashDeskId}
          transfers={closeTransfers}
          cashMovements={shift.cashMovements ?? []}
          usdtOperations={shift.usdtOperations ?? []}
          showProfit={canSeeProfit}
          onClose={handleCloseShift}
          onCancel={() => setClosingShift(false)}
          onRecalcBasis={async (basis) => {
            await api.patch(`/shifts/${shift.id}/cost-basis`, { costBasis: basis });
            await loadShift(selectedDeskId ?? shift.cashDeskId);
          }}
        />
      </div>
    );
  }

  // ── Робоча зміна ───────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col flex-1 overflow-hidden">

      {/* ── Банер офлайну / синхронізації черги ── */}
      {(!online || queued.length > 0) && (
        <div className={`px-4 py-1.5 text-sm font-medium text-center ${
          !online ? 'bg-amber-500 text-white'
          : syncError ? 'bg-red-600 text-white'
          : 'bg-blue-600 text-white'
        }`}>
          {!online ? (
            <>📴 ОФЛАЙН — операції обміну зберігаються локально
              {queued.length > 0 && <> · у черзі: <b>{queued.length}</b></>}</>
          ) : syncError ? (
            <>⚠️ Черга ({queued.length}) не синхронізується: {syncError}</>
          ) : (
            <>⏳ Черга операцій: <b>{queued.length}</b> — надсилаємо на сервер…</>
          )}
        </div>
      )}

      {/* Тости сповіщень */}
      {notifications.length > 0 && (
        <div className="fixed top-16 right-4 z-50 space-y-2 w-80">
          {notifications.map((n) => (
            <div key={n.id} className="bg-white border border-gray-200 rounded-xl shadow-lg p-4 flex gap-3 items-start">
              <div className="flex-1 text-sm text-gray-800">{n.message}</div>
              <button onClick={() => dismissNotification(n.id)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
            </div>
          ))}
        </div>
      )}

      {/* ── Підшапка: перемикач форма/список — лише на мобільному в Operations ── */}
      {tab === 'operations' && (
        <div className="lg:hidden bg-white border-b border-gray-200 px-3 py-2 flex items-center gap-3">
          <div className="flex items-center gap-1 bg-gray-100 rounded p-0.5">
            <button
              onClick={() => setMobileView('form')}
              className={`px-3 py-1 rounded text-xs font-medium transition ${mobileView === 'form' ? 'bg-white shadow text-blue-700' : 'text-gray-600'}`}
            >
              ✏️ Форма
            </button>
            <button
              onClick={() => setMobileView('list')}
              className={`px-3 py-1 rounded text-xs font-medium transition ${mobileView === 'list' ? 'bg-white shadow text-blue-700' : 'text-gray-600'}`}
            >
              📋 Список
            </button>
          </div>
        </div>
      )}

      {/* ── Основний контент ────────────────────────────────────────────── */}
      {tab === 'operations' && (
        <div className="flex flex-1 min-h-0">

          {/* Ліва колонка — список операцій (другорядний): вужча, на мобільному прихована коли активна форма */}
          <div className={`
            lg:flex lg:w-2/5 lg:border-r lg:border-gray-200 lg:overflow-hidden lg:bg-white
            ${mobileView === 'list' ? 'flex flex-1 overflow-hidden bg-white' : 'hidden'}
          `}>
            <div className="w-full h-full">
              <OperationsList
                shiftId={shift.id}
                refresh={refreshOps}
                fullHeight
                rates={rates}
                onRefresh={() => loadShift(selectedDeskId!)}
                receipt={{
                  orgName,
                  address: shift?.cashDesk?.exchangePoint?.address ?? '',
                  deskNo: shift?.cashDeskId,
                }}
              />
            </div>
          </div>

          {/* Права колонка (головна) — курси + нова операція */}
          <div className={`
            lg:flex lg:flex-col lg:w-3/5 lg:overflow-y-auto lg:bg-gray-50
            ${mobileView === 'form' ? 'flex flex-col flex-1 overflow-y-auto bg-gray-50' : 'hidden'}
          `}>

            {/* Курси валют + Залишок в касі — поруч (по 50%) */}
            <div className="flex flex-col sm:flex-row border-b border-gray-200">

              {/* Курси валют */}
              <div className="bg-white px-3 py-2 w-full sm:w-1/2">
                <div className="flex items-center text-xs font-semibold uppercase tracking-wider mb-1">
                  <span className="flex-1 text-gray-900">Курси валют</span>
                  <span className="w-20 text-right text-green-600">Купівля</span>
                  <span className="w-20 text-right text-red-500">Продаж</span>
                </div>
                <div className="divide-y divide-gray-100">
                  {rates.map((r) => (
                    <div
                      key={r.currency}
                      onClick={() => setActiveCur(r.currency)}
                      className={`flex items-center py-1 cursor-pointer rounded px-1 transition ${
                        activeCur === r.currency ? 'bg-blue-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      <span className="text-lg w-7 text-center"><Flag currency={r.currency} /></span>
                      <span className={`font-bold text-lg flex-1 ${activeCur === r.currency ? 'text-blue-700' : 'text-gray-800'}`}>{r.currency}</span>
                      <span className="w-20 text-right text-xl font-bold text-green-700">{Number(r.buy).toFixed(2)}</span>
                      <span className="w-20 text-right text-xl font-bold text-red-600">{Number(r.sell).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Залишок в касі */}
              <div className="bg-white px-3 py-2 w-full sm:w-1/2 border-t sm:border-t-0 sm:border-l border-gray-200">
                <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold uppercase tracking-wider mb-1">
                  <span className="flex-1 text-gray-900">Залишок в касі</span>
                  <button
                    onClick={() => setShowReconcileModal(true)}
                    className="bg-amber-500 hover:bg-amber-600 text-white rounded text-base px-2 py-1 font-medium normal-case"
                  >
                    Звірити залишок
                  </button>
                </div>
                <div className="divide-y divide-gray-100">
                  {currentBalance['UAH'] !== undefined && (
                    <div className="flex items-center py-1 px-1">
                      <span className="text-lg w-7 text-center"><Flag currency="UAH" /></span>
                      <span className="font-bold text-lg flex-1 text-gray-800">UAH</span>
                      <span className="text-xl font-bold text-blue-800">{fmtInt(currentBalance['UAH'])}</span>
                    </div>
                  )}
                  {Object.entries(currentBalance).filter(([c]) => c !== 'UAH').map(([cur, amt]) => (
                    <div key={cur} className="flex items-center py-1 px-1">
                      <span className="text-lg w-7 text-center"><Flag currency={cur} /></span>
                      <span className="font-bold text-lg flex-1 text-gray-800">{cur}</span>
                      <span className={`text-xl font-bold ${Number(amt) < 0 ? 'text-red-600' : 'text-blue-800'}`}>{fmtInt(amt)}</span>
                    </div>
                  ))}
                </div>
                {/* Живий прибуток каси за зміну (реаліз. спред + маржа USDT) —
                    лише якщо адмін дозволив показ прибутку касиру */}
                {canSeeProfit && (
                  <div className="flex items-center mt-1.5 pt-1.5 border-t border-gray-200 px-1">
                    <span className="flex-1 text-xs font-semibold uppercase tracking-wider text-gray-500">Прибуток каси</span>
                    <span
                      className={`text-xl font-bold ${liveProfit.total >= 0 ? 'text-green-600' : 'text-red-600'}`}
                      title={`Торговий: ${liveProfit.trading.toFixed(2)} ₴${Math.abs(liveProfit.usdt) >= 0.005 ? ` · USDT: ${liveProfit.usdt.toFixed(2)} ₴` : ''}`}
                    >
                      {liveProfit.total >= 0 ? '+' : ''}{fmtMoney(liveProfit.total)} ₴
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Нова операція */}
            <OperationForm
              shiftId={shift.id}
              rates={rates}
              balance={currentBalance}
              quickAmounts={quickAmounts}
              activeCur={activeCur}
              receipt={{
                orgName,
                address: shift?.cashDesk?.exchangePoint?.address ?? '',
                deskNo: shift?.cashDeskId,
              }}
              onCreated={() => {
                setRefreshOps((n) => n + 1);
                loadShift(selectedDeskId!);
                setMobileView('list'); // після збереження — показати список
              }}
            />
          </div>
        </div>
      )}

      {tab === 'transfers' && (
        <div className="p-3 sm:p-4 flex-1 overflow-y-auto">
          <TransferPanel
            cashDeskId={selectedDeskId}
            balance={currentBalance}
            onBalanceChange={() => loadShift(selectedDeskId!)}
            onPendingCountChange={setPendingCount}
          />
        </div>
      )}

      {/* ── Модалка звірки залишку ────────────────────────────────────────── */}
      {showReconcileModal && (
        <ReconcileModal
          shiftId={shift.id}
          expectedBalance={currentBalance}
          startBalance={(shift?.startBalance as Record<string, number>) || {}}
          currencies={Array.from(new Set(['UAH', ...rates.map((r: any) => r.currency), ...Object.keys(currentBalance)]))}
          onClose={() => setShowReconcileModal(false)}
          onSave={async (expected, actual) => {
            await api.post('/reconciliations', { shiftId: shift.id, expected, actual });
            setShowReconcileModal(false);
          }}
        />
      )}

      {/* ── Модалка руху готівки (підкріплення / інкасація) ────────────────── */}
      {cashMoveDir && (
        <CashMovementModal
          shiftId={shift.id}
          direction={cashMoveDir}
          balance={currentBalance}
          movements={shift.cashMovements ?? []}
          currencies={Array.from(new Set(['UAH', ...rates.map((r: any) => r.currency), ...Object.keys(currentBalance)]))}
          onClose={() => setCashMoveDir(null)}
          onSaved={() => loadShift(selectedDeskId!)}
        />
      )}

      {/* ── Модалка USDT-операції ──────────────────────────────────────────── */}
      {showUsdt && (
        <UsdtModal
          shiftId={shift.id}
          pointId={selectedPointId ?? shift.cashDesk?.exchangePointId}
          rates={rates}
          balance={currentBalance}
          operations={shift.usdtOperations ?? []}
          onClose={() => setShowUsdt(false)}
          onSaved={() => loadShift(selectedDeskId!)}
        />
      )}
      {showExpense && (
        <ExpenseModal
          exchangePointId={selectedPointId ?? shift.cashDesk?.exchangePointId}
          onClose={() => setShowExpense(false)}
        />
      )}
    </div>
  );
}

// ── Модалка витрати (для касира, якщо дозволено адміном) ─────────────────────
function ExpenseModal({ exchangePointId, onClose }: { exchangePointId: number; onClose: () => void }) {
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    const amt = parseFloat(amount);
    if (!(amt > 0)) { setError('Сума має бути більшою за 0'); return; }
    if (!category.trim()) { setError('Вкажіть категорію'); return; }
    setSaving(true); setError('');
    try {
      await api.post('/expenses', { amount: amt, category: category.trim(), note: note.trim() || undefined, exchangePointId });
      onClose();
    } catch (e: any) {
      setError(e.response?.data?.message ?? 'Помилка'); setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-lg w-full max-w-sm p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-gray-800">Витрата</h3>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Сума, ₴</label>
          <input type="number" step="1" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)}
            autoFocus placeholder="0"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-right focus:outline-none focus:ring-2 focus:ring-amber-400" />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Категорія</label>
          <input type="text" value={category} onChange={(e) => setCategory(e.target.value)}
            placeholder="напр. Оренда, Зарплата, Інше"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Примітка (необов'язково)</label>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
        </div>
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 rounded-lg hover:bg-gray-100">Скасувати</button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 text-sm font-medium bg-amber-600 hover:bg-amber-700 text-white rounded-lg disabled:opacity-50">
            {saving ? 'Збереження...' : 'Додати витрату'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Модалка руху готівки ─────────────────────────────────────────────────────
// Підкріплення (IN) — готівка приходить у касу (банк/офіс/власник/інша каса).
// Інкасація (OUT) — готівка йде з каси. Змінює залишок каси, але не входить у
// прибуток зміни. Для OUT перевіряємо достатній залишок.
type MovementItem = {
  id: number;
  direction: CashDirection;
  currency: string;
  amount: string | number;
  source?: string | null;
  note?: string | null;
  createdAt: string;
};

// Джерело/призначення руху готівки:
//  • «Банк» — рухає глобальний банк компанії (підкріплення: банк ↓ каса ↑;
//    інкасація: каса ↓ банк ↑) — перевірено, працює через counterparty BANK;
//  • «Інше» — гроші ззовні/назовні компанії (не чіпають банк).
// «Інша каса» прибрано: для переміщень між касами є Передачі (з підтвердженням
// отримувачем); «Офіс»/«Власник» злиті в «Інше».
//  • «Коригування» — вирівнювання перерахунку каси (копійки/округлення). Банк не
//    чіпає, лишає слід у журналі. Доступне, лише якщо адмін дозволив
//    «Редагування залишків каси».
const SOURCE_CATEGORIES = ['Банк', 'Інше'];
const ADJUST_SOURCE = 'Коригування';

// Короткий двотональний сигнал про нову вхідну передачу (WebAudio, без файлів).
function playTransferBeep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    osc.start();
    osc.frequency.setValueAtTime(1175, ctx.currentTime + 0.12);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
    osc.stop(ctx.currentTime + 0.45);
    osc.onended = () => ctx.close();
  } catch { /* без звуку — не критично */ }
}

function CashMovementModal({
  shiftId, direction, balance, movements, currencies, onClose, onSaved,
}: {
  shiftId: number;
  direction: CashDirection;
  balance: Record<string, number>;
  movements: MovementItem[];
  currencies: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isIn = direction === 'IN';
  // Повні (статичні) класи — щоб Tailwind JIT їх згенерував.
  const ui = isIn
    ? { head: 'text-green-700', ring: 'focus:ring-green-500' }
    : { head: 'text-purple-700', ring: 'focus:ring-purple-500' };
  const title = isIn ? 'Підкріплення каси' : 'Інкасація';
  const sourceLabel = isIn ? 'Джерело' : 'Призначення';

  // За замовчуванням — гривня (найчастіший випадок для підкріплення/інкасації).
  const [currency, setCurrency] = useState(
    currencies.includes('UAH') ? 'UAH' : (currencies[0] ?? 'UAH'),
  );
  const [amount, setAmount] = useState('');
  const [source, setSource] = useState(SOURCE_CATEGORIES[0]);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Баланс банку — показуємо касиру лише якщо ввімкнено в налаштуваннях і обрано «Банк».
  const [bankBalances, setBankBalances] = useState<Record<string, number> | null>(null);
  // Банк може бути вимкнений адміном — тоді джерела «Банк» узагалі немає.
  const [bankEnabled, setBankEnabled] = useState(true);
  // «Коригування» — окремий інструмент вирівнювання каси (не чіпає банк).
  const [adjustEnabled, setAdjustEnabled] = useState(false);
  const sources = [
    ...(bankEnabled ? SOURCE_CATEGORIES : SOURCE_CATEGORIES.filter((c) => c !== 'Банк')),
    ...(adjustEnabled ? [ADJUST_SOURCE] : []),
  ];

  useEffect(() => {
    api.get('/settings/balance-edit')
      .then(({ data }) => setAdjustEnabled(!!data.enabled))
      .catch(() => {});

    api.get('/settings/cash-bank-enabled').then(({ data }) => {
      setBankEnabled(!!data.enabled);
      if (!data.enabled) setSource('Інше');
    }).catch(() => {});

    api.get('/settings/cashier-see-bank').then(({ data }) => {
      if (data.enabled) {
        api.get('/cash-bank').then(({ data: b }) => {
          const map: Record<string, number> = {};
          for (const c of b.currencies) map[c.currency] = c.amount;
          setBankBalances(map);
        }).catch(() => {});
      }
    }).catch(() => {});
  }, []);

  const have = balance[currency] ?? 0;
  const parsed = parseFloat(amount) || 0;
  // Перевірка залишку лише для інкасації (OUT).
  const warning = !isIn && parsed > have
    ? `Недостатньо ${currency}: в касі ${have.toFixed(2)}, інкасуєте ${parsed.toFixed(2)}`
    : '';

  const handleSave = async () => {
    if (!parsed || warning) return;
    setSaving(true);
    setError('');
    try {
      await api.post('/cash-movements', {
        shiftId, direction, currency, amount: parsed,
        source: source || undefined,
        // Контрагент «Банк» рухає глобальний банк готівки; решта — зовнішні мітки.
        counterparty: source === 'Банк' ? 'BANK' : 'EXTERNAL',
        note: note || undefined,
      });
      onSaved();
      onClose();
    } catch (e: any) {
      setError(e.response?.data?.message ?? 'Помилка');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md flex flex-col max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 pb-3 border-b border-gray-100">
          <div className={`text-sm font-semibold ${ui.head} uppercase tracking-wider`}>{title}</div>
          <p className="text-sm text-gray-500 mt-1">
            {isIn
              ? 'Готівка приходить у касу (з банку / офісу / іншої каси). Збільшує залишок каси, але не впливає на прибуток зміни.'
              : 'Вилучення готівки з каси (в банк / офіс / сейф). Зменшує залишок каси, але не впливає на прибуток зміни.'}
          </p>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto">
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-sm text-gray-600 mb-1">Валюта</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className={`w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 ${ui.ring}`}
              >
                {currencies.map((c) => (
                  <option key={c} value={c}>{c} (в касі {fmtInt(balance[c] ?? 0)})</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-sm text-gray-600 mb-1">Сума</label>
              <input
                type="number"
                min="0"
                step="1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className={`w-full border rounded-lg px-3 py-2 text-right font-medium focus:outline-none focus:ring-2 ${
                  warning ? 'border-red-300 focus:ring-red-400 bg-red-50' : `border-gray-300 ${ui.ring}`
                }`}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">{sourceLabel}</label>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className={`w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 ${ui.ring}`}
            >
              {sources.map((c) => <option key={c}>{c}</option>)}
            </select>
            {source === 'Банк' && bankBalances && (
              <p className="text-xs text-gray-500 mt-1">
                У банку: <span className="font-semibold">{fmtMoney(bankBalances[currency] ?? 0)} {currency}</span>
              </p>
            )}
            {source === ADJUST_SOURCE && (
              <p className="text-xs text-amber-600 mt-1">
                Вирівнювання перерахунку каси. Банк не змінюється; запис лишиться в журналі.
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Примітка (необов'язково)</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={isIn ? 'Напр.: підкріплення з головної каси' : 'Напр.: інкасація в банк'}
              className={`w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 ${ui.ring}`}
            />
          </div>
          {warning && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-2.5 text-sm text-red-700">
              <span className="mt-0.5">⚠️</span><span>{warning}</span>
            </div>
          )}
          {error && <p className="text-red-500 text-sm">{error}</p>}

          {movements.length > 0 && (
            <div className="pt-2">
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Рух готівки за зміну</div>
              <div className="divide-y divide-gray-100 max-h-40 overflow-y-auto">
                {movements.map((m) => (
                  <div key={m.id} className="flex items-center justify-between py-1.5 text-sm">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
                        m.direction === 'IN' ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700'
                      }`}>
                        {m.direction === 'IN' ? 'Підкр.' : 'Інкас.'}
                      </span>
                      <span className="font-semibold text-gray-800">{Number(m.amount).toFixed(2)} {m.currency}</span>
                      {(m.source || m.note) && (
                        <span className="text-gray-400 italic">{[m.source, m.note].filter(Boolean).join(' · ')}</span>
                      )}
                    </div>
                    <span className="text-xs text-gray-400">{format(new Date(m.createdAt), 'HH:mm')}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 transition">
            Скасувати
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !parsed || !!warning}
            className={`px-4 py-2 text-white rounded-lg font-semibold disabled:opacity-50 transition ${
              isIn ? 'bg-green-600 hover:bg-green-700' : 'bg-purple-600 hover:bg-purple-700'
            }`}
          >
            {saving ? 'Збереження...' : (isIn ? 'Підкріпити' : 'Інкасувати')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Модалка звірки залишку (проміжна, зі збереженням) ────────────────────────
// Дозволяє касиру впродовж дня порівняти розрахунковий (CMS) залишок із фактичним
// перерахунком готівки по кожній валюті, побачити розбіжності й зберегти звірку
// (її бачить адмін по кожній касі).
type ReconHistory = { id: number; createdAt: string; actual: Record<string, number>; hasDiscrepancy: boolean };

function ReconcileModal({
  shiftId, expectedBalance, startBalance, currencies, onClose, onSave,
}: {
  shiftId: number;
  expectedBalance: Record<string, number>;
  startBalance: Record<string, number>;
  currencies: string[];
  onClose: () => void;
  onSave: (expected: Record<string, number>, actual: Record<string, number>) => Promise<void>;
}) {
  const [actual, setActual] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<ReconHistory[]>([]);

  // Попередні звірки цієї зміни (від найстарішої до найновішої) — окремими колонками.
  useEffect(() => {
    api.get(`/reconciliations?shiftId=${shiftId}`)
      .then(({ data }) => setHistory([...data].reverse()))
      .catch(() => setHistory([]));
  }, [shiftId]);

  const rows = currencies.map((cur) => {
    const start = Number(startBalance[cur] ?? 0);
    const expected = Number(expectedBalance[cur] ?? 0);
    const raw = actual[cur];
    const entered = raw !== undefined && raw !== '';
    const act = parseFloat(raw ?? '') || 0;
    const diff = act - expected;
    const hasDiff = entered && Math.abs(diff) >= 0.01;
    return { cur, start, expected, entered, diff, hasDiff };
  });

  const checked = rows.filter((r) => r.entered);
  const mismatches = rows.filter((r) => r.hasDiff);

  const handleSave = async () => {
    setSaving(true);
    try {
      // Зберігаємо лише перевірені валюти (які касир реально перерахував).
      const expected: Record<string, number> = {};
      const actualNums: Record<string, number> = {};
      for (const r of checked) {
        expected[r.cur] = r.expected;
        actualNums[r.cur] = parseFloat(actual[r.cur]) || 0;
      }
      await onSave(expected, actualNums);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-[90vw] max-w-[90vw] max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 pb-3 text-center border-b border-gray-100">
          <div className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-1">Звірка залишку</div>
          <p className="text-sm text-gray-500">
            Перерахуйте готівку й уведіть фактичну суму по кожній валюті. Система покаже розбіжність із розрахунковим залишком. Звірку буде збережено.
          </p>
        </div>

        <div className="overflow-auto px-6 py-4">
          <table className="w-full text-sm border-collapse border border-gray-200 [&_th]:border [&_th]:border-gray-200 [&_td]:border [&_td]:border-gray-200">
            <thead>
              <tr className="text-xs text-gray-900 uppercase tracking-wide bg-gray-50">
                <th className="py-1 px-2 text-left font-semibold">Валюта</th>
                <th className="py-1 px-2 text-right font-semibold">На початок</th>
                {history.map((h) => (
                  <th key={h.id} className="py-1 px-2 text-right font-semibold whitespace-nowrap" title={`Звірка ${format(new Date(h.createdAt), 'dd.MM HH:mm')}`}>
                    {format(new Date(h.createdAt), 'HH:mm')}
                    {h.hasDiscrepancy && <span className="text-red-500" title="Були розбіжності"> ⚠</span>}
                  </th>
                ))}
                <th className="py-1 px-2 text-right font-semibold">Очікувано</th>
                <th className="py-1 px-2 text-right font-semibold">Фактично</th>
                <th className="py-1 px-2 text-right font-semibold">Різниця</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.cur} className={r.hasDiff ? 'bg-red-50' : r.entered ? 'bg-green-50' : ''}>
                  <td className="py-1 px-2 font-bold text-gray-800">
                    <span className="inline-flex items-center gap-2"><Flag currency={r.cur} /> {r.cur}</span>
                  </td>
                  <td className="py-1 px-2 text-right text-gray-500 tabular-nums">{r.start.toFixed(2)}</td>
                  {history.map((h) => {
                    const v = h.actual?.[r.cur];
                    return (
                      <td key={h.id} className="py-1 px-2 text-right text-gray-600 tabular-nums">
                        {v === undefined ? '—' : Number(v).toFixed(2)}
                      </td>
                    );
                  })}
                  <td className="py-1 px-2 text-right font-medium text-blue-700 tabular-nums">{r.expected.toFixed(2)}</td>
                  <td className="py-1 px-2 text-right">
                    <input
                      type="number"
                      step="0.01"
                      value={actual[r.cur] ?? ''}
                      onChange={(e) => setActual((p) => ({ ...p, [r.cur]: e.target.value }))}
                      placeholder={r.expected.toFixed(2)}
                      className={`w-32 border rounded px-2 py-1 text-right font-medium tabular-nums focus:outline-none focus:ring-2 ${
                        r.hasDiff ? 'border-red-300 focus:ring-red-400 bg-red-50' : 'border-gray-300 focus:ring-blue-400'
                      }`}
                    />
                  </td>
                  <td className={`py-1 px-2 text-right font-semibold tabular-nums ${
                    !r.entered ? 'text-gray-300' : r.hasDiff ? (r.diff > 0 ? 'text-green-600' : 'text-red-600') : 'text-green-600'
                  }`}>
                    {!r.entered ? '—' : r.hasDiff ? (r.diff > 0 ? '+' : '') + r.diff.toFixed(2) : '✓'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="px-6 py-4 border-t border-gray-100 space-y-3">
          {checked.length > 0 && (
            mismatches.length > 0 ? (
              <div className="bg-red-50 border border-red-200 rounded px-3 py-2 text-sm text-red-700">
                ⚠️ Розбіжності у {mismatches.length} {mismatches.length === 1 ? 'валюті' : 'валютах'}: {mismatches.map((m) => `${m.cur} ${m.diff > 0 ? '+' : ''}${m.diff.toFixed(2)}`).join(', ')}
              </div>
            ) : (
              <div className="bg-green-50 border border-green-200 rounded px-3 py-2 text-sm text-green-700">
                ✓ Усі перевірені валюти ({checked.length}) збігаються з розрахунковим залишком.
              </div>
            )
          )}
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="px-3 py-1 border border-gray-300 rounded text-lg text-gray-600 hover:bg-gray-50 transition">
              Скасувати
            </button>
            <button
              onClick={handleSave}
              disabled={saving || checked.length === 0}
              className="px-3 py-1 bg-blue-700 hover:bg-blue-800 text-white rounded text-lg font-semibold disabled:opacity-50 transition"
            >
              {saving ? 'Збереження...' : 'Зберегти звірку'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
