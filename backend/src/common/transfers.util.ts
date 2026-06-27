// Нетто-передачі між касами по валютах для конкретної каси.
// Отримана передача (toDeskId == deskId) → +, відправлена (fromDeskId == deskId) → −.
// Передачі НЕ є торговим прибутком — лише рух готівки між касами/точками,
// тож при розрахунку фактичного результату зміни їх вилучають із залишку.

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
