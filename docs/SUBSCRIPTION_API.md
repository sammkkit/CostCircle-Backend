# Subscription API Documentation

Base URL: `/subscription`

---

## Authentication

All endpoints except `/webhook` require JWT authentication via the `Authorization` header:

```
Authorization: Bearer <jwt_token>
```

---

## Endpoints

### 1. Create Subscription

**POST** `/subscription/create`

Creates a new Razorpay subscription for the authenticated user.

#### Request

```http
POST /subscription/create
Authorization: Bearer <token>
```

#### Success Response (201)

```json
{
  "msg": "Subscription created",
  "subscription": {
    "id": "sub_ABC123xyz",
    "status": "created",
    "short_url": "https://rzp.io/i/xxxxxx",
    "plan_id": "plan_xxxxx"
  }
}
```

#### Error Responses

| Status | Message                                 |
| ------ | --------------------------------------- |
| 400    | You already have an active subscription |
| 404    | User not found                          |
| 500    | Failed to create subscription           |

#### Flow

1. User calls this endpoint
2. Redirect user to `short_url` for Razorpay checkout
3. User completes payment
4. Razorpay sends webhook to activate subscription

---

### 2. Get Subscription Status

**GET** `/subscription/status`

Returns the current subscription status for the authenticated user.

#### Request

```http
GET /subscription/status
Authorization: Bearer <token>
```

#### Success Response (200)

```json
{
  "hasSubscription": true,
  "isPremium": true,
  "subscription": {
    "id": "sub_ABC123xyz",
    "status": "active",
    "currentPeriodStart": "2026-01-08T00:00:00.000Z",
    "currentPeriodEnd": "2026-02-08T00:00:00.000Z",
    "createdAt": "2026-01-08T06:00:00.000Z"
  }
}
```

#### No Subscription Response (200)

```json
{
  "hasSubscription": false,
  "isPremium": false,
  "subscription": null
}
```

#### Subscription Statuses

| Status                 | Description                             | isPremium |
| ---------------------- | --------------------------------------- | --------- |
| `created`              | Awaiting user payment                   | ❌        |
| `authenticated`        | User authorized, awaiting first charge  | ❌        |
| `active`               | Subscription is active                  | ✅        |
| `pending`              | Payment pending/authorization issues    | ❌        |
| `pending_cancellation` | User cancelled, still in billing period | ✅        |
| `cancelled`            | Subscription ended                      | ❌        |
| `completed`            | All billing cycles finished             | ❌        |
| `halted`               | Payment failed multiple times           | ❌        |
| `paused`               | Subscription paused                     | ❌        |

---

### 3. Cancel Subscription

**POST** `/subscription/cancel`

Cancels the user's active subscription at the end of the current billing period.

#### Request

```http
POST /subscription/cancel
Authorization: Bearer <token>
```

#### Success Response (200)

```json
{
  "msg": "Subscription will be cancelled at the end of your billing period",
  "currentPeriodEnd": "2026-02-08T00:00:00.000Z",
  "cancelledAt": "2026-01-08T12:30:00.000Z"
}
```

#### Error Responses

| Status | Message                       |
| ------ | ----------------------------- |
| 404    | No active subscription found  |
| 400    | Razorpay error description    |
| 500    | Failed to cancel subscription |

> **Note**: User retains premium access until `currentPeriodEnd`.

---

### 4. Webhook (Razorpay → Server)

**POST** `/subscription/webhook`

Receives webhook events from Razorpay. **No authentication required** - uses signature verification.

#### Headers

```
x-razorpay-signature: <hmac_sha256_signature>
Content-Type: application/json
```

#### Handled Events

| Event                        | Action                                    |
| ---------------------------- | ----------------------------------------- |
| `subscription.authenticated` | Mark as authenticated                     |
| `subscription.activated`     | Activate + grant premium                  |
| `subscription.charged`       | Update period dates                       |
| `subscription.pending`       | Mark as pending                           |
| `subscription.halted`        | Halt + revoke premium                     |
| `subscription.cancelled`     | Cancel + revoke premium (if period ended) |
| `subscription.completed`     | Complete + revoke premium                 |
| `subscription.paused`        | Mark as paused                            |
| `subscription.resumed`       | Resume + grant premium                    |
| `payment.failed`             | Log payment failure                       |

#### Response (Always 200)

```json
{
  "received": true
}
```

---

## Environment Variables Required

```env
RAZORPAY_KEY_ID=rzp_test_xxxxxxx
RAZORPAY_KEY_SECRET=your_secret_key
RAZORPAY_PLAN_ID=plan_xxxxxxx
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret
```

---

## Database Schema

```sql
CREATE TABLE subscriptions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    razorpay_subscription_id VARCHAR(255) UNIQUE NOT NULL,
    razorpay_plan_id VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'created',
    current_period_start TIMESTAMP,
    current_period_end TIMESTAMP,
    cancelled_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add to users table
ALTER TABLE users ADD COLUMN is_premium BOOLEAN DEFAULT FALSE;
```

---

## Subscription Lifecycle

```
┌─────────────┐
│   created   │ ← User initiates subscription
└──────┬──────┘
       │ User completes payment
       ▼
┌─────────────────┐
│  authenticated  │ ← Payment method saved
└────────┬────────┘
         │ First charge successful
         ▼
    ┌─────────┐
    │  active │ ← Premium access granted
    └────┬────┘
         │
    ┌────┴────────────────────────┐
    │                             │
    ▼                             ▼
┌───────────────────┐      ┌───────────┐
│pending_cancellation│      │  charged  │ (recurring)
└─────────┬─────────┘      └───────────┘
          │ Period ends
          ▼
    ┌───────────┐
    │ cancelled │ ← Premium revoked
    └───────────┘
```
