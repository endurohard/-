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
        // Создание таблицы users
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                                                 id BIGINT PRIMARY KEY,
                                                 username VARCHAR(50),
                first_name VARCHAR(50),
                last_name VARCHAR(50),
                phone VARCHAR(15) UNIQUE,
                role VARCHAR(20) NOT NULL DEFAULT 'user',
                created_at TIMESTAMP DEFAULT NOW()
                );
        `);
        console.log('[Database] Таблица users проверена или создана.');

        // Создание таблицы payment_templates
        await pool.query(`
            CREATE TABLE IF NOT EXISTS payment_templates (
                                                             id SERIAL PRIMARY KEY,
                                                             bank_name TEXT NOT NULL,
                                                             payment_method TEXT NOT NULL,
                                                             details TEXT NOT NULL
            );
        `);
        console.log('[Database] Таблица payment_templates проверена или создана.');

        // Создание таблицы prices
        await pool.query(`
            CREATE TABLE IF NOT EXISTS prices (
                                                  id SERIAL PRIMARY KEY,
                                                  role VARCHAR(20) NOT NULL,         -- Роль: 'user' или 'manager'
                duration VARCHAR(20) NOT NULL,    -- Продолжительность ('year', 'six_months', 'three_months')
                price INTEGER NOT NULL            -- Цена
                );
        `);
        console.log('[Database] Таблица prices проверена или создана.');

        // Заполняем таблицу prices данными по умолчанию, если они отсутствуют
        const existingPrices = await pool.query('SELECT COUNT(*) FROM prices');
        if (parseInt(existingPrices.rows[0].count, 10) === 0) {
            await pool.query(`
                INSERT INTO prices (role, duration, price)
                VALUES 
                ('user', 'year', 600),
                ('user', 'six_months', 350),
                ('user', 'three_months', 250),
                ('manager', 'year', 500),
                ('manager', 'six_months', 300),
                ('manager', 'three_months', 200)
            ON CONFLICT DO NOTHING;
            `);
            console.log('[Database] Таблица prices заполнена данными по умолчанию.');
        }

        // Создание таблицы servers
        await pool.query(`
            CREATE TABLE IF NOT EXISTS servers (
                                                   id SERIAL PRIMARY KEY,
                                                   name VARCHAR(50) NOT NULL,
                display_name VARCHAR(100) NOT NULL,
                api_url TEXT NOT NULL
                );
        `);
        console.log('[Database] Таблица servers проверена или создана.');

        // Создание таблицы keys
        await pool.query(`
            CREATE TABLE IF NOT EXISTS keys (
                                                id SERIAL PRIMARY KEY,
                                                key TEXT NOT NULL,
                                                user_id BIGINT NOT NULL,
                                                server_id INT NOT NULL,
                                                created_at TIMESTAMP NOT NULL,
                                                expires_at TIMESTAMP NOT NULL,
                                                creator_id BIGINT NOT NULL
            );
        `);
        console.log('[Database] Таблица keys проверена или создана.');

        // Проверяем и добавляем колонку expires_at, если ее нет
        const result = await pool.query(`
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'keys' AND column_name = 'expires_at';
        `);

        if (result.rows.length === 0) {
            await pool.query(`ALTER TABLE keys ADD COLUMN expires_at TIMESTAMP;`);
            console.log('[Database] Колонка expires_at добавлена в таблицу keys.');
        }

        // Добавляем администратора
        if (process.env.ADMIN_ID) {
            const adminId = parseInt(process.env.ADMIN_ID, 10);
            await pool.query(`
                INSERT INTO users (id, role)
                VALUES ($1, 'admin')
                    ON CONFLICT (id) DO UPDATE SET role = 'admin';
            `, [adminId]);
            console.log(`[Database] Администратор с ID ${adminId} проверен или добавлен.`);
        } else {
            console.warn('[Database] Переменная окружения ADMIN_ID не задана.');
        }
    } catch (error) {
        console.error('[Database] Ошибка инициализации базы данных:', error);
    }
}

module.exports = initializeDatabase;