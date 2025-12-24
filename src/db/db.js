import pkg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pkg;

export const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false // Required for most cloud databases (Render/Neon)
    }
});

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
