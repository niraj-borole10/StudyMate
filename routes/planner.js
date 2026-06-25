import express from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { authMiddleware } from "../utils/auth.js";
import Schedule from "../models/Schedule.js";

const router = express.Router();

// @route   POST /api/planner/generate
router.post("/generate", authMiddleware, async (req, res) => {
  const { subjects, hoursPerDay } = req.body;

  if (!subjects || !Array.isArray(subjects) || subjects.length === 0) {
    return res.status(400).json({ error: "Subjects array is required" });
  }

  const hours = parseInt(hoursPerDay);
  if (isNaN(hours) || hours <= 0 || hours > 24) {
    return res.status(400).json({ error: "Hours per day must be a number between 1 and 24" });
  }

  try {
    let scheduleData;
    const apiKey = process.env.GEMINI_API_KEY;

    if (apiKey && apiKey !== "your_gemini_api_key_here") {
      try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
          model: "gemini-2.5-flash",
          generationConfig: { responseMimeType: "application/json" }
        });

        const prompt = `
          Create a realistic weekly study schedule (Monday to Sunday) for a student.
          Courses to study: ${subjects.join(", ")}
          Target study hours per day: ${hours} hours

          For each day of the week, distribute the target ${hours} hours across these courses.
          Make sure the distribution is balanced, assigning hours in whole numbers (e.g. 1, 2, etc.) that sum up to exactly ${hours} hours per day.

          Return JSON matching this exact structure:
          {
            "schedule": {
              "monday": [{"subject": "CourseName", "hours": 2}, {"subject": "CourseName2", "hours": 2}],
              "tuesday": [{"subject": "CourseName", "hours": 1}, {"subject": "CourseName2", "hours": 3}],
              "wednesday": [...],
              "thursday": [...],
              "friday": [...],
              "saturday": [...],
              "sunday": [...]
            }
          }
        `;

        const result = await model.generateContent(prompt);
        const text = result.response.text();
        scheduleData = JSON.parse(text).schedule;
      } catch (apiErr) {
        console.error("Gemini API call failed, falling back to mock schedule generator:", apiErr);
        scheduleData = generateMockSchedule(subjects, hours);
      }
    } else {
      scheduleData = generateMockSchedule(subjects, hours);
    }

    let schedule = await Schedule.findOne({ userId: req.user._id });
    if (!schedule) {
      schedule = new Schedule({
        userId: req.user._id,
        subjects,
        hoursPerDay: hours,
        scheduleData
      });
    } else {
      schedule.subjects = subjects;
      schedule.hoursPerDay = hours;
      schedule.scheduleData = scheduleData;
      schedule.updatedAt = new Date();
    }

    await schedule.save();
    res.json({ success: true, schedule });

  } catch (error) {
    console.error("Failed to generate schedule:", error);
    res.status(500).json({ error: error.message });
  }
});

function generateMockSchedule(subjects, hours) {
  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const schedule = {};

  days.forEach(day => {
    const dayBlocks = [];
    let remainingHours = hours;

    for (let i = 0; remainingHours > 0; i++) {
      const subject = subjects[i % subjects.length];
      const hoursToAssign = Math.min(remainingHours, Math.ceil(hours / subjects.length));
      dayBlocks.push({ subject, hours: hoursToAssign });
      remainingHours -= hoursToAssign;
    }

    schedule[day] = dayBlocks;
  });

  return schedule;
}

// @route   GET /api/planner/schedule
router.get("/schedule", authMiddleware, async (req, res) => {
  try {
    const schedule = await Schedule.findOne({ userId: req.user._id });
    if (!schedule) {
      return res.json({ found: false });
    }
    res.json({ found: true, schedule });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
