import { pool } from "../db/db.js";

//
// GET GROUP BALANCES
//
export const getGroupBalances = async (req, res) => {
    try {
        const { groupId } = req.params;
        const userId = req.userId;

        // 1️⃣ Verify requester is group member
        const memberCheck = await pool.query(
            "SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2",
            [groupId, userId]
        );

        if (memberCheck.rows.length === 0) {
            return res.status(403).json({ msg: "Not authorized" });
        }

        // 2️⃣ Get total paid per user
        const paidResult = await pool.query(
            `
      SELECT paid_by AS user_id, SUM(amount) AS paid
      FROM expenses
      WHERE group_id = $1
      GROUP BY paid_by
      `,
            [groupId]
        );

        // 3️⃣ Get total owed per user
        const owedResult = await pool.query(
            `
      SELECT es.user_id, SUM(es.amount) AS owed
      FROM expense_splits es
      JOIN expenses e ON es.expense_id = e.id
      WHERE e.group_id = $1
      GROUP BY es.user_id
      `,
            [groupId]
        );

        // 4️⃣ Get group members
        const membersResult = await pool.query(
            `
      SELECT u.id, u.name
      FROM users u
      JOIN group_members gm ON u.id = gm.user_id
      WHERE gm.group_id = $1
      `,
            [groupId]
        );

        // 5️⃣ Convert results to maps
        const paidMap = {};
        paidResult.rows.forEach(r => {
            paidMap[r.user_id] = Number(r.paid);
        });

        const owedMap = {};
        owedResult.rows.forEach(r => {
            owedMap[r.user_id] = Number(r.owed);
        });

        // 6️⃣ Compute balances
        const balances = membersResult.rows.map(member => {
            const paid = paidMap[member.id] || 0;
            const owed = owedMap[member.id] || 0;

            return {
                userId: member.id,
                name: member.name,
                balance: Number((paid - owed).toFixed(2))
            };
        });

        res.json(balances);

    } catch (err) {
        console.error("GET BALANCES ERROR:", err);
        res.status(500).json({ msg: "Server error" });
    }
};
