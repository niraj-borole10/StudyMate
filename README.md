# StudyMate - Student Productivity Agent 🎓

StudyMate is an intelligent full-stack AI student productivity workspace that reads and parses homework/assignment details from student emails using Gemini AI, schedules prep blocks on calendars, logs deadlines in Notion (or local Kanban boards), tracks files on Google Drive, and features an AI Academic Tutor running a local Retrieval-Augmented Generation (RAG) system on student notes.

This project consists of:
1. **Frontend Client Interface (`public/`)**: A premium glassmorphic dashboard showcasing assignments, Google Calendar, an AI study planner, and a QA Notes tutor.
2. **Backend Server (`server.js`)**: An Express.js web server handling Google OAuth2 login sessions, MongoDB persistence, Gmail API sync, and Calendar/Drive integration.
3. **AI RAG Microservice (`rag-service/`)**: A FastAPI Python service leveraging ChromaDB vector database and Gemini API embeddings to let students ask questions based on PDF/Text study guides synced from Google Drive.
4. **Standalone MCP Server Templates (`mcp-servers/`)**: Model Context Protocol servers for third-party client integrations (like Claude Desktop).

---

## 🛠️ Installation & Setup

### Prerequisites
- **Node.js** (version 18+)
- **Python** (version 3.10+)

---

## 🚀 Step 1: Install Dependencies

### 1. Install Node.js Packages
Run the following inside the project root directory:
```bash
npm install
```

### 2. Setup Python Virtual Environment (for RAG)
Create and activate a virtual environment, then install Python packages:
```bash
# Go to RAG directory
cd rag-service

# Create virtual environment
python -m venv venv

# Activate (Windows PowerShell)
.\venv\Scripts\Activate.ps1

# Install requirements
pip install -r requirements.txt

# Return to root
cd ..
```

---

## ⚙️ Step 2: Environment Configurations

1. **Google OAuth Client Credentials**:
   - Go to [Google Cloud Console](https://console.cloud.google.com).
   - Create a project. Enable **Gmail API**, **Google Calendar API**, and **Google Drive API**.
   - Set up **OAuth Consent Screen** (User Type: External, add your email as a **Test User**).
   - Under **Credentials**, create an **OAuth 2.0 Client ID** (select **Web Application**).
   - Add Authorized Redirect URI: `http://localhost:5000/api/auth/callback`
   - Download the JSON credentials file, rename it to **`client_secret.json`**, and place it in the project root: `C:\Users\Ulhas\Desktop\MCP\client_secret.json`.

2. **Setup environment parameters**:
   - Open `.env` file in the project root and configure your credentials:
     ```env
     PORT=5000
     JWT_SECRET=any_random_secret_string
     MONGO_URI=your_mongodvb_url
     GEMINI_API_KEY=gemini_key
     RAG_SERVICE_URL=http://localhost:8000
     ```

---

## ⚡ Step 3: Run the Application

### 1. Launch MongoDB
Make sure your MongoDB server is running:
```powershell
# In Windows PowerShell (Run as Administrator)
net start MongoDB
```

### 2. Start the Python RAG Microservice
Activate your virtual environment and run the FastAPI app:
```bash
cd rag-service
# (Ensure venv is active)
python app.py
```
*Runs on http://localhost:8000*

### 3. Start the Express Web Server
In a new terminal window at the project root, run:
```bash
npm start
```
*Runs on http://localhost:5000*

Open your browser and navigate to **[http://localhost:5000](http://localhost:5000)** to sign in with Google and start managing your workspace!