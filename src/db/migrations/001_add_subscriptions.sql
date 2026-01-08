-- Migration: Add Subscriptions Support
-- Run this in your PostgreSQL database

-- 1. Create subscriptions table
CREATE TABLE IF NOT EXISTS subscriptions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    razorpay_subscription_id VARCHAR(50) UNIQUE,
    razorpay_plan_id VARCHAR(50),
    status VARCHAR(20) DEFAULT 'created',  -- created, active, cancelled, expired
    current_period_start TIMESTAMP,
    current_period_end TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

-- 3. Add is_premium column to users table (for quick premium status check)
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_premium BOOLEAN DEFAULT FALSE;
ALTER TABLE subscriptions ADD COLUMN cancelled_at TIMESTAMP;
-- 4. Verify the tables
SELECT 'subscriptions table created successfully' AS status;
