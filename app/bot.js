require('dotenv').config(); // Загрузка переменных окружения
require('../db/initDatabase'); // Инициализация базы данных
const https = require('https');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const { Pool } = require('pg');
const initializeDatabase = require('../db/initDatabase');
const schedule = require('node-schedule');
const moment = require('moment');

const db = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

(async () => {
    try {
        await initializeDatabase();
        console.log('[Bot] База данных инициализирована.');
    } catch (error) {
        console.error('[Database] Ошибка инициализации:', error);
    }
})();

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
console.log("[Bot] Telegram бот успешно запущен.");

const userStates = {}; // Хранение состояний пользователей

// ====================== ОБРАБОТЧИКИ КОМАНД ======================

// Обработчик команды /start
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    console.log(`[Bot] Получена команда /start от пользователя ID: ${chatId}`);

    try {
        // Получаем роль пользователя
        const role = await getRole(chatId);
        console.log(`[Debug] Роль пользователя: ${role}`);

        // Формируем клавиатуру в зависимости от роли
        let keyboard = [];
        if (role === 'admin') {
            keyboard = [
                [{ text: 'Сервер' }],
                [{ text: 'Создать ключ' }],
                [{ text: 'Шаблоны оплаты' }],
                [{ text: 'Менеджеры' }],
                [{ text: 'Настройки цен' }]
            ];
        } else if (role === 'manager') {
            keyboard = [
                [{ text: 'Создать ключ' }],
                [{ text: 'Шаблоны оплаты' }]
            ];
        } else if (role === 'user') {
            keyboard = [
                [{ text: 'Создать ключ' }]
            ];
        }

        // Отправляем приветственное сообщение с клавиатурой
        await bot.sendMessage(chatId, 'Добро пожаловать в RaphaelVPN Bot! Выберите действие:', {
            reply_markup: {
                keyboard: keyboard,
                resize_keyboard: true,
                one_time_keyboard: false
            }
        });
        console.log('[Bot] Главное меню отправлено пользователю.');
    } catch (error) {
        console.error('[Bot] Ошибка при обработке команды /start:', error);
        await bot.sendMessage(chatId, 'Произошла ошибка при обработке команды. Попробуйте позже.');
    }
});

// Обработчик текстовых сообщений
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const userState = userStates[chatId];

    try {
        console.log(`[Debug] Проверяем роль пользователя ID: ${userId}`);
        const role = await getRole(userId);
        console.log(`[Debug] Роль пользователя: ${role}`);

        // Проверка этапов
        if (userState.step === 'set_year_price') {
            const yearPrice = parseInt(msg.text.replace(/\D/g, ''), 10);
            if (isNaN(yearPrice)) {
                return bot.sendMessage(chatId, 'Введите корректное число для цены за год:');
            }

            userState.yearPrice = yearPrice;
            userState.step = 'set_six_months_price';
            return bot.sendMessage(chatId, 'Введите цену за 6 месяцев:');
        }

        if (userState.step === 'set_six_months_price') {
            const sixMonthsPrice = parseInt(msg.text.replace(/\D/g, ''), 10);
            if (isNaN(sixMonthsPrice)) {
                return bot.sendMessage(chatId, 'Введите корректное число для цены за 6 месяцев:');
            }

            userState.sixMonthsPrice = sixMonthsPrice;
            userState.step = 'set_three_months_price';
            return bot.sendMessage(chatId, 'Введите цену за 3 месяца:');
        }

        if (userState.step === 'set_three_months_price') {
            const threeMonthsPrice = parseInt(msg.text.replace(/\D/g, ''), 10);
            if (isNaN(threeMonthsPrice)) {
                return bot.sendMessage(chatId, 'Введите корректное число для цены за 3 месяца:');
            }

            // Сохраняем цены в базу данных
            userState.threeMonthsPrice = threeMonthsPrice;

            const { yearPrice, sixMonthsPrice, threeMonthsPrice } = userState;

            // Обновляем цены в таблице `prices`
            await db.query(`UPDATE prices SET price = $1 WHERE role = $2 AND duration = $3`, [yearPrice, 'user', 'year']);
            await db.query(`UPDATE prices SET price = $1 WHERE role = $2 AND duration = $3`, [sixMonthsPrice, 'user', 'six_months']);
            await db.query(`UPDATE prices SET price = $1 WHERE role = $2 AND duration = $3`, [threeMonthsPrice, 'user', 'three_months']);

            delete userStates[chatId];
            return bot.sendMessage(chatId, `Цены успешно обновлены:\n\nГод: ${yearPrice}₽\n6 месяцев: ${sixMonthsPrice}₽\n3 месяца: ${threeMonthsPrice}₽`);
        }

        // Обработка сообщения в зависимости от текста
        if (msg.text === 'Менеджеры') {
            if (role !== 'admin') {
                return bot.sendMessage(chatId, 'У вас нет доступа к этой функции.');
            }

            return bot.sendMessage(chatId, 'Управление менеджерами:', {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Добавить менеджера', callback_data: 'add_manager' }],
                        [{ text: 'Список менеджеров', callback_data: 'list_managers' }]
                    ]
                }
            });
        }

        console.log(`[Bot] Получено сообщение: "${msg.text}" от пользователя ID: ${userId}`);

        if (msg.text === 'Настройки цен') {
            if (role !== 'admin') {
                return bot.sendMessage(chatId, 'У вас нет доступа к этой функции.');
            }

            return bot.sendMessage(chatId, 'Выберите роль для изменения цен:', {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Цена для Пользователей', callback_data: 'set_price_user' }],
                        [{ text: 'Цена для Менеджеров', callback_data: 'set_price_manager' }]
                    ]
                }
            });
        }

        if (userState?.step === 'awaiting_manager_name') {
            userStates[chatId] = { step: 'awaiting_manager_id_or_phone', name: msg.text };
            await bot.sendMessage(chatId, `Имя "${msg.text}" сохранено. Теперь введите ID или номер телефона менеджера:`);
        } else if (userState?.step === 'awaiting_manager_id_or_phone') {
            const input = msg.text;
            const name = userState.name;

            try {
                if (!isNaN(input)) {
                    const managerId = parseInt(input, 10);
                    await db.query(
                        'INSERT INTO users (id, first_name, role) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET first_name = $2, role = $3',
                        [managerId, name, 'manager']
                    );
                    await bot.sendMessage(chatId, `Менеджер "${name}" с ID ${managerId} успешно добавлен.`);
                } else if (input.startsWith('+')) {
                    const generatedId = Date.now();
                    await db.query(
                        'INSERT INTO users (id, first_name, phone, role) VALUES ($1, $2, $3, $4) ON CONFLICT (phone) DO UPDATE SET first_name = $2, role = $4',
                        [generatedId, name, input, 'manager']
                    );
                    await bot.sendMessage(chatId, `Менеджер "${name}" с номером телефона ${input} успешно добавлен.`);
                } else {
                    await bot.sendMessage(chatId, 'Некорректный ввод. Укажите ID или номер телефона корректно.');
                    return;
                }
            } catch (error) {
                console.error('[Database] Ошибка добавления менеджера:', error);
                await bot.sendMessage(chatId, 'Ошибка при добавлении менеджера.');
            }

            delete userStates[chatId];
        }

        if (userState?.step === 'delete_manager') {
            const input = msg.text;

            try {
                if (!isNaN(input)) {
                    const result = await db.query('DELETE FROM users WHERE id = $1 AND role = $2', [input, 'manager']);
                    if (result.rowCount > 0) {
                        await bot.sendMessage(chatId, `Менеджер с ID ${input} успешно удалён.`);
                    } else {
                        await bot.sendMessage(chatId, `Менеджер с ID ${input} не найден.`);
                    }
                } else if (input.startsWith('+')) {
                    const result = await db.query('DELETE FROM users WHERE phone = $1 AND role = $2', [input, 'manager']);
                    if (result.rowCount > 0) {
                        await bot.sendMessage(chatId, `Менеджер с номером телефона ${input} успешно удалён.`);
                    } else {
                        await bot.sendMessage(chatId, `Менеджер с номером телефона ${input} не найден.`);
                    }
                } else {
                    await bot.sendMessage(chatId, 'Некорректный ввод. Введите ID или номер телефона.');
                }
            } catch (error) {
                console.error('[Database] Ошибка удаления менеджера:', error);
                await bot.sendMessage(chatId, 'Ошибка при удалении менеджера.');
            }

            delete userStates[chatId];
        }

        // Обработка сообщения, если администратор вводит цены
        if (userState?.step === 'set_price') {
            const input = parseFloat(msg.text);

            if (isNaN(input) || input <= 0) {
                await bot.sendMessage(chatId, 'Пожалуйста, введите корректную цену (число больше 0).');
                return;
            }

            // Сохраняем цену для текущего этапа
            userState.prices[userState.currentStep] = input;

            // Переходим к следующему этапу
            const steps = ['year', 'six_months', 'three_months'];
            const currentStepIndex = steps.indexOf(userState.currentStep);

            if (currentStepIndex < steps.length - 1) {
                userState.currentStep = steps[currentStepIndex + 1];
                await bot.sendMessage(chatId, `Введите цену за ${userState.currentStep === 'six_months' ? '6 месяцев' : '3 месяца'}:`);
            } else {
                // Все цены введены, сохраняем в базу данных
                const { year, six_months, three_months } = userState.prices;
                const targetRole = userState.targetRole;

                try {
                    await db.query(
                        `UPDATE prices SET year = $1, six_months = $2, three_months = $3 WHERE role = $4`,
                        [year, six_months, three_months, targetRole]
                    );

                    await bot.sendMessage(chatId, `Цены для роли ${targetRole} успешно обновлены:\n- Год: ${year}₽\n- 6 месяцев: ${six_months}₽\n- 3 месяца: ${three_months}₽.`);
                } catch (error) {
                    console.error('[Database] Ошибка обновления цен:', error);
                    await bot.sendMessage(chatId, 'Произошла ошибка при обновлении цен. Попробуйте позже.');
                }

                // Сброс состояния
                delete userStates[chatId];
            }

            return;
        }
        // Меню настроек цен
        if (msg.text === 'Настройки цен' && role === 'admin') {
            await bot.sendMessage(chatId, 'Выберите, для кого изменить цены:', {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Пользователи', callback_data: 'set_price_user' }],
                        [{ text: 'Менеджеры', callback_data: 'set_price_manager' }],
                    ]
                }
            });
            return;
        }
        // Проверяем состояние пользователя
        if (userState?.step === 'awaiting_receipt') {
            if (msg.photo || msg.document) {
                const adminId = process.env.ADMIN_ID;
                const fileId = msg.photo ? msg.photo[msg.photo.length - 1].file_id : msg.document.file_id;

                // Загружаем данные сервера из базы
                const server = await getServerById(userState.serverId);
                if (!server) {
                    await bot.sendMessage(chatId, 'Ошибка: сервер не найден. Обратитесь к администратору.');
                    return;
                }

                // Определяем срок действия в текстовом формате
                const durationText = {
                    year: '1 год',
                    six_months: '6 месяцев',
                    three_months: '3 месяца'
                };

                // Получаем цены из базы данных
                try {
                    const result = await db.query('SELECT year, six_months, three_months FROM prices WHERE role = $1', [role]);
                    const { year, six_months, three_months } = result.rows[0];

                    const prices = {
                        year,
                        six_months,
                        three_months
                    };

                    const price = prices[userState.duration];
                    if (!price) {
                        return bot.sendMessage(chatId, 'Ошибка: некорректный срок действия. Попробуйте еще раз.');
                    }

                    console.log(`[Debug] Пользователь: ${chatId}, Роль: ${role}, Цена: ${price}`);

                    // Отправка сообщения админу с деталями
                    await bot.sendMessage(
                        adminId,
                        `Поступил запрос на создание ключа:\n` +
                        `👤 Пользователь: ${chatId} (${msg.from.first_name || "Без имени"}) - ${role}\n` +
                        `🌍 Сервер: ${server.display_name}\n` +
                        `📅 Срок: ${durationText[userState.duration]}\n` +
                        `💰 Цена: ${price}₽.`,
                        {
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: 'Подтвердить', callback_data: `approve_${chatId}_${userState.serverId}_${userState.duration}_${price}` }],
                                    [{ text: 'Отклонить', callback_data: `reject_${chatId}` }]
                                ]
                            }
                        }
                    );

                    // Отправка файла админу
                    if (msg.photo) {
                        await bot.sendPhoto(adminId, fileId);
                    } else {
                        await bot.sendDocument(adminId, fileId);
                    }

                    await bot.sendMessage(chatId, 'Ваш запрос отправлен администратору. Ожидайте подтверждения.');

                    // Сброс состояния
                    delete userStates[chatId];
                } catch (error) {
                    console.error('[Database] Ошибка получения цен:', error);
                    await bot.sendMessage(chatId, 'Произошла ошибка при получении цен. Попробуйте позже.');
                }
            } else {
                await bot.sendMessage(chatId, 'Пожалуйста, отправьте фото или PDF-файл.');
            }
        }

        switch (msg.text) {
            case 'Создать ключ':
                console.log(`[Bot] Пользователь ${userId} запросил создание ключа.`);
                await showServerSelection(bot, chatId);
                break;

            case '/setprice':
                if (role !== 'admin') {
                    return bot.sendMessage(chatId, 'У вас нет прав для выполнения этой команды.');
                }
                await bot.sendMessage(chatId, 'Введите данные в формате: <роль> <срок> <цена>. Пример: user six_months 300');
                userStates[chatId] = { step: 'awaiting_price_input' };
                break;

            default:
                if (userState?.step === 'awaiting_price_input') {
                    const [roleInput, durationInput, priceInput] = msg.text.split(' ');
                    if (!roleInput || !durationInput || isNaN(priceInput)) {
                        return bot.sendMessage(chatId, 'Некорректный ввод. Используйте формат: <роль> <срок> <цена>.');
                    }

                    try {
                        await db.query(
                            `INSERT INTO prices (role, duration, price)
                             VALUES ($1, $2, $3)
                             ON CONFLICT (role, duration)
                             DO UPDATE SET price = $3`,
                            [roleInput, durationInput, parseInt(priceInput, 10)]
                        );
                        await bot.sendMessage(chatId, `Цена для роли "${roleInput}" и срока "${durationInput}" успешно обновлена: ${priceInput}₽.`);
                    } catch (error) {
                        console.error('[Database] Ошибка обновления цены:', error);
                        await bot.sendMessage(chatId, 'Ошибка при обновлении цены. Попробуйте позже.');
                    }

                    delete userStates[chatId];
                } else {
                    await handleUserState(msg, chatId, userState);
                }
        }
    } catch (error) {
        console.error('[Bot] Ошибка обработки сообщения:', error);
        await bot.sendMessage(chatId, 'Произошла ошибка. Попробуйте позже.');
    }
});

// Обработчик callback_query
bot.on('callback_query', async (callbackQuery) => {
    const data = callbackQuery.data;
    const chatId = callbackQuery.message.chat.id;

    console.log(`[Bot] Получена callback_query: ${data} от пользователя ID: ${chatId}`);

    try {

        if (data === 'set_price_user' || data === 'set_price_manager') {
            const targetRole = data === 'set_price_user' ? 'user' : 'manager';

            // Инициализируем состояние
            userStates[chatId] = {
                step: 'set_price',
                currentStep: 'year', // Начинаем с года
                prices: {},
                targetRole
            };

            await bot.sendMessage(chatId, 'Введите цену за год:');
            return;
        }

        // Добавление менеджера
        if (data === 'add_manager') {
            const userId = callbackQuery.from.id;
            const role = await getRole(userId);

            if (role !== 'admin') {
                return bot.sendMessage(chatId, 'У вас нет доступа к этой функции.');
            }

            // Устанавливаем состояние "ожидание имени"
            userStates[chatId] = { step: 'awaiting_manager_name' };
            await bot.sendMessage(chatId, 'Введите имя менеджера:');
        }

        // Удаление менеджера
        if (data.startsWith('delete_manager_')) {
            const managerId = data.split('delete_manager_')[1];

            const result = await db.query('DELETE FROM users WHERE id = $1 AND role = $2', [managerId, 'manager']);

            if (result.rowCount > 0) {
                await bot.sendMessage(chatId, `Менеджер с ID ${managerId} успешно удалён.`);
            } else {
                await bot.sendMessage(chatId, `Менеджер с ID ${managerId} не найден.`);
            }
        }

        // Список менеджеров
        if (data === 'list_managers') {
            const userId = callbackQuery.from.id;
            const role = await getRole(userId);

            if (role !== 'admin') {
                return bot.sendMessage(chatId, 'У вас нет доступа к этой функции.');
            }

            const result = await db.query('SELECT id, first_name, phone FROM users WHERE role = $1', ['manager']);

            if (result.rows.length === 0) {
                return bot.sendMessage(chatId, 'Список менеджеров пуст.');
            }

            const buttons = result.rows.map(manager => [
                { text: `Удалить: ${manager.first_name} (${manager.phone || manager.id})`, callback_data: `delete_manager_${manager.id}` }
            ]);

            await bot.sendMessage(chatId, 'Список менеджеров:', {
                reply_markup: { inline_keyboard: buttons }
            });
        }

        if (data.startsWith('set_price_')) {
            const role = data.split('_')[2]; // Получаем роль: 'user' или 'manager'

            userStates[chatId] = { step: 'set_price', role };
            await bot.sendMessage(chatId, `Введите новые цены для ${role === 'user' ? 'Пользователей' : 'Менеджеров'} в формате:\n<code>год, 6 месяцев, 3 месяца</code>`, { parse_mode: 'HTML' });
        }

        if (data.startsWith('view_template_')) {
            const templateId = data.split('view_template_')[1];
            if (!templateId || isNaN(templateId)) {
                await bot.sendMessage(chatId, 'Ошибка: некорректный идентификатор шаблона для просмотра.');
                return;
            }
            await viewPaymentTemplate(templateId, chatId);
            return;
        }

        // Создание ключа: выбор срока действия
        if (data.startsWith('create_key_')) {
            const serverId = data.split('create_key_')[1];

            if (!serverId || isNaN(serverId)) {
                return bot.sendMessage(chatId, 'Ошибка: некорректный идентификатор сервера.');
            }

            userStates[chatId] = { step: 'select_duration', serverId };

            const durations = [
                { text: '1 год (600₽)', callback_data: 'key_duration_year' },
                { text: '6 месяцев (350₽)', callback_data: 'key_duration_six_months' },
                { text: '3 месяца (250₽)', callback_data: 'key_duration_three_months' }
            ];

            await bot.sendMessage(chatId, 'Выберите срок действия ключа:', {
                reply_markup: { inline_keyboard: durations.map(duration => [duration]) }
            });
        }

        // Выбор срока действия ключа
        if (data.startsWith('key_duration_')) {
            const userState = userStates[chatId];
            if (!userState || userState.step !== 'select_duration') {
                return bot.sendMessage(chatId, 'Произошла ошибка. Начните процесс заново.');
            }

            const duration = data.split('key_duration_')[1];
            userStates[chatId].duration = duration;

            // Проверяем роль пользователя
            const role = await getRole(chatId);
            if (role === 'admin') {
                try {
                    const server = await getServerById(userState.serverId);
                    if (!server) {
                        return bot.sendMessage(chatId, 'Ошибка: сервер не найден.');
                    }

                    // Генерация ключа
                    const key = await createKey(bot, chatId, server, duration);

                    // Определяем продолжительность
                    const validDurations = {
                        year: { years: 1 },
                        six_months: { months: 6 },
                        three_months: { months: 3 }
                    };

                    if (!validDurations[duration]) {
                        throw new Error(`Некорректное значение срока действия: ${duration}`);
                    }

                    // Вычисляем дату окончания
                    const expirationDate = moment().add(validDurations[duration]).toDate();
                    const formattedExpirationDate = expirationDate.toLocaleDateString('ru-RU', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric'
                    });

                    // Сохранение ключа в базе данных
                    await db.query(
                        `
                            INSERT INTO keys (key, user_id, server_id, created_at, expires_at, creator_id)
                            VALUES ($1, $2, $3, $4, $5, $6)
                        `,
                        [
                            customAccessUrl,      // Ключ доступа
                            chatId,               // ID пользователя
                            server.id,            // ID сервера
                            createdAt,            // Дата создания
                            expirationDate,       // Дата окончания действия
                            chatId                // ID создателя (creator_id)
                        ]);

                    // Уведомление администратора об успешном создании
                    await bot.sendMessage(chatId,
                        `Ключ успешно создан!\n` +
                        `🔑 Ключ: ${key}\n` +
                        `📅 Срок действия: ${duration === 'year' ? '1 год' : duration === 'six_months' ? '6 месяцев' : '3 месяца'}\n` +
                        `📅 Дата окончания: ${formattedExpirationDate}`);
                } catch (error) {
                    console.error('[Bot Error] Ошибка при создании ключа администратору:', error.message);
                    await bot.sendMessage(chatId, 'Произошла ошибка при создании ключа. Попробуйте позже.');
                }

                // Сбрасываем состояние
                delete userStates[chatId];
            } else {
                // Для всех остальных ролей: ожидание квитанции
                userStates[chatId].step = 'awaiting_receipt';
                await bot.sendMessage(chatId, 'Отправьте фото или PDF с квитанцией об оплате.');
                console.log(`[Debug] Обновлено состояние userStates для ${chatId}:`, userStates[chatId]);
            }
        }

        // Выбор шаблона оплаты
        if (data.startsWith('select_payment_')) {
            const templateId = data.split('select_payment_')[1];
            userStates[chatId].paymentTemplate = templateId;

            await bot.sendMessage(chatId, 'Отправьте фото или PDF-файл с квитанцией об оплате.');
            userStates[chatId].step = 'awaiting_receipt';
        }

        // Проверка подтверждения
        if (data.startsWith('approve_')) {
            const [_, userId, serverId, duration] = data.split('_');
            const role = await getRole(userId);

            try {
                const result = await db.query('SELECT year, six_months, three_months FROM prices WHERE role = $1', [role]);
                const { year, six_months, three_months } = result.rows[0];

                const prices = {
                    year,
                    six_months,
                    three_months
                };

                const price = prices[duration];
                if (!price) {
                    throw new Error('Некорректный срок действия.');
                }

                console.log(`[Debug] Роль: ${role}, Цена: ${price}`);

                // Генерация ключа
                const server = await getServerById(serverId);
                const key = await createKey(bot, userId, server, duration);

                await bot.sendMessage(userId,
                    `Ваш ключ успешно создан!\n🔑 Ключ: ${key}\n📅 Срок действия: ${duration}\n💰 Цена: ${price}₽.`);
            } catch (error) {
                console.error('[Bot Error] Ошибка подтверждения ключа:', error.message);
                await bot.sendMessage(adminId, `Ошибка подтверждения ключа: ${error.message}`);
            }
        }

        if (data.startsWith('view_server_')) {
            const serverId = data.split('view_server_')[1];
            if (!serverId || isNaN(serverId)) {
                await bot.sendMessage(chatId, 'Ошибка: некорректный идентификатор сервера для просмотра.');
                return;
            }
            await viewServerDetails(serverId, chatId);
            return;
        }

        if (data === 'list_servers') {
            try {
                const servers = await getServersFromDatabase();

                if (servers.length === 0) {
                    await bot.sendMessage(chatId, 'На данный момент нет доступных серверов.');
                    return;
                }

                const buttons = servers.map(server => [
                    { text: server.display_name, callback_data: `view_server_${server.id}` },
                    { text: '🗑 Удалить', callback_data: `delete_server_${server.id}` }
                ]);

                await bot.sendMessage(chatId, 'Список серверов:', {
                    reply_markup: {
                        inline_keyboard: buttons
                    }
                });

                console.log('[Bot] Список серверов отправлен пользователю.');
            } catch (error) {
                console.error('[Bot Error] Ошибка при получении списка серверов:', error.message);
                await bot.sendMessage(chatId, 'Ошибка при получении списка серверов. Попробуйте позже.');
            }
        }

        // Отклонение запроса
        if (data.startsWith('reject_')) {
            const userId = data.split('_')[1];

            await bot.sendMessage(userId, 'Ваш запрос на ключ был отклонён.');
            await bot.sendMessage(adminId, `Запрос от пользователя ${userId} отклонён.`);
        }
    } catch (error) {
        console.error('[Bot Error] Ошибка обработки callback_query:', error);
        await bot.sendMessage(chatId, 'Произошла ошибка. Попробуйте позже.');
    }
});

// ====================== ФУНКЦИИ ======================

// Функция для обработки состояний пользователя
async function handleUserState(msg, chatId, userState) {
    if (!userState) {
        console.log(`[Bot] Сообщение "${msg.text}" не соответствует ни одной команде.`);
        return;
    }

    const handlers = {
        awaiting_bank_name: async () => {
            userStates[chatId] = { step: 'awaiting_payment_method', bank_name: msg.text };
            await bot.sendMessage(chatId, 'Введите способ оплаты:');
        },
        awaiting_payment_method: async () => {
            userStates[chatId] = {
                step: 'awaiting_details',
                bank_name: userState.bank_name,
                payment_method: msg.text
            };
            await bot.sendMessage(chatId, 'Введите детали оплаты:');
        },
        awaiting_details: async () => {
            const { bank_name, payment_method } = userState;
            const details = msg.text;

            try {
                await db.query('INSERT INTO payment_templates (bank_name, payment_method, details) VALUES ($1, $2, $3)', [bank_name, payment_method, details]);
                await bot.sendMessage(chatId, `Шаблон добавлен:\n🏦 Банк: ${bank_name}\n💳 Способ: ${payment_method}\n📄 Детали: ${details}`);
                console.log(`[Database] Новый шаблон: ${bank_name}, ${payment_method}, ${details}`);
            } catch (error) {
                console.error('[Database] Ошибка при добавлении шаблона:', error);
                await bot.sendMessage(chatId, 'Ошибка при добавлении шаблона.');
            }

            delete userStates[chatId];
        }
    };

    if (handlers[userState.step]) {
        await handlers[userState.step]();
    }
}

// Функция для отображения списка серверов
async function handleServerList(bot, chatId) {
    console.log(`[Bot] Пользователь ID ${chatId} запросил список серверов.`);

    try {
        const result = await db.query('SELECT id, display_name, name FROM servers');
        const servers = result.rows;

        console.log('[Database] Список серверов:', servers);

        if (servers.length === 0) {
            await bot.sendMessage(chatId, 'На данный момент нет доступных серверов.');
            return;
        }

        const buttons = servers.map(server => [
            { text: server.display_name, callback_data: `view_server_${server.id}` },
            { text: '🗑 Удалить', callback_data: `delete_server_${server.id}` }
        ]);

        await bot.sendMessage(chatId, 'Список серверов:', {
            reply_markup: {
                inline_keyboard: buttons
            }
        });
    } catch (error) {
        console.error('[Database] Ошибка при получении серверов:', error);
        await bot.sendMessage(chatId, 'Ошибка при получении списка серверов. Попробуйте позже.');
    }
}

// Функция для получения шаблонов оплаты
async function getPaymentTemplates() {
    try {
        const result = await db.query('SELECT * FROM payment_templates');
        console.log('[Database] Шаблоны оплаты:', result.rows);
        return result.rows;
    } catch (error) {
        console.error('[Database] Ошибка получения шаблонов:', error);
        return [];
    }
}

// Функция для отправки меню шаблонов оплаты
async function sendPaymentTemplatesMenu(chatId) {
    const templates = await getPaymentTemplates();
    if (templates.length === 0) {
        await bot.sendMessage(chatId, 'Нет шаблонов оплаты.');
        return;
    }

    const buttons = templates.map(template => [
        { text: `${template.bank_name} - ${template.payment_method}`, callback_data: `view_template_${template.id}` },
        { text: '🗑 Удалить', callback_data: `delete_template_${template.id}` }
    ]);

    await bot.sendMessage(chatId, 'Список шаблонов:', {
        reply_markup: { inline_keyboard: buttons }
    });
}

// Функция для просмотра шаблона оплаты
async function viewPaymentTemplate(templateId, chatId) {
    try {
        const result = await db.query('SELECT * FROM payment_templates WHERE id = $1', [templateId]);
        const template = result.rows[0];

        if (template) {
            await bot.sendMessage(chatId, `Шаблон оплаты:\n🏦 Банк: ${template.bank_name}\n💳 Способ оплаты: ${template.payment_method}\n📄 Детали: ${template.details}`);
        } else {
            await bot.sendMessage(chatId, 'Шаблон не найден.');
        }
    } catch (error) {
        console.error('[Database] Ошибка получения шаблона:', error);
        await bot.sendMessage(chatId, 'Ошибка при получении шаблона.');
    }
}

// Функция для удаления шаблона оплаты
async function deletePaymentTemplate(templateId, chatId) {
    try {
        await db.query('DELETE FROM payment_templates WHERE id = $1', [templateId]);
        await bot.sendMessage(chatId, 'Шаблон удален.');
    } catch (error) {
        console.error('[Database] Ошибка удаления шаблона:', error);
        await bot.sendMessage(chatId, 'Ошибка удаления шаблона.');
    }
}

// Функция для отображения доступных серверов
async function showServerSelection(bot, chatId) {
    try {
        const servers = await getAvailableServers();
        if (servers.length === 0) {
            await bot.sendMessage(chatId, 'Нет доступных серверов для создания ключа.');
            return;
        }
        const buttons = servers.map(server => [
            { text: server.display_name, callback_data: `create_key_${server.id}` }
        ]);
        await bot.sendMessage(chatId, 'Выберите сервер для создания ключа:', {
            reply_markup: { inline_keyboard: buttons }
        });
    } catch (error) {
        console.error('[Bot] Ошибка в showServerSelection:', error);
        await bot.sendMessage(chatId, 'Ошибка при получении списка серверов. Попробуйте позже.');
    }
}

// Функция для создания ключа
async function createKey(bot, chatId, server, duration) {
    try {
        console.log(`[Key] Начинаем создание ключа для пользователя ${chatId} на сервере ${server.name}.`);

        // Запрос к серверу для создания ключа
        const response = await axios.post(`${server.api_url}/access-keys`, {}, { httpsAgent });
        const { id, accessUrl } = response.data;

        if (!accessUrl) {
            throw new Error('Отсутствует accessUrl в ответе сервера.');
        }

        console.log(`[Key] Получен accessUrl: ${accessUrl}`);

        // Формирование customAccessUrl
        const url = new URL(accessUrl);
        const userInfo = url.username;
        const hostname = `${server.name}.bestvpn.world`;
        const port = url.port;
        const queryParams = url.search;
        const customAccessUrl = `ss://${userInfo}@${hostname}:${port}/${queryParams}#RaphaelVPN`;

        console.log(`[Key] Сформированный customAccessUrl: ${customAccessUrl}`);

        // Проверка и расчет срока действия
        const validDurations = {
            year: 12, // месяцев
            six_months: 6,
            three_months: 3
        };

        const monthsToAdd = validDurations[duration];
        if (!monthsToAdd) {
            throw new Error(`Некорректный срок действия: ${duration}`);
        }

        const expirationDate = new Date();
        expirationDate.setMonth(expirationDate.getMonth() + monthsToAdd);

        console.log(`[Key] Срок действия ключа до: ${expirationDate.toISOString()}`);

        // Сохранение ключа в базу данных
        const createdAt = new Date().toISOString();
        await db.query(
            `
                INSERT INTO keys (key, user_id, server_id, created_at, expires_at, creator_id)
                VALUES ($1, $2, $3, $4, $5, $6)
            `,
            [customAccessUrl, chatId, server.id, createdAt, expirationDate.toISOString(), chatId]
        );

        console.log('[Database] Ключ успешно сохранен в базе данных.');

        // Уведомление пользователя
        await bot.sendMessage(
            chatId,
            `Ключ успешно создан для сервера ${server.display_name}:\n<code>${customAccessUrl}</code>\n📅 Дата окончания действия: ${expirationDate.toLocaleDateString('ru-RU')}`,
            { parse_mode: 'HTML' }
        );

        return customAccessUrl;
    } catch (error) {
        console.error('[Key] Ошибка при создании ключа:', error.message);
        console.error('[Key] Детали ошибки:', error);

        // Уведомление пользователя об ошибке
        await bot.sendMessage(chatId, 'Ошибка при создании ключа. Попробуйте позже.');
        throw error;
    }
}

// Функция для получения списка серверов из базы данных
async function getServersFromDatabase() {
    try {
        const result = await db.query('SELECT id, name, display_name, api_url FROM servers');
        console.log('[Database] Список серверов:', result.rows);
        return result.rows;
    } catch (error) {
        console.error('[Database] Ошибка получения серверов:', error);
        throw error;
    }
}

// Функция проверки доступности сервера
async function checkServerAvailability(server) {
    try {
        const response = await axios.get(`${server.api_url}/server/metrics/transfer`, {
            timeout: 5000,
            httpsAgent,
        });

        console.log(`[Monitor] Сервер ${server.name} доступен. Код ответа: ${response.status}`);
        return true; // Считаем сервер доступным при любом ответе
    } catch (error) {
        if (error.response) {
            // Сервер ответил, но с ошибкой (например, 404 или 500)
            console.log(`[Monitor] Сервер ${server.name} доступен с ошибкой. Код ответа: ${error.response.status}`);
            return true; // Считаем сервер доступным
        } else {
            // Ошибка подключения (например, таймаут)
            console.warn(`[Monitor] Сервер ${server.name} недоступен: ${error.message}`);
            return false; // Считаем сервер недоступным
        }
    }
}

// Функция мониторинга доступных серверов
async function getAvailableServers() {
    const servers = await getServersFromDatabase();
    const availableServers = [];

    for (const server of servers) {
        if (await checkServerAvailability(server)) {
            availableServers.push(server);
        }
    }

    console.log('[Monitor] Доступные серверы:', availableServers);
    return availableServers;
}

// Функция для отображения деталей сервера
async function viewServerDetails(serverId, chatId) {
    try {
        const result = await db.query('SELECT * FROM servers WHERE id = $1', [serverId]);
        const server = result.rows[0];

        if (server) {
            const serverInfo = `📛 Display Name: ${server.display_name}\n` +
                `🖥️ Name: ${server.name}\n` +
                `🔗 API URL: ${server.api_url}`;

            await bot.sendMessage(chatId, `Информация о сервере:\n\n${serverInfo}`);
            console.log(`[Bot] Информация о сервере ID ${serverId} отправлена.`);
        } else {
            await bot.sendMessage(chatId, 'Сервер не найден.');
            console.log(`[Database] Сервер с ID ${serverId} не найден.`);
        }
    } catch (error) {
        console.error('[Database] Ошибка при получении информации о сервере:', error);
        await bot.sendMessage(chatId, 'Ошибка при получении информации о сервере. Попробуйте позже.');
    }
}

// Функция удаления сервера
async function deleteServer(serverId, chatId) {
    try {
        await db.query('DELETE FROM servers WHERE id = $1', [serverId]);
        await bot.sendMessage(chatId, 'Сервер успешно удален.');
        console.log(`[Database] Сервер с ID ${serverId} успешно удален.`);
    } catch (error) {
        console.error('[Database] Ошибка удаления сервера:', error);
        await bot.sendMessage(chatId, 'Ошибка при удалении сервера. Попробуйте позже.');
    }
}




// Функция проверки роли администратора

function isAdmin(userId) {
    return userId.toString() === process.env.ADMIN_ID;
}

function isAdminByPhone(phone) {
    return phone === process.env.ADMIN_PHONE;
}

//Функция проверки ролей
async function getRole(userId) {
    try {
        const result = await db.query('SELECT role FROM users WHERE id = $1', [userId]); // Исправлено
        return result.rows.length > 0 ? result.rows[0].role : 'user'; // Если пользователь не найден, возвращаем 'user'
    } catch (error) {
        console.error('[Database] Ошибка получения роли пользователя:', error);
        return 'user'; // Если произошла ошибка, возвращаем роль по умолчанию
    }
}

async function getServerById(serverId) {
    try {
        const result = await db.query('SELECT id, display_name, name, api_url FROM servers WHERE id = $1', [serverId]);
        return result.rows[0] || null;
    } catch (error) {
        console.error('[Database] Ошибка получения сервера:', error);
        return null;
    }
}
async function getUserById(userId) {
    try {
        const result = await db.query('SELECT first_name, role FROM users WHERE id = $1', [userId]);
        return result.rows[0] || { first_name: 'Неизвестный', role: 'user' };
    } catch (error) {
        console.error('[Database] Ошибка получения пользователя:', error);
        return { first_name: 'Неизвестный', role: 'user' };
    }
}

// Добавляем функцию для обработки просроченных ключей
async function removeExpiredKeys() {
    try {
        const now = new Date().toISOString();

        console.log('[Key] Начало проверки просроченных ключей.');

        // Получаем просроченные ключи
        const expiredKeys = await db.query(`
            SELECT id, key, server_id FROM keys WHERE expires_at <= $1
        `, [now]);

        if (expiredKeys.rows.length === 0) {
            console.log('[Key] Нет просроченных ключей.');
            return;
        }

        console.log(`[Key] Найдено просроченных ключей: ${expiredKeys.rows.length}.`);

        for (const expiredKey of expiredKeys.rows) {
            try {
                // Получаем данные сервера
                const server = await db.query(`
                    SELECT api_url FROM servers WHERE id = $1
                `, [expiredKey.server_id]);

                if (server.rows.length === 0) {
                    console.error(`[Key] Сервер с ID ${expiredKey.server_id} не найден.`);
                    continue;
                }

                const serverApiUrl = server.rows[0].api_url;

                // Удаляем ключ с сервера
                console.log(`[Key] Удаляем ключ ${expiredKey.id} с сервера ${serverApiUrl}.`);
                await axios.delete(`${serverApiUrl}/access-keys/${expiredKey.id}`, { httpsAgent });
                console.log(`[Key] Ключ ${expiredKey.id} успешно удален с сервера.`);

                // Удаляем ключ из базы данных
                await db.query(`
                    DELETE FROM keys WHERE id = $1
                `, [expiredKey.id]);
                console.log(`[Database] Ключ ${expiredKey.id} успешно удален из базы.`);
            } catch (serverError) {
                console.error(`[Key] Ошибка при удалении ключа ${expiredKey.id} с сервера: ${serverError.message}`);
            }
        }
    } catch (error) {
        console.error('[Key] Ошибка при удалении просроченных ключей:', error.message);
    }
}

// Планируем выполнение задачи по расписанию
schedule.scheduleJob('0 0 * * *', async () => {
    console.log('[Scheduler] Запуск задачи удаления просроченных ключей.');
    await removeExpiredKeys();
});

//Получение цен из базы данных
async function getPrice(role, duration) {
    try {
        const result = await db.query(
            `SELECT price FROM prices WHERE role = $1 AND duration = $2`,
            [role, duration]
        );

        return result.rows.length > 0 ? result.rows[0].price : null;
    } catch (error) {
        console.error('[Database] Ошибка получения цены:', error);
        return null;
    }
}