/**
 * Test Setup and Utilities for CostCircle Backend
 * 
 * This file provides helper functions for:
 * - Setting up test database state
 * - Creating test users and groups
 * - Cleaning up after tests
 */

import { pool, withTransaction } from '../src/db/db.js';

/**
 * Create a test user and return their ID
 */
export const createTestUser = async (email = `test-${Date.now()}@example.com`) => {
    const result = await pool.query(
        `INSERT INTO users (name, email, password) 
         VALUES ($1, $2, $3) 
         RETURNING id`,
        [`Test User ${Date.now()}`, email, 'hashedpassword123']
    );
    return result.rows[0].id;
};

/**
 * Create a test group with creator as member
 */
export const createTestGroup = async (creatorId, groupName = `Test Group ${Date.now()}`) => {
    return await withTransaction(async (client) => {
        const groupResult = await client.query(
            `INSERT INTO groups (name, created_by) VALUES ($1, $2) RETURNING id`,
            [groupName, creatorId]
        );
        const groupId = groupResult.rows[0].id;

        await client.query(
            `INSERT INTO group_members (group_id, user_id) VALUES ($1, $2)`,
            [groupId, creatorId]
        );

        return groupId;
    });
};

/**
 * Add a user to a group
 */
export const addUserToGroup = async (groupId, userId) => {
    await pool.query(
        `INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [groupId, userId]
    );
};

/**
 * Clean up test data by IDs
 */
export const cleanupTestData = async ({ userIds = [], groupIds = [], expenseIds = [] }) => {
    // Delete in order of dependencies
    if (expenseIds.length > 0) {
        await pool.query(`DELETE FROM expense_splits WHERE expense_id = ANY($1)`, [expenseIds]);
        await pool.query(`DELETE FROM expenses WHERE id = ANY($1)`, [expenseIds]);
    }
    
    if (groupIds.length > 0) {
        await pool.query(`DELETE FROM payments WHERE group_id = ANY($1)`, [groupIds]);
        await pool.query(`DELETE FROM expense_splits WHERE expense_id IN (SELECT id FROM expenses WHERE group_id = ANY($1))`, [groupIds]);
        await pool.query(`DELETE FROM expenses WHERE group_id = ANY($1)`, [groupIds]);
        await pool.query(`DELETE FROM group_members WHERE group_id = ANY($1)`, [groupIds]);
        await pool.query(`DELETE FROM groups WHERE id = ANY($1)`, [groupIds]);
    }
    
    if (userIds.length > 0) {
        await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [userIds]);
    }
};

/**
 * Get expense with splits
 */
export const getExpenseWithSplits = async (expenseId) => {
    const expense = await pool.query(`SELECT * FROM expenses WHERE id = $1`, [expenseId]);
    const splits = await pool.query(`SELECT * FROM expense_splits WHERE expense_id = $1`, [expenseId]);
    return {
        expense: expense.rows[0] || null,
        splits: splits.rows
    };
};

/**
 * Check if a group exists
 */
export const groupExists = async (groupId) => {
    const result = await pool.query(`SELECT id FROM groups WHERE id = $1`, [groupId]);
    return result.rows.length > 0;
};

/**
 * Check if user is member of group
 */
export const isMember = async (groupId, userId) => {
    const result = await pool.query(
        `SELECT id FROM group_members WHERE group_id = $1 AND user_id = $2`,
        [groupId, userId]
    );
    return result.rows.length > 0;
};

/**
 * Close database pool after all tests
 */
export const closePool = async () => {
    await pool.end();
};
