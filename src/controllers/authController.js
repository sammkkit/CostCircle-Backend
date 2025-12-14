import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "../db/db.js";

//
// REGISTER
//
export const register = async (req, res) => {
    try {
        const { name, email, password } = req.body;

        // Validation
        if (!name || !email || !password) {
            return res.status(400).json({ msg: "All fields are required" });
        }

        // Check if email exists
        const existing = await pool.query(
            "SELECT id FROM users WHERE email = $1",
            [email]
        );

        if (existing.rows.length > 0) {
            return res.status(400).json({ msg: "Email already registered" });
        }

        // Hash password
        const hashed = await bcrypt.hash(password, 10);

        // Insert new user
        await pool.query(
            "INSERT INTO users (name, email, password) VALUES ($1, $2, $3)",
            [name, email, hashed]
        );

        res.status(201).json({ msg: "User registered successfully" });

    } catch (error) {
        console.error("REGISTER ERROR:", error);
        res.status(500).json({ msg: "Server error" });
    }
};

//
// LOGIN
//
export const login = async (req, res) => {
    try {
        const { email, password } = req.body;

        // Validation
        if (!email || !password) {
            return res.status(400).json({ msg: "Email and password required" });
        }

        // Check if user exists
        const result = await pool.query(
            "SELECT * FROM users WHERE email = $1",
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(400).json({ msg: "Invalid credentials" });
        }

        const user = result.rows[0];

        // Compare password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ msg: "Invalid credentials" });
        }

        // Create JWT token
        const token = jwt.sign(
            { id: user.id },
            process.env.JWT_SECRET,
            { expiresIn: "7d" }
        );

        res.json({
            msg: "Login successful",
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email
            }
        });

    } catch (error) {
        console.error("LOGIN ERROR:", error);
        res.status(500).json({ msg: "Server error" });
    }
};
