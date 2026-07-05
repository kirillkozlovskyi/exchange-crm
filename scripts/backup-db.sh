#!/bin/sh
# Ручний бекап / відновлення БД обмінника.
#
#   ./scripts/backup-db.sh                 — зробити бекап зараз (у ./backups)
#   ./scripts/backup-db.sh restore FILE    — відновити з бекапу (ОБЕРЕЖНО:
#                                            повністю замінює поточну БД!)
#
# Працює через контейнер db (docker compose), креденшали з .env або дефолтні.
set -e
cd "$(dirname "$0")/.."

DB_USER="${DB_USER:-crm}"
DB_NAME="${DB_NAME:-currency_crm}"
mkdir -p backups

if [ "$1" = "restore" ]; then
  FILE="$2"
  [ -f "$FILE" ] || { echo "Файл не знайдено: $FILE"; exit 1; }
  echo "⚠️  Це ПОВНІСТЮ замінить базу «$DB_NAME» вмістом $FILE"
  printf "Введіть YES для підтвердження: "
  read -r ans
  [ "$ans" = "YES" ] || { echo "Скасовано."; exit 1; }
  # Зупиняємо бекенд, щоб не тримав з'єднання, дропаємо схему і відновлюємо.
  docker compose stop backend
  gunzip -c "$FILE" | docker compose exec -T db psql -U "$DB_USER" -d "$DB_NAME" \
    -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" >/dev/null
  gunzip -c "$FILE" | docker compose exec -T db psql -U "$DB_USER" -d "$DB_NAME" >/dev/null
  docker compose start backend
  echo "✅ Відновлено з $FILE"
  exit 0
fi

FILE="backups/currency_crm_$(date +%Y%m%d_%H%M%S).sql.gz"
docker compose exec -T db pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$FILE"
echo "✅ Бекап: $FILE ($(du -h "$FILE" | cut -f1))"
