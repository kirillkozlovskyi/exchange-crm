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
  const { setInfo } = useShiftHeader();

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
  const [mobileView, setMobileView] = useState<'form' | 'list'>('form');

  // Редагування балансу
  const [balanceEditEnabled, setBalanceEditEnabled] = useState(true);
  const [showBalanceModal, setShowBalanceModal] = useState(false);
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
        api.get('/settings/balance-edit').then(({ data }) => setBalanceEditEnabled(data.enabled)).catch(() => {});
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
  const currentBalance = useMemo(() => {
    const bal: Record<string, number> = { ...(shift?.startBalance as Record<string, number> ?? {}) };
    for (const op of shift?.operations ?? []) {
      if ((op as any).cancelled) continue; // скасовані операції не враховуються
      const cur = op.currency;
      if (op.type === 'BUY') {
        bal[cur] = (bal[cur] ?? 0) + Number(op.amount);
        bal['UAH'] = (bal['UAH'] ?? 0) - Number(op.totalUah);
      } else {
        bal[cur] = (bal[cur] ?? 0) - Number(op.amount);
        bal['UAH'] = (bal['UAH'] ?? 0) + Number(op.totalUah);
      }
    }
    return bal;
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

  // ── Мапи прапорів ─────────────────────────────────────────────────────────
  const FLAG: Record<string, string> = {
    USD: '🇺🇸', EUR: '🇪🇺', PLN: '🇵🇱', GBP: '🇬🇧',
    CHF: '🇨🇭', CAD: '🇨🇦', CZK: '🇨🇿', UAH: '🇺🇦',
    HUF: '🇭🇺', RON: '🇷🇴', NOK: '🇳🇴', SEK: '🇸🇪',
  };

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
              <p className="text-amber-600 text-sm text-center py-4 bg-amber-50 rounded-lg">
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
                      className="w-full flex items-center justify-between border border-blue-200 hover:border-blue-500 hover:bg-blue-50 rounded-lg px-4 py-3 text-left transition"
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
        <OpenShiftForm rates={rates} onOpen={handleOpenShift} />
      </div>
    );
  }

  // ── Закриття зміни ─────────────────────────────────────────────────────────
  if (closingShift) {
    return (
      <div className="p-6 max-w-3xl mx-auto mt-4">
        <CloseShiftForm
          shift={shift}
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

      {/* ── Підшапка зміни ──────────────────────────────────────────────── */}
      <div className="bg-white border-b border-gray-200 px-3 py-2 flex items-center gap-3 flex-wrap">

        {/* Перемикач форма/список — тільки на мобільному коли в Operations */}
        {tab === 'operations' && (
          <div className="flex lg:hidden items-center gap-1 bg-gray-100 rounded-lg p-0.5 flex-shrink-0">
            <button
              onClick={() => setMobileView('form')}
              className={`px-3 py-1 rounded-md text-xs font-medium transition ${mobileView === 'form' ? 'bg-white shadow text-blue-700' : 'text-gray-600'}`}
            >
              ✏️ Форма
            </button>
            <button
              onClick={() => setMobileView('list')}
              className={`px-3 py-1 rounded-md text-xs font-medium transition ${mobileView === 'list' ? 'bg-white shadow text-blue-700' : 'text-gray-600'}`}
            >
              📋 Список
            </button>
          </div>
        )}

        {/* Залишок в касі — ліворуч, займає весь доступний простір */}
        <div className="flex items-center gap-2 flex-1 min-w-0 overflow-x-auto scrollbar-none">
          <span className="text-lg font-semibold text-gray-800 whitespace-nowrap flex-shrink-0 hidden sm:block">Залишок в касі:</span>
          {currentBalance['UAH'] !== undefined && (
            <div className="flex-shrink-0 bg-blue-50 border border-blue-200 rounded-lg px-3 py-1.5">
              <span className="font-bold text-lg text-blue-800">UAH: </span>
              <span className="font-bold text-lg text-blue-800">{Number(currentBalance['UAH']).toFixed(0)}</span>
            </div>
          )}
          {Object.entries(currentBalance).filter(([c]) => c !== 'UAH').map(([cur, amt]) => (
            <div key={cur} className="flex-shrink-0 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5">
              <span className="font-bold text-lg text-blue-800">{FLAG[cur] ?? ''} {cur}: </span>
              <span className={`font-bold text-lg ${Number(amt) < 0 ? 'text-red-600' : 'text-blue-800'}`}>{Number(amt).toFixed(0)}</span>
            </div>
          ))}
          {balanceEditEnabled && (
            <button
              onClick={() => setShowBalanceModal(true)}
              className="flex-shrink-0 text-gray-400 hover:text-blue-600 transition text-lg px-1"
              title="Коригувати залишок"
            >✏️</button>
          )}
        </div>

        {/* Таби + Закрити зміну — праворуч */}
        <div className="flex items-center gap-2 flex-shrink-0 ml-auto">
          <button onClick={() => setTab('operations')}
            className={`px-4 py-1.5 rounded-lg font-medium text-lg transition ${tab === 'operations' ? 'bg-blue-700 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
            Операції
          </button>
          <button onClick={() => setTab('transfers')}
            className={`relative px-4 py-1.5 rounded-lg font-medium text-lg transition ${tab === 'transfers' ? 'bg-blue-700 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
            Передачі
            {pendingCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-xs font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                {pendingCount}
              </span>
            )}
          </button>
          <button onClick={() => setClosingShift(true)}
            className="bg-red-600 hover:bg-red-700 text-white px-4 py-1.5 rounded-lg text-lg font-medium ml-4">
            Закрити зміну
          </button>
        </div>
      </div>

      {/* ── Основний контент ────────────────────────────────────────────── */}
      {tab === 'operations' && (
        <div className="flex flex-1 min-h-0">

          {/* Ліва колонка — список операцій: прихована на мобільному коли активна форма */}
          <div className={`
            lg:flex lg:w-1/2 lg:border-r lg:border-gray-200 lg:overflow-hidden lg:bg-white
            ${mobileView === 'list' ? 'flex flex-1 overflow-hidden bg-white' : 'hidden'}
          `}>
            <div className="w-full h-full">
              <OperationsList shiftId={shift.id} refresh={refreshOps} fullHeight rates={rates} onRefresh={() => loadShift(selectedDeskId!)} />
            </div>
          </div>

          {/* Права колонка — курси + нова операція: прихована на мобільному коли активний список */}
          <div className={`
            lg:flex lg:flex-col lg:w-1/2 lg:overflow-y-auto lg:bg-gray-50
            ${mobileView === 'form' ? 'flex flex-col flex-1 overflow-y-auto bg-gray-50' : 'hidden'}
          `}>

            {/* Блок курсів */}
            <div className="bg-white border-b border-gray-200 p-3 sm:p-4">
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Курси валют</div>
              <div className="space-y-0.5">
                {rates.map((r) => (
                  <div
                    key={r.currency}
                    onClick={() => setActiveCur(r.currency)}
                    className={`flex items-center gap-2 sm:gap-3 py-0.5 border-b border-gray-100 last:border-0 cursor-pointer rounded-lg px-1 transition ${
                      activeCur === r.currency ? 'bg-blue-50 border-blue-200' : 'hover:bg-gray-50'
                    }`}
                  >
                    <span className="text-base sm:text-lg w-6 sm:w-8 text-center">{FLAG[r.currency] ?? '💱'}</span>
                    <span className={`font-bold text-sm sm:text-lg w-10 sm:w-12 ${activeCur === r.currency ? 'text-blue-700' : 'text-gray-800'}`}>{r.currency}</span>
                    <div className="flex gap-3 sm:gap-4 ml-auto">
                      <div className="text-right">
                        <div className="text-xs text-gray-400">Купівля</div>
                        <div className="text-base sm:text-2xl font-bold text-green-700">{Number(r.buy).toFixed(2)}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-gray-400">Продаж</div>
                        <div className="text-base sm:text-2xl font-bold text-red-600">{Number(r.sell).toFixed(2)}</div>
                      </div>
                    </div>
                  </div>
                ))}
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

      {/* ── Модалка редагування залишку ───────────────────────────────── */}
      {showBalanceModal && (
        <BalanceEditModal
          currentBalance={currentBalance}
          currencies={['UAH', ...rates.map((r: any) => r.currency)]}
          flag={FLAG}
          onClose={() => setShowBalanceModal(false)}
          onSave={async (newBalance) => {
            await api.patch(`/shifts/${shift.id}/adjust-balance`, { balance: newBalance });
            await loadShift(selectedDeskId!);
            setShowBalanceModal(false);
          }}
        />
      )}
    </div>
  );
}

// ── Модалка коригування залишку ──────────────────────────────────────────────
function BalanceEditModal({
  currentBalance, currencies, flag, onClose, onSave,
}: {
  currentBalance: Record<string, number>;
  currencies: string[];
  flag: Record<string, string>;
  onClose: () => void;
  onSave: (balance: Record<string, number>) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(currencies.map((c) => [c, (currentBalance[c] ?? 0).toFixed(0)]))
  );
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const parsed: Record<string, number> = {};
      for (const [cur, val] of Object.entries(values)) {
        parsed[cur] = parseFloat(val) || 0;
      }
      await onSave(parsed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6 space-y-5" onClick={(e) => e.stopPropagation()}>
        <div className="text-center">
          <div className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-1">Коригування залишків</div>
          <p className="text-lg text-gray-500">Введіть фактичний залишок у кожній валюті</p>
        </div>

        <div className="space-y-3">
          {currencies.map((cur) => (
            <div key={cur} className="flex items-center gap-4">
              <span className="text-2xl w-8 text-center">{flag[cur] ?? ''}</span>
              <span className="w-14 font-bold text-gray-700 text-lg">{cur}</span>
              <input
                type="number"
                step="1"
                value={values[cur] ?? '0'}
                onChange={(e) => setValues((prev) => ({ ...prev, [cur]: e.target.value }))}
                className="flex-1 border border-gray-300 rounded-lg px-4 py-2.5 text-right font-bold text-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
          ))}
        </div>

        <div className="flex gap-3 pt-1">
          <button onClick={onClose} className="flex-1 px-4 py-3 border border-gray-300 rounded-lg text-lg text-gray-600 hover:bg-gray-50 transition">
            Скасувати
          </button>
          <button onClick={handleSave} disabled={saving} className="flex-1 px-4 py-3 bg-blue-700 hover:bg-blue-800 text-white rounded-lg text-lg font-bold disabled:opacity-50 transition">
            {saving ? 'Збереження...' : 'Зберегти'}
          </button>
        </div>
      </div>
    </div>
  );
}
