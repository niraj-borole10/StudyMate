import express from "express";
import { google } from "googleapis";
import { authMiddleware, getGoogleClientForUser } from "../utils/auth.js";
import fs from "fs";
import path from "path";

const router = express.Router();
const RAG_SERVICE_URL = process.env.RAG_SERVICE_URL || "http://localhost:8000";

// Find or create classroom folder in Google Drive
async function getClassroomFolder(drive) {
  const res = await drive.files.list({
    q: "name = 'Classroom_Backup' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
    fields: "files(id)"
  });
  if (res.data.files && res.data.files.length > 0) {
    return res.data.files[0].id;
  }
  return null;
}

// @route   POST /api/rag/sync-drive
// @desc    Download academic PDFs from Drive and upload them to the Python RAG service
router.post("/sync-drive", authMiddleware, async (req, res) => {
  try {
    const authClient = getGoogleClientForUser(req.user);

    if (!authClient) {
      // Sandbox Mode: Write a default notes text file and upload it to the local FastAPI RAG server
      const sandboxNotePath = path.join(process.cwd(), "dynamic_programming_notes.txt");
      
      if (!fs.existsSync(sandboxNotePath)) {
        fs.writeFileSync(
          sandboxNotePath, 
          "Dynamic Programming (DP) Notes:\n" +
          "- Dynamic Programming is an algorithmic technique for solving optimization problems by breaking them down into simpler subproblems and utilizing the 'Memoization' or 'Tabulation' techniques to avoid redundant computations.\n" +
          "- Key components: Overlapping Subproblems and Optimal Substructure.\n" +
          "- Example problem: Fibonacci sequence, Knapsack problem, Longest Common Subsequence (LCS).\n" +
          "- Memoization is a top-down approach where we store the results of expensive function calls and return the cached result when the same inputs occur again.\n" +
          "- Tabulation is a bottom-up approach where we build a table (usually a 1D or 2D array) and fill it in a sequential order starting from base cases."
        );
      }

      const { default: fetch } = await import("node-fetch");
      const { FormData, Blob } = await import("formdata-node");

      const fileBuffer = fs.readFileSync(sandboxNotePath);
      const formData = new FormData();
      const blob = new Blob([fileBuffer], { type: "text/plain" });
      formData.set("file", blob, "dynamic_programming_notes.txt");
      formData.set("user_id", req.user._id.toString());

      const ingestRes = await fetch(`${RAG_SERVICE_URL}/ingest`, {
        method: "POST",
        body: formData
      });

      const ingestedFiles = [];
      if (ingestRes.ok) {
        const result = await ingestRes.json();
        ingestedFiles.push({ name: "dynamic_programming_notes.txt", status: "Success", details: result });
      } else {
        const errText = await ingestRes.text();
        ingestedFiles.push({ name: "dynamic_programming_notes.txt", status: "Failed", error: errText });
      }

      return res.json({
        success: true,
        filesProcessed: 1,
        ingested: ingestedFiles
      });
    }

    const drive = google.drive({ version: "v3", auth: authClient });

    // 1. Locate Classroom folder
    const folderId = await getClassroomFolder(drive);
    console.log("Classroom_Backup folder ID found:", folderId);
    if (!folderId) {
      return res.status(404).json({ error: "Classroom_Backup directory not found on your Google Drive." });
    }

    // 2. Fetch all PDF and text files in that directory
    const listRes = await drive.files.list({
      q: `'${folderId}' in parents and (mimeType = 'application/pdf' or mimeType = 'text/plain') and trashed = false`,
      fields: "files(id, name, mimeType)"
    });

    const files = listRes.data.files || [];
    console.log("Found files count in Classroom_Backup:", files.length);
    const ingestedFiles = [];

    // Import dynamic FormData node helper (available since Node 18)
    const { default: fetch } = await import("node-fetch");
    const { FormData, Blob } = await import("formdata-node");

    for (let file of files) {
      try {
        console.log("Downloading file from Google Drive:", file.name, "ID:", file.id);
        // Fetch file data as arrayBuffer
        const fileRes = await drive.files.get(
          { fileId: file.id, alt: "media" },
          { responseType: "arraybuffer" }
        );

        // Construct FormData for multipart transfer
        const formData = new FormData();
        const blob = new Blob([fileRes.data], { type: file.mimeType });
        formData.set("file", blob, file.name);
        formData.set("user_id", req.user._id.toString());

        console.log("Posting file to FastAPI RAG service /ingest:", file.name);
        // Upload to Python FastAPI RAG Service
        const ingestRes = await fetch(`${RAG_SERVICE_URL}/ingest`, {
          method: "POST",
          body: formData
        });

        if (ingestRes.ok) {
          const result = await ingestRes.json();
          console.log("Ingestion success for file:", file.name, "Details:", result);
          ingestedFiles.push({ name: file.name, status: "Success", details: result });
        } else {
          const errText = await ingestRes.text();
          console.error("Ingestion failed for file:", file.name, "Response:", errText);
          ingestedFiles.push({ name: file.name, status: "Failed", error: errText });
        }

      } catch (fileErr) {
        console.error(`Failed to sync file ${file.name}:`, fileErr);
        ingestedFiles.push({ name: file.name, status: "Failed", error: fileErr.message });
      }
    }

    res.json({
      success: true,
      filesProcessed: files.length,
      ingested: ingestedFiles
    });

  } catch (error) {
    console.error("Drive sync error:", error);
    res.status(500).json({ error: error.message });
  }
});

// @route   POST /api/rag/query
// @desc    Query the RAG microservice with a student question
router.post("/query", authMiddleware, async (req, res) => {
  const { question } = req.body;
  if (!question) {
    return res.status(400).json({ error: "Question parameter is required" });
  }

  try {
    const { default: fetch } = await import("node-fetch");
    
    // Query python FastAPI RAG Service
    const response = await fetch(`${RAG_SERVICE_URL}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, user_id: req.user._id.toString() })
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: `RAG Service error: ${errText}` });
    }

    const data = await response.json();
    res.json(data);

  } catch (error) {
    console.error("RAG query error:", error);
    res.status(500).json({ error: `Could not reach RAG service: ${error.message}` });
  }
});

// @route   GET /api/rag/files
// @desc    Get files count and names from RAG service
router.get("/files", authMiddleware, async (req, res) => {
  try {
    const { default: fetch } = await import("node-fetch");
    const response = await fetch(`${RAG_SERVICE_URL}/count?user_id=${req.user._id.toString()}`);
    if (response.ok) {
      const data = await response.json();
      res.json(data);
    } else {
      res.json({ count: 0, files: [] });
    }
  } catch (error) {
    console.error("Failed to fetch RAG files:", error);
    res.json({ count: 0, files: [] });
  }
});

export default router;
