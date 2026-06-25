import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
import mongoose from "mongoose";
import Email from "./models/Email.js";
import Assignment from "./models/Assignment.js";
import User from "./models/User.js";

dotenv.config();
const connStr = process.env.MONGO_URI || "mongodb://localhost:27017/studymate";

async function main() {
  console.log("=== PARSER TEST DIAGNOSTICS ===");
  const apiKey = process.env.GEMINI_API_KEY;
  console.log("Gemini API Key:", apiKey ? `${apiKey.substring(0, 8)}...` : "MISSING");

  try {
    await mongoose.connect(connStr);
    console.log("Connected to MongoDB.");

    const user = await User.findOne({ name: "Niraj Borole" });
    if (!user) {
      console.error("Niraj Borole user not found in DB.");
      return;
    }

    const testSubject = "Math Homework 3: Linear Algebra";
    const testBody = "Please solve problems 1 to 5 from chapter 3. Due on July 15.";

    console.log("\nSimulating email sync & parsing...");

    let genAI;
    if (apiKey && apiKey !== "your_gemini_api_key_here") {
      genAI = new GoogleGenerativeAI(apiKey);
    }

    let extractedData;
    if (genAI) {
      console.log("Attempting Gemini API Call...");
      try {
        const model = genAI.getGenerativeModel({
          model: "gemini-1.5-flash",
          generationConfig: { responseMimeType: "application/json" }
        });

        const prompt = `
          Analyze this email sent to a student and extract assignment details.
          Email From: Prof. Sarah Jenkins
          Email Subject: ${testSubject}
          Email Body: "${testBody}"
          Return JSON matching this exact structure:
          {
            "isAssignment": true,
            "title": "Name of homework or assignment",
            "deadline": "YYYY-MM-DD",
            "subject": "Course abbreviation or subject name"
          }
        `;

        const result = await model.generateContent(prompt);
        extractedData = JSON.parse(result.response.text());
        console.log("Gemini Output:", extractedData);
      } catch (apiErr) {
        console.error("Gemini API call failed, falling back to mock extraction:", apiErr.message);
        extractedData = {
          isAssignment: true,
          title: testSubject,
          deadline: "2026-07-15",
          subject: "Mathematics"
        };
      }
    } else {
      console.log("No Gemini API Key found. Using mock fallback...");
      extractedData = {
        isAssignment: true,
        title: testSubject,
        deadline: "2026-07-15",
        subject: "Mathematics"
      };
    }

    if (extractedData && extractedData.isAssignment) {
      console.log("Creating Assignment in MongoDB...");
      const assignment = new Assignment({
        userId: user._id,
        title: extractedData.title,
        deadline: new Date(extractedData.deadline),
        subject: extractedData.subject,
        status: "todo"
      });
      await assignment.save();
      console.log("✅ Success! Assignment created successfully.");
    } else {
      console.log("❌ Extracted data is not an assignment.");
    }

  } catch (error) {
    console.error("❌ ERROR RUNNING PARSER:", error);
  } finally {
    await mongoose.disconnect();
  }
}

main();
