# 💰 CostCircle Backend

A robust, production-ready RESTful API for expense splitting and group financial management. Built with **Express.js** and **PostgreSQL**, featuring Google OAuth authentication, real-time push notifications, and atomic transaction handling.

---

## ⚡ Quick Start

```bash
# Clone and install
git clone <your-repo-url>
cd costcircle-backend
npm install

# Configure environment
cp .env.example .env
# Edit .env with your credentials

# Start development server
npm run dev
```

The server runs on `http://localhost:4000` by default.

---

## 🏗️ Architecture Overview

```
src/
├── config/           # Firebase configuration
│   └── firebase.js   # FCM initialization (env or local JSON)
├── controllers/      # Business logic
│   ├── authController.js         # Google OAuth login
│   ├── balanceController.js      # Group balance calculations
│   ├── groupController.js        # Groups, expenses, members
│   ├── notificationController.js # Push notifications via FCM
│   ├── paymentController.js      # Settle-up payments
│   ├── settlementController.js   # Debt simplification algorithm
│   └── userController.js         # User activity & profile
├── db/               # Database layer
│   └── db.js         # PostgreSQL pool + transaction helper
├── middleware/       # Express middleware
│   └── authMiddleware.js  # JWT verification
├── routes/           # API route definitions
│   ├── auth/
│   │   ├── auth.js   # /auth/* routes
│   │   └── user.js   # /user/* routes
│   └── groups/
│       └── groups.js # /groups/* routes
├── utils/            # Utilities
│   └── delay.js      # Sleep/delay helper
└── server.js         # Express app entry point
```

---

## 🔐 Authentication

### Google OAuth Flow

The backend uses **Google Sign-In** for authentication. The Android/iOS client obtains an ID token from Google, which is then verified server-side.

```
POST /auth/google
Content-Type: application/json

{
  "idToken": "<Google ID Token from client>"
}
```

**Response:**

```json
{
  "token": "eyJhbGciOiJI...", // JWT for subsequent requests
  "user": {
    "id": 1,
    "name": "Samkit Jain",
    "email": "samkit@example.com",
    "picture": "https://..."
  }
}
```

### JWT Authentication

All protected endpoints require the JWT in the Authorization header:

```
Authorization: Bearer <jwt_token>
```

---

## 📚 API Reference

### Authentication Routes (`/auth`)

| Method | Endpoint       | Description                       |
| ------ | -------------- | --------------------------------- |
| `POST` | `/auth/google` | Authenticate with Google ID token |

### User Routes (`/user`)

| Method | Endpoint           | Auth | Description                             |
| ------ | ------------------ | ---- | --------------------------------------- |
| `POST` | `/user/check-user` | ✅   | Check if a user exists by email         |
| `POST` | `/user/fcm-token`  | ✅   | Update FCM token for push notifications |
| `GET`  | `/user/activity`   | ✅   | Get user's transaction activity feed    |

### Group Routes (`/groups`)

| Method   | Endpoint                 | Auth | Description                             |
| -------- | ------------------------ | ---- | --------------------------------------- |
| `POST`   | `/groups`                | ✅   | Create a new group                      |
| `GET`    | `/groups`                | ✅   | List all groups for current user        |
| `GET`    | `/groups/summary`        | ✅   | Get financial summary across all groups |
| `DELETE` | `/groups/:groupId`       | ✅   | Delete group (admin only)               |
| `GET`    | `/groups/:groupId/stats` | ✅   | Get spending statistics & charts data   |

### Member Management

| Method | Endpoint                        | Auth | Description                         |
| ------ | ------------------------------- | ---- | ----------------------------------- |
| `POST` | `/groups/:groupId/members`      | ✅   | Add single member by email          |
| `POST` | `/groups/:groupId/members/bulk` | ✅   | Add multiple members by email array |
| `GET`  | `/groups/:groupId/members`      | ✅   | Get all members in a group          |

### Expense Management

| Method | Endpoint                    | Auth | Description                          |
| ------ | --------------------------- | ---- | ------------------------------------ |
| `POST` | `/groups/:groupId/expenses` | ✅   | Add new expense with splits          |
| `GET`  | `/groups/:groupId/expenses` | ✅   | Get all expenses & payments in group |

### Balance & Settlement

| Method | Endpoint                             | Auth | Description                          |
| ------ | ------------------------------------ | ---- | ------------------------------------ |
| `GET`  | `/groups/:groupId/balances`          | ✅   | Get balance for each member          |
| `GET`  | `/groups/:groupId/financial-summary` | ✅   | Get optimized settlement suggestions |
| `POST` | `/groups/:groupId/settle`            | ✅   | Record a settle-up payment           |

### Subscription Routes (`/subscription`)

| Method | Endpoint                | Auth | Description                     |
| ------ | ----------------------- | ---- | ------------------------------- |
| `POST` | `/subscription/create`  | ✅   | Create Razorpay subscription    |
| `GET`  | `/subscription/status`  | ✅   | Get current subscription status |
| `POST` | `/subscription/cancel`  | ✅   | Cancel active subscription      |
| `POST` | `/subscription/webhook` | ❌   | Razorpay webhook handler        |

---

## 💸 Expense Splitting

The API supports **three split types**:

### 1. Equal Split (Default)

```json
{
  "description": "Dinner",
  "amount": 300,
  "paidBy": 1,
  "splitType": "EQUAL"
}
```

Automatically splits equally among all group members with penny-accurate distribution.

### 2. Exact Split

```json
{
  "description": "Hotel Room",
  "amount": 1000,
  "paidBy": 1,
  "splitType": "EXACT",
  "splits": [
    { "userId": 1, "value": 400 },
    { "userId": 2, "value": 300 },
    { "userId": 3, "value": 300 }
  ]
}
```

Sum of values must equal the total amount.

### 3. Percentage Split

```json
{
  "description": "Trip Expenses",
  "amount": 5000,
  "paidBy": 1,
  "splitType": "PERCENTAGE",
  "splits": [
    { "userId": 1, "value": 50 },
    { "userId": 2, "value": 30 },
    { "userId": 3, "value": 20 }
  ]
}
```

Percentages must sum to 100%.

---

## 🧮 Settlement Algorithm

The backend includes an optimized **debt simplification algorithm** that minimizes the number of transactions needed to settle all debts.

```
GET /groups/:groupId/financial-summary
```

**Response:**

```json
{
  "groupId": "5",
  "settlements": [
    {
      "payerUserId": 2,
      "payerName": "Alice",
      "receiverUserId": 1,
      "receiverName": "Bob",
      "amount": 150.5
    }
  ]
}
```

The algorithm:

1. Calculates net balance for each member (paid - owed + payments sent - payments received)
2. Separates users into creditors (positive balance) and debtors (negative balance)
3. Greedily matches debtors to creditors to minimize transaction count

---

## 🔔 Push Notifications

The backend integrates with **Firebase Cloud Messaging (FCM)** for real-time notifications.

### Notification Triggers

- **New expense added** → Notifies all group members (except creator)
- **Added to group** → Notifies newly added members
- **Settlement recorded** → Can be extended to notify parties

### Setup

1. Create a Firebase project and download `serviceAccountKey.json`
2. Place in `src/` directory OR set `FIREBASE_CREDENTIALS` env variable with JSON string

---

## 🗃️ Database Schema

The application uses **PostgreSQL** with the following main tables:

```sql
-- Users
users (id, name, email, password, google_id, picture, fcm_token, created_at)

-- Groups
groups (id, name, created_by, created_at)
group_members (id, group_id, user_id, created_at)

-- Expenses
expenses (id, description, amount, paid_by, group_id, split_type, category, created_at)
expense_splits (id, expense_id, user_id, amount)

-- Payments (Settle-ups)
payments (id, group_id, payer_id, receiver_id, amount, created_at)
```

### Key Constraints

- Foreign keys ensure referential integrity
- `group_members` has unique constraint on `(group_id, user_id)`
- All monetary values stored as `DECIMAL(10,2)`

---

## ⚙️ Environment Variables

Create a `.env` file in the root directory:

```env
# Server
PORT=4000
NODE_ENV=development

# Database
DATABASE_URL=postgresql://user:password@host:5432/dbname

# Authentication
JWT_SECRET=your-super-secret-jwt-key
GOOGLE_CLIENT_ID=your-google-oauth-client-id

# Firebase (Option 1: Environment variable - for production)
FIREBASE_CREDENTIALS={"type":"service_account","project_id":"..."}

# Firebase (Option 2: Local file at src/serviceAccountKey.json for development)

# Razorpay Subscriptions
RAZORPAY_KEY_ID=rzp_test_XXXXX
RAZORPAY_KEY_SECRET=your_razorpay_secret
RAZORPAY_PLAN_ID=plan_XXXXX
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret  # Optional for test mode
```

---

## 🧪 Testing

The project uses **Jest** for testing with focus on transaction atomicity.

```bash
# Run all tests
npm test
```

### Test Coverage

- **Transaction Atomicity**: Verifies that multi-step operations either fully commit or fully rollback
- **Concurrent Safety**: Tests simultaneous expense additions don't corrupt data
- **Rollback Scenarios**: Ensures partial failures don't leave orphaned data

### Test Structure

```
tests/
├── setup.js           # Test utilities & helpers
└── transactions.test.js  # Atomicity & concurrency tests
```

---

## 🚀 Deployment

### Docker

```bash
# Build image
docker build -t costcircle-backend .

# Run container
docker run -p 4000:4000 --env-file .env costcircle-backend
```

### Dockerfile Overview

- Base: `node:20-alpine`
- Installs production dependencies
- Exposes port 3000 (configurable via PORT env)
- Runs `npm start`

### Production Platforms

- **Render**: Set environment variables in dashboard
- **Railway**: Connect GitHub repo, auto-deploy on push
- **Heroku**: Standard Node.js buildpack

---

## 🛡️ Security Features

| Feature                      | Implementation                            |
| ---------------------------- | ----------------------------------------- |
| **Authentication**           | Google OAuth + JWT sessions               |
| **Authorization**            | Membership checks on all group operations |
| **Input Validation**         | Request body validation in controllers    |
| **SQL Injection Prevention** | Parameterized queries throughout          |
| **CORS**                     | Enabled via `cors` middleware             |
| **Token Expiry**             | JWTs expire after 30 days                 |

---

## 📊 API Categories & Expense Types

Expenses can be categorized for analytics:

| Category        | Description                         |
| --------------- | ----------------------------------- |
| `GENERAL`       | Default category                    |
| `FOOD`          | Food & dining                       |
| `TRANSPORT`     | Travel & transportation             |
| `SHOPPING`      | Purchases & shopping                |
| `ENTERTAINMENT` | Movies, events, etc.                |
| `PAYMENT`       | Settlement payments (auto-assigned) |

---

## ⚡ Transaction Safety

All critical operations use atomic transactions via the `withTransaction` helper:

```javascript
import { withTransaction } from "./db/db.js";

const result = await withTransaction(async (client) => {
  await client.query("INSERT INTO groups...");
  await client.query("INSERT INTO group_members...");
  return groupId; // Both succeed or both fail
});
```

This ensures:

- ✅ No partial expense records (expense without splits)
- ✅ No orphaned group memberships
- ✅ Clean rollback on any failure

---

## 📱 Client Integration

The API is designed for **Android/iOS** clients using:

1. **Google Sign-In SDK** → Obtain ID token
2. **POST /auth/google** → Exchange for JWT
3. **Store JWT** → Use for all authenticated requests
4. **FCM Token** → Register for push notifications via `/user/fcm-token`

---

## 🧹 Scripts

| Script        | Description                                  |
| ------------- | -------------------------------------------- |
| `npm start`   | Production server                            |
| `npm run dev` | Development server with hot-reload (nodemon) |
| `npm test`    | Run Jest test suite                          |

---

## 📈 Monitoring & Debugging

The backend includes debug logs with unique IDs:

```
--- [DEBUG_START: abc123] ---
[abc123] User ID: 1
[abc123] Group Name: Trip to Goa
[abc123] BEGIN TRANSACTION
[abc123] Created group ID: 5
[abc123] TRANSACTION COMMITTED
--- [DEBUG_END: abc123] ---
```

These help trace individual requests through the system.

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

ISC License - See `package.json` for details.

---

## 👨‍💻 Author

Built with ❤️ by Samkit Jain

---

_CostCircle - Making group expenses simple._
