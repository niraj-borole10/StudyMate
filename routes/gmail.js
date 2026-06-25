import express from "express";
import { google } from "googleapis";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { authMiddleware, getGoogleClientForUser } from "../utils/auth.js";
import Email from "../models/Email.js";
import Assignment from "../models/Assignment.js";
import { createCalendarEventForAssignment } from "./calendar.js";

const router = express.Router();

// Helper to extract email body text
function getBodyText(payload) {
  if (payload.body && payload.body.data) {
    return Buffer.from(payload.body.data, "base64").toString("utf8");
  }
  if (payload.parts) {
    for (let part of payload.parts) {
      let body = getBodyText(part);
      if (body) return body;
    }
  }
  return "";
}

// @route   POST /api/gmail/sync
// @desc    Sync unread emails, run Gemini extraction, and save assignments
router.post("/sync", authMiddleware, async (req, res) => {
  try {
    const authClient = getGoogleClientForUser(req.user);
    const isSandbox = !authClient;
    let messages = [];

    if (isSandbox) {
      // Mock Inbox Data
      messages = [
        {
          id: "mock_email_math_hw3",
          sender: "Prof. Sarah Jenkins <s.jenkins@university.edu>",
          subject: "Math 201: Homework 3 Announced",
          date: new Date().toISOString(),
          body: "Hi Class,\n\nPlease find Homework 3 attached. It covers Linear Transformations. Submissions are due on Friday by 5:00 PM. Late submissions will receive a 10% penalty per day.\n\nBest,\nProf. Jenkins"
        },
        {
          id: "mock_email_cs_lab4",
          sender: "CS 102 Coordinator <cs102-coord@university.edu>",
          subject: "Lab 4: Binary Trees Submission Portal Open",
          date: new Date().toISOString(),
          body: "Hi all,\n\nWelcome to Lab 4. You are required to implement a Binary Search Tree with insertion and deletion. Upload your solution as a single python file. Deadline: Friday at 11:59 PM."
        },
        {
          id: "mock_email_history_essay",
          sender: "Dr. Raymond Carver <r.carver@university.edu>",
          subject: "Term Essay Outline & Primary Sources",
          date: new Date().toISOString(),
          body: "Hello,\n\nA reminder that the primary source critique for your Term Essay is due next Monday. Please organize your references. Contact your TA if you need source materials."
        }
      ];
    } else {
      const gmail = google.gmail({ version: "v1", auth: authClient });
      const searchRes = await gmail.users.messages.list({
        userId: "me",
        q: "is:unread subject:(homework OR assignment OR project OR quiz OR exam)",
        maxResults: 10
      });
      messages = searchRes.data.messages || [];
    }

    const syncedEmails = [];
    const newAssignments = [];

    // Initialize Gemini Client
    const apiKey = process.env.GEMINI_API_KEY;
    let genAI;
    if (apiKey && apiKey !== "your_gemini_api_key_here") {
      genAI = new GoogleGenerativeAI(apiKey);
    } else {
      console.warn("⚠️ Warning: GEMINI_API_KEY is not configured. Falling back to mock extraction.");
    }

    for (let msg of messages) {
      // Avoid parsing already synced emails that were successfully processed
      let existingEmail = await Email.findOne({ emailId: msg.id });
      if (existingEmail && existingEmail.parsedStatus === "PROCESSED") continue;

      let subject, sender, date, body;

      if (isSandbox) {
        subject = msg.subject;
        sender = msg.sender;
        date = msg.date;
        body = msg.body;
      } else {
        const gmail = google.gmail({ version: "v1", auth: authClient });
        const detail = await gmail.users.messages.get({
          userId: "me",
          id: msg.id
        });

        const headers = detail.data.payload.headers;
        subject = headers.find(h => h.name.toLowerCase() === "subject")?.value || "(No Subject)";
        sender = headers.find(h => h.name.toLowerCase() === "from")?.value || "(Unknown)";
        date = headers.find(h => h.name.toLowerCase() === "date")?.value || "";
        body = getBodyText(detail.data.payload);
      }

      let emailRecord = existingEmail;
      if (!emailRecord) {
        emailRecord = new Email({
          userId: req.user._id,
          emailId: msg.id,
          sender,
          subject,
          date,
          body,
          parsedStatus: "UNPROCESSED"
        });
        await emailRecord.save();
        syncedEmails.push(emailRecord);
      } else {
        emailRecord.sender = sender;
        emailRecord.subject = subject;
        emailRecord.date = date;
        emailRecord.body = body;
        emailRecord.parsedStatus = "UNPROCESSED";
        await emailRecord.save();
        syncedEmails.push(emailRecord);
      }

      // 2. Perform AI Extraction
      try {
        let extractedData;
        
        if (genAI) {
          try {
            const model = genAI.getGenerativeModel({
              model: "gemini-2.5-flash",
              generationConfig: { responseMimeType: "application/json" }
            });

            const prompt = `
              Analyze this email sent to a student and extract assignment details.
              
              Email From: ${sender}
              Email Subject: ${subject}
              Email Body:
              """
              ${body}
              """
              
              Return JSON matching this exact structure:
              {
                "isAssignment": true,
                "title": "Name of homework or assignment",
                "deadline": "YYYY-MM-DD (estimate if only weekday mentioned, current year 2026)",
                "subject": "Course abbreviation or subject name (e.g. DBMS, DSA, Math)"
              }
              If the email is not an academic assignment or doesn't have a deadline, set "isAssignment" to false.
            `;

            const result = await model.generateContent(prompt);
            const rawText = result.response.text();
            extractedData = JSON.parse(rawText);
          } catch (apiErr) {
            console.error(`Gemini API call failed, falling back to mock extraction for ${subject}:`, apiErr);
            extractedData = mockExtract(subject, body);
          }
        } else {
          extractedData = mockExtract(subject, body);
        }

        if (extractedData && extractedData.isAssignment) {
          let assignment = await Assignment.findOne({ emailId: emailRecord._id });
          if (!assignment) {
            assignment = new Assignment({
              userId: req.user._id,
              emailId: emailRecord._id,
              title: extractedData.title,
              deadline: new Date(extractedData.deadline),
              subject: extractedData.subject,
              status: "todo"
            });
            await assignment.save();
            newAssignments.push(assignment);

            if (!isSandbox) {
              try {
                await createCalendarEventForAssignment(authClient, assignment);
              } catch (calError) {
                console.error(`Failed to schedule calendar event for ${assignment.title}:`, calError);
              }
            } else {
              console.log(`[Sandbox Mode] Skipping Google Calendar insert for: ${assignment.title}`);
            }
          } else {
            console.log(`Assignment already exists for email: ${emailRecord.subject}`);
          }

          emailRecord.parsedStatus = "PROCESSED";
          await emailRecord.save();
        } else {
          emailRecord.parsedStatus = "FAILED"; // Not an assignment
          await emailRecord.save();
        }

      } catch (err) {
        console.error(`Error parsing email ${msg.id} with Gemini/mock:`, err);
        emailRecord.parsedStatus = "FAILED";
        await emailRecord.save();
      }
    }

    res.json({
      success: true,
      emailsSynced: syncedEmails.length,
      assignmentsCreated: newAssignments.length,
      assignments: newAssignments
    });

  } catch (error) {
    console.error("Sync error:", error);
    res.status(500).json({ error: error.message });
  }
});

function mockExtract(subject, body) {
  const content = (subject + " " + body).toLowerCase();
  
  let subjectName = "General";
  if (content.includes("math")) subjectName = "Mathematics";
  else if (content.includes("cs") || content.includes("computer") || content.includes("binary trees")) subjectName = "Computer Science";
  else if (content.includes("history")) subjectName = "History";
  else if (content.includes("dbms")) subjectName = "DBMS";
  else if (content.includes("dsa")) subjectName = "DSA";

  let title = subject || "Course Assignment";

  let deadlineStr = "";
  const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december", "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  
  const dueOnReg = /due\s+(?:on|by)?\s*([a-z]+)\s+(\d{1,2})/i;
  const match = (subject + " " + body).match(dueOnReg);
  if (match) {
    const monthName = match[1].toLowerCase();
    const day = parseInt(match[2], 10);
    const monthIndex = months.findIndex(m => m === monthName || m.substring(0, 3) === monthName.substring(0, 3));
    if (monthIndex !== -1) {
      const year = 2026;
      const dateObj = new Date(year, monthIndex % 12, day);
      const yyyy = dateObj.getFullYear();
      const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
      const dd = String(dateObj.getDate()).padStart(2, '0');
      deadlineStr = `${yyyy}-${mm}-${dd}`;
    }
  }

  if (!deadlineStr) {
    const dl = new Date();
    dl.setDate(dl.getDate() + 5);
    const yyyy = dl.getFullYear();
    const mm = String(dl.getMonth() + 1).padStart(2, '0');
    const dd = String(dl.getDate()).padStart(2, '0');
    deadlineStr = `${yyyy}-${mm}-${dd}`;
  }

  let isAssignment = (content.includes("homework") || 
                      content.includes("assignment") || 
                      content.includes("project") || 
                      content.includes("quiz") || 
                      content.includes("exam") || 
                      content.includes("lab") || 
                      content.includes("essay"));

  if (content.includes("naukri") || content.includes("internship") || content.includes("newsletter") || content.includes("subscribe")) {
    isAssignment = false;
  }

  return {
    isAssignment,
    title,
    deadline: deadlineStr,
    subject: subjectName
  };
}

// @route   GET /api/gmail/emails
// @desc    Get synced emails
router.get("/emails", authMiddleware, async (req, res) => {
  try {
    const emails = await Email.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(10);
    res.json(emails);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// @route   GET /api/gmail/assignments
// @desc    Get all assignments for the user
router.get("/assignments", authMiddleware, async (req, res) => {
  try {
    const assignments = await Assignment.find({ userId: req.user._id }).sort({ deadline: 1 });
    res.json(assignments);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// @route   PUT /api/gmail/assignments/:id
// @desc    Update assignment status
router.put("/assignments/:id", authMiddleware, async (req, res) => {
  const { status } = req.body;
  if (!status) {
    return res.status(400).json({ error: "Status field is required" });
  }

  try {
    const assignment = await Assignment.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { status },
      { new: true }
    );
    if (!assignment) {
      return res.status(404).json({ error: "Assignment not found" });
    }
    res.json({ success: true, assignment });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
