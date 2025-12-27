import { pool } from "../db/db.js";
import { messaging } from "../config/firebase.js";

// 1. SAVE TOKEN (Android calls this on login)
export const updateFcmToken = async (req, res) => {
    try {
        const userId = req.userId;
        const { token } = req.body;

        if (!token) return res.status(400).json({ msg: "Token required" });

        await pool.query(
            "UPDATE users SET fcm_token = $1 WHERE id = $2",
            [token, userId]
        );

        res.json({ msg: "Token updated" });
    } catch (err) {
        console.error("FCM UPDATE ERROR:", err);
        res.status(500).json({ msg: "Server error" });
    }
};

// 2. HELPER: Send Notification (Internal use only)
export const sendNotification = async (userId, title, body, data = {}) => {
    try {
        // 1. Get user's token
        const res = await pool.query("SELECT fcm_token FROM users WHERE id = $1", [userId]);
        
        if (res.rows.length === 0 || !res.rows[0].fcm_token) {
            console.log(`[FCM-FAIL] User ${userId} has no FCM token in DB.`);
            return;
        }

        const token = res.rows[0].fcm_token;
        console.log(`[FCM-START] Sending to User ${userId} | Token ends in: ...${token.slice(-6)}`);

        const message = {
            notification: { title, body },
            data: data,
            token: token
        };

        // 2. Send and Log the Result
        const response = await messaging.send(message);
        console.log(`[FCM-SUCCESS] Message ID: ${response}`);

    } catch (err) {
        // 3. Log detailed errors
        if (err.code === 'messaging/registration-token-not-registered') {
            console.error(`[FCM-ERROR] Token invalid (User uninstalled app?). Removing token from DB.`);
            // Optional: Cleanup dead token
            await pool.query("UPDATE users SET fcm_token = NULL WHERE id = $1", [userId]);
        } else {
            console.error(`[FCM-ERROR] Failed to send:`, err);
        }
    }
};