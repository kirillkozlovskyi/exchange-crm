// Нетто-передачі між касами по валютах (дзеркало backend/common/transfers.util.ts).
// Основне плече: отримана передача (toDeskId == deskId) → +, відправлена → −.
// Своп (counterCurrency/counterAmount): зустрічне плече йде від toDesk до fromDesk.
// Передачі — це рух готівки між касами/точками, а не торговий прибуток.

export interface TransferRow {
  currency: string;
  amount: number | string;
  fromDeskId: number;
  toDeskId: number;
  counterCurrency?: string | null;
  counterAmount?: number | string | null;
}

export function netTransfers(
  transfers: TransferRow[],
  deskId: number,
): Record<string, number> {
  const net: Record<string, number> = {};
  const add = (cur: string, amt: number) => { net[cur] = (net[cur] ?? 0) + amt; };
  for (const t of transfers) {
    const amt = Number(t.amount);
    if (t.toDeskId === deskId) add(t.currency, amt);
    if (t.fromDeskId === deskId) add(t.currency, -amt);
    if (t.counterCurrency && t.counterAmount != null) {
      const camt = Number(t.counterAmount);
      if (t.fromDeskId === deskId) add(t.counterCurrency, camt);
      if (t.toDeskId === deskId) add(t.counterCurrency, -camt);
    }
  }
  return net;
}
