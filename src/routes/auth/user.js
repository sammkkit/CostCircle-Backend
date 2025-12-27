import express from "express";

import { pool } from "../../db/db.js";

import { checkUserExists } from "../../controllers/userController.js";
import { authMiddleware } from "../../middleware/authMiddleware.js";
import { updateFcmToken } from "../../controllers/notificationController.js";


const router = express.Router();

router.post("/check-user", authMiddleware, checkUserExists);
router.post("/fcm-token", authMiddleware, updateFcmToken);
export default router;
