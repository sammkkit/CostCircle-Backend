import { pool } from "../db/db.js";

export const settleUp = async (req, res) => {
    const { groupId } = req.params;
    const { receiverId, amount } = req.body;
    const payerId = req.userId;
    console.log("Settle Request:", { groupId, payerId, receiverId, amount });
    try {
        // 1. Validation: Ensure both are in the group
        const memberCheck = await pool.query(
            'SELECT user_id FROM group_members WHERE group_id = $1 AND user_id IN ($2, $3)',
            [groupId, payerId, receiverId]
        );

        if (memberCheck.rows.length < 2) {
            return res.status(400).json({ msg: "Both users must be members of the group" });
        }

        // 2. Insert the payment
        const newPayment = await pool.query(
            'INSERT INTO payments (group_id, payer_id, receiver_id, amount) VALUES ($1, $2, $3, $4) RETURNING id',
            [groupId, payerId, receiverId, amount]
        );

        res.status(201).json({
            msg: "Payment recorded successfully",
            paymentId: newPayment.rows[0].id
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
};