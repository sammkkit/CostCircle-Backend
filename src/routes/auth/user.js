import express from "express";

import { pool } from "../../db/db.js";

import { checkUserExists } from "../../controllers/userController.js";
import { authMiddleware } from "../../middleware/authMiddleware.js";



const router = express.Router();

router.post("/check-user", authMiddleware, checkUserExists);

export default router;
