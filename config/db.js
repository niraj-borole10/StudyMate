import mongoose from "mongoose";

const connectDB = async () => {
  const connStr = process.env.MONGO_URI || "mongodb://localhost:27017/studymate";

  // Mask password in logs for safety
  const safeStr = connStr.replace(/:([^@]+)@/, ":****@");
  console.log(`Connecting to MongoDB at: ${safeStr}`);

  try {
    const conn = await mongoose.connect(connStr, {
      serverSelectionTimeoutMS: 10000, // Give Atlas 10s to respond
      socketTimeoutMS: 45000,
      connectTimeoutMS: 10000,
    });
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`❌ MongoDB connection failed: ${error.message}`);
    console.error(
      "Check: 1) MONGO_URI is correct  2) IP is whitelisted in Atlas  3) DB user credentials are right"
    );
    // Exit so the process restarts (Render auto-restarts on crash)
    process.exit(1);
  }
};

export default connectDB;
