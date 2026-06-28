import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useShiftHeader } from '../context/ShiftHeaderContext';
import api from '../api/axios';
import { format } from 'date-fns';
import OperationForm from '../components/cashier/OperationForm';
import OperationsList from '../components/cashier/OperationsList';
import TransferPanel from '../components/cashier/TransferPanel';
import OpenShiftForm from '../components/cashier/OpenShiftForm';
import CloseShiftForm from '../components/cashier/CloseShiftForm';
import Flag from '../components/Flag';
import { computeCurrentBalance } from '../lib/balance';
import { applyCashMovements, type CashDirection } from '../lib/cash-movements';

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
  const [quickAmounts, setQuickAmounts] = useState<number[]>([10, 20, 50, 100, 500]);
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
    } catch {
      setShift(null);
    }
  }, []);

  useEffect(() => {
    if (!selectedDeskId) return;
    loadShift(selectedDeskId);
    const interval = setInterval(() => loadShift(selectedDeskId), 30000);
    return () => clearInterval(interval);
  }, [selectedDeskId, loadShift]);

  const handleOpenShift = async (startBalance: Record<string, number>) => {
    await api.post('/shifts/open', { cashDeskId: selectedDeskId, startBalance });
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
  useEffect(() => {
    if (!selectedDeskId) return;
    const poll = async () => {
      try {
        const { data } = await api.get(`/transfers/pending?deskId=${selectedDeskId}`);
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
  // Залишок = початок + операції + рух готівки (підкріплення +, інкасація −).
  const currentBalance = useMemo(
    () => applyCashMovements(
      computeCurrentBalance(shift?.startBalance, shift?.operations),
      shift?.cashMovements,
    ),
    [shift],
  );

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

  // ── Кнопки (Операції / Передачі / Закрити зміну) — у хедер ────────────────
  useEffect(() => {
    const inWorkingView = !!shift && !closingShift && !!selectedDeskId;
    if (!inWorkingView) { setActions(null); return; }
    const tabCls = (active: boolean) =>
      `px-3 py-1 rounded text-sm font-medium transition ${active ? 'bg-blue-900' : 'hover:bg-blue-600'}`;
    setActions(
      <>
        <button onClick={() => setTab('operations')} className={tabCls(tab === 'operations')}>
          Операції
        </button>
        <button onClick={() => setTab('transfers')} className={`relative ${tabCls(tab === 'transfers')}`}>
          Передачі
          {pendingCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-xs font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
              {pendingCount}
            </span>
          )}
        </button>
        <button onClick={startClosing} className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-sm font-medium ml-2">
          Закрити зміну
        </button>
      </>
    );
    return () => setActions(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shift, closingShift, selectedDeskId, tab, pendingCount]);

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
  if (!shift) {
    return (
      <div className="p-6">
        <div className="max-w-lg mx-auto mb-4 mt-2">
          <button onClick={handleBackToPicker} className="text-sm text-gray-500 hover:text-gray-700">
            ← Змінити касу
          </button>
          <div className="text-sm text-gray-500 mt-1">
            {selectedPointName && <>{selectedPointName} · </>}
            <span className="font-semibold text-gray-700">{selectedDeskName}</span>
          </div>
        </div>
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
          onClose={handleCloseShift}
          onCancel={() => setClosingShift(false)}
        />
      </div>
    );
  }

  // ── Робоча зміна ───────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col flex-1 overflow-hidden">

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
              <OperationsList shiftId={shift.id} refresh={refreshOps} fullHeight rates={rates} onRefresh={() => loadShift(selectedDeskId!)} />
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
                    onClick={() => setCashMoveDir('IN')}
                    className="bg-green-600 hover:bg-green-700 text-white rounded text-base px-2 py-1 font-medium normal-case"
                  >
                    Підкріплення
                  </button>
                  <button
                    onClick={() => setCashMoveDir('OUT')}
                    className="bg-purple-600 hover:bg-purple-700 text-white rounded text-base px-2 py-1 font-medium normal-case"
                  >
                    Інкасація
                  </button>
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
                      <span className="text-xl font-bold text-blue-800">{Number(currentBalance['UAH']).toFixed(0)}</span>
                    </div>
                  )}
                  {Object.entries(currentBalance).filter(([c]) => c !== 'UAH').map(([cur, amt]) => (
                    <div key={cur} className="flex items-center py-1 px-1">
                      <span className="text-lg w-7 text-center"><Flag currency={cur} /></span>
                      <span className="font-bold text-lg flex-1 text-gray-800">{cur}</span>
                      <span className={`text-xl font-bold ${Number(amt) < 0 ? 'text-red-600' : 'text-blue-800'}`}>{Number(amt).toFixed(0)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Нова операція */}
            <OperationForm
              shiftId={shift.id}
              rates={rates}
              balance={currentBalance}
              quickAmounts={quickAmounts}
              activeCur={activeCur}
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

const SOURCE_CATEGORIES = ['Банк', 'Офіс', 'Власник', 'Інша каса', 'Інше'];

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
                  <option key={c} value={c}>{c} (в касі {Number(balance[c] ?? 0).toFixed(0)})</option>
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
              {SOURCE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
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
