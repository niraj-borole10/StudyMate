import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs";
import path from "path";
import { google } from "googleapis";
import { Readable } from "stream";

const server = new Server(
  {
    name: "student-drive-mcp",
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

// Find or create the Classroom_Backup parent folder in root Drive
async function getOrCreateRootFolder(drive) {
  const res = await drive.files.list({
    q: "name = 'Classroom_Backup' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
    fields: "files(id, name)"
  });

  if (res.data.files && res.data.files.length > 0) {
    return res.data.files[0].id;
  }

  const createRes = await drive.files.create({
    requestBody: {
      name: "Classroom_Backup",
      mimeType: "application/vnd.google-apps.folder"
    },
    fields: "id"
  });

  return createRes.data.id;
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "list_files",
        description: "List files and folders within the Classroom_Backup root directory.",
        inputSchema: {
          type: "object",
          properties: {
            folderId: { type: "string", description: "Optional folder ID to explore. Defaults to Classroom_Backup root." }
          }
        }
      },
      {
        name: "create_folder",
        description: "Create a new subdirectory for a course or lab section.",
        inputSchema: {
          type: "object",
          properties: {
            folderName: { type: "string", description: "Name of the new folder (e.g., 'CS_102_Lab_4')" },
            parentFolderId: { type: "string", description: "Optional parent folder ID. Defaults to Classroom_Backup root." }
          },
          required: ["folderName"]
        }
      },
      {
        name: "upload_file",
        description: "Upload assignment summaries, guidelines, or reference files into a folder.",
        inputSchema: {
          type: "object",
          properties: {
            fileName: { type: "string", description: "Name of the file including extension (e.g. 'notes.txt')" },
            content: { type: "string", description: "Text contents to write into the file" },
            parentFolderId: { type: "string", description: "Target folder ID to store the file" }
          },
          required: ["fileName", "content", "parentFolderId"]
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const auth = getAuthClient();
    const drive = google.drive({ version: "v3", auth });

    switch (name) {
      case "list_files": {
        const rootId = await getOrCreateRootFolder(drive);
        const parentId = args.folderId || rootId;

        const res = await drive.files.list({
          q: `'${parentId}' in parents and trashed = false`,
          fields: "files(id, name, mimeType)",
          orderBy: "folder,name"
        });

        const files = (res.data.files || []).map(f => ({
          id: f.id,
          name: f.name,
          type: f.mimeType === "application/vnd.google-apps.folder" ? "folder" : "file"
        }));

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ parentFolderId: parentId, items: files }, null, 2)
            }
          ]
        };
      }

      case "create_folder": {
        const rootId = await getOrCreateRootFolder(drive);
        const parentId = args.parentFolderId || rootId;

        const res = await drive.files.create({
          requestBody: {
            name: args.folderName,
            mimeType: "application/vnd.google-apps.folder",
            parents: [parentId]
          },
          fields: "id, name"
        });

        return {
          content: [
            {
              type: "text",
              text: `Success: Directory folder created successfully.\nFolder Name: "${res.data.name}"\nID: ${res.data.id}\nParent ID: ${parentId}`
            }
          ]
        };
      }

      case "upload_file": {
        const parentId = args.parentFolderId;
        const fileName = args.fileName;
        const textContent = args.content;

        const mediaStream = new Readable();
        mediaStream.push(textContent);
        mediaStream.push(null);

        const res = await drive.files.create({
          requestBody: {
            name: fileName,
            parents: [parentId]
          },
          media: {
            mimeType: "text/plain",
            body: mediaStream
          },
          fields: "id, name"
        });

        return {
          content: [
            {
              type: "text",
              text: `Success: File uploaded to Google Drive.\nFile Name: "${res.data.name}"\nID: ${res.data.id}\nParent ID: ${parentId}`
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
console.error("Drive MCP server running on stdio");
