import express from "express";
import { 
    createSubscription, 
    getSubscriptionStatus, 
    cancelSubscription,
    handleWebhook 
} from "../../controllers/subscriptionController.js";
import { authMiddleware } from "../../middleware/authMiddleware.js";

const router = express.Router();
/**
 * Protected Routes (require JWT)
 */
router.post("/create", authMiddleware, createSubscription);
router.get("/status", authMiddleware, getSubscriptionStatus);
router.post("/cancel", authMiddleware, cancelSubscription);

/**
 * Webhook Route (no auth - Razorpay calls this directly)
 */
router.post("/webhook", handleWebhook);

export default router;
