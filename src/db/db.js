
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';

// If we are on localhost, the connection string usually contains "localhost" or "127.0.0.1"
const isLocal = process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost');

const poolConfig = {
    connectionString: process.env.DATABASE_URL,
    // Only use SSL if we are NOT running locally
    ssl: isLocal ? false : { rejectUnauthorized: false }
};

export const pool = new pg.Pool(poolConfig);
/**
 * Execute multiple queries in an atomic transaction.
 * If any query fails, all changes are rolled back.
 * 
 * @param {Function} callback - Async function receiving a client to execute queries
 * @returns {Promise<any>} - Result from the callback
 * 
 * @example
 * const result = await withTransaction(async (client) => {
 *     await client.query('INSERT INTO...');
 *     await client.query('INSERT INTO...');
 *     return { success: true };
 * });
 */
export const withTransaction = async (callback) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};
