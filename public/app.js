
let currentUser = null;
let currentActiveTab = "dashboard";

const loginScreen = document.getElementById("login-screen");
const appScreen = document.getElementById("app-screen");
const clockEl = document.getElementById("time-display");


const userPicture = document.getElementById("user-picture");
const userName = document.getElementById("user-name");
const userEmail = document.getElementById("user-email");

const navItems = document.querySelectorAll(".nav-item");
const tabContents = document.querySelectorAll(".tab-content");

function updateClock() {
  const now = new Date();
  let hours = now.getHours().toString().padStart(2, "0");
  let minutes = now.getMinutes().toString().padStart(2, "0");
  clockEl.textContent = `${hours}:${minutes}`;
}
setInterval(updateClock, 1000);
updateClock();

// 1. Session Authentication & Boot
async function checkAuthStatus() {
  try {
    const res = await fetch("/api/auth/status");
    const data = await res.json();

    if (data.authenticated) {
      currentUser = data.user;
      showAppScreen();
    } else {
      showLoginScreen();
    }
  } catch (error) {
    console.error("Auth status validation failed:", error);
    showLoginScreen();
  }
}

function showLoginScreen() {
  loginScreen.style.display = "flex";
  appScreen.style.display = "none";
  lucide.createIcons();
}

function showAppScreen() {
  loginScreen.style.display = "none";
  appScreen.style.display = "flex";
  userPicture.src = currentUser.picture || "https://via.placeholder.com/150";
  userName.textContent = currentUser.name;
  userEmail.textContent = currentUser.email;

  initSettings();

  loadTabData(currentActiveTab);
}

// Logout handler
document.getElementById("btn-logout").addEventListener("click", async () => {
  try {
    await fetch("/api/auth/logout");
    window.location.reload();
  } catch (error) {
    console.error("Logout failed:", error);
  }
});

// ==========================================
// 2. Tab Navigation
// ==========================================
navItems.forEach(item => {
  item.addEventListener("click", () => {
    const tabName = item.getAttribute("data-tab");
    
    // Toggle active classes on nav
    navItems.forEach(n => n.classList.remove("active"));
    item.classList.add("active");

    // Toggle active tab panel
    tabContents.forEach(content => {
      content.classList.remove("active");
      if (content.id === `tab-${tabName}`) {
        content.classList.add("active");
      }
    });

    currentActiveTab = tabName;
    loadTabData(tabName);
  });
});

function loadTabData(tabName) {
  switch (tabName) {
    case "dashboard":
      loadDashboardData();
      break;
    case "assignments":
      loadAssignmentsData();
      break;
    case "calendar":
      loadCalendarData();
      break;
    case "planner":
      loadPlannerData();
      break;
    case "notes":
      loadNotesData();
      break;
  }
}

// ==========================================
// 3. Tab 1: Dashboard Logic
// ==========================================
async function loadDashboardData() {
  logAgentAction("Syncing dashboard widgets...");
  
  try {
    // 1. Fetch Assignments
    const assignRes = await fetch("/api/gmail/assignments");
    const assignments = await assignRes.json();
    const todoAssignments = assignments.filter(a => a.status !== "completed");
    document.getElementById("stat-assignments-count").textContent = todoAssignments.length;

    // Calculate closest upcoming (or most urgent overdue) deadline
    let closestAssignment = null;
    let minDeadlineTime = Infinity;
    todoAssignments.forEach(a => {
      const deadlineTime = new Date(a.deadline).getTime();
      if (deadlineTime < minDeadlineTime) {
        minDeadlineTime = deadlineTime;
        closestAssignment = a;
      }
    });

    const deadlineEl = document.getElementById("stat-upcoming-deadline");
    const deadlineSubEl = document.getElementById("stat-upcoming-deadline-sub");
    if (deadlineEl && deadlineSubEl) {
      if (closestAssignment) {
        const friendlyDate = new Date(closestAssignment.deadline).toLocaleDateString("en-US", { month: "short", day: "numeric" });
        deadlineEl.textContent = friendlyDate;
        deadlineSubEl.textContent = closestAssignment.title;
        
        // Highlight in red if overdue
        const nowTime = new Date().getTime();
        if (minDeadlineTime < nowTime) {
          deadlineEl.style.color = "var(--color-error)";
        } else {
          deadlineEl.style.color = "";
        }
      } else {
        deadlineEl.textContent = "None";
        deadlineEl.style.color = "";
        deadlineSubEl.textContent = "No pending tasks";
      }
    }

    // 2. Fetch Emails
    const emailRes = await fetch("/api/gmail/emails");
    const emails = await emailRes.json();
    
    const emailListEl = document.getElementById("dashboard-email-list");
    emailListEl.innerHTML = "";
    
    if (emails.length === 0) {
      emailListEl.innerHTML = `<div class="empty-placeholder">No synced academic emails found.</div>`;
      const unreadEl = document.getElementById("stat-unread-count");
      if (unreadEl) unreadEl.textContent = "0";
    } else {
      const unprocessed = emails.filter(e => e.parsedStatus === "UNPROCESSED");
      const unreadEl = document.getElementById("stat-unread-count");
      if (unreadEl) unreadEl.textContent = unprocessed.length;

      emails.forEach(email => {
        const item = document.createElement("div");
        item.className = `email-item ${email.parsedStatus !== "UNPROCESSED" ? "read" : ""}`;
        item.innerHTML = `
          <div class="email-left">
            <i data-lucide="${email.parsedStatus !== "UNPROCESSED" ? "mail-open" : "mail"}" class="email-icon"></i>
            <div class="email-details">
              <span class="email-sender">${email.sender}</span>
              <span class="email-subject">${email.subject}</span>
            </div>
          </div>
          <span class="email-time">${email.date.substring(0, 16)}</span>
        `;
        emailListEl.appendChild(item);
      });
      lucide.createIcons();
    }

    // 3. Fetch Study Hours
    const scheduleRes = await fetch("/api/planner/schedule");
    const schedData = await scheduleRes.json();
    if (schedData.found) {
      // Calculate today's study hours
      const todayName = new Date().toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
      const todayBlocks = schedData.schedule.scheduleData[todayName] || [];
      const totalHours = todayBlocks.reduce((sum, b) => sum + b.hours, 0);
      document.getElementById("stat-study-hours").textContent = `${totalHours}h`;
    } else {
      document.getElementById("stat-study-hours").textContent = "0h";
    }

    // 4. Fetch RAG Files count
    try {
      const ragRes = await fetch("/api/rag/files");
      const ragData = await ragRes.json();
      const notesEl = document.getElementById("stat-notes-count");
      if (notesEl) {
        notesEl.textContent = ragData.count || 0;
      }
    } catch (ragErr) {
      console.error("Failed to load notes count:", ragErr);
      const notesEl = document.getElementById("stat-notes-count");
      if (notesEl) notesEl.textContent = "0";
    }

    logAgentOutput("Dashboard metrics synchronized successfully.");

  } catch (error) {
    console.error("Dashboard load failed:", error);
    logAgentAction("Error: Failed to fetch dashboard data.");
  }
}

// Mail Sync Trigger
document.getElementById("btn-sync-gmail").addEventListener("click", async () => {
  logAgentAction("Gmail Sync Triggered. Requesting <code>/api/gmail/sync</code>...");
  showToast("Syncing Inbox", "Fetching and parsing academic emails...");
  
  try {
    const res = await fetch("/api/gmail/sync", { method: "POST" });
    const data = await res.json();
    
    if (data.success) {
      logAgentOutput(`Sync complete. Processed ${data.emailsSynced} emails, created ${data.assignmentsCreated} assignments.`);
      showToast("Sync Complete", `Logged ${data.assignmentsCreated} new assignments!`);
      loadDashboardData();
    } else {
      logAgentAction(`Gmail Sync failed: ${data.error}`);
    }
  } catch (err) {
    console.error(err);
    logAgentAction(`Gmail Sync failed: ${err.message}`);
  }
});

function logAgentAction(msg) {
  const consoleLogs = document.getElementById("console-logs");
  const el = document.createElement("div");
  el.className = "log-entry agent-action";
  el.innerHTML = `[Agent] ${msg}`;
  consoleLogs.appendChild(el);
  consoleLogs.scrollTop = consoleLogs.scrollHeight;
}

function logAgentOutput(msg) {
  const consoleLogs = document.getElementById("console-logs");
  const el = document.createElement("div");
  el.className = "log-entry agent-output";
  el.innerHTML = `[Output] ${msg}`;
  consoleLogs.appendChild(el);
  consoleLogs.scrollTop = consoleLogs.scrollHeight;
}

// ==========================================
// 4. Tab 2: Assignments Kanban Board
// ==========================================
async function loadAssignmentsData() {
  try {
    const res = await fetch("/api/gmail/assignments");
    const assignments = await res.json();

    const todoEl = document.getElementById("kanban-todo");
    const progressEl = document.getElementById("kanban-progress");
    const completedEl = document.getElementById("kanban-completed");

    todoEl.innerHTML = "";
    progressEl.innerHTML = "";
    completedEl.innerHTML = "";

    if (assignments.length === 0) {
      todoEl.innerHTML = `<div class="empty-placeholder">No assignments found.</div>`;
      return;
    }

    assignments.forEach(task => {
      const card = document.createElement("div");
      
      const titleLower = (task.title || "").toLowerCase();
      const subjectLower = (task.subject || "").toLowerCase();
      
      let subjectClass = "card-general";
      if (subjectLower.includes("chemistry") || subjectLower.includes("chemsitry") || titleLower.includes("chemistry") || titleLower.includes("chemsitry")) {
        subjectClass = "card-chemistry";
      } else if (subjectLower.includes("physics") || titleLower.includes("physics")) {
        subjectClass = "card-physics";
      } else if (subjectLower.includes("math") || subjectLower.includes("algebra") || titleLower.includes("math") || titleLower.includes("algebra") || titleLower.includes("calculus")) {
        subjectClass = "card-math";
      }
      
      card.className = `kanban-card ${subjectClass}`;
      
      const badgeClass = `sub-tag-${subjectLower}`;
      const friendlyDate = new Date(task.deadline).toLocaleDateString("en-US", { month: "short", day: "numeric" });

      let actionButtons = "";
      if (task.status === "todo") {
        actionButtons = `<button class="btn-card-action" onclick="updateAssignmentStatus('${task._id}', 'progress')">Start Work</button>`;
      } else if (task.status === "progress") {
        actionButtons = `<button class="btn-card-action" onclick="updateAssignmentStatus('${task._id}', 'completed')">Mark Completed</button>`;
      }

      card.innerHTML = `
        <h4>${task.title}</h4>
        <div class="kanban-meta">
          <span class="subject-badge ${badgeClass}">${task.subject}</span>
          <span class="kanban-date"><i data-lucide="calendar"></i> ${friendlyDate}</span>
        </div>
        ${actionButtons ? `<div class="kanban-actions">${actionButtons}</div>` : ""}
      `;

      if (task.status === "todo") todoEl.appendChild(card);
      else if (task.status === "progress") progressEl.appendChild(card);
      else if (task.status === "completed") completedEl.appendChild(card);
    });

    lucide.createIcons();

  } catch (error) {
    console.error("Failed to load assignments:", error);
  }
}

// Global action handles for assignment state updates
window.updateAssignmentStatus = async function(id, status) {
  try {
    const res = await fetch(`/api/gmail/assignments/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    });
    
    if (res.ok) {
      showToast("Task Updated", `Assignment status set to ${status}.`);
      loadAssignmentsData();
    }
  } catch (err) {
    console.error(err);
  }
};

// ==========================================
// 5. Tab 3: Calendar Month View
// ==========================================
let calendarCurrentDate = new Date();
let isCalendarNavBound = false;

async function loadCalendarData() {
  const monthGrid = document.getElementById("calendar-month-grid");
  const monthYearLabel = document.getElementById("calendar-month-year");
  if (!monthGrid || !monthYearLabel) return;

  try {
    const res = await fetch("/api/calendar/events");
    const events = await res.json();

    renderMonthlyCalendar(events);
    bindCalendarNavButtons(events);

  } catch (error) {
    console.error("Failed to load calendar events:", error);
  }
}

function bindCalendarNavButtons(events) {
  if (isCalendarNavBound) return;
  isCalendarNavBound = true;

  const btnPrev = document.getElementById("btn-prev-month");
  const btnNext = document.getElementById("btn-next-month");

  if (btnPrev && btnNext) {
    btnPrev.addEventListener("click", () => {
      calendarCurrentDate.setMonth(calendarCurrentDate.getMonth() - 1);
      renderMonthlyCalendar(events);
    });
    btnNext.addEventListener("click", () => {
      calendarCurrentDate.setMonth(calendarCurrentDate.getMonth() + 1);
      renderMonthlyCalendar(events);
    });
  }
}

function renderMonthlyCalendar(events) {
  const monthGrid = document.getElementById("calendar-month-grid");
  const monthYearLabel = document.getElementById("calendar-month-year");
  
  monthGrid.innerHTML = "";
  
  const year = calendarCurrentDate.getFullYear();
  const month = calendarCurrentDate.getMonth();
  
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  monthYearLabel.textContent = `${monthNames[month]} ${year}`;
  
  const firstDay = new Date(year, month, 1);
  let firstDayOfWeek = firstDay.getDay();
  firstDayOfWeek = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1;
  
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevDaysInMonth = new Date(year, month, 0).getDate();
  
  const today = new Date();
  const cells = [];
  
  // offset days from previous month
  for (let i = firstDayOfWeek - 1; i >= 0; i--) {
    cells.push({
      dayNum: prevDaysInMonth - i,
      date: new Date(year, month - 1, prevDaysInMonth - i),
      isCurrentMonth: false
    });
  }
  
  // days of current month
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({
      dayNum: d,
      date: new Date(year, month, d),
      isCurrentMonth: true
    });
  }
  
  // padding days from next month
  const totalCells = cells.length;
  const gridRows = totalCells <= 35 ? 35 : 42;
  const nextMonthPadding = gridRows - totalCells;
  for (let d = 1; d <= nextMonthPadding; d++) {
    cells.push({
      dayNum: d,
      date: new Date(year, month + 1, d),
      isCurrentMonth: false
    });
  }
  
  cells.forEach(cell => {
    const cellEl = document.createElement("div");
    cellEl.className = "calendar-day-cell";
    if (!cell.isCurrentMonth) {
      cellEl.classList.add("other-month");
    }
    
    const isToday = cell.date.toDateString() === today.toDateString();
    if (isToday) {
      cellEl.classList.add("is-today");
    }
    
    const headerEl = document.createElement("div");
    headerEl.className = "calendar-day-num";
    headerEl.textContent = cell.dayNum;
    cellEl.appendChild(headerEl);
    
    const eventsContainer = document.createElement("div");
    eventsContainer.className = "calendar-day-events";
    
    const cellDateStr = cell.date.toDateString();
    const matchedEvents = events.filter(e => {
      const evDate = new Date(e.start);
      return evDate.toDateString() === cellDateStr;
    });
    
    matchedEvents.forEach(e => {
      const eventEl = document.createElement("div");
      
      const summaryLower = e.summary.toLowerCase();
      let eventTypeClass = "mini-event-meeting";
      if (summaryLower.includes("due") || summaryLower.includes("🚨")) {
        eventTypeClass = "mini-event-assignment";
      } else if (summaryLower.includes("study")) {
        eventTypeClass = "mini-event-study";
      }
      
      eventEl.className = `calendar-mini-event ${eventTypeClass}`;
      eventEl.title = `${e.summary} (${new Date(e.start).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })})`;
      eventEl.textContent = e.summary.replace("🚨 Due: ", "").replace("Study: ", "");
      eventsContainer.appendChild(eventEl);
    });
    
    cellEl.appendChild(eventsContainer);
    monthGrid.appendChild(cellEl);
  });
}

// ==========================================
// 6. Tab 4: Study Planner
// ==========================================
async function loadPlannerData() {
  const display = document.getElementById("planner-schedule-display");
  
  try {
    const res = await fetch("/api/planner/schedule");
    const data = await res.json();

    if (!data.found) {
      display.innerHTML = `<div class="empty-placeholder">No active plan found. Fill out the parameters to generate one.</div>`;
      return;
    }

    renderTimetable(data.schedule.scheduleData);

  } catch (error) {
    console.error("Failed to load schedule:", error);
  }
}

function renderTimetable(scheduleData) {
  const display = document.getElementById("planner-schedule-display");
  display.innerHTML = "";

  const table = document.createElement("table");
  table.className = "planner-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>Day</th>
        <th>Structured Study Sessions</th>
      </tr>
    </thead>
    <tbody id="planner-table-body"></tbody>
  `;

  display.appendChild(table);
  const tbody = document.getElementById("planner-table-body");

  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

  days.forEach(day => {
    const blocks = scheduleData[day] || [];
    const tr = document.createElement("tr");

    let blocksHTML = "";
    if (blocks.length === 0) {
      blocksHTML = `<span style="color: var(--text-dark);">Rest Day</span>`;
    } else {
      blocksHTML = `<div class="study-chip-list">` +
        blocks.map(b => `<span class="study-chip">${b.hours}h ${b.subject}</span>`).join("") +
        `</div>`;
    }

    tr.innerHTML = `
      <td style="font-weight: 700; text-transform: capitalize;">${day}</td>
      <td>${blocksHTML}</td>
    `;
    tbody.appendChild(tr);
  });
}

// Study Plan Form submission
document.getElementById("btn-generate-plan").addEventListener("click", async () => {
  const subjectsInput = document.getElementById("planner-subjects").value;
  const hoursInput = document.getElementById("planner-hours").value;

  const subjects = subjectsInput.split(",").map(s => s.trim()).filter(s => s.length > 0);
  if (subjects.length === 0) {
    showToast("Invalid Input", "Please enter at least one subject.");
    return;
  }

  showToast("Planning Schedule", "Gemini is balancing your daily modules...");
  
  try {
    const res = await fetch("/api/planner/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subjects, hoursPerDay: hoursInput })
    });
    
    const data = await res.json();
    if (data.success) {
      showToast("Plan Created", "Your new weekly schedule has been compiled!");
      renderTimetable(data.schedule.scheduleData);
    }
  } catch (error) {
    console.error(error);
  }
});

// ==========================================
// 7. Tab 5: Tutor RAG Chat & Drive Sync
// ==========================================
async function loadNotesData() {
  const sourcesList = document.getElementById("rag-sources-list");
  if (!sourcesList) return;
  sourcesList.innerHTML = `<span style="font-size: 0.72rem; color: var(--text-dark);">Loading synced notes...</span>`;
  try {
    const res = await fetch("/api/rag/files");
    const data = await res.json();
    sourcesList.innerHTML = "";
    if (!data.files || data.files.length === 0) {
      sourcesList.innerHTML = `<div class="empty-placeholder">No active PDF study guides are registered in ChromaDB. Click "Sync Notes" above to read them from Classroom_Backup.</div>`;
    } else {
      data.files.forEach(file => {
        const item = document.createElement("div");
        item.className = "doc-source-item";
        item.innerHTML = `
          <i data-lucide="file-text"></i>
          <span>${file} (Indexed)</span>
        `;
        sourcesList.appendChild(item);
      });
      lucide.createIcons();
    }
  } catch (err) {
    console.error("Failed to load notes list:", err);
    sourcesList.innerHTML = `<div class="empty-placeholder">Error connecting to RAG service.</div>`;
  }
}

// Sync Drive files into ChromaDB
document.getElementById("btn-sync-drive").addEventListener("click", async () => {
  logAgentAction("RAG Sync Triggered. Requesting <code>/api/rag/sync-drive</code>...");
  showToast("Indexing Notes", "Syncing PDFs from Classroom_Backup into ChromaDB...");
  
  try {
    const res = await fetch("/api/rag/sync-drive", { method: "POST" });
    const data = await res.json();
    
    if (data.success) {
      await loadNotesData();
      
      // Update dashboard Notes Synced count
      const notesEl = document.getElementById("stat-notes-count");
      if (notesEl) {
        try {
          const ragRes = await fetch("/api/rag/files");
          const ragData = await ragRes.json();
          notesEl.textContent = ragData.count || 0;
        } catch (err) {
          notesEl.textContent = data.ingested ? data.ingested.filter(f=>f.status==="Success").length : 0;
        }
      }

      // Log details to Agent Console
      const successCount = data.ingested ? data.ingested.filter(f => f.status === "Success").length : 0;
      const failedCount = data.ingested ? data.ingested.filter(f => f.status === "Failed").length : 0;
      logAgentOutput(`Sync complete. Processed ${data.filesProcessed} files: ${successCount} successful, ${failedCount} failed.`);
      if (failedCount > 0) {
        data.ingested.forEach(f => {
          if (f.status === "Failed") {
            logAgentAction(`⚠️ Ingestion failed for ${f.name}: ${f.error || 'Check server logs'}`);
          }
        });
      }

      showToast("Indexing Complete", `Synced and vectorized notes!`);
    } else {
      logAgentAction(`RAG Sync failed: ${data.error}`);
      showToast("Sync Failed", data.error);
    }
  } catch (error) {
    console.error(error);
    logAgentAction(`Connection error. FastAPI RAG service is offline.`);
    showToast("Connection Error", "FastAPI RAG service is offline.");
  }
});

// Send Chat Message to RAG Question Answering Service
const ragInput = document.getElementById("rag-chat-input");
const btnSendRag = document.getElementById("btn-send-rag");
const chatBody = document.getElementById("rag-chat-body");

async function handleRagSubmit() {
  const queryText = ragInput.value.trim();
  if (!queryText) return;

  // Append user bubble
  appendChatBubble(queryText, "user-message");
  ragInput.value = "";

  // Append typing bubble
  const typingEl = appendChatBubble("Consulting Vector DB & Gemini...", "bot-message");

  try {
    const res = await fetch("/api/rag/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: queryText })
    });

    const data = await res.json();
    typingEl.remove();

    if (res.ok) {
      appendChatBubble(data.answer, "bot-message", data.sources);
    } else {
      appendChatBubble(`Error querying microservice: ${data.error}`, "bot-message");
    }

  } catch (error) {
    console.error(error);
    typingEl.remove();
    appendChatBubble("Error: RAG FastAPI service is currently offline. Start it on port 8000.", "bot-message");
  }
}

function appendChatBubble(text, className, sources = []) {
  const bubble = document.createElement("div");
  bubble.className = `chat-bubble ${className}`;
  
  let sourcesHTML = "";
  if (sources && sources.length > 0) {
    sourcesHTML = `<div class="chat-sources">
      <i data-lucide="info"></i>
      <span>Sources: ${sources.join(", ")}</span>
    </div>`;
  }

  // Format paragraphs/lists slightly
  const formattedText = text.replace(/\n/g, "<br>");
  bubble.innerHTML = `${formattedText}${sourcesHTML}`;
  
  chatBody.appendChild(bubble);
  lucide.createIcons();
  chatBody.scrollTop = chatBody.scrollHeight;
  return bubble;
}

ragInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleRagSubmit();
});
btnSendRag.addEventListener("click", handleRagSubmit);

// ==========================================
// 8. General Toast Notifications
// ==========================================
function showToast(title, desc) {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `
    <div class="toast-content">
      <span class="toast-title">${title}</span>
      <span class="toast-desc">${desc}</span>
    </div>
  `;
  
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = "slide-in-right 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) reverse forwards";
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ==========================================
// 9. Command Bar (Ctrl + K)
// ==========================================
const commandBar = document.getElementById("command-bar");
const commandBarInput = document.getElementById("command-bar-input");
const commandBarResults = document.getElementById("command-bar-results");

let selectedIndex = 0;

const defaultCommands = [
  { icon: "layout-dashboard", name: "Go to Dashboard", shortcut: "G D", action: () => switchTab("dashboard") },
  { icon: "check-square", name: "Go to Assignments", shortcut: "G A", action: () => switchTab("assignments") },
  { icon: "calendar", name: "Go to Calendar", shortcut: "G C", action: () => switchTab("calendar") },
  { icon: "calendar-days", name: "Go to Study Planner", shortcut: "G P", action: () => switchTab("planner") },
  { icon: "message-square", name: "Go to AI Tutor", shortcut: "G T", action: () => switchTab("notes") },
  { icon: "mail", name: "Sync Gmail Mail", shortcut: "S M", action: () => document.getElementById("btn-sync-gmail").click() },
  { icon: "hard-drive", name: "Sync Google Drive Notes", shortcut: "S N", action: () => document.getElementById("btn-sync-drive").click() },
  { icon: "log-out", name: "Logout", shortcut: "L O", action: () => document.getElementById("btn-logout").click() }
];

function switchTab(tabName) {
  const item = document.querySelector(`.nav-item[data-tab="${tabName}"]`);
  if (item) {
    item.click();
  }
}

function closeCommandBar() {
  commandBar.classList.remove("active");
  commandBarInput.value = "";
}

function openCommandBar() {
  commandBar.classList.add("active");
  commandBarInput.focus();
  renderCommandResults();
}

// Toggle Command Bar
window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    if (commandBar.classList.contains("active")) {
      closeCommandBar();
    } else {
      openCommandBar();
    }
  } else if (e.key === "Escape" && commandBar.classList.contains("active")) {
    closeCommandBar();
  }
});

// Close when clicking outside modal
commandBar.addEventListener("click", (e) => {
  if (e.target === commandBar) {
    closeCommandBar();
  }
});

// Render results
function renderCommandResults() {
  const query = commandBarInput.value.trim().toLowerCase();
  commandBarResults.innerHTML = "";
  
  let filtered = defaultCommands.filter(c => c.name.toLowerCase().includes(query));
  
  if (filtered.length === 0) {
    commandBarResults.innerHTML = `<div class="empty-placeholder" style="font-size: 0.8rem; padding: 16px;">No commands found matching "${query}"</div>`;
    return;
  }
  
  if (selectedIndex >= filtered.length) {
    selectedIndex = filtered.length - 1;
  }
  if (selectedIndex < 0) {
    selectedIndex = 0;
  }
  
  filtered.forEach((cmd, idx) => {
    const item = document.createElement("div");
    item.className = `command-item ${idx === selectedIndex ? "active-item" : ""}`;
    item.innerHTML = `
      <i data-lucide="${cmd.icon}"></i>
      <span>${cmd.name}</span>
      <span class="command-item-kbd">${cmd.shortcut}</span>
    `;
    item.addEventListener("click", () => {
      cmd.action();
      closeCommandBar();
    });
    commandBarResults.appendChild(item);
  });
  
  lucide.createIcons();
}

// Input listeners for command bar
commandBarInput.addEventListener("input", () => {
  selectedIndex = 0;
  renderCommandResults();
});

commandBarInput.addEventListener("keydown", (e) => {
  const items = commandBarResults.querySelectorAll(".command-item");
  if (items.length === 0) return;
  
  if (e.key === "ArrowDown") {
    e.preventDefault();
    selectedIndex = (selectedIndex + 1) % items.length;
    renderCommandResults();
    scrollIntoViewIfNeeded(items[selectedIndex]);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    selectedIndex = (selectedIndex - 1 + items.length) % items.length;
    renderCommandResults();
    scrollIntoViewIfNeeded(items[selectedIndex]);
  } else if (e.key === "Enter") {
    e.preventDefault();
    const query = commandBarInput.value.trim().toLowerCase();
    const filtered = defaultCommands.filter(c => c.name.toLowerCase().includes(query));
    if (filtered[selectedIndex]) {
      filtered[selectedIndex].action();
      closeCommandBar();
    }
  }
});

// ==========================================
// 10. System Settings & Preferences Persistence
// ==========================================
function initSettings() {
  const defaults = {
    "setting-ai-model": "gemini-2.5-flash",
    "setting-ai-temp": "0.3",
    "setting-planner-hours": "4",
    "setting-planner-mode": "balanced",
    "setting-drive-folder": "Classroom_Backup",
    "setting-ui-toasts": true,
    "setting-ui-logs": true,
    "setting-show-instructions": false
  };

  for (const [id, defaultVal] of Object.entries(defaults)) {
    const element = document.getElementById(id);
    if (!element) continue;

    const storedVal = localStorage.getItem(id);
    if (storedVal !== null) {
      if (element.type === "checkbox") {
        element.checked = storedVal === "true";
      } else {
        element.value = storedVal;
      }
    } else {
      if (element.type === "checkbox") {
        element.checked = defaultVal;
      } else {
        element.value = defaultVal.toString();
      }
      localStorage.setItem(id, defaultVal.toString());
    }

    element.addEventListener("change", () => {
      let newVal = element.type === "checkbox" ? element.checked.toString() : element.value;
      localStorage.setItem(id, newVal);
      handleSettingChange(id, element.type === "checkbox" ? element.checked : element.value);
    });

    handleSettingChange(id, element.type === "checkbox" ? element.checked : element.value);
  }

  // Sync Study Planner hours field with setting input
  const plannerHoursInput = document.getElementById("planner-hours");
  const settingPlannerHours = document.getElementById("setting-planner-hours");
  if (plannerHoursInput && settingPlannerHours) {
    plannerHoursInput.value = settingPlannerHours.value;

    plannerHoursInput.addEventListener("change", () => {
      settingPlannerHours.value = plannerHoursInput.value;
      localStorage.setItem("setting-planner-hours", plannerHoursInput.value);
    });
  }
}

function handleSettingChange(id, value) {
  if (id === "setting-show-instructions") {
    const section = document.getElementById("settings-instructions-section");
    if (section) {
      section.style.display = value ? "block" : "none";
    }
  } else if (id === "setting-planner-hours") {
    const plannerHoursInput = document.getElementById("planner-hours");
    if (plannerHoursInput) {
      plannerHoursInput.value = value;
    }
  }
}

function scrollIntoViewIfNeeded(element) {
  if (element) {
    element.scrollIntoView({ block: "nearest" });
  }
}

// Initial Boot run
window.addEventListener("load", checkAuthStatus);
