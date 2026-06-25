import jwt from "jsonwebtoken";
import { google } from "googleapis";
import User from "../models/User.js";
import { getOAuth2Client } from "../routes/auth.js";

const JWT_SECRET = process.env.JWT_SECRET || "super_secret_jwt_key";

// Express middleware to verify JWT cookies
export async function authMiddleware(req, res, next) {
  const token = req.cookies.token;
  if (!token) {
    return res.status(401).json({ error: "Unauthorized. Please sign in." });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(401).json({ error: "Session user not found." });
    }
    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid session token." });
  }
}

// Instantiate authorized Google client for a user
export function getGoogleClientForUser(user) {
  if (!user.googleTokens) {
    throw new Error("No Google authorization tokens found for this account.");
  }

  if (user.googleTokens.sandbox) {
    return null; // Sandbox Mode client
  }

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials(user.googleTokens);

  // When Google library auto-refreshes the access token, update Mongoose User
  oauth2Client.on("tokens", async (newTokens) => {
    try {
      const dbUser = await User.findById(user._id);
      if (dbUser) {
        dbUser.googleTokens = { ...dbUser.googleTokens, ...newTokens };
        await dbUser.save();
        console.log(`Refreshed Google OAuth tokens saved for user: ${dbUser.email}`);
      }
    } catch (err) {
      console.error("Failed to save refreshed Google tokens:", err);
    }
  });

  return oauth2Client;
}
