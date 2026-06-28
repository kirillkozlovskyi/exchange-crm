import { cashMovementsDelta, applyCashMovements } from './cash-movements.util';

describe('cash-movements.util', () => {
  it('cashMovementsDelta — IN додає, OUT віднімає, з накопиченням', () => {
    const delta = cashMovementsDelta([
      { direction: 'IN', currency: 'USD', amount: 100 },   // підкріплення
      { direction: 'OUT', currency: 'USD', amount: 40 },   // інкасація
      { direction: 'IN', currency: 'UAH', amount: 5000 },
    ]);
    expect(delta).toEqual({ USD: 60, UAH: 5000 });
  });

  it('applyCashMovements — підкріплення збільшує, інкасація зменшує баланс', () => {
    const result = applyCashMovements({ USD: 500, UAH: 10000 }, [
      { direction: 'IN', currency: 'USD', amount: 200 },
      { direction: 'OUT', currency: 'UAH', amount: 3000 },
    ]);
    expect(result).toEqual({ USD: 700, UAH: 7000 });
  });

  it('порожній список не змінює баланс', () => {
    expect(applyCashMovements({ USD: 500 }, [])).toEqual({ USD: 500 });
  });
});
