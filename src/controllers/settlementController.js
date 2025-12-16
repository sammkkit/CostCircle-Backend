import { pool } from "../db/db.js";

/**
 * GET /groups/:groupId/settlements
 */
export const getGroupSettlements = async (req, res) => {
    try {
        const groupId = req.params.groupId;
        const userId = req.userId;

        // 1️⃣ Ensure user is member of group
        const memberCheck = await pool.query(
            `SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2`,
            [groupId, userId]
        );

        if (memberCheck.rowCount === 0) {
            return res.status(403).json({ msg: "Not a group member" });
        }

        // 2️⃣ Get balances (same logic you already use)
        const balanceResult = await pool.query(
            `
      SELECT
        u.id AS user_id,
        u.name,
        COALESCE(SUM(
          CASE
            WHEN e.paid_by = u.id THEN e.amount
            ELSE 0
          END
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

        // 3️⃣ Run settlement algorithm
        const settlements = computeSettlements(balances);

        res.json(settlements);

    } catch (err) {
        console.error("SETTLEMENT ERROR:", err);
        res.status(500).json({ msg: "Server error" });
    }
};
function computeSettlements(balances) {
    const creditors = [];
    const debtors = [];

    for (const user of balances) {
        if (user.balance > 0.01) {
            creditors.push({ ...user });
        } else if (user.balance < -0.01) {
            debtors.push({ ...user });
        }
    }

    const settlements = [];
    let i = 0, j = 0;

    while (i < debtors.length && j < creditors.length) {
        const debtor = debtors[i];
        const creditor = creditors[j];

        const amount = Math.min(
            Math.abs(debtor.balance),
            creditor.balance
        );

        settlements.push({
            fromUserId: debtor.userId,
            fromName: debtor.name,
            toUserId: creditor.userId,
            toName: creditor.name,
            amount: Number(amount.toFixed(2))
        });

        debtor.balance += amount;
        creditor.balance -= amount;

        if (Math.abs(debtor.balance) < 0.01) i++;
        if (creditor.balance < 0.01) j++;
    }

    return settlements;
}
