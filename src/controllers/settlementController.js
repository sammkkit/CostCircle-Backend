import { pool } from "../db/db.js";


export const getGroupFinancialSummary = async (req, res) => {
    try {
        const { groupId } = req.params;
        const userId = req.userId;

        // 1️⃣ Membership check
        const memberCheck = await pool.query(
            `
            SELECT 1 
            FROM group_members 
            WHERE group_id = $1 AND user_id = $2
            `,
            [groupId, userId]
        );

        if (memberCheck.rowCount === 0) {
            return res.status(403).json({ msg: "Not a group member" });
        }

        // 2️⃣ Compute balances cleanly
        // 2️⃣ Compute balances with Corrected Directional Math
const result = await pool.query(
    `
    WITH expense_paid AS (
        SELECT paid_by AS user_id, SUM(amount) AS total_paid
        FROM expenses
        WHERE group_id = $1
        GROUP BY paid_by
    ),
    expense_owed AS (
        SELECT es.user_id, SUM(es.amount) AS total_owed
        FROM expense_splits es
        JOIN expenses e ON e.id = es.expense_id
        WHERE e.group_id = $1
        GROUP BY es.user_id
    ),
    payment_net AS (
        SELECT 
            user_id,
            SUM(paid) - SUM(received) AS payment_adjustment -- FLIPPED: Paid is positive, Received is negative
        FROM (
            SELECT payer_id AS user_id, amount AS paid, 0 AS received
            FROM payments WHERE group_id = $1
            UNION ALL
            SELECT receiver_id AS user_id, 0 AS paid, amount AS received
            FROM payments WHERE group_id = $1
        ) t
        GROUP BY user_id
    )
    SELECT 
        u.id AS user_id,
        u.name,
        (COALESCE(ep.total_paid, 0) - COALESCE(eo.total_owed, 0)) -- Current Debt/Credit from expenses
        + COALESCE(pn.payment_adjustment, 0) AS balance         -- Adjustment from Settle Up
    FROM users u
    JOIN group_members gm ON gm.user_id = u.id
    LEFT JOIN expense_paid ep ON ep.user_id = u.id
    LEFT JOIN expense_owed eo ON eo.user_id = u.id
    LEFT JOIN payment_net pn ON pn.user_id = u.id
    WHERE gm.group_id = $1
    ORDER BY balance DESC
    `,
    [groupId]
);

        const balances = result.rows.map(row => ({
            userId: row.user_id,
            name: row.name,
            balance: Number(row.balance)
        }));

        const settlements = computeSettlements(balances);

        res.json({
            groupId,
            settlements
        });

    } catch (err) {
        console.error("FINANCIAL SUMMARY ERROR:", err);
        res.status(500).json({ msg: "Server error" });
    }
};


function computeSettlements(balances) {
    const receivers = balances
        .filter(u => u.balance > 0.01)
        .map(u => ({ ...u }));

    const payers = balances
        .filter(u => u.balance < -0.01)
        .map(u => ({ ...u }));

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
