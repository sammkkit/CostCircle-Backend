import Razorpay from "razorpay";
import crypto from "crypto";
import { pool } from "../db/db.js";

// Initialize Razorpay instance
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

/**
 * CREATE SUBSCRIPTION
 * Creates a new Razorpay subscription for the authenticated user
 * Duration: 3 months (3 billing cycles)
 */
export const createSubscription = async (req, res) => {
    try {
        const userId = req.userId;

        // 1. Check if user already has an active subscription
        const existingSubscription = await pool.query(
            `SELECT * FROM subscriptions WHERE user_id = $1 AND status IN ('created', 'active', 'authenticated')`,
            [userId]
        );

        if (existingSubscription.rows.length > 0) {
            const sub = existingSubscription.rows[0];
            return res.status(400).json({ 
                msg: "You already have an active subscription",
                subscription: {
                    id: sub.razorpay_subscription_id,
                    status: sub.status
                }
            });
        }

        // 2. Get user details for Razorpay customer
        const userResult = await pool.query(
            `SELECT email, name FROM users WHERE id = $1`,
            [userId]
        );
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({ msg: "User not found" });
        }

        const user = userResult.rows[0];

        // 3. Create subscription in Razorpay
        const subscription = await razorpay.subscriptions.create({
            plan_id: process.env.RAZORPAY_PLAN_ID,
            total_count: 3, // 3 billing cycles (3 months)
            customer_notify: 1,
            notes: {
                user_id: userId.toString(),
                email: user.email
            }
        });

        // 4. Store subscription in database
        await pool.query(
            `INSERT INTO subscriptions (user_id, razorpay_subscription_id, razorpay_plan_id, status) 
             VALUES ($1, $2, $3, $4)`,
            [userId, subscription.id, process.env.RAZORPAY_PLAN_ID, subscription.status]
        );

        // 5. Return subscription details to client
        res.status(201).json({
            msg: "Subscription created",
            subscription: {
                id: subscription.id,
                status: subscription.status,
                short_url: subscription.short_url, // Razorpay hosted checkout page
                plan_id: subscription.plan_id
            }
        });

    } catch (err) {
        console.error("CREATE SUBSCRIPTION ERROR:", err);
        res.status(500).json({ msg: "Failed to create subscription" });
    }
};

/**
 * GET SUBSCRIPTION STATUS
 * Returns the current subscription status for the authenticated user
 */
export const getSubscriptionStatus = async (req, res) => {
    try {
        const userId = req.userId;

        // 1. Get subscription from database
        const result = await pool.query(
            `SELECT s.*, u.is_premium 
             FROM subscriptions s
             JOIN users u ON s.user_id = u.id
             WHERE s.user_id = $1 
             ORDER BY s.created_at DESC 
             LIMIT 1`,
            [userId]
        );

        if (result.rows.length === 0) {
            // No subscription found
            const userResult = await pool.query(
                `SELECT is_premium FROM users WHERE id = $1`,
                [userId]
            );
            
            return res.json({
                hasSubscription: false,
                isPremium: userResult.rows[0]?.is_premium || false,
                subscription: null
            });
        }

        const subscription = result.rows[0];

        // 2. Fetch from Razorpay if status might have changed
        const needsRefresh = ['created', 'authenticated', 'pending'].includes(subscription.status) || 
                             !subscription.current_period_start || 
                             !subscription.current_period_end;

        if (needsRefresh && subscription.razorpay_subscription_id) {
            try {
                const razorpaySub = await razorpay.subscriptions.fetch(subscription.razorpay_subscription_id);
                
                // Update local status and period dates
                if (razorpaySub.status !== subscription.status || 
                    razorpaySub.current_start || razorpaySub.current_end) {
                    await pool.query(
                        `UPDATE subscriptions 
                         SET status = $1, 
                             current_period_start = to_timestamp($2),
                             current_period_end = to_timestamp($3),
                             updated_at = CURRENT_TIMESTAMP
                         WHERE id = $4`,
                        [
                            razorpaySub.status,
                            razorpaySub.current_start || null,
                            razorpaySub.current_end || null,
                            subscription.id
                        ]
                    );

                    // Update local variables for response
                    subscription.status = razorpaySub.status;
                    if (razorpaySub.current_start) {
                        subscription.current_period_start = new Date(razorpaySub.current_start * 1000);
                    }
                    if (razorpaySub.current_end) {
                        subscription.current_period_end = new Date(razorpaySub.current_end * 1000);
                    }

                    // If now active, update user's premium status
                    if (razorpaySub.status === 'active') {
                        await pool.query(
                            `UPDATE users SET is_premium = TRUE WHERE id = $1`,
                            [userId]
                        );
                    }
                }
            } catch (fetchErr) {
                console.error("Failed to fetch Razorpay subscription:", fetchErr);
            }
        }

        // Determine if user should have premium access
        // User is premium if subscription is active OR if cancelled but still within period
       const isPremiumActive = 
            ['active', 'pending_cancellation'].includes(subscription.status) || 
            (subscription.status === 'cancelled' && 
             subscription.current_period_end && 
             new Date(subscription.current_period_end) > new Date());
             
        res.json({
            hasSubscription: true,
            isPremium: isPremiumActive,
            subscription: {
                id: subscription.razorpay_subscription_id,
                status: subscription.status,
                currentPeriodStart: subscription.current_period_start,
                currentPeriodEnd: subscription.current_period_end,
                createdAt: subscription.created_at
            }
        });

    } catch (err) {
        console.error("GET SUBSCRIPTION STATUS ERROR:", err);
        res.status(500).json({ msg: "Failed to get subscription status" });
    }
};

/**
 * CANCEL SUBSCRIPTION
 * Cancels the user's active subscription at end of current period
 */
export const cancelSubscription = async (req, res) => {
    try {
        const userId = req.userId;

        // 1. Find active subscription (active or authenticated)
        const result = await pool.query(
            `SELECT * FROM subscriptions WHERE user_id = $1 AND status IN ('active', 'authenticated')`,
            [userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ msg: "No active subscription found" });
        }

        const subscription = result.rows[0];

        // 2. Cancel in Razorpay (at end of current period)
        const cancelledSub = await razorpay.subscriptions.cancel(subscription.razorpay_subscription_id, {
            cancel_at_cycle_end: 1 // User keeps access until period ends
        });

        // 3. Update local database - mark as 'pending_cancellation' to track graceful cancellation
        // The actual 'cancelled' status will be set by webhook when period ends
        await pool.query(
            `UPDATE subscriptions 
             SET status = 'pending_cancellation', 
                 cancelled_at = CURRENT_TIMESTAMP,
                 updated_at = CURRENT_TIMESTAMP 
             WHERE id = $1`,
            [subscription.id]
        );

        res.json({ 
            msg: "Subscription will be cancelled at the end of your billing period",
            currentPeriodEnd: subscription.current_period_end,
            cancelledAt: new Date().toISOString()
        });

    } catch (err) {
        console.error("CANCEL SUBSCRIPTION ERROR:", err);
        
        // Handle specific Razorpay errors
        if (err.error?.description) {
            return res.status(400).json({ msg: err.error.description });
        }
        
        res.status(500).json({ msg: "Failed to cancel subscription" });
    }
};

/**
 * RAZORPAY WEBHOOK HANDLER
 * Processes webhook events from Razorpay
 * IMPORTANT: This route must receive raw body for signature verification
 */
export const handleWebhook = async (req, res) => {
    try {
        const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
        
        // 1. Verify webhook signature using raw body
        if (webhookSecret) {
            const signature = req.headers['x-razorpay-signature'];
            
            // req.rawBody should be set by middleware (see server.js setup)
            const body = req.rawBody || JSON.stringify(req.body);
            
            const expectedSignature = crypto
                .createHmac('sha256', webhookSecret)
                .update(body)
                .digest('hex');

            if (signature !== expectedSignature) {
                console.error("Webhook signature verification failed");
                return res.status(400).json({ msg: "Invalid signature" });
            }
        }

        // 2. Parse the event
        const event = req.body.event;
        const payload = req.body.payload?.subscription?.entity;
        const paymentPayload = req.body.payload?.payment?.entity;

        console.log(`[WEBHOOK] Event: ${event}`);

        // Handle subscription events
        if (payload) {
            const subscriptionId = payload.id;
            const userId = payload.notes?.user_id;

            console.log(`[WEBHOOK] Subscription: ${subscriptionId}, User: ${userId}`);

            switch (event) {
                case 'subscription.authenticated':
                    // User completed authentication, waiting for first charge
                    await pool.query(
                        `UPDATE subscriptions 
                         SET status = 'authenticated', updated_at = CURRENT_TIMESTAMP
                         WHERE razorpay_subscription_id = $1`,
                        [subscriptionId]
                    );
                    break;

                case 'subscription.activated':
                    // First payment successful, subscription is now active
                    await pool.query(
                        `UPDATE subscriptions 
                         SET status = 'active', 
                             current_period_start = to_timestamp($1),
                             current_period_end = to_timestamp($2),
                             updated_at = CURRENT_TIMESTAMP
                         WHERE razorpay_subscription_id = $3`,
                        [payload.current_start, payload.current_end, subscriptionId]
                    );

                    if (userId) {
                        await pool.query(
                            `UPDATE users SET is_premium = TRUE WHERE id = $1`,
                            [parseInt(userId)]
                        );
                    }
                    break;

                case 'subscription.charged':
                    // Recurring payment successful
                    await pool.query(
                        `UPDATE subscriptions 
                         SET status = 'active', 
                             current_period_start = to_timestamp($1),
                             current_period_end = to_timestamp($2),
                             updated_at = CURRENT_TIMESTAMP
                         WHERE razorpay_subscription_id = $3`,
                        [payload.current_start, payload.current_end, subscriptionId]
                    );

                    if (userId) {
                        await pool.query(
                            `UPDATE users SET is_premium = TRUE WHERE id = $1`,
                            [parseInt(userId)]
                        );
                    }
                    break;

                case 'subscription.pending':
                    // Payment is pending (authorization issues)
                    await pool.query(
                        `UPDATE subscriptions 
                         SET status = 'pending', updated_at = CURRENT_TIMESTAMP
                         WHERE razorpay_subscription_id = $1`,
                        [subscriptionId]
                    );
                    break;

                case 'subscription.halted':
                    // Payment failed multiple times, subscription halted
                    await pool.query(
                        `UPDATE subscriptions 
                         SET status = 'halted', updated_at = CURRENT_TIMESTAMP
                         WHERE razorpay_subscription_id = $1`,
                        [subscriptionId]
                    );

                    if (userId) {
                        await pool.query(
                            `UPDATE users SET is_premium = FALSE WHERE id = $1`,
                            [parseInt(userId)]
                        );
                    }
                    break;

                case 'subscription.cancelled':
                    // Subscription cancelled (either by user request or payment failure)
                    await pool.query(
                        `UPDATE subscriptions 
                         SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
                         WHERE razorpay_subscription_id = $1`,
                        [subscriptionId]
                    );

                    // Only remove premium if current period has ended
                    if (userId && payload.ended_at) {
                        await pool.query(
                            `UPDATE users SET is_premium = FALSE WHERE id = $1`,
                            [parseInt(userId)]
                        );
                    }
                    break;

                case 'subscription.completed':
                    // All billing cycles completed
                    await pool.query(
                        `UPDATE subscriptions 
                         SET status = 'completed', updated_at = CURRENT_TIMESTAMP
                         WHERE razorpay_subscription_id = $1`,
                        [subscriptionId]
                    );

                    if (userId) {
                        await pool.query(
                            `UPDATE users SET is_premium = FALSE WHERE id = $1`,
                            [parseInt(userId)]
                        );
                    }
                    break;

                case 'subscription.paused':
                    // Subscription paused
                    await pool.query(
                        `UPDATE subscriptions 
                         SET status = 'paused', updated_at = CURRENT_TIMESTAMP
                         WHERE razorpay_subscription_id = $1`,
                        [subscriptionId]
                    );
                    break;

                case 'subscription.resumed':
                    // Subscription resumed from pause
                    await pool.query(
                        `UPDATE subscriptions 
                         SET status = 'active', updated_at = CURRENT_TIMESTAMP
                         WHERE razorpay_subscription_id = $1`,
                        [subscriptionId]
                    );

                    if (userId) {
                        await pool.query(
                            `UPDATE users SET is_premium = TRUE WHERE id = $1`,
                            [parseInt(userId)]
                        );
                    }
                    break;

                default:
                    console.log(`[WEBHOOK] Unhandled subscription event: ${event}`);
            }
        }

        // Handle payment failure events
        if (paymentPayload && event === 'payment.failed') {
            console.log(`[WEBHOOK] Payment failed for: ${paymentPayload.id}`);
            // You could send notification to user here
        }

        // Always return 200 to acknowledge receipt
        res.status(200).json({ received: true });

    } catch (err) {
        console.error("WEBHOOK ERROR:", err);
        // Return 200 even on error to prevent Razorpay from retrying
        res.status(200).json({ received: true, error: err.message });
    }
};
