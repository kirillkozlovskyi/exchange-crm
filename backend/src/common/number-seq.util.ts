/**
 * Наступний номер документа з PostgreSQL sequence — атомарно, без гонок
 * (замінює патерн count()+1, який під конкурентністю давав дублікати номерів
 * і падіння на unique constraint).
 *
 * Імена sequences створює міграція 20260705130000_number_sequences. Імʼя
 * підставляється лише з констант коду (не з вводу користувача).
 */
export type SequenceName =
  | 'operation_number_seq'
  | 'shift_number_seq'
  | 'transfer_number_seq'
  | 'cash_movement_in_seq'
  | 'cash_movement_out_seq'
  | 'usdt_number_seq';

interface RawQuerier {
  $queryRawUnsafe<T = unknown>(query: string): Promise<T>;
}

export async function nextDocNumber(prisma: RawQuerier, seq: SequenceName): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ nextval: bigint }[]>(
    `SELECT nextval('${seq}')`,
  );
  return Number(rows[0].nextval);
}
