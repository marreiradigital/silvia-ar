import mysql from 'mysql2/promise';

export async function tryConnectDB() {
    const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } = process.env;
    if (!DB_HOST || !DB_USER || !DB_NAME) return null;

    try {
        const pool = mysql.createPool({
            host: DB_HOST,
            port: Number(DB_PORT) || 3306,
            user: DB_USER,
            password: DB_PASSWORD || '',
            database: DB_NAME,
            connectionLimit: 10,
            waitForConnections: true,
            charset: 'utf8mb4',
            timezone: 'Z',
        });
        const conn = await pool.getConnection();
        await conn.query('SELECT 1');
        conn.release();
        return pool;
    } catch (err) {
        console.warn(`[db] connection failed: ${err.code || err.message}`);
        return null;
    }
}
