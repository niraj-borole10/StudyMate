import express from "express";
import fs from "fs";
import path from "path";
import { google } from "googleapis";
import jwt from "jsonwebtoken";
import User from "../models/User.js";

const router = express.Router();

const SECRET_PATH = path.join(process.cwd(), "client_secret.json");
const ALT_SECRET_PATH = path.join(process.cwd(), "credentials.json");
const JWT_SECRET = process.env.JWT_SECRET || "super_secret_jwt_key";

// Helper to check if credentials file exists
export function hasClientSecrets() {
  return fs.existsSync(SECRET_PATH) || fs.existsSync(ALT_SECRET_PATH);
}

// Helper to get configured OAuth2 client
export function getOAuth2Client() {
  let secretContent;
  if (fs.existsSync(SECRET_PATH)) {
    secretContent = fs.readFileSync(SECRET_PATH, "utf8");
  } else if (fs.existsSync(ALT_SECRET_PATH)) {
    secretContent = fs.readFileSync(ALT_SECRET_PATH, "utf8");
  } else {
    throw new Error("Missing client_secret.json credentials in root project folder.");
  }

  const credentials = JSON.parse(secretContent);
  const config = credentials.web || credentials.installed;
  const { client_id, client_secret, redirect_uris } = config;
  const redirectUri = redirect_uris ? redirect_uris[0] : "http://localhost:3000/oauth2callback";

  // Use the callback route served by our Express server (port 5000)
  const expressRedirectUri = `http://localhost:${process.env.PORT || 5000}/api/auth/callback`;

  return new google.auth.OAuth2(client_id, client_secret, expressRedirectUri);
}

// Scopes required
const SCOPES = [
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/drive.readonly"
];

// @route   GET /api/auth/google
// @desc    Redirect to Google OAuth Consent Page (or fallback to Sandbox Mode)
router.get("/google", (req, res) => {
  try {
    if (!hasClientSecrets()) {
      console.log("⚠️ No Google client secret file found in workspace. Routing to Sandbox Mode.");
      return res.redirect(`/api/auth/callback?sandbox=true`);
    }

    const oauth2Client = getOAuth2Client();
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: SCOPES,
      prompt: "consent"
    });
    res.redirect(authUrl);
  } catch (error) {
    console.error("OAuth generate url error:", error);
    res.status(500).send(`
      <html>
        <body style="font-family: sans-serif; padding: 40px; background-color: #0f172a; color: #f8fafc; text-align: center;">
          <h1 style="color: #ef4444;">OAuth Setup Required</h1>
          <p>Please make sure you have placed your downloaded 'client_secret.json' inside the project folder.</p>
          <p style="color: #94a3b8; font-size: 0.95rem;">${error.message}</p>
        </body>
      </html>
    `);
  }
});

// @route   GET /api/auth/callback
// @desc    OAuth Redirect Handler (Code Exchange -> JWT Cookie)
router.get("/callback", async (req, res) => {
  const isSandbox = req.query.sandbox === "true";
  const code = req.query.code;

  if (!isSandbox && !code) {
    return res.status(400).send("Authorization code is missing.");
  }

  try {
    let profile;
    let tokens = {};

    if (isSandbox) {
      profile = {
        id: "sandbox_student_id",
        name: "Sandbox Student",
        email: "sandbox@studymate.edu",
        picture: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200"
      };
      tokens = { sandbox: true };
    } else {
      const oauth2Client = getOAuth2Client();
      
      // Exchange callback code for tokens
      const { tokens: exchangedTokens } = await oauth2Client.getToken(code);
      tokens = exchangedTokens;
      oauth2Client.setCredentials(tokens);

      // Fetch Google profile
      const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
      const userInfoRes = await oauth2.userinfo.get();
      profile = userInfoRes.data;
    }

    // Find or create Mongoose User
    let user = await User.findOne({ googleId: profile.id });
    if (!user) {
      user = new User({
        googleId: profile.id,
        name: profile.name,
        email: profile.email,
        picture: profile.picture,
        googleTokens: tokens
      });
    } else {
      // Update tokens (ensures we retain the refresh token)
      user.name = profile.name;
      user.picture = profile.picture;
      user.googleTokens = { ...user.googleTokens, ...tokens };
    }

    await user.save();

    // Create JWT Token session
    const payload = { userId: user._id };
    const jwtToken = jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });

    // Set JWT in HTTP-Only Cookie
    res.cookie("token", jwtToken, {
      httpOnly: true,
      secure: false, // Set to true if running on HTTPS
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    // Redirect to Dashboard home page
    res.redirect("/");
  } catch (error) {
    console.error("OAuth callback error:", error);
    res.status(500).send(`Authentication failed: ${error.message}`);
  }
});

// @route   GET /api/auth/status
// @desc    Check auth status and return user details
router.get("/status", async (req, res) => {
  const token = req.cookies.token;
  if (!token) {
    return res.status(401).json({ authenticated: false, message: "No session token found" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId).select("-googleTokens");
    if (!user) {
      return res.status(401).json({ authenticated: false, message: "User not found" });
    }

    res.json({ authenticated: true, user });
  } catch (error) {
    res.status(401).json({ authenticated: false, message: "Invalid session token" });
  }
});

// @route   GET /api/auth/logout
// @desc    Logout user & clear cookie
router.get("/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ success: true, message: "Logged out successfully" });
});

export default router;
