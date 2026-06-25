import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  {
    name: "student-notion-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Mock Notion Database representation
const mockDatabase = [
  { id: "n1", properties: { Name: "Read History Chapter 4", Status: "In Progress", Subject: "History", Due: "2026-06-25" } },
  { id: "n2", properties: { Name: "Submit CS Lab 3", Status: "Completed", Subject: "Computer Science", Due: "2026-06-22" } }
];

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "list_tasks",
        description: "List all items in the Notion Assignment Database.",
        inputSchema: { type: "object", properties: {} }
      },
      {
        name: "add_task_to_database",
        description: "Add a newly parsed assignment to the student's Notion workspace.",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string", description: "Name of the task/assignment" },
            subject: { type: "string", description: "Associated course subject" },
            dueDate: { type: "string", description: "Due date in YYYY-MM-DD format" },
            status: { type: "string", enum: ["To Do", "In Progress", "Completed"], default: "To Do" }
          },
          required: ["title", "subject", "dueDate"]
        }
      },
      {
        name: "update_task_status",
        description: "Update the progress status of a task in Notion.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: { type: "string", description: "Notion page/task ID" },
            status: { type: "string", enum: ["To Do", "In Progress", "Completed"] }
          },
          required: ["taskId", "status"]
        }
      },
      {
        name: "create_study_guide_page",
        description: "Create a detailed subpage in Notion compiling notes, outlines, and resources for an assignment.",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string", description: "Title of the study guide page" },
            markdownContent: { type: "string", description: "Formatted markdown notes/outline to insert" }
          },
          required: ["title", "markdownContent"]
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "list_tasks": {
        return {
          content: [{ type: "text", text: JSON.stringify(mockDatabase, null, 2) }]
        };
      }

      case "add_task_to_database": {
        const newTask = {
          id: "n_" + Date.now(),
          properties: {
            Name: args.title,
            Status: args.status || "To Do",
            Subject: args.subject,
            Due: args.dueDate
          }
        };
        mockDatabase.push(newTask);
        
        return {
          content: [
            {
              type: "text",
              text: `Success: Notion task page created.\nTask Title: "${args.title}"\nID: ${newTask.id}\nStatus: ${args.status || "To Do"}`
            }
          ]
        };
      }

      case "update_task_status": {
        const id = args.taskId;
        const task = mockDatabase.find(t => t.id === id);
        
        if (!task) {
          return {
            content: [{ type: "text", text: `Error: Task with ID ${id} not found.` }],
            isError: true
          };
        }
        
        task.properties.Status = args.status;
        
        return {
          content: [{ type: "text", text: `Success: Task ID ${id} updated status to '${args.status}'.` }]
        };
      }

      case "create_study_guide_page": {
        return {
          content: [
            {
              type: "text",
              text: `Success: Notion study guide created under page title '${args.title}'.\nContent compiled: ${args.markdownContent.length} characters written.`
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
console.error("Notion MCP server running on stdio");
