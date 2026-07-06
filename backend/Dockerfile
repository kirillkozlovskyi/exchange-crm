FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npx prisma generate
RUN npm run build

EXPOSE 4000

# На старті застосовуємо міграції (створює нові таблиці на чистій БД Railway),
# потім піднімаємо застосунок. Railway використовує саме цей CMD.
CMD sh -c "npx prisma migrate deploy && node --max-old-space-size=384 dist/src/main.js"
