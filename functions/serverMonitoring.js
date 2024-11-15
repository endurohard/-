const axios = require('axios');
const https = require('https');
const { Pool } = require('pg');

// Подключение к базе данных
const db = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

// Создаем HTTPS агент, игнорирующий самоподписанные сертификаты
const httpsAgent = new https.Agent({
    rejectUnauthorized: false, // Игнорируем самоподписанные сертификаты
});

async function getServersFromDatabase() {
    try {
        const result = await db.query('SELECT id, name, api_url FROM servers');
        console.log('[Database] Список серверов из базы данных:', result.rows);
        return result.rows;
    } catch (error) {
        console.error('[Database] Ошибка при получении серверов:', error);
        return [];
    }
}

async function checkServerMetrics(server) {
    try {
        const url = `${server.api_url}/server/metrics/transfer`;
        console.log(`[Monitor] Запрос метрик от сервера: ${server.name}, URL: ${url}`);

        const response = await axios.get(url, {
            timeout: 5000,
            httpsAgent,
        });

        if (response.status === 200) {
            console.log(`[Monitor] Сервер ${server.name} доступен. Метрики получены.`);
            return { available: true, metrics: response.data };
        } else {
            console.warn(`[Monitor] Сервер ${server.name} вернул неожиданный статус: ${response.status}`);
            return { available: true, metrics: null };
        }
    } catch (error) {
        console.error(`[Monitor] Ошибка при запросе метрик от сервера ${server.name}:`, error.message);
        return { available: false, metrics: null };
    }
}

async function monitorServers() {
    console.log('[Monitor] Запуск мониторинга серверов...');
    const servers = await getServersFromDatabase();

    if (servers.length === 0) {
        console.warn('[Monitor] Нет доступных серверов для мониторинга.');
        return;
    }

    for (const server of servers) {
        const result = await checkServerMetrics(server);

        if (result.available) {
            console.log(`[Monitor] Сервер ${server.name} доступен.`);
        } else {
            console.warn(`[Monitor] Сервер ${server.name} недоступен.`);
        }

        // Логирование метрик, если они есть
        if (result.metrics) {
            console.log(`[Monitor] Метрики сервера ${server.name}:`, result.metrics);
        }
    }

    console.log('[Monitor] Мониторинг завершен.');
}

// Планируем выполнение мониторинга каждые 5 минут
setInterval(monitorServers, 5 * 60 * 1000); // 5 минут

module.exports = { monitorServers };