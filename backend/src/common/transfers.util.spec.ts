import { netTransfers } from './transfers.util';

describe('transfers.util — netTransfers', () => {
  it('одностороння передача: +отримувачу, −відправнику', () => {
    const t = [{ currency: 'USD', amount: 200, fromDeskId: 9, toDeskId: 7 }];
    expect(netTransfers(t, 7)).toEqual({ USD: 200 });   // отримувач
    expect(netTransfers(t, 9)).toEqual({ USD: -200 });  // відправник
  });

  it('двовалютний своп: відправник −USD/+UAH, отримувач +USD/−UAH', () => {
    // Каса 9 віддає 10000 USD касі 7, отримує 244558 UAH назад.
    const t = [{
      currency: 'USD', amount: 10000, fromDeskId: 9, toDeskId: 7,
      counterCurrency: 'UAH', counterAmount: 244558,
    }];
    expect(netTransfers(t, 9)).toEqual({ USD: -10000, UAH: 244558 });
    expect(netTransfers(t, 7)).toEqual({ USD: 10000, UAH: -244558 });
  });

  it('накопичує кілька передач по валютах', () => {
    const t = [
      { currency: 'USD', amount: 100, fromDeskId: 1, toDeskId: 7 },
      { currency: 'USD', amount: 40, fromDeskId: 7, toDeskId: 2 },
    ];
    expect(netTransfers(t, 7)).toEqual({ USD: 60 });
  });
});
