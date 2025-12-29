import { pool } from "../db/db.js";

export const getUserActivity = async (req, res) => {
    try {
        const userId = req.userId;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const offset = (page - 1) * limit;

        const groupCheck = await pool.query(
            `SELECT group_id FROM group_members WHERE user_id = $1`,
            [userId]
        );
        const groupIds = groupCheck.rows.map(row => row.group_id);

        if (groupIds.length === 0) {
            return res.json([]);
        }

        // 🚀 UPDATED QUERY: Joins with 'users' table to fetch names
        const query = `
            SELECT 
                t.id,
                t.description,
                t.amount,
                t.paid_by as "payerId",
                t.receiver_id as "receiverId",
                t.created_at as "createdAt",
                t.type,
                t.category,
                g.name as "groupName",
                u1.name as "payerName",      -- <--- NEW
                u2.name as "receiverName"    -- <--- NEW
            FROM (
                SELECT id, description, amount, paid_by, NULL as receiver_id, created_at, 'EXPENSE' as type, category, group_id 
                FROM expenses WHERE group_id = ANY($1)
                UNION ALL
                SELECT id, 'Payment', amount, payer_id, receiver_id, created_at, 'SETTLEMENT' as type, 'PAYMENT', group_id 
                FROM payments WHERE group_id = ANY($1)
            ) t
            JOIN groups g ON t.group_id = g.id
            LEFT JOIN users u1 ON t.paid_by = u1.id      -- Join for Payer Name
            LEFT JOIN users u2 ON t.receiver_id = u2.id  -- Join for Receiver Name
            ORDER BY t.created_at DESC
            LIMIT $2 OFFSET $3
        `;

        const result = await pool.query(query, [groupIds, limit, offset]);
        res.json(result.rows);

    } catch (err) {
        console.error("ACTIVITY ERROR:", err);
        res.status(500).json({ msg: "Server error" });
    }
};

// CHECK IF USER EXISTS (New Endpoint)
export const checkUserExists = async (req, res) => {
    try {
        const { email } = req.body;
        // Simple check
        const result = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ msg: "User not found" });
        }
        res.status(200).json({ msg: "User found" });
        
    } catch (err) {
        res.status(500).json({ msg: "Server error" });
    }
};
