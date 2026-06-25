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
    name: "student-calendar-mcp",
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
  
  oauth2Client.on("tokens", (newTokens) => {
    const currentTokens = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
    const mergedTokens = { ...currentTokens, ...newTokens };
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(mergedTokens, null, 2));
  });
  
  return oauth2Client;
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "list_events",
        description: "List calendar events for a student within a date range.",
        inputSchema: {
          type: "object",
          properties: {
            timeMin: { type: "string", description: "ISO DateTime start (default: start of today)" },
            timeMax: { type: "string", description: "ISO DateTime end (default: end of this week)" }
          }
        }
      },
      {
        name: "find_free_slots",
        description: "Fetch free/busy windows on a target date to identify suitable slots for study sessions.",
        inputSchema: {
          type: "object",
          properties: {
            date: { type: "string", description: "Date in YYYY-MM-DD format" },
            durationHours: { type: "number", description: "Required study window size in hours (default: 2)", default: 2 }
          },
          required: ["date"]
        }
      },
      {
        name: "create_event",
        description: "Create a new study session or deadline event on the calendar.",
        inputSchema: {
          type: "object",
          properties: {
            summary: { type: "string", description: "Event title (e.g. 'Study: CS 102 BST Lab Prep')" },
            description: { type: "string", description: "Detailed description of topic coverage" },
            startISO: { type: "string", description: "Start ISO DateTime string (e.g., 2026-06-25T14:00:00+05:30)" },
            endISO: { type: "string", description: "End ISO DateTime string (e.g., 2026-06-25T16:00:00+05:30)" }
          },
          required: ["summary", "startISO", "endISO"]
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const auth = getAuthClient();
    const calendar = google.calendar({ version: "v3", auth });

    switch (name) {
      case "list_events": {
        const timeMin = args.timeMin || new Date().toISOString();
        
        const defaultMax = new Date();
        defaultMax.setDate(defaultMax.getDate() + 7);
        const timeMax = args.timeMax || defaultMax.toISOString();

        const res = await calendar.events.list({
          calendarId: "primary",
          timeMin: timeMin,
          timeMax: timeMax,
          singleEvents: true,
          orderBy: "startTime"
        });

        const events = (res.data.items || []).map(event => ({
          id: event.id,
          summary: event.summary,
          description: event.description || "",
          start: event.start.dateTime || event.start.date,
          end: event.end.dateTime || event.end.date
        }));

        return {
          content: [{ type: "text", text: JSON.stringify(events, null, 2) }]
        };
      }

      case "find_free_slots": {
        const date = args.date;
        const duration = args.durationHours || 2;
        
        const timeMin = `${date}T08:00:00Z`;
        const timeMax = `${date}T22:00:00Z`;

        const freebusyRes = await calendar.freebusy.query({
          requestBody: {
            timeMin,
            timeMax,
            items: [{ id: "primary" }]
          }
        });

        const busyIntervals = freebusyRes.data.calendars.primary.busy || [];
        
        const freeSlots = [];
        let cursor = new Date(timeMin).getTime();
        const endDay = new Date(timeMax).getTime();
        const durationMs = duration * 60 * 60 * 1000;

        const sortedBusy = busyIntervals.map(i => ({
          start: new Date(i.start).getTime(),
          end: new Date(i.end).getTime()
        })).sort((a, b) => a.start - b.start);

        for (let interval of sortedBusy) {
          if (interval.start > cursor + durationMs) {
            freeSlots.push({
              start: new Date(cursor).toISOString(),
              end: new Date(interval.start).toISOString()
            });
          }
          if (interval.end > cursor) {
            cursor = interval.end;
          }
        }

        if (endDay > cursor + durationMs) {
          freeSlots.push({
            start: new Date(cursor).toISOString(),
            end: new Date(endDay).toISOString()
          });
        }

        return {
          content: [
            {
              type: "text",
              text: `Free slot windows (>= ${duration} hour duration) on ${date}:\n` + JSON.stringify(freeSlots, null, 2)
            }
          ]
        };
      }

      case "create_event": {
        const res = await calendar.events.insert({
          calendarId: "primary",
          requestBody: {
            summary: args.summary,
            description: args.description || "Created by StudyMate Student Agent",
            start: {
              dateTime: args.startISO,
            },
            end: {
              dateTime: args.endISO,
            }
          }
        });

        return {
          content: [
            {
              type: "text",
              text: `Success: Calendar event created.\nID: ${res.data.id}\nSummary: '${args.summary}'\nTime: ${args.startISO} to ${args.endISO}`
            }
          ]
        };
      }

      default:
        throw new Error(`Tool not found: ${name}`);
    }
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Calendar MCP server running on stdio");
