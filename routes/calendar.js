import express from "express";
import { google } from "googleapis";
import { authMiddleware, getGoogleClientForUser } from "../utils/auth.js";

const router = express.Router();

export async function createCalendarEventForAssignment(authClient, assignment) {
  const calendar = google.calendar({ version: "v3", auth: authClient });

  const deadlineDate = new Date(assignment.deadline);
  
  const startDateTime = new Date(deadlineDate);
  startDateTime.setHours(12, 0, 0, 0);
  
  const endDateTime = new Date(deadlineDate);
  endDateTime.setHours(13, 0, 0, 0);

  const eventBody = {
    summary: `🚨 Due: ${assignment.title} [${assignment.subject}]`,
    description: `Automated assignment tracking for ${assignment.title}. Created by StudyMate.`,
    start: {
      dateTime: startDateTime.toISOString(),
      timeZone: "UTC"
    },
    end: {
      dateTime: endDateTime.toISOString(),
      timeZone: "UTC"
    },
    reminders: {
      useDefault: false,
      overrides: [
        { method: "email", minutes: 4320 }, // 3 days before
        { method: "popup", minutes: 1440 }  // 1 day before
      ]
    }
  };

  const response = await calendar.events.insert({
    calendarId: "primary",
    requestBody: eventBody
  });

  return response.data;
}

import Assignment from "../models/Assignment.js";
import Schedule from "../models/Schedule.js";

// @route   GET /api/calendar/events
router.get("/events", authMiddleware, async (req, res) => {
  try {
    const authClient = getGoogleClientForUser(req.user);

    if (!authClient) {
      const assignments = await Assignment.find({ userId: req.user._id });
      const events = [];

      assignments.forEach(task => {
        const start = new Date(task.deadline);
        start.setHours(12, 0, 0, 0);
        const end = new Date(start);
        end.setHours(13, 0, 0, 0);

        events.push({
          id: task._id.toString(),
          summary: `🚨 Due: ${task.title} [${task.subject}]`,
          description: "Sandbox Assignment deadline",
          start: start.toISOString(),
          end: end.toISOString()
        });
      });

      const schedule = await Schedule.findOne({ userId: req.user._id });
      if (schedule && schedule.scheduleData) {
        const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
        const today = new Date();

        days.forEach((day, index) => {
          const blocks = schedule.scheduleData[day] || [];
          const targetDay = new Date(today);
          targetDay.setDate(today.getDate() + (index - ((today.getDay() + 6) % 7)));

          blocks.forEach((block, bIdx) => {
            const start = new Date(targetDay);
            start.setHours(14 + bIdx * 2, 0, 0, 0);
            const end = new Date(start);
            end.setHours(start.getHours() + block.hours);

            events.push({
              id: `block_${day}_${bIdx}`,
              summary: `Study: ${block.subject} Prep`,
              description: "AI Scheduled Study Block",
              start: start.toISOString(),
              end: end.toISOString()
            });
          });
        });
      }

      const seen = new Set();
      const uniqueEvents = [];
      events.forEach(e => {
        if (e.summary) {
          const startDayStr = new Date(e.start).toDateString();
          const key = `${e.summary.trim()}_${startDayStr}`;
          if (!seen.has(key)) {
            seen.add(key);
            uniqueEvents.push(e);
          }
        }
      });

      return res.json(uniqueEvents);
    }

    const calendar = google.calendar({ version: "v3", auth: authClient });

    const start = new Date();
    start.setDate(start.getDate() - 30);
    start.setHours(0, 0, 0, 0);

    const end = new Date();
    end.setDate(end.getDate() + 60);
    end.setHours(23, 59, 59, 999);

    const response = await calendar.events.list({
      calendarId: "primary",
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: true,
      orderBy: "startTime"
    });

    const items = (response.data.items || []).map(event => ({
      id: event.id,
      summary: event.summary,
      description: event.description || "",
      start: event.start.dateTime || event.start.date,
      end: event.end.dateTime || event.end.date
    }));

    const seen = new Set();
    const uniqueItems = [];
    items.forEach(item => {
      if (item.summary) {
        const startDayStr = new Date(item.start).toDateString();
        const key = `${item.summary.trim()}_${startDayStr}`;
        if (!seen.has(key)) {
          seen.add(key);
          uniqueItems.push(item);
        }
      }
    });

    res.json(uniqueItems);
  } catch (error) {
    console.error("Failed to list calendar events:", error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
