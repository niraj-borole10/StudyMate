import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import path from "path";

import connectDB from "./config/db.js";
import authRoutes from "./routes/auth.js";
import gmailRoutes from "./routes/gmail.js";
import calendarRoutes from "./routes/calendar.js";
import plannerRoutes from "./routes/planner.js";
import ragRoutes from "./routes/rag.js";

// Connect to MongoDB
connectDB();

const app = express();
const PORT = process.env.PORT || 5000;

// Standard Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Serve Frontend Static Site Assets
app.use(express.static(path.join(process.cwd(), "public")));

// API Endpoints
app.use("/api/auth", authRoutes);
app.use("/api/gmail", gmailRoutes);
app.use("/api/calendar", calendarRoutes);
app.use("/api/planner", plannerRoutes);
app.use("/api/rag", ragRoutes);

// Fallback Route for Single Page App
app.get("*", (req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "index.html"));
});

// Boot Server
app.listen(PORT, () => {
  console.log(`===================================================`);
  console.log(`StudyMate Server Running on: http://localhost:${PORT}`);
  console.log(`===================================================`);
});
