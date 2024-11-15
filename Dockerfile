# Используем официальный образ Node.js
FROM node:18

# Устанавливаем рабочую директорию
WORKDIR /app

# Копируем package.json и package-lock.json в рабочую директорию
COPY package*.json ./

# Устанавливаем зависимости
RUN npm install

# Копируем файлы проекта
COPY . .

# Открываем порт для приложения
EXPOSE 3000

# Команда запуска приложения (указываем путь к bot.js в папке app)
CMD ["node", "app/bot.js"]