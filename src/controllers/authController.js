import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import { pool } from '../db/db.js';

// Initialize the Google Client with your Client ID from the Cloud Console
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

export const googleLogin = async (req, res) => {
    try {
        const { idToken } = req.body;

        if (!idToken) {
            return res.status(400).json({ msg: "ID Token is required" });
        }

        // 1. Verify the token with Google
        // This ensures the token was actually issued by Google for YOUR app
        const ticket = await client.verifyIdToken({
            idToken,
            audience: process.env.GOOGLE_CLIENT_ID,
        });
        
        const payload = ticket.getPayload();
        // Extract user info from the secure payload
        const { email, name, sub: googleId, picture } = payload;

        // 2. Check if user exists in YOUR database
        const userCheck = await pool.query("SELECT * FROM users WHERE email = $1", [email]);

        let userId;
        let userName = name;
        let userPicture = picture;

        if (userCheck.rows.length > 0) {
            // CASE A: User exists -> Log them in
            const user = userCheck.rows[0];
            userId = user.id;

            // Optional: Update their picture/google_id if they linked an old account
            if (!user.google_id || user.picture !== picture) {
                await pool.query(
                    "UPDATE users SET google_id=$1, picture=$2 WHERE id=$3", 
                    [googleId, picture, userId]
                );
            }
        } else {
            // CASE B: New User -> Create account automatically
            // Password is NOT required anymore (nullable in DB)
            const newUser = await pool.query(
                "INSERT INTO users (name, email, google_id, picture) VALUES ($1, $2, $3, $4) RETURNING id",
                [name, email, googleId, picture]
            );
            userId = newUser.rows[0].id;
        }

        // 3. Generate YOUR App's JWT (Session Token)
        // This is the token Android will use for all future requests (addExpense, etc.)
        const token = jwt.sign({ id: userId }, process.env.JWT_SECRET, {
            expiresIn: "30d",
        });

        // 4. Send back the data needed for the Android UI
        res.status(200).json({ 
            token, 
            user: {
                id: userId,
                name: userName,
                email: email,
                picture: userPicture
            }
        });

    } catch (err) {
        console.error("GOOGLE LOGIN ERROR:", err);
        res.status(401).json({ msg: "Invalid or expired Google Token" });
    }
};