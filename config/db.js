import mongoose from "mongoose";

const connectDB = async () => {
  try {
    const connStr = process.env.MONGO_URI || "mongodb://localhost:27017/studymate";
    console.log(`Connecting to MongoDB at: ${connStr}`);
    
    const conn = await mongoose.connect(connStr);
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`Error connecting to MongoDB: ${error.message}`);
    console.log("Tip: Ensure your local MongoDB server is running (e.g. net start MongoDB on Windows).");
  }
};

export default connectDB;
