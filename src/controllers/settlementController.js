/**
 * GET /groups/:groupId/financial-summary
 */
// settlementController.js
import { pool } from "../db/db.js";

export const getGroupFinancialSummary = async (req, res) => {
    try {
        const groupId = req.params.groupId;
        const userId = req.userId;

        // Ensure user is member of group
        const memberCheck = await pool.query(
            `SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2`,
            [groupId, userId]
        );

        if (memberCheck.rowCount === 0) {
            return res.status(403).json({ msg: "Not a group member" });
        }

        // Get balances
        const balanceResult = await pool.query(
            `
            SELECT
                u.id AS user_id,
                u.name,
                COALESCE(SUM(
                    CASE WHEN e.paid_by = u.id THEN e.amount ELSE 0 END
                ), 0)
                -
                COALESCE(SUM(es.amount), 0) AS balance
            FROM users u
            JOIN group_members gm ON gm.user_id = u.id
            LEFT JOIN expenses e ON e.group_id = gm.group_id
            LEFT JOIN expense_splits es 
                ON es.expense_id = e.id AND es.user_id = u.id
            WHERE gm.group_id = $1
            GROUP BY u.id, u.name
            `,
            [groupId]
        );

        const balances = balanceResult.rows.map(row => ({
            userId: row.user_id,
            name: row.name,
            balance: Number(row.balance)
        }));

        const settlements = computeGroupSettlements(balances);

        res.json({
            groupId,
            settlements
        });

    } catch (err) {
        console.error("FINANCIAL SUMMARY ERROR:", err);
        res.status(500).json({ msg: "Server error" });
    }
};

function computeGroupSettlements(balances) {
    const receivers = [];
    const payers = [];

    for (const user of balances) {
        if (user.balance > 0.01) {
            receivers.push({ ...user });
        } else if (user.balance < -0.01) {
            payers.push({ ...user });
        }
    }

    const settlements = [];
    let i = 0, j = 0;

    while (i < payers.length && j < receivers.length) {
        const payer = payers[i];
        const receiver = receivers[j];

        const amount = Math.min(
            Math.abs(payer.balance),
            receiver.balance
        );

        settlements.push({
            payerUserId: payer.userId,
            payerName: payer.name,
            receiverUserId: receiver.userId,
            receiverName: receiver.name,
            amount: Number(amount.toFixed(2))
        });

        payer.balance += amount;
        receiver.balance -= amount;

        if (Math.abs(payer.balance) < 0.01) i++;
        if (receiver.balance < 0.01) j++;
    }

    return settlements;
}
