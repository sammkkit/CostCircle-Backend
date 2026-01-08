import { pool, withTransaction } from "../db/db.js";
import sleep from "../utils/delay.js";
import { sendNotification } from "../controllers/notificationController.js";
//
// CREATE GROUP
//
export const createGroup = async (req, res) => {
    const debugId = Math.random().toString(36).substring(7);
    console.log(`\n--- [DEBUG_START: ${debugId}] ---`);
    
    try {
        const { name } = req.body;
        const userId = req.userId;

        console.log(`[${debugId}] User ID:`, userId);
        console.log(`[${debugId}] Group Name:`, name);

        if (!name) {
            console.log(`[${debugId}] VALIDATION FAILED: Name is missing`);
            return res.status(400).json({ msg: "Group name required" });
        }

        // 🔒 ATOMIC TRANSACTION: Both group and member are created together
        // If member insert fails, the group is also rolled back
        const groupId = await withTransaction(async (client) => {
            console.log(`[${debugId}] BEGIN TRANSACTION`);
            
            // Create group
            const result = await client.query(
                "INSERT INTO groups (name, created_by) VALUES ($1, $2) RETURNING id",
                [name, userId]
            );
            const newGroupId = result.rows[0].id;
            console.log(`[${debugId}] Created group ID:`, newGroupId);

            // Add creator as member
            await client.query(
                "INSERT INTO group_members (group_id, user_id) VALUES ($1, $2)",
                [newGroupId, userId]
            );
            console.log(`[${debugId}] Added creator as member`);
            
            return newGroupId;
        });

        console.log(`[${debugId}] TRANSACTION COMMITTED`);
        console.log(`--- [DEBUG_END: ${debugId}] ---\n`);

        res.status(201).json({
            msg: "Group created",
            groupId
        });

    } catch (err) {
        console.error(`[${debugId}] !!! CREATE GROUP ERROR (ROLLED BACK):`, err);
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
        (async () => {
            try {
                // 1. Get Group Name & Admin Name for the message
                const groupRes = await pool.query("SELECT name FROM groups WHERE id = $1", [groupId]);
                const adminRes = await pool.query("SELECT name FROM users WHERE id = $1", [req.userId]);
                
                const groupName = groupRes.rows[0]?.name || "a group";
                const adminName = adminRes.rows[0]?.name || "Admin";

                // 2. We have the list of 'idsToAdd' (the users we just inserted)
                // Note: Make sure 'idsToAdd' is available from your logic above
                for (const newMemberId of idsToAdd) {
                    await sendNotification(
                        newMemberId,
                        "New Group Added! 🎉",
                        `${adminName} added you to '${groupName}'`,
                        { 
                            type: "GROUP_INVITE", 
                            groupId: groupId.toString() 
                        }
                    );
                }
            } catch (notifyErr) {
                console.error("NOTIFICATION ERROR (Ignored):", notifyErr);
            }
        })();
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
// ADD EXPENSE (HANDLES EQUAL, EXACT, & PERCENTAGE)
//
export const addExpense = async (req, res) => {
    // Start a client for the transaction
    const client = await pool.connect();
    
    try {
        const { groupId } = req.params;
        const { description, amount, paidBy, splitType = 'EQUAL', splits,category = 'GENERAL' } = req.body;
        // splits structure example: [{ userId: 1, value: 50 }, { userId: 2, value: 25 }] 
        
        const requesterId = req.userId;
        const totalAmount = Number(amount);

        if (!totalAmount || totalAmount <= 0) {
            return res.status(400).json({ msg: "Invalid amount" });
        }

        // 1. Authorization: Requester must be in the group
        const membershipCheck = await client.query(
            "SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2",
            [groupId, requesterId]
        );
        if (membershipCheck.rowCount === 0) {
            return res.status(403).json({ msg: "You are not a member of this group" });
        }

        // 2. Validation: Payer must be in the group
        // If paidBy is not provided, assume the requester paid
        const actualPayerId = paidBy || requesterId;
        const payerCheck = await client.query(
            "SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2",
            [groupId, actualPayerId]
        );
        if (payerCheck.rowCount === 0) {
            return res.status(400).json({ msg: "Payer must be a group member" });
        }

        // --- NEW VALIDATION: Ensure all split users are in the group ---
        if (splits && splits.length > 0) {
            const splitUserIds = splits.map(s => s.userId);
            
            // Query DB to find which of these IDs are valid members
            // usage of ANY($2::int[]) allows us to check an array of IDs in one query
            const validMembersRes = await client.query(
                "SELECT user_id FROM group_members WHERE group_id = $1 AND user_id = ANY($2::int[])",
                [groupId, splitUserIds]
            );

            const validMemberIds = validMembersRes.rows.map(r => r.user_id);
            
            // Find invalid IDs (IDs requested but not found in the group)
            const invalidIds = splitUserIds.filter(id => !validMemberIds.includes(id));

            if (invalidIds.length > 0) {
                return res.status(400).json({ 
                    msg: `Users [${invalidIds.join(', ')}] are not members of this group` 
                });
            }
        }
        // --- END NEW VALIDATION ---

        // 3. Logic: Calculate Shares based on Split Type
        let finalSplits = []; 

        // Default: If no 'splits' array sent, assume EQUAL split among ALL members
        let targetUsers = splits;
        if (!targetUsers || targetUsers.length === 0) {
             const allMembers = await client.query(
                "SELECT user_id FROM group_members WHERE group_id = $1",
                [groupId]
            );
            targetUsers = allMembers.rows.map(m => ({ userId: m.user_id }));
        }

        if (splitType === 'EQUAL') {
            // Distribute amount equally, handling pennies
            const count = targetUsers.length;
            const baseShare = Math.floor((totalAmount / count) * 100) / 100; // Round down to 2 decimals
            let remainder = Math.round((totalAmount - (baseShare * count)) * 100); 

            finalSplits = targetUsers.map(u => {
                let share = baseShare;
                if (remainder > 0) {
                    share += 0.01; 
                    remainder--;
                }
                return { userId: u.userId, amount: Number(share.toFixed(2)) };
            });

        } else if (splitType === 'EXACT') {
            // Validation: Sum must match Total
            let sum = 0;
            finalSplits = targetUsers.map(s => {
                const val = Number(s.value || 0);
                sum += val;
                return { userId: s.userId, amount: val };
            });

            if (Math.abs(totalAmount - sum) > 0.01) {
                return res.status(400).json({ msg: `Sum (${sum}) does not match Total (${totalAmount})` });
            }

        } else if (splitType === 'PERCENTAGE') {
            // Logic: (Total * Percent) / 100
            let sumPercent = 0;
            let currentSumAmount = 0;

            finalSplits = targetUsers.map((s) => {
                const val = Number(s.value || 0);
                sumPercent += val;
                
                let rawShare = (totalAmount * val) / 100;
                let roundedShare = Math.round(rawShare * 100) / 100; 

                currentSumAmount += roundedShare;
                return { userId: s.userId, amount: roundedShare };
            });

            if (Math.abs(100 - sumPercent) > 0.1) {
                return res.status(400).json({ msg: `Percentages sum to ${sumPercent}%, expected 100%` });
            }

            // Fix Penny Rounding on the first person
            let diff = totalAmount - currentSumAmount;
            if (Math.abs(diff) > 0.001) {
                finalSplits[0].amount += diff;
                finalSplits[0].amount = Number(finalSplits[0].amount.toFixed(2));
            }
        }

        // 4. DATABASE TRANSACTION
        await client.query('BEGIN');

        // A. Insert Expense
       const expenseRes = await client.query(
            `INSERT INTO expenses (description, amount, paid_by, group_id, split_type, category) 
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [description, totalAmount, actualPayerId, groupId, splitType, category] // <--- Added category here
        );
        const expenseId = expenseRes.rows[0].id;

        // B. Insert Splits
        const splitQueryValues = [];
        const splitParams = [];
        let paramIndex = 1;

        finalSplits.forEach(split => {
            splitQueryValues.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2})`);
            splitParams.push(expenseId, split.userId, split.amount);
            paramIndex += 3;
        });

        const splitQuery = `
            INSERT INTO expense_splits (expense_id, user_id, amount)
            VALUES ${splitQueryValues.join(", ")}
        `;

        await client.query(splitQuery, splitParams);

        await client.query('COMMIT');
        // 🔔 NEW: Send Notifications (Fire and Forget)
        // We don't await this because we don't want to slow down the response 
        // if notifications take time.
        (async () => {
            try {
                // 1. Get all group members EXCEPT the person who added the expense
                const membersRes = await pool.query(
                    "SELECT user_id FROM group_members WHERE group_id = $1 AND user_id != $2",
                    [groupId, requesterId]
                );
                
                // 2. Get the name of the person who added it (for the message body)
                const userRes = await pool.query("SELECT name FROM users WHERE id = $1", [requesterId]);
                const payerName = userRes.rows[0]?.name || "Someone";

                // 3. Loop and send
                const memberIds = membersRes.rows.map(row => row.user_id);
                
                for (const memberId of memberIds) {
                    await sendNotification(
                        memberId,
                        "New Expense Added 💸", 
                        `${payerName} added '${description}' for ₹${totalAmount}`,
                        { 
                            type: "EXPENSE_ADDED", 
                            groupId: groupId.toString() 
                        }
                    );
                }
            } catch (notifyErr) {
                console.error("NOTIFICATION ERROR (Ignored):", notifyErr);
            }
        })();
        res.status(201).json({ 
            msg: "Expense added successfully", 
            expenseId,
            splits: finalSplits 
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error("ADD EXPENSE ERROR:", err);
        res.status(500).json({ msg: "Server Error" });
    } finally {
        client.release();
    }
};

// controllers/groupController.js
export const getGroupsSummary = async (req, res) => {
    try {
        const userId = req.userId;

        const result = await pool.query(
            `
            WITH MyExpenses AS (
                -- 1. Total amount I physically paid for expenses in each group
                SELECT group_id, SUM(amount) as total_paid
                FROM expenses
                WHERE paid_by = $1
                GROUP BY group_id
            ),
            MySplits AS (
                -- 2. Total amount I was supposed to pay (my share) in each group
                SELECT e.group_id, SUM(es.amount) as total_share
                FROM expense_splits es
                JOIN expenses e ON es.expense_id = e.id
                WHERE es.user_id = $1
                GROUP BY e.group_id
            ),
            MyPaymentsSent AS (
                -- 3. Total Settle-Up payments I SENT to others
                SELECT group_id, SUM(amount) as amt
                FROM payments
                WHERE payer_id = $1
                GROUP BY group_id
            ),
            MyPaymentsReceived AS (
                -- 4. Total Settle-Up payments I RECEIVED from others
                SELECT group_id, SUM(amount) as amt
                FROM payments
                WHERE receiver_id = $1
                GROUP BY group_id
            )
            SELECT 
                g.id, 
                g.name, 
                -- THE MASTER FORMULA:
                -- (What I Paid - My Share) + (Payments I Sent - Payments I Got)
                (
                    (COALESCE(me.total_paid, 0) - COALESCE(ms.total_share, 0)) + 
                    (COALESCE(mps.amt, 0) - COALESCE(mpr.amt, 0))
                ) AS final_net_balance,
                (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as member_count
            FROM groups g
            JOIN group_members gm ON g.id = gm.group_id
            LEFT JOIN MyExpenses me ON me.group_id = g.id
            LEFT JOIN MySplits ms ON ms.group_id = g.id
            LEFT JOIN MyPaymentsSent mps ON mps.group_id = g.id
            LEFT JOIN MyPaymentsReceived mpr ON mpr.group_id = g.id
            WHERE gm.user_id = $1
            ORDER BY g.created_at DESC;
            `,
            [userId]
        );

        const summary = result.rows.map(row => {
            const balance = parseFloat(row.final_net_balance);
            
            // Logic: 
            // - Negative Balance: I owe money (Red)
            // - Positive Balance: I am owed money (Green)
            // - Near Zero: Settled
            
            let direction = "SETTLED";
            if (balance < -0.01) direction = "YOU_OWE";
            if (balance > 0.01) direction = "YOU_ARE_OWED";

            return {
                groupId: row.id,
                groupName: row.name,
                // SEND RAW NUMBER for ViewModel math, format on UI only
                netAmount: Math.abs(balance), 
                direction: direction,
                memberCount: parseInt(row.member_count)
            };
        });

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
        // 🔔 NEW: Send Notifications (Logic Added Here)
        (async () => {
            try {
                // Get Group Name & Requester Name
                const groupRes = await pool.query("SELECT name FROM groups WHERE id = $1", [groupId]);
                const requesterRes = await pool.query("SELECT name FROM users WHERE id = $1", [requesterId]);
                
                const groupName = groupRes.rows[0]?.name || "a group";
                const requesterName = requesterRes.rows[0]?.name || "Someone";

                // Notify all found users
                for (const memberId of foundUserIds) {
                    // Don't notify yourself if you somehow added your own email
                    if (memberId === requesterId) continue;

                    await sendNotification(
                        memberId,
                        "New Group Added! 🎉",
                        `${requesterName} added you to '${groupName}'`,
                        { 
                            type: "GROUP_INVITE", 
                            groupId: groupId.toString() 
                        }
                    );
                }
            } catch (notifyErr) {
                console.error("NOTIFICATION ERROR (Ignored):", notifyErr);
            }
        })();
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
//
// GET GROUP TRANSACTIONS (EXPENSES + SETTLEMENTS)
//
//
// GET GROUP TRANSACTIONS (EXPENSES + PAYMENTS)
//
export const getGroupExpenses = async (req, res) => {
    try {
        const { groupId } = req.params;

        const query = `
            SELECT 
                id, 
                description, 
                amount, 
                paid_by as "payerId", 
                NULL as "receiverId", 
                created_at as "createdAt",
                'EXPENSE' as type,
                category
            FROM expenses 
            WHERE group_id = $1

            UNION ALL

            SELECT 
                id, 
                'Payment' as description, 
                amount, 
                payer_id as "payerId",    -- Make sure your payments table uses 'payer_id'
                receiver_id as "receiverId", -- and 'receiver_id'
                created_at as "createdAt", 
                'SETTLEMENT' as type,
                'PAYMENT' as category
            FROM payments  -- <--- CHANGED FROM 'settlements' TO 'payments'
            WHERE group_id = $1

            ORDER BY "createdAt" DESC;
        `;

        const result = await pool.query(query, [groupId]);
        res.json(result.rows);

    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
};


// DELETE GROUP (Admin Only)
export const deleteGroup = async (req, res) => {
    const debugId = Math.random().toString(36).substring(7);
    console.log(`\n--- [DEBUG_START: ${debugId}] DELETE GROUP ---`);

    try {
        const { groupId } = req.params;
        const userId = req.userId;

        // 1. Check if Group Exists & Verify Admin
        const groupCheck = await pool.query(
            "SELECT created_by FROM groups WHERE id = $1", 
            [groupId]
        );
        
        if (groupCheck.rows.length === 0) {
            return res.status(404).json({ msg: "Group not found" });
        }
        
        // STRICT RULE: Only the Creator (Admin) can delete
        if (groupCheck.rows[0].created_by !== userId) {
            return res.status(403).json({ msg: "Only the group admin can delete this group" });
        }

        // 2. ATOMIC DELETION (The Clean Sweep)
        await withTransaction(async (client) => {
            console.log(`[${debugId}] Deleting dependent data...`);

            // A. Delete Expense Splits (Children of Expenses)
            // We find all expenses in this group, then delete their splits
            await client.query(`
                DELETE FROM expense_splits 
                WHERE expense_id IN (SELECT id FROM expenses WHERE group_id = $1)
            `, [groupId]);

            // B. Delete Expenses (Children of Group)
            await client.query("DELETE FROM expenses WHERE group_id = $1", [groupId]);

            // C. Delete Payments/Settlements (Children of Group)
            // *IMPORTANT* You mentioned 'settles'. Assuming table is 'payments' based on previous code.
            await client.query("DELETE FROM payments WHERE group_id = $1", [groupId]);

            // D. Delete Members (Children of Group)
            await client.query("DELETE FROM group_members WHERE group_id = $1", [groupId]);

            // E. Finally... Delete the Group
            await client.query("DELETE FROM groups WHERE id = $1", [groupId]);
            
            console.log(`[${debugId}] Group ${groupId} deleted completely.`);
        });

        res.json({ msg: "Group and all related data deleted successfully" });

    } catch (err) {
        console.error(`[${debugId}] DELETE ERROR:`, err);
        res.status(500).json({ msg: "Server error during deletion" });
    }
};



export const getGroupStats = async (req, res) => {
    try {
        const { groupId } = req.params;

        // 1. Total Group Spending
        const totalQuery = await pool.query(
            `SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE group_id = $1`,
            [groupId]
        );

        // 2. Spending by Category (For Donut Chart) 🍩
        const categoryQuery = await pool.query(
            `SELECT category, SUM(amount) as total 
             FROM expenses 
             WHERE group_id = $1 
             GROUP BY category`,
            [groupId]
        );

        // 3. Spending by Member (For Bar Chart) 📊
        // We join with 'users' to get the real name
        const memberQuery = await pool.query(
            `SELECT u.name, SUM(e.amount) as total 
             FROM expenses e
             JOIN users u ON e.paid_by = u.id
             WHERE e.group_id = $1
             GROUP BY u.name, u.id
             ORDER BY total DESC`,
            [groupId]
        );

        res.json({
            totalSpending: Number(totalQuery.rows[0].total),
            byCategory: categoryQuery.rows.map(row => ({
                category: row.category,
                total: Number(row.total)
            })),
            byMember: memberQuery.rows.map(row => ({
                name: row.name,
                total: Number(row.total)
            }))
        });

    } catch (err) {
        console.error("STATS ERROR:", err);
        res.status(500).json({ msg: "Server error" });
    }
};