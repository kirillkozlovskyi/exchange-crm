// Нетто-передачі між касами по валютах для конкретної каси.
// Основне плече: отримана передача (toDeskId == deskId) → +, відправлена → −.
// Двовалютний своп (counterCurrency/counterAmount): fromDesk отримує counter,
// toDesk віддає counter — тож додаємо зустрічне плече з протилежним знаком.
// Передачі НЕ є торговим прибутком — це рух готівки між касами/точками.

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
    // Основне плече: currency йде від fromDesk до toDesk.
    if (t.toDeskId === deskId) add(t.currency, amt);
    if (t.fromDeskId === deskId) add(t.currency, -amt);
    // Зустрічне плече свопу: counterCurrency йде від toDesk до fromDesk.
    if (t.counterCurrency && t.counterAmount != null) {
      const camt = Number(t.counterAmount);
      if (t.fromDeskId === deskId) add(t.counterCurrency, camt);
      if (t.toDeskId === deskId) add(t.counterCurrency, -camt);
    }
  }
  return net;
}
