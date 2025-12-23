import { pool } from "../db/db.js";
import sleep from "../utils/delay.js";
//
// CREATE GROUP
//
export const createGroup = async (req, res) => {
    // Generate a quick random ID to track this specific execution instance
    const debugId = Math.random().toString(36).substring(7);
    const timestamp = new Date().toISOString();

    console.log(`\n--- [DEBUG_START: ${debugId}] ---`);
    console.log(`Time: ${timestamp}`);
    
    try {
        const { name } = req.body;
        const userId = req.userId;

        console.log(`[${debugId}] User ID:`, userId);
        console.log(`[${debugId}] Group Name:`, name);

        if (!name) {
            console.log(`[${debugId}] VALIDATION FAILED: Name is missing`);
            return res.status(400).json({ msg: "Group name required" });
        }

        // Check if a group with this exact name and creator was JUST made (Self-Correction)
        console.log(`[${debugId}] Executing Group INSERT...`);
        const result = await pool.query(
            "INSERT INTO groups (name, created_by) VALUES ($1, $2) RETURNING id",
            [name, userId]
        );

        const groupId = result.rows[0].id;
        console.log(`[${debugId}] SUCCESS: Created group ID:`, groupId);

        console.log(`[${debugId}] Executing Member INSERT for userId: ${userId}...`);
        const memberResult = await pool.query(
            "INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) RETURNING *",
            [groupId, userId]
        );

        console.log(`[${debugId}] SUCCESS: Inserted into group_members`);
        console.log(`--- [DEBUG_END: ${debugId}] ---\n`);

        res.status(201).json({
            msg: "Group created",
            groupId
        });

    } catch (err) {
        console.error(`[${debugId}] !!! CREATE GROUP ERROR:`, err);
        console.log(`--- [DEBUG_END: ${debugId}] WITH ERROR ---\n`);
        res.status(500).json({ msg: "Server error" });
    }
};

//
// LIST MY GROUPS
//
// Update in your groups controller
export const getMyGroups = async (req, res) => {
    try {
        const userId = req.userId;

        const result = await pool.query(
            `
            SELECT 
                g.id, 
                g.name, 
                g.created_at,
                -- Total you paid minus total you owe in this specific group
                COALESCE((SELECT SUM(amount) FROM expenses WHERE group_id = g.id AND paid_by = $1), 0) - 
                COALESCE((SELECT SUM(es.amount) FROM expense_splits es 
                          JOIN expenses e ON es.expense_id = e.id 
                          WHERE e.group_id = g.id AND es.user_id = $1), 0) AS balance
            FROM groups g
            JOIN group_members gm ON g.id = gm.group_id
            WHERE gm.user_id = $1
            ORDER BY g.created_at DESC
            `,
            [userId]
        );

        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ msg: "Server error" });
    }
};
//
// ADD MEMBER TO GROUP
//
export const addMemberToGroup = async (req, res) => {
    try {
        const { groupId } = req.params;
        const { email } = req.body;
        const userId = req.userId;

        if (!email) {
            return res.status(400).json({ msg: "Email required" });
        }

        // 1️⃣ Check if requester is group member
        const membership = await pool.query(
            "SELECT id FROM group_members WHERE group_id=$1 AND user_id=$2",
            [groupId, userId]
        );

        if (membership.rows.length === 0) {
            return res.status(403).json({ msg: "Not a group member" });
        }

        // 2️⃣ Find user by email
        const userResult = await pool.query(
            "SELECT id FROM users WHERE email=$1",
            [email]
        );

        if (userResult.rows.length === 0) {
            return res.status(404).json({ msg: "User not found" });
        }

        const newUserId = userResult.rows[0].id;

        // 3️⃣ Prevent duplicate membership
        const exists = await pool.query(
            "SELECT id FROM group_members WHERE group_id=$1 AND user_id=$2",
            [groupId, newUserId]
        );

        if (exists.rows.length > 0) {
            return res.status(400).json({ msg: "User already in group" });
        }

        // 4️⃣ Add member
        await pool.query(
            "INSERT INTO group_members (group_id, user_id) VALUES ($1, $2)",
            [groupId, newUserId]
        );

        res.json({ msg: "Member added to group" });

    } catch (err) {
        console.error("ADD MEMBER ERROR:", err);
        res.status(500).json({ msg: "Server error" });
    }
};

//
// GET GROUP MEMBERS
//
export const getGroupMembers = async (req, res) => {
    try {
        const { groupId } = req.params;
        const userId = req.userId;

        if (!groupId) {
            return res.status(400).json({ msg: "Group ID required" });
        }

        // 1️⃣ Check if requester is group member
        const membership = await pool.query(
            "SELECT id FROM group_members WHERE group_id=$1 AND user_id=$2",
            [groupId, userId]
        );

        if (membership.rows.length === 0) {
            return res.status(403).json({ msg: "Not a group member" });
        }

        // 2️⃣ Get group members
        const result = await pool.query(
            "SELECT u.id, u.name, u.email FROM users u JOIN group_members gm ON u.id = gm.user_id WHERE gm.group_id = $1",
            [groupId]
        );

        res.json(result.rows);

    } catch (err) {
        console.error("GET GROUP MEMBERS ERROR:", err);
        res.status(500).json({ msg: "Server error" });
    }
};
//
// ADD EXPENSE (EQUAL SPLIT)
//
export const addExpense = async (req, res) => {
    try {
        const { groupId } = req.params;
        const { amount, description, paidBy } = req.body;
        const userId = req.userId;

        if (!amount || amount <= 0 || !paidBy) {
            return res.status(400).json({ msg: "Invalid expense data" });
        }

        // 1️⃣ Check requester is group member
        const memberCheck = await pool.query(
            "SELECT id FROM group_members WHERE group_id=$1 AND user_id=$2",
            [groupId, userId]
        );

        if (memberCheck.rows.length === 0) {
            return res.status(403).json({ msg: "Not a group member" });
        }

        // 2️⃣ Check paidBy is group member
        const paidByCheck = await pool.query(
            "SELECT id FROM group_members WHERE group_id=$1 AND user_id=$2",
            [groupId, paidBy]
        );

        if (paidByCheck.rows.length === 0) {
            return res.status(400).json({ msg: "paidBy must be group member" });
        }

        // 3️⃣ Create expense
        const expenseResult = await pool.query(
            `
      INSERT INTO expenses (group_id, paid_by, amount, description)
      VALUES ($1, $2, $3, $4)
      RETURNING id
      `,
            [groupId, paidBy, amount, description || null]
        );

        const expenseId = expenseResult.rows[0].id;

        // 4️⃣ Get all group members
        const membersResult = await pool.query(
            "SELECT user_id FROM group_members WHERE group_id=$1",
            [groupId]
        );

        const members = membersResult.rows;
        const splitAmount = Number(amount) / members.length;

        // 5️⃣ Insert splits
        for (const member of members) {
            await pool.query(
                `
        INSERT INTO expense_splits (expense_id, user_id, amount)
        VALUES ($1, $2, $3)
        `,
                [expenseId, member.user_id, splitAmount]
            );
        }

        res.status(201).json({
            msg: "Expense added",
            expenseId
        });

    } catch (err) {
        console.error("ADD EXPENSE ERROR:", err);
        res.status(500).json({ msg: "Server error" });
    }
};


export const getGroupsSummary = async (req, res) => {
    try {
        const userId = req.userId;

        // This query calculates the specific net balance for the LOGGED-IN user
        // by subtracting what they owe (splits) from what they paid (expenses).
        const result = await pool.query(
            `
            SELECT 
                g.id, 
                g.name, 
                COALESCE(SUM(CASE WHEN e.paid_by = $1 THEN e.amount ELSE 0 END), 0) - 
                COALESCE(SUM(es.amount), 0) AS user_net_balance,
                (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as member_count
            FROM groups g
            JOIN group_members gm ON g.id = gm.group_id
            LEFT JOIN expenses e ON e.group_id = g.id
            LEFT JOIN expense_splits es ON es.expense_id = e.id AND es.user_id = $1
            WHERE gm.user_id = $1
            GROUP BY g.id, g.name
            ORDER BY g.id DESC
            `,
            [userId]
        );

        // Ensure numbers are formatted correctly
        const summary = result.rows.map(row => ({
            groupId: row.id,
            groupName: row.name,
            netAmount: parseFloat(row.user_net_balance).toFixed(2),
            direction: row.user_net_balance < 0 ? "YOU_OWE" : row.user_net_balance > 0 ? "YOU_ARE_OWED" : "SETTLED",
            memberCount: parseInt(row.member_count)
        }));

        res.json(summary);
    } catch (err) {
        console.error("SUMMARY ERROR:", err);
        res.status(500).json({ msg: "Server error" });
    }
};


//
// BULK ADD MEMBERS TO GROUP
//
export const addMembersBulk = async (req, res) => {
    try {
        const { groupId } = req.params;
        const { emails } = req.body; // Expecting { "emails": ["a@b.com", "c@d.com"] }
        const requesterId = req.userId;

        if (!emails || !Array.isArray(emails) || emails.length === 0) {
            return res.status(400).json({ msg: "Valid emails array required" });
        }

        // 1. Check if requester is a group member
        const membership = await pool.query(
            "SELECT id FROM group_members WHERE group_id=$1 AND user_id=$2",
            [groupId, requesterId]
        );

        if (membership.rows.length === 0) {
            return res.status(403).json({ msg: "Not authorized to add members to this group" });
        }

        // 2. Find existing users for these emails
        const userResults = await pool.query(
            "SELECT id, email FROM users WHERE email = ANY($1)",
            [emails]
        );

        const foundUserIds = userResults.rows.map(row => row.id);
        const foundEmails = userResults.rows.map(row => row.email);
        const missingEmails = emails.filter(e => !foundEmails.includes(e));

        if (foundUserIds.length === 0) {
            return res.status(404).json({ 
                msg: "No users found for the provided emails", 
                missingEmails 
            });
        }

        // 3. Add valid users (ignoring those already in the group to prevent errors)
        // Using "INSERT INTO ... SELECT ... ON CONFLICT DO NOTHING"
        await pool.query(
            `
            INSERT INTO group_members (group_id, user_id)
            SELECT $1, unnest($2::int[])
            ON CONFLICT (group_id, user_id) DO NOTHING
            `,
            [groupId, foundUserIds]
        );

        res.json({
            msg: `${foundUserIds.length} users processed`,
            addedCount: foundUserIds.length,
            missingEmails: missingEmails // Send back emails that don't have an account
        });

    } catch (err) {
        console.error("BULK ADD ERROR:", err);
        res.status(500).json({ msg: "Server error" });
    }
};

//
// GET GROUP EXPENSE HISTORY (TRANSACTIONS)
//
export const getGroupExpenses = async (req, res) => {
    try {
        const { groupId } = req.params;
        const userId = req.userId;

        // 1. Authorization Check
        const membership = await pool.query(
            "SELECT id FROM group_members WHERE group_id=$1 AND user_id=$2",
            [groupId, userId]
        );

        if (membership.rows.length === 0) {
            return res.status(403).json({ msg: "Not authorized to view this group" });
        }

        // 2. Fetch Expenses with Payer Info
        const result = await pool.query(
            `
            SELECT 
                e.id, 
                e.description, 
                e.amount, 
                e.created_at,
                u.name AS paid_by_name,
                e.paid_by = $2 AS was_paid_by_me
            FROM expenses e
            JOIN users u ON e.paid_by = u.id
            WHERE e.group_id = $1
            ORDER BY e.created_at DESC
            `,
            [groupId, userId]
        );

        res.json(result.rows);

    } catch (err) {
        console.error("GET EXPENSES ERROR:", err);
        res.status(500).json({ msg: "Server error" });
    }
};