// Нетто-передачі між касами по валютах (дзеркало backend/common/transfers.util.ts).
// Отримана передача (toDeskId == deskId) → +, відправлена (fromDeskId == deskId) → −.
// Передачі — це рух готівки між касами/точками, а не торговий прибуток.

export interface TransferRow {
  currency: string;
  amount: number | string;
  fromDeskId: number;
  toDeskId: number;
}

export function netTransfers(
  transfers: TransferRow[],
  deskId: number,
): Record<string, number> {
  const net: Record<string, number> = {};
  for (const t of transfers) {
    const amt = Number(t.amount);
    if (t.toDeskId === deskId) net[t.currency] = (net[t.currency] ?? 0) + amt;
    if (t.fromDeskId === deskId) net[t.currency] = (net[t.currency] ?? 0) - amt;
  }
  return net;
}
