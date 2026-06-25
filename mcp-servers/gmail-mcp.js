import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs";
import path from "path";
import { google } from "googleapis";

const server = new Server(
  {
    name: "student-gmail-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

function getAuthClient() {
  const TOKEN_PATH = path.join(process.cwd(), "tokens.json");
  const SECRET_PATH = path.join(process.cwd(), "client_secret.json");
  const ALT_SECRET_PATH = path.join(process.cwd(), "credentials.json");

  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error("Missing tokens.json. Please run 'node oauth-setup.js' first.");
  }
  
  let secretContent;
  if (fs.existsSync(SECRET_PATH)) {
    secretContent = fs.readFileSync(SECRET_PATH, "utf8");
  } else if (fs.existsSync(ALT_SECRET_PATH)) {
    secretContent = fs.readFileSync(ALT_SECRET_PATH, "utf8");
  } else {
    throw new Error("Missing client_secret.json. Please run 'node oauth-setup.js' first.");
  }
  
  const credentials = JSON.parse(secretContent);
  const config = credentials.web || credentials.installed;
  const { client_id, client_secret, redirect_uris } = config;
  const redirectUri = redirect_uris ? redirect_uris[0] : "http://localhost:3000/oauth2callback";
  
  const oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirectUri);
  const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
  oauth2Client.setCredentials(tokens);
  
  // Save refreshed tokens
  oauth2Client.on("tokens", (newTokens) => {
    const currentTokens = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
    const mergedTokens = { ...currentTokens, ...newTokens };
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(mergedTokens, null, 2));
  });
  
  return oauth2Client;
}

// Parse email payload parts for body text
function getEmailBody(payload) {
  if (payload.body && payload.body.data) {
    return Buffer.from(payload.body.data, "base64").toString("utf8");
  }
  if (payload.parts) {
    for (let part of payload.parts) {
      let body = getEmailBody(part);
      if (body) return body;
    }
  }
  return "";
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "list_emails",
        description: "List unread messages from your Gmail inbox. Can search by query keywords like 'assignment' or 'homework'.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Query search parameters matching Gmail syntax (default: 'is:unread subject:(homework OR assignment OR quiz OR project)')",
              default: "is:unread subject:(homework OR assignment OR quiz OR project)"
            },
            maxResults: {
              type: "number",
              description: "Maximum number of messages to return (default: 5)",
              default: 5
            }
          }
        }
      },
      {
        name: "get_email_details",
        description: "Fetch contents and body of a specific email by ID to parse assignment deadlines.",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "The unique ID of the email to retrieve"
            }
          },
          required: ["id"]
        }
      },
      {
        name: "mark_as_read",
        description: "Mark an email as read once processed by the agent.",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "The unique ID of the email to modify"
            }
          },
          required: ["id"]
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const auth = getAuthClient();
    const gmail = google.gmail({ version: "v1", auth });

    switch (name) {
      case "list_emails": {
        const query = args?.query || "is:unread subject:(homework OR assignment OR quiz OR project)";
        const limit = args?.maxResults || 5;

        const res = await gmail.users.messages.list({
          userId: "me",
          q: query,
          maxResults: limit
        });

        const messages = res.data.messages || [];
        const resultList = [];

        for (let msg of messages) {
          const detail = await gmail.users.messages.get({
            userId: "me",
            id: msg.id,
            format: "metadata",
            metadataHeaders: ["Subject", "From", "Date"]
          });

          const headers = detail.data.payload.headers;
          const subject = headers.find(h => h.name === "Subject")?.value || "(No Subject)";
          const from = headers.find(h => h.name === "From")?.value || "(Unknown)";
          const date = headers.find(h => h.name === "Date")?.value || "";

          resultList.push({
            id: msg.id,
            sender: from,
            subject,
            date
          });
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(resultList, null, 2),
            },
          ],
        };
      }

      case "get_email_details": {
        const id = args?.id;
        const res = await gmail.users.messages.get({
          userId: "me",
          id: id
        });

        const headers = res.data.payload.headers;
        const subject = headers.find(h => h.name === "Subject")?.value || "";
        const from = headers.find(h => h.name === "From")?.value || "";
        const date = headers.find(h => h.name === "Date")?.value || "";
        const body = getEmailBody(res.data.payload);

        const emailDetails = {
          id,
          sender: from,
          subject,
          date,
          body
        };

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(emailDetails, null, 2),
            },
          ],
        };
      }

      case "mark_as_read": {
        const id = args?.id;
        await gmail.users.messages.modify({
          userId: "me",
          id: id,
          requestBody: {
            removeLabelIds: ["UNREAD"]
          }
        });

        return {
          content: [
            {
              type: "text",
              text: `Success: Email ${id} marked as read.`,
            },
          ],
        };
      }

      default:
        throw new Error(`Tool not found: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error processing tool ${name}: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Gmail MCP server running on stdio");
