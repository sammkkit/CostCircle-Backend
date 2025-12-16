import { pool } from "../db/db.js";

//
// CREATE GROUP
//
export const createGroup = async (req, res) => {
    try {
        const { name } = req.body;
        const userId = req.userId;

        console.log("CREATE GROUP called");
        console.log("User ID from token:", userId);
        console.log("Group name:", name);

        if (!name) {
            return res.status(400).json({ msg: "Group name required" });
        }

        // Create group
        const result = await pool.query(
            "INSERT INTO groups (name, created_by) VALUES ($1, $2) RETURNING id",
            [name, userId]
        );

        const groupId = result.rows[0].id;
        console.log("Created group ID:", groupId);

        // Add creator as member
        const memberResult = await pool.query(
            "INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) RETURNING *",
            [groupId, userId]
        );

        console.log("Inserted into group_members:", memberResult.rows[0]);

        res.status(201).json({
            msg: "Group created",
            groupId
        });

    } catch (err) {
        console.error("CREATE GROUP ERROR:", err);
        res.status(500).json({ msg: "Server error" });
    }
};

//
// LIST MY GROUPS
//
export const getMyGroups = async (req, res) => {
    try {
        const userId = req.userId;

        console.log("GET GROUPS called");
        console.log("User ID from token:", userId);

        const result = await pool.query(
            `
      SELECT g.id, g.name, g.created_at, gm.user_id
      FROM groups g
      JOIN group_members gm ON g.id = gm.group_id
      WHERE gm.user_id = $1
      ORDER BY g.created_at DESC
      `,
            [userId]
        );

        console.log("Groups query result:", result.rows);

        res.json(result.rows);

    } catch (err) {
        console.error("GET GROUPS ERROR:", err);
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


