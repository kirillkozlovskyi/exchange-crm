import { parseRateCommand } from './telegram-bot.service';

/**
 * Парсер команди бота: від нього залежить, чи правильно змінить курс адмін із
 * телефона. Тому перевіряємо саме розбір форматів, а не просто «не впав».
 */
describe('parseRateCommand', () => {
  it('розбирає код точки + рядки «валюта купівля продаж»', () => {
    const r = parseRateCommand('Т2\nUSD 44.50 45.10\nEUR 51 51.8')!;
    expect(r.code).toBe('Т2');
    expect(r.rows).toEqual([
      { currency: 'USD', buy: 44.5, sell: 45.1 },
      { currency: 'EUR', buy: 51, sell: 51.8 },
    ]);
    expect(r.errors).toHaveLength(0);
  });

  it('кома як десятковий роздільник і нижній регістр валюти', () => {
    const r = parseRateCommand('ko\nusd 44,5 45,1')!;
    expect(r.code).toBe('KO');
    expect(r.rows[0]).toEqual({ currency: 'USD', buy: 44.5, sell: 45.1 });
  });

  it('зайві пробіли між колонками не заважають', () => {
    const r = parseRateCommand('Т2\nUSD    44.5     45.1')!;
    expect(r.rows[0]).toEqual({ currency: 'USD', buy: 44.5, sell: 45.1 });
  });

  it('неповний рядок → в errors, решта валідних застосовується', () => {
    const r = parseRateCommand('Т2\nUSD 44.5\nEUR 51 51.8')!;
    expect(r.rows).toEqual([{ currency: 'EUR', buy: 51, sell: 51.8 }]);
    expect(r.errors).toHaveLength(1);
  });

  it('відʼємний або нульовий курс відхиляється', () => {
    const r = parseRateCommand('Т2\nUSD -44 45\nEUR 51 0')!;
    expect(r.rows).toHaveLength(0);
    expect(r.errors).toHaveLength(2);
  });

  it('без другого рядка (лише код) → null (це не команда курсів)', () => {
    expect(parseRateCommand('Т2')).toBeNull();
    expect(parseRateCommand('')).toBeNull();
  });
});
