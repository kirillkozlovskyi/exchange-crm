#!/usr/bin/env sh
# Бекап БД для Railway (та будь-якого середовища з DATABASE_URL) — без docker compose.
# Робить pg_dump за рядком підключення DATABASE_URL, стискає gzip, кладе у BACKUP_DIR
# з міткою часу й видаляє бекапи, старіші за BACKUP_KEEP_DAYS.
#
# Використання:
#   DATABASE_URL=postgres://user:pass@host:5432/db ./scripts/backup-railway.sh
#
# Змінні (з дефолтами):
#   BACKUP_DIR=./backups        — куди складати
#   BACKUP_KEEP_DAYS=14         — скільки днів тримати
#
# На Railway це запускають як окремий Cron-сервіс (див. docs/DEPLOY-RAILWAY.md).
# Потрібен клієнт postgresql (pg_dump) у середовищі виконання.
set -eu

: "${DATABASE_URL:?DATABASE_URL не задано}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"

mkdir -p "$BACKUP_DIR"
FILE="$BACKUP_DIR/crm_$(date +%Y%m%d_%H%M%S).sql.gz"

echo "→ Бекап у $FILE"
pg_dump "$DATABASE_URL" | gzip > "$FILE"
echo "✓ Готово: $(du -h "$FILE" | cut -f1)"

# Ротація: прибираємо старі бекапи.
find "$BACKUP_DIR" -name 'crm_*.sql.gz' -type f -mtime +"$KEEP_DAYS" -print -delete 2>/dev/null || true
echo "✓ Ротація: лишаємо останні $KEEP_DAYS днів"
