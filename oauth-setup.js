import fs from "fs";
import path from "path";
import http from "http";
import { google } from "googleapis";
import { exec } from "child_process";

const TOKEN_PATH = path.join(process.cwd(), "tokens.json");
const SECRET_PATH = path.join(process.cwd(), "client_secret.json");
const ALT_SECRET_PATH = path.join(process.cwd(), "credentials.json");
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",       // Read, search, and mark emails as read
  "https://www.googleapis.com/auth/calendar",           // Manage student calendar events
  "https://www.googleapis.com/auth/drive.file"          // Create folders and upload files
];

async function main() {
  console.log("=========================================");
  console.log("Google OAuth2 Setup - Student Agent");
  console.log("=========================================\n");

  let credentials;
  let secretFile = SECRET_PATH;

  // 1. Locate and read Google OAuth Credentials
  if (fs.existsSync(SECRET_PATH)) {
    credentials = JSON.parse(fs.readFileSync(SECRET_PATH, "utf8"));
  } else if (fs.existsSync(ALT_SECRET_PATH)) {
    credentials = JSON.parse(fs.readFileSync(ALT_SECRET_PATH, "utf8"));
    secretFile = ALT_SECRET_PATH;
  } else {
    console.error("❌ Error: OAuth Client Secret file not found!");
    console.log(`Please download your OAuth client configuration JSON from the Google Cloud Console`);
    console.log(`and save it as 'client_secret.json' inside: ${process.cwd()}\n`);
    console.log("Instructions:");
    console.log("1. Go to Google Cloud Console (https://console.cloud.google.com)");
    console.log("2. Create a project, and enable Gmail API, Google Calendar API, and Google Drive API.");
    console.log("3. Configure OAuth Consent Screen (add your email as a Test User).");
    console.log("4. Under Credentials -> Create Credentials -> OAuth Client ID.");
    console.log("5. Set Application Type to 'Web Application' (or 'Desktop Application').");
    console.log("6. Add Authorized Redirect URI: http://localhost:3000/oauth2callback");
    console.log("7. Download the JSON, rename it to 'client_secret.json' and place it in the project folder.\n");
    
    // Create template example to help user
    const exampleSecret = {
      web: {
        client_id: "YOUR_CLIENT_ID.apps.googleusercontent.com",
        project_id: "your-project-id",
        auth_uri: "https://accounts.google.com/o/oauth2/auth",
        token_uri: "https://oauth2.googleapis.com/token",
        client_secret: "YOUR_CLIENT_SECRET",
        redirect_uris: ["http://localhost:3000/oauth2callback"]
      }
    };
    fs.writeFileSync(path.join(process.cwd(), "client_secret.json.example"), JSON.stringify(exampleSecret, null, 2));
    console.log(`Created template: 'client_secret.json.example' in your folder.`);
    process.exit(1);
  }

  // Parse Google JSON structure (can be 'web' or 'installed' depending on credential type)
  const config = credentials.web || credentials.installed;
  if (!config) {
    console.error("❌ Error: Invalid client_secret.json structure. Must contain 'web' or 'installed' key.");
    process.exit(1);
  }

  const { client_id, client_secret, redirect_uris } = config;
  const redirectUri = redirect_uris ? redirect_uris[0] : "http://localhost:3000/oauth2callback";

  // 2. Initialize Google OAuth2 Client
  const oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirectUri);

  // 3. Generate Authorization Consent URL
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline", // Generates a refresh token
    scope: SCOPES,
    prompt: "consent" // Force authorization consent screen to get refresh token every setup run
  });

  console.log("🔑 Open the URL below in your web browser to authenticate:");
  console.log("---------------------------------------------------------");
  console.log(authUrl);
  console.log("---------------------------------------------------------\n");

  // Attempt to open the URL automatically in Windows browser
  exec(`start "" "${authUrl.replace(/&/g, "^&")}"`, (err) => {
    // Fail silently if browser open fails; user can copy-paste URL
  });

  console.log("📡 Listening on http://localhost:3000/oauth2callback for callback code...");

  // 4. Start local HTTP Callback Server to catch the redirect code
  const server = http.createServer(async (req, res) => {
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    
    if (urlObj.pathname === "/oauth2callback") {
      const code = urlObj.searchParams.get("code");
      
      if (!code) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("<h1>Error</h1><p>Authorization code missing in redirect query.</p>");
        return;
      }

      try {
        // Exchange authorization code for tokens
        const { tokens } = await oauth2Client.getToken(code);
        
        // Write tokens to disk
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
        
        console.log("\n✅ Success! Tokens received and saved to tokens.json");
        console.log("Setup complete. You can now run the MCP servers!");

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <html>
            <body style="font-family: sans-serif; text-align: center; padding-top: 50px; background-color: #0f172a; color: #f8fafc;">
              <h1 style="color: #22c55e;">Authentication Successful!</h1>
              <p>Google Workspace credentials have been saved to your project folder.</p>
              <p style="color: #94a3b8;">You can close this tab and return to the terminal.</p>
            </body>
          </html>
        `);

        // Close server and exit process
        setTimeout(() => {
          server.close(() => {
            process.exit(0);
          });
        }, 1000);

      } catch (error) {
        console.error("❌ Error exchanging authorization code:", error);
        res.writeHead(500, { "Content-Type": "text/html" });
        res.end(`<h1>Authentication Failed</h1><p>${error.message}</p>`);
      }
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(3000);
}

main().catch(console.error);
