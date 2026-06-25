import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
dotenv.config();

async function run() {
  const apiKey = process.env.GEMINI_API_KEY;
  console.log("API Key length:", apiKey ? apiKey.length : 0);
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    for (const modelName of ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.0-flash", "gemini-1.5-flash-latest"]) {
      try {
        console.log(`Testing model: ${modelName}`);
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent("Say hello");
        console.log(`Success with ${modelName}:`, result.response.text());
        break;
      } catch (err) {
        console.error(`Failed with ${modelName}:`, err.message);
      }
    }
  } catch (error) {
    console.error("General error:", error);
  }
}

run();
