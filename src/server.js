import express from "express";
import cors from "cors";
import dotenv from "dotenv";
dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

// Routes
import authRoutes from "./routes/auth/auth.js";
app.use("/auth", authRoutes);

app.get("/", (req, res) => {
  res.send("CostCircle backend running...");
});

const PORT = 3000;
app.listen(PORT, () => console.log("Server running on port", PORT));
