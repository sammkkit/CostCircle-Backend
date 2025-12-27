import { pool } from "../db/db.js";


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
