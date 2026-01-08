import express from "express";
import cors from "cors";
import dotenv from "dotenv";
dotenv.config();

const app = express();

app.use(cors());

// Custom middleware to capture raw body for webhook signature verification
app.use(express.json({
  verify: (req, res, buf) => {
    // Store raw body for routes that need it (webhooks)
    req.rawBody = buf.toString();
  }
}));

// Routes
import authRoutes from "./routes/auth/auth.js";
import groupRoutes from "./routes/groups/groups.js";
import userRoutes from "./routes/auth/user.js";
import subscriptionRoutes from "./routes/subscription/subscription.js";

app.use("/auth", authRoutes);
app.use("/groups", groupRoutes);
app.use("/user", userRoutes);
app.use("/subscription", subscriptionRoutes);

app.get("/", (req, res) => {
  res.send("CostCircle backend running...");
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log("Server running on port", PORT));
