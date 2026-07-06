# Деплой на Railway

Проєкт — два сервіси (backend, frontend) + Postgres. Railway збирає кожен сервіс
із його Dockerfile (перевірено: образи збираються, backend на чистій БД сам
застосовує всі міграції і створює дефолт-адміна `admin / admin123`).

## 1. Postgres
Add → Database → PostgreSQL. Railway дасть змінну `DATABASE_URL`.

## 2. Сервіс backend
- **Root Directory:** `backend`
- **Змінні:**
  - `DATABASE_URL` = референс на Postgres (`${{Postgres.DATABASE_URL}}`)
  - `JWT_SECRET` = довгий випадковий рядок (ОБОВʼЯЗКОВО — без нього прод падає навмисне)
  - `NODE_ENV` = `production`
  - `PORT` — Railway ставить сам; код його читає
  - *(Telegram — краще налаштувати в адмінці; або задати `TELEGRAM_BOT_TOKEN` / `TELEGRAM_ADMIN_CHAT_ID`)*
- Міграції застосовуються автоматично на старті (CMD Dockerfile).

## 3. Сервіс frontend
- **Root Directory:** `frontend`
- **Build-змінна:** `VITE_API_URL` = публічний URL backend + `/api`
  (напр. `https://<backend>.up.railway.app/api`).
  nginx фронта роздає лише статику й НЕ проксує `/api`, тож фронт звертається
  до backend напряму — CORS на бекенді відкритий (`*`), тому працює.
- `PORT` — Railway ставить сам; nginx слухає його через envsubst.

## Порядок
1. Підняти Postgres → backend (дочекатись, поки в логах «LISTENING» і застосовані
   міграції) → взяти публічний URL backend.
2. Підняти frontend із `VITE_API_URL` = цей URL + `/api`.
3. Відкрити фронт, увійти `admin / admin123`, **одразу змінити пароль**,
   налаштувати Telegram у Налаштуваннях.

## Бекапи
Сервіс `backup` з docker-compose на Railway НЕ використовується (то для локалі/VPS).
На Railway вмикай вбудовані бекапи Postgres (плагін БД) або періодичний
`pg_dump` окремим cron-сервісом.

## Локальна перевірка образів (як на Railway)
```
docker build -t be ./backend
docker build --build-arg VITE_API_URL=https://x/api -t fe ./frontend
```
