-- Нумерація документів через sequences (замість count()+1, що дає дублікати
-- під конкурентністю). Ініціалізуємо з поточної кількості рядків, щоб серії
-- номерів продовжились без стрибків: nextval = кількість + 1.

CREATE SEQUENCE IF NOT EXISTS "operation_number_seq";
SELECT setval('operation_number_seq', (SELECT COUNT(*) FROM "Operation") + 1, false);

CREATE SEQUENCE IF NOT EXISTS "shift_number_seq";
SELECT setval('shift_number_seq', (SELECT COUNT(*) FROM "Shift") + 1, false);

CREATE SEQUENCE IF NOT EXISTS "transfer_number_seq";
SELECT setval('transfer_number_seq', (SELECT COUNT(*) FROM "Transfer") + 1, false);

CREATE SEQUENCE IF NOT EXISTS "cash_movement_in_seq";
SELECT setval('cash_movement_in_seq', (SELECT COUNT(*) FROM "CashMovement" WHERE direction = 'IN') + 1, false);

CREATE SEQUENCE IF NOT EXISTS "cash_movement_out_seq";
SELECT setval('cash_movement_out_seq', (SELECT COUNT(*) FROM "CashMovement" WHERE direction = 'OUT') + 1, false);

CREATE SEQUENCE IF NOT EXISTS "usdt_number_seq";
SELECT setval('usdt_number_seq', (SELECT COUNT(*) FROM "UsdtOperation") + 1, false);
