import mongoose from "mongoose";
import dotenv from "dotenv";
import User from "./models/User.js";
import Email from "./models/Email.js";
import Assignment from "./models/Assignment.js";

dotenv.config();
const connStr = process.env.MONGO_URI || "mongodb://localhost:27017/studymate";

async function main() {
  console.log("Connecting to:", connStr);
  try {
    await mongoose.connect(connStr);
    console.log("Connected successfully!");

    const usersCount = await User.countDocuments();
    const emailsCount = await Email.countDocuments();
    const assignmentsCount = await Assignment.countDocuments();

    console.log(`\n--- DATABASE SUMMARY ---`);
    console.log(`Users: ${usersCount}`);
    console.log(`Emails: ${emailsCount}`);
    console.log(`Assignments: ${assignmentsCount}`);

    if (usersCount > 0) {
      console.log(`\n--- USERS ---`);
      const users = await User.find();
      users.forEach(u => console.log(`- Name: ${u.name}, Email: ${u.email}, GoogleId: ${u.googleId}`));
    }

    if (emailsCount > 0) {
      console.log(`\n--- RECENT EMAILS ---`);
      const emails = await Email.find().limit(5);
      emails.forEach(e => console.log(`- Subject: ${e.subject}, Status: ${e.parsedStatus}, Date: ${e.date}`));
    }

    if (assignmentsCount > 0) {
      console.log(`\n--- ASSIGNMENTS ---`);
      const assignments = await Assignment.find().limit(5);
      assignments.forEach(a => console.log(`- Title: ${a.title}, Course: ${a.subject}, Deadline: ${a.deadline}`));
    }

  } catch (err) {
    console.error("Database connection/query error:", err);
  } finally {
    await mongoose.disconnect();
  }
}

main();
