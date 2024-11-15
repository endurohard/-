require('dotenv').config(); // Загрузка переменных окружения
require('../db/initDatabase'); // Инициализация базы данных
const https = require ('https');
const axios = require ('axios');
const TelegramBot = require('node-telegram-bot-api');
const { Pool } = require('pg'); // Импортируем Pool
const initializeDatabase = require('../db/initDatabase'); // путь к вашему скрипту


const db = new Pool({ // Создаем экземпляр Pool
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

(async () => {
    await initializeDatabase();
    console.log('[Bot] База данных инициализирована.');
})();

// HTTPS агент для игнорирования сертификатов
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
console.log("[Bot] Telegram бот успешно запущен.");

// Хранение состояний пользователей
const userStates = {};

// Обработчик команды /start
    bot.onText(/\/start/, async (msg) => {
        const chatId = msg.chat.id;
        console.log(`[Bot] Получена команда /start от пользователя ID: ${chatId}`);

        await bot.sendMessage(chatId, 'Добро пожаловать в RaphaelVPN Bot! Выберите действие:', {
            reply_markup: {
                keyboard: [
                    [{ text: 'Добавить сервер' }],
                    [{ text: 'Список серверов' }],
                    [{ text: 'Создать ключ' }],
                    [{ text: 'Шаблоны оплаты' }]
                ],
                resize_keyboard: true, // Подгоняет клавиатуру под экран пользователя
                one_time_keyboard: false // Клавиатура не исчезает после нажатия
            }
        });
        console.log('[Bot] Отправлено главное меню пользователю.');
    });

// Обработчик нажатия на кнопку "Список серверов"
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const userState = userStates[chatId];

    console.log(`[Bot] Получено сообщение: "${msg.text}" от пользователя ID: ${userId}`);

    try {
        if (msg.text === 'Создать ключ') {
            console.log(`[Bot] Пользователь ID ${msg.from.id} запросил создание ключа.`);
            await showServerSelection(bot, chatId);
        }
        if (msg.text === 'Шаблоны оплаты') {
            console.log(`[Bot] Пользователь ID ${msg.from.id} запросил шаблоны оплаты.`);

            const options = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Добавить шаблон', callback_data: 'add_payment_template' }],
                        [{ text: 'Список шаблонов', callback_data: 'list_payment_templates' }]
                    ]
                }
            };

            await bot.sendMessage(chatId, 'Управление шаблонами оплаты:', options);
        }
        if (msg.text === 'Список серверов') {
            console.log(`[Bot] Пользователь ${userId} запросил список серверов.`);
            await handleServerList(bot, chatId);
            return;
        }

        if (msg.text === 'Добавить сервер') {
            console.log(`[Bot] Пользователь ${userId} начал добавление сервера.`);
            userStates[chatId] = { step: 1 };
            await bot.sendMessage(chatId, 'Введите Display Name сервера:');
            return;
        }

        if (userState) {
            console.log(`[Bot] Состояние пользователя: ${JSON.stringify(userState)}`);

            if (userState.step === 'awaiting_bank_name') {
                userStates[chatId] = { step: 'awaiting_payment_method', bank_name: msg.text };
                await bot.sendMessage(chatId, 'Введите способ оплаты (например, СБП или Перевод):');
            } else if (userState.step === 'awaiting_payment_method') {
                userStates[chatId] = { step: 'awaiting_details', bank_name: userState.bank_name, payment_method: msg.text };
                await bot.sendMessage(chatId, 'Введите детали (например, номер карты или телефон):');
            } else if (userState.step === 'awaiting_details') {
                const { bank_name, payment_method } = userState;
                const details = msg.text;

                try {
                    await db.query(
                        'INSERT INTO payment_templates (bank_name, payment_method, details) VALUES ($1, $2, $3)',
                        [bank_name, payment_method, details]
                    );
                    await bot.sendMessage(chatId, `Шаблон оплаты успешно добавлен:\nБанк: ${bank_name}\nСпособ: ${payment_method}\nДетали: ${details}`);
                    console.log(`[Database] Добавлен новый шаблон оплаты: ${bank_name}, ${payment_method}, ${details}`);
                } catch (error) {
                    console.error('[Database] Ошибка добавления шаблона оплаты:', error);
                    await bot.sendMessage(chatId, 'Ошибка при добавлении шаблона оплаты. Попробуйте позже.');
                }

                delete userStates[chatId]; // Сброс состояния пользователя
            }
            return;
        }

        console.log(`[Bot] Сообщение "${msg.text}" не соответствует ни одной команде.`);
    } catch (error) {
        console.error('[Bot] Ошибка обработки сообщения:', error);
        await bot.sendMessage(chatId, 'Произошла ошибка. Попробуйте позже.');
    }
});
async function getPaymentTemplates() {
    try {
        const result = await db.query('SELECT * FROM payment_templates');
        return result.rows;
    } catch (error) {
        console.error('[Database] Ошибка при получении шаблонов оплаты:', error);
        return [];
    }
}
// Обработчик callback_query для удаления сервера
bot.on('callback_query', async (callbackQuery) => {
    const data = callbackQuery.data;
    const chatId = callbackQuery.message.chat.id;
    console.log(`[Bot] Получена callback_query: ${data} от пользователя ID: ${chatId}`);

    if (data === 'add_payment_template') {
        userStates[chatId] = { step: 'awaiting_bank_name' };
        await bot.sendMessage(chatId, 'Введите название банка:');
    }

    if (data === 'list_payment_templates') {
        const templates = await getPaymentTemplates();

        if (templates.length === 0) {
            await bot.sendMessage(chatId, 'Нет доступных шаблонов оплаты.');
            return;
        }

        const buttons = templates.map(template => [
            { text: `${template.bank_name} - ${template.payment_method}`, callback_data: `view_template_${template.id}` },
            { text: '🗑 Удалить', callback_data: `delete_template_${template.id}` }
        ]);

        await bot.sendMessage(chatId, 'Список шаблонов оплаты:', {
            reply_markup: {
                inline_keyboard: buttons
            }
        });
    }

    if (data.startsWith('view_template_')) {
        const templateId = data.split('view_template_')[1];

        try {
            const result = await db.query('SELECT * FROM payment_templates WHERE id = $1', [templateId]);
            const template = result.rows[0];

            if (template) {
                await bot.sendMessage(
                    chatId,
                    `Шаблон оплаты:\n\n🏦 Банк: ${template.bank_name}\n💳 Способ оплаты: ${template.payment_method}\n📄 Детали: ${template.details}`
                );
            } else {
                await bot.sendMessage(chatId, 'Шаблон не найден.');
            }
        } catch (error) {
            console.error('[Database] Ошибка при получении шаблона оплаты:', error);
            await bot.sendMessage(chatId, 'Ошибка при получении шаблона. Попробуйте позже.');
        }
    }

    if (data.startsWith('delete_template_')) {
        const templateId = data.split('delete_template_')[1];

        try {
            await db.query('DELETE FROM payment_templates WHERE id = $1', [templateId]);
            await bot.sendMessage(chatId, 'Шаблон успешно удален.');
        } catch (error) {
            console.error('[Database] Ошибка при удалении шаблона оплаты:', error);
            await bot.sendMessage(chatId, 'Ошибка при удалении шаблона. Попробуйте позже.');
        }
    }

    if (data.startsWith('delete_server_')) {
        const serverId = data.split('delete_server_')[1];

        try {
            console.log(`[Database] Попытка удаления сервера с ID: ${serverId}`);
            await db.query('DELETE FROM servers WHERE id = $1', [serverId]);
            bot.sendMessage(chatId, 'Сервер успешно удален.');
            console.log(`[Database] Сервер с ID ${serverId} успешно удален.`);
        } catch (err) {
            console.error('[Database] Ошибка при удалении сервера:', err);
            bot.sendMessage(chatId, 'Ошибка при удалении сервера. Попробуйте позже.');
        }
    }

    if (data.startsWith('create_key_')) {
        const serverId = data.split('create_key_')[1];
        const servers = await getServersFromDatabase();
        const selectedServer = servers.find(server => server.id.toString() === serverId);

        if (!selectedServer) {
            await bot.sendMessage(chatId, 'Ошибка: сервер не найден.');
            return;
        }

        console.log(`[Callback] Пользователь выбрал сервер: ${selectedServer.name}`);
        await createKey(bot, chatId, selectedServer);
    }

    if (data.startsWith('info_server_')) {
        const serverId = data.split('info_server_')[1];

        try {
            console.log(`[Database] Получение информации о сервере с ID: ${serverId}`);
            const result = await dbClient.query('SELECT * FROM servers WHERE id = $1', [serverId]);
            const server = result.rows[0];

            if (server) {
                bot.sendMessage(chatId, `Информация о сервере:\n\n📛 Display Name: ${server.display_name}\n🖥️ Name: ${server.name}\n🔗 API URL: ${server.api_url}`);
                console.log(`[Bot] Информация о сервере ID ${serverId} отправлена.`);
            } else {
                bot.sendMessage(chatId, 'Сервер не найден.');
                console.log(`[Database] Сервер с ID ${serverId} не найден.`);
            }
        } catch (err) {
            console.error('[Database] Ошибка при получении информации о сервере:', err);
            bot.sendMessage(chatId, 'Ошибка при получении информации о сервере. Попробуйте позже.');
        }
    }
});

// Функция создания и отправки ключа
async function createKey(bot, chatId, server) {
    try {
        // Создаем ключ на сервере
        const response = await axios.post(`${server.api_url}/access-keys`, {}, {
            httpsAgent,
        });

        const { id, accessUrl } = response.data;

        // Парсим данные из accessUrl
        const url = new URL(accessUrl);
        const userInfo = url.username; // Данные ключа
        const hostname = `${server.name}.bestvpn.world`; // Кастомное доменное имя
        const port = url.port;
        const queryParams = url.search; // outline=1

        // Генерируем кастомный формат ссылки
        const customAccessUrl = `ss://${userInfo}@${hostname}:${port}/${queryParams}#RaphaelVPN`;

        console.log(`[Key] Ключ создан для сервера ${server.name}. Custom URL: ${customAccessUrl}`);

        // Отправляем ключ пользователю
        await bot.sendMessage(chatId, `Ключ успешно создан для сервера ${server.display_name}:\n<code>${customAccessUrl}</code>`, { parse_mode: 'HTML' });
    } catch (error) {
        console.error('[Key] Ошибка создания ключа:', error.message);
        await bot.sendMessage(chatId, 'Ошибка при создании ключа. Попробуйте позже.');
    }
}

// Функция для получения списка серверов из базы данных
async function getServersFromDatabase() {
    try {
        const result = await db.query('SELECT id, name, display_name, api_url FROM servers');
        console.log('[Database] Список серверов:', result.rows);
        return result.rows;
    } catch (error) {
        console.error('[Database] Ошибка при получении серверов:', error);
        throw error;
    }
}

// Функция для проверки доступности сервера
async function checkServerAvailability(server) {
    try {
        const response = await axios.get(`${server.api_url}/server/metrics/transfer`, {
            timeout: 5000,
            httpsAgent,
        });
        console.log(`[Monitor] Сервер ${server.name} доступен. Код ответа: ${response.status}`);
        return true; // Считаем сервер доступным при любом коде ответа
    } catch (error) {
        if (error.response) {
            console.log(`[Monitor] Сервер ${server.name} ответил с кодом: ${error.response.status}, но считается доступным.`);
            return true; // Сервер доступен при любом ответе
        }

        console.warn(`[Monitor] Сервер ${server.name} недоступен: ${error.message}`);
        return false; // Сервер недоступен только если нет ответа
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

// Функция выбора сервера
async function showServerSelection(bot, chatId) {
    try {
        const servers = await getAvailableServers();

        if (servers.length === 0) {
            await bot.sendMessage(chatId, 'Нет доступных серверов для создания ключа.');
            return;
        }

        // Убедитесь, что используете корректное поле display_name
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

async function handleServerList(bot, chatId) {
    console.log(`[Bot] Пользователь ID ${chatId} запросил список серверов.`);

    try {
        const result = await db.query('SELECT id, display_name, name FROM servers');
        const servers = result.rows;

        console.log('[Database] Список серверов:', servers);

        if (servers.length === 0) {
            await bot.sendMessage(chatId, 'На данный момент нет доступных серверов.');
            console.log('[Bot] Сообщение: "Нет доступных серверов" отправлено.');
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
        console.error('[Database] Ошибка при получении серверов:', error);
        await bot.sendMessage(chatId, 'Ошибка при получении списка серверов. Попробуйте позже.');
    }
}