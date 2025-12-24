/**
 * Transaction Atomicity Tests for CostCircle Backend
 * 
 * These tests verify that multi-step database operations are atomic:
 * - If any step fails, ALL changes are rolled back
 * - No partial data is left in the database
 */

import { jest, describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { pool, withTransaction } from '../src/db/db.js';
import {
    createTestUser,
    createTestGroup,
    addUserToGroup,
    cleanupTestData,
    getExpenseWithSplits,
    groupExists,
    isMember,
    closePool
} from './setup.js';

// Track test data for cleanup
let testUserIds = [];
let testGroupIds = [];
let testExpenseIds = [];

afterAll(async () => {
    // Clean up all test data
    await cleanupTestData({
        userIds: testUserIds,
        groupIds: testGroupIds,
        expenseIds: testExpenseIds
    });
    await closePool();
});

describe('withTransaction Helper', () => {
    it('should commit all changes when transaction succeeds', async () => {
        const userId = await createTestUser();
        testUserIds.push(userId);

        const groupId = await withTransaction(async (client) => {
            const result = await client.query(
                `INSERT INTO groups (name, created_by) VALUES ($1, $2) RETURNING id`,
                ['Transaction Test Group', userId]
            );
            const gId = result.rows[0].id;

            await client.query(
                `INSERT INTO group_members (group_id, user_id) VALUES ($1, $2)`,
                [gId, userId]
            );

            return gId;
        });

        testGroupIds.push(groupId);

        // Verify both group and member exist
        expect(await groupExists(groupId)).toBe(true);
        expect(await isMember(groupId, userId)).toBe(true);
    });

    it('should rollback all changes when transaction fails', async () => {
        const userId = await createTestUser();
        testUserIds.push(userId);

        let createdGroupId = null;

        try {
            await withTransaction(async (client) => {
                // This should succeed
                const result = await client.query(
                    `INSERT INTO groups (name, created_by) VALUES ($1, $2) RETURNING id`,
                    ['Rollback Test Group', userId]
                );
                createdGroupId = result.rows[0].id;

                // This should fail - invalid user_id (very large number)
                await client.query(
                    `INSERT INTO group_members (group_id, user_id) VALUES ($1, $2)`,
                    [createdGroupId, 999999999] // Non-existent user - will fail FK constraint
                );
            });
        } catch (error) {
            // Expected to fail
        }

        // The group should NOT exist because the transaction was rolled back
        if (createdGroupId) {
            const exists = await groupExists(createdGroupId);
            expect(exists).toBe(false);
        }
    });
});

describe('Expense Creation Atomicity', () => {
    let testUserId;
    let testGroupId;

    beforeAll(async () => {
        testUserId = await createTestUser();
        testUserIds.push(testUserId);

        testGroupId = await createTestGroup(testUserId);
        testGroupIds.push(testGroupId);
    });

    it('should create expense and all splits atomically on success', async () => {
        // Add another member to the group
        const secondUserId = await createTestUser();
        testUserIds.push(secondUserId);
        await addUserToGroup(testGroupId, secondUserId);

        // Create expense with splits using transaction
        const expenseId = await withTransaction(async (client) => {
            const expenseResult = await client.query(
                `INSERT INTO expenses (group_id, paid_by, amount, description)
                 VALUES ($1, $2, $3, $4) RETURNING id`,
                [testGroupId, testUserId, 100, 'Atomic Test Expense']
            );
            const eId = expenseResult.rows[0].id;

            // Get members
            const membersResult = await client.query(
                `SELECT user_id FROM group_members WHERE group_id = $1`,
                [testGroupId]
            );
            const splitAmount = 100 / membersResult.rows.length;

            // Insert splits
            for (const member of membersResult.rows) {
                await client.query(
                    `INSERT INTO expense_splits (expense_id, user_id, amount) VALUES ($1, $2, $3)`,
                    [eId, member.user_id, splitAmount]
                );
            }

            return eId;
        });

        testExpenseIds.push(expenseId);

        // Verify expense and splits both exist
        const { expense, splits } = await getExpenseWithSplits(expenseId);
        expect(expense).not.toBeNull();
        expect(expense.amount).toBe('100.00'); // Postgres returns as string
        expect(splits.length).toBeGreaterThanOrEqual(2);
    });

    it('should rollback expense if split insertion fails', async () => {
        let createdExpenseId = null;

        try {
            await withTransaction(async (client) => {
                const expenseResult = await client.query(
                    `INSERT INTO expenses (group_id, paid_by, amount, description)
                     VALUES ($1, $2, $3, $4) RETURNING id`,
                    [testGroupId, testUserId, 50, 'Should Be Rolled Back']
                );
                createdExpenseId = expenseResult.rows[0].id;

                // Force an error - invalid expense_id reference
                await client.query(
                    `INSERT INTO expense_splits (expense_id, user_id, amount) VALUES ($1, $2, $3)`,
                    [999999999, testUserId, 25] // Invalid expense_id
                );
            });
        } catch (error) {
            // Expected to fail
        }

        // The expense should NOT exist
        if (createdExpenseId) {
            const { expense } = await getExpenseWithSplits(createdExpenseId);
            expect(expense).toBeNull();
        }
    });
});

describe('Concurrent Transaction Safety', () => {
    let testUserId1, testUserId2;
    let testGroupId;

    beforeAll(async () => {
        testUserId1 = await createTestUser();
        testUserId2 = await createTestUser();
        testUserIds.push(testUserId1, testUserId2);

        testGroupId = await createTestGroup(testUserId1);
        testGroupIds.push(testGroupId);
        await addUserToGroup(testGroupId, testUserId2);
    });

    it('should handle concurrent expense additions without data corruption', async () => {
        // Simulate two users adding expenses at the same time
        const promises = [
            withTransaction(async (client) => {
                const result = await client.query(
                    `INSERT INTO expenses (group_id, paid_by, amount, description)
                     VALUES ($1, $2, $3, $4) RETURNING id`,
                    [testGroupId, testUserId1, 100, 'Concurrent Expense 1']
                );
                const eId = result.rows[0].id;
                await client.query(
                    `INSERT INTO expense_splits (expense_id, user_id, amount) VALUES ($1, $2, $3)`,
                    [eId, testUserId1, 50]
                );
                await client.query(
                    `INSERT INTO expense_splits (expense_id, user_id, amount) VALUES ($1, $2, $3)`,
                    [eId, testUserId2, 50]
                );
                return eId;
            }),
            withTransaction(async (client) => {
                const result = await client.query(
                    `INSERT INTO expenses (group_id, paid_by, amount, description)
                     VALUES ($1, $2, $3, $4) RETURNING id`,
                    [testGroupId, testUserId2, 200, 'Concurrent Expense 2']
                );
                const eId = result.rows[0].id;
                await client.query(
                    `INSERT INTO expense_splits (expense_id, user_id, amount) VALUES ($1, $2, $3)`,
                    [eId, testUserId1, 100]
                );
                await client.query(
                    `INSERT INTO expense_splits (expense_id, user_id, amount) VALUES ($1, $2, $3)`,
                    [eId, testUserId2, 100]
                );
                return eId;
            })
        ];

        const results = await Promise.all(promises);
        testExpenseIds.push(...results);

        // Both expenses should exist with correct splits
        for (const expenseId of results) {
            const { expense, splits } = await getExpenseWithSplits(expenseId);
            expect(expense).not.toBeNull();
            expect(splits.length).toBe(2);
        }
    });
});
