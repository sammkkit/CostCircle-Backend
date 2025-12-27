import express from "express";
import { googleLogin } from '../../controllers/authController.js'; // Import it!

const router = express.Router();

// router.post("/register", register);
// router.post("/login", login);

router.post('/google', googleLogin);

export default router;
