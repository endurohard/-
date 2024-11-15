const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

async function initializeDatabase() {
    try {
        // Пример создания таблицы servers
        await pool.query(`
            CREATE TABLE IF NOT EXISTS servers (
                id SERIAL PRIMARY KEY,
                display_name TEXT NOT NULL,
                name TEXT UNIQUE NOT NULL,
                api_url TEXT NOT NULL
            );
        `);
        console.log('Таблица servers проверена или создана.');

        // Пример создания таблицы payment_templates
        await pool.query(`
            CREATE TABLE IF NOT EXISTS payment_templates (
                id SERIAL PRIMARY KEY,
                bank_name TEXT NOT NULL,
                payment_method TEXT NOT NULL,
                details TEXT NOT NULL
            );
        `);
        console.log('Таблица payment_templates проверена или создана.');
    } catch (error) {
        console.error('Ошибка инициализации базы данных:', error);
    }
}

module.exports = initializeDatabase; // Экспорт функции