"use strict";

// IMPORTANT:
// Set this to your Cloudflare Worker URL to avoid browser CORS issues.
// Example: "https://your-worker-name.your-subdomain.workers.dev"
const GAS_WEBAPP_URL =
  "https://your-worker-name.your-subdomain.workers.dev";

// Default to local mode to avoid CORS issues in static hosting.
let USE_REMOTE_API = false;

async function apiGet(action, params = {}) {
  const url = new URL(GAS_WEBAPP_URL);
  url.searchParams.set("action", action);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const res = await fetch(url.toString(), { method: "GET" });
  return await res.json();
}

async function apiPost(action, payload) {
  const res = await fetch(GAS_WEBAPP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, payload })
  });
  return await res.json();
}

const state = {
  currentUser: null,
  users: [],
  questions: [],
  responses: [],
  results: [],
  lastComputedScores: {},
  activeBrainCategory: null,
  charts: {}
};

const FREQUENCY_CHOICES = [
  { label: "Always", value: 4 },
  { label: "Sometimes", value: 3 },
  { label: "Maybe", value: 2 },
  { label: "Never", value: 1 }
];

const SCORE_MAX = 4;

const SOFT_SKILL_CATEGORIES = [
  "Problem Solving",
  "Story Telling",
  "Collaboration",
  "Curiosity",
  "Communication",
  "Creativity"
];

const HARD_SKILL_CATEGORIES = [
  "Subject Matter Expertise",
  "Math & Statistics",
  "Data & Technical Skills"
];

const BRAIN_LOBES = {
  hard: [
    { category: "Subject Matter Expertise", label: "Subject Matter Expertise", icon: "🎓" },
    { category: "Math & Statistics", label: "Math & Statistics", icon: "🔢" },
    { category: "Data & Technical Skills", label: "Data & Technical Skills", icon: "📊" }
  ],
  soft: [
    { category: "Problem Solving", label: "Problem Solving", icon: "💡" },
    { category: "Story Telling", label: "Story Telling", icon: "✒" },
    { category: "Collaboration", label: "Collaboration", icon: "👥" },
    { category: "Curiosity", label: "Curiosity", icon: "❓" },
    { category: "Communication", label: "Communication", icon: "💬" },
    { category: "Creativity", label: "Creativity", icon: "🎨" }
  ]
};

const SOFT_SKILL_TEMPLATES = [
  { category: "Problem Solving", question: "When I face a complex problem, I break it into smaller steps and try different approaches until it is solved." },
  { category: "Story Telling", question: "I explain my ideas using clear examples and a logical flow that others can follow." },
  { category: "Collaboration", question: "I actively seek input from teammates or colleagues when working on shared goals." },
  { category: "Curiosity", question: "I regularly explore new tools, methods, or ideas to improve how I work." },
  { category: "Communication", question: "I listen carefully and respond thoughtfully in professional conversations." },
  { category: "Creativity", question: "I propose original solutions when standard approaches are not enough." }
];

const HARD_SKILL_BY_COURSE = {
  BSIT: [
    { category: "Subject Matter Expertise", question: "I apply programming and IT concepts from my degree to solve real workplace tasks." },
    { category: "Math & Statistics", question: "I use data, logic, and numerical reasoning to support technical decisions." },
    { category: "Data & Technical Skills", question: "I am comfortable using databases, systems, and technical tools required in my field." }
  ],
  "BSBA - Marketing": [
    { category: "Subject Matter Expertise", question: "I apply marketing and business concepts from my degree to real workplace challenges." },
    { category: "Math & Statistics", question: "I interpret metrics and market data to guide business decisions." },
    { category: "Data & Technical Skills", question: "I use digital tools and platforms to manage campaigns and analyze performance." }
  ],
  BSED: [
    { category: "Subject Matter Expertise", question: "I apply subject-area teaching knowledge from my degree in classroom or training settings." },
    { category: "Math & Statistics", question: "I use assessment data and evidence to evaluate learner progress." },
    { category: "Data & Technical Skills", question: "I use educational technology and digital resources effectively in my practice." }
  ],
  BEED: [
    { category: "Subject Matter Expertise", question: "I apply elementary education principles from my degree in teaching or training roles." },
    { category: "Math & Statistics", question: "I track and interpret learner outcomes using classroom data." },
    { category: "Data & Technical Skills", question: "I integrate age-appropriate technology and learning tools into my work." }
  ],
  BECED: [
    { category: "Subject Matter Expertise", question: "I apply early childhood education principles from my degree in professional settings." },
    { category: "Math & Statistics", question: "I use observation records and developmental data to guide instruction." },
    { category: "Data & Technical Skills", question: "I use child-centered tools and digital resources to support learning." }
  ]
};

function buildQuestionBank() {
  const courses = Object.keys(HARD_SKILL_BY_COURSE);
  const questions = [];
  let counter = 1;
  courses.forEach((course) => {
    SOFT_SKILL_TEMPLATES.forEach((item) => {
      questions.push({
        id: "Q" + counter++,
        course,
        category: item.category,
        skillType: "soft",
        question: item.question,
        type: "frequency"
      });
    });
    (HARD_SKILL_BY_COURSE[course] || []).forEach((item) => {
      questions.push({
        id: "Q" + counter++,
        course,
        category: item.category,
        skillType: "hard",
        question: item.question,
        type: "frequency"
      });
    });
  });
  return questions;
}

function performanceLevel(score) {
  return Number(score) >= 3.5 ? "High Proficiency" : "Emerging Proficiency";
}

const DEMO_DB = {
  users: [
    { user_id: "A001", name: "Liam Ortega", email: "liam@nbsc.edu", password: "alumni123", course: "BSIT", major: "Software", batch: 2023, role: "Alumni" },
    { user_id: "A002", name: "Ava Medina", email: "ava@nbsc.edu", password: "alumni123", course: "BSBA - Marketing", major: "Marketing", batch: 2022, role: "Alumni" },
    { user_id: "A003", name: "Noah Villanueva", email: "noah@nbsc.edu", password: "alumni123", course: "BSED", major: "English", batch: 2021, role: "Alumni" },
    { user_id: "A004", name: "Mia Navarro", email: "mia@nbsc.edu", password: "alumni123", course: "BEED", major: "General Education", batch: 2020, role: "Alumni" },
    { user_id: "A005", name: "Ethan Cruz", email: "ethan@nbsc.edu", password: "alumni123", course: "BECED", major: "Early Childhood", batch: 2023, role: "Alumni" },
    { user_id: "ADM1", name: "System Administrator", email: "admin@alskill.local", password: "admin123", course: "-", major: "-", batch: 0, role: "Admin" }
  ],
  questions: buildQuestionBank(),
  responses: [],
  results: [
    { id: "RES01", user_id: "A001", category: "Problem Solving", score: 3.75, date: "2026-05-01T09:00:00.000Z" },
    { id: "RES02", user_id: "A001", category: "Communication", score: 3.5, date: "2026-05-01T09:00:00.000Z" },
    { id: "RES03", user_id: "A001", category: "Data & Technical Skills", score: 3.67, date: "2026-05-01T09:00:00.000Z" },
    { id: "RES04", user_id: "A002", category: "Collaboration", score: 3.25, date: "2026-05-01T09:00:00.000Z" },
    { id: "RES05", user_id: "A002", category: "Subject Matter Expertise", score: 3.5, date: "2026-05-01T09:00:00.000Z" },
    { id: "RES06", user_id: "A003", category: "Story Telling", score: 3.5, date: "2026-05-01T09:00:00.000Z" },
    { id: "RES07", user_id: "A003", category: "Curiosity", score: 3.0, date: "2026-05-01T09:00:00.000Z" },
    { id: "RES08", user_id: "A004", category: "Creativity", score: 3.25, date: "2026-05-01T09:00:00.000Z" },
    { id: "RES09", user_id: "A005", category: "Communication", score: 3.5, date: "2026-05-01T09:00:00.000Z" },
    { id: "RES10", user_id: "A005", category: "Math & Statistics", score: 3.0, date: "2026-05-01T09:00:00.000Z" }
  ]
};

function init() {
  state.users = [...DEMO_DB.users];
  state.questions = [...DEMO_DB.questions];
  state.responses = [...DEMO_DB.responses];
  state.results = [...DEMO_DB.results];
  warmupRemote();
  bindNavigation();
  bindAuthForms();
  bindAlumniActions();
  bindAdminActions();
  bindShellInteractions();
  renderAdminDashboard();
  renderAlumniKpis();
  renderBrainDashboard();
  updateSessionUI();
  setAuthMode("login");
  showSection("authSection");
}

async function warmupRemote() {
  if (!USE_REMOTE_API) return;
  try {
    await apiGet("initializeDatabase");
    await hydrateQuestions();
    await refreshAdminAnalytics();
  } catch {
    USE_REMOTE_API = false;
  }
}

async function hydrateQuestions() {
  if (!USE_REMOTE_API) return;
  const courses = ["BSIT", "BSBA - Marketing", "BSED", "BEED", "BECED"];
  const all = [];
  for (const course of courses) {
    const res = await apiGet("fetchQuestions", { course });
    if (res && res.success && Array.isArray(res.questions)) all.push(...res.questions);
  }
  const uniq = new Map(all.map((q) => [q.id, q]));
  state.questions = [...uniq.values()];
}

function bindNavigation() {
  const navButtons = document.querySelectorAll(".nav-btn");
  navButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!canAccessSection(btn.dataset.section)) {
        showSection("authSection");
        setActiveNav(null);
        return;
      }
      document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      showSection(btn.dataset.section);
    });
  });
}

function showSection(sectionId) {
  if (!canAccessSection(sectionId)) {
    sectionId = "authSection";
  }
  document.querySelectorAll(".panel").forEach((panel) => panel.classList.remove("active"));
  document.getElementById(sectionId).classList.add("active");
}

function bindShellInteractions() {
  const toggleBtn = document.getElementById("sidebarToggleBtn");
  const sidebar = document.getElementById("sidebar");
  if (toggleBtn && sidebar) {
    toggleBtn.addEventListener("click", () => {
      if (window.innerWidth <= 980) sidebar.classList.toggle("open");
      else sidebar.classList.toggle("collapsed");
    });
  }
  document.querySelectorAll(".ripple").forEach((button) => {
    button.addEventListener("click", (event) => {
      const ripple = document.createElement("span");
      ripple.className = "ripple-dot";
      ripple.style.left = `${event.offsetX}px`;
      ripple.style.top = `${event.offsetY}px`;
      button.appendChild(ripple);
      setTimeout(() => ripple.remove(), 500);
    });
  });
}

async function refreshAdminAnalytics() {
  if (!USE_REMOTE_API) return;
  const analytics = await apiGet("getAdminAnalytics");
  if (analytics && analytics.success) {
    renderAdminKpis(analytics);
    renderRankingTable(analytics.performanceIndex || []);
    renderCourseList(analytics.courseScores || {});
    renderCategoryList(analytics.categoryDistribution || {});
    drawAdminCharts({
      courseScores: analytics.courseScores || {},
      categoryDistribution: analytics.categoryDistribution || {}
    });
    const wrap = document.getElementById("rankingTableWrap");
    if (wrap) wrap.classList.remove("skeleton");
  }
}

function bindAuthForms() {
  const registerForm = document.getElementById("registerForm");
  const loginForm = document.getElementById("loginForm");
  const topLogoutBtn = document.getElementById("topLogoutBtn");
  const loginStatus = document.getElementById("loginStatus");
  const registerStatus = document.getElementById("registerStatus");
  const showLoginBtn = document.getElementById("showLoginBtn");
  const showRegisterBtn = document.getElementById("showRegisterBtn");

  showLoginBtn.addEventListener("click", () => setAuthMode("login"));
  showRegisterBtn.addEventListener("click", () => setAuthMode("register"));

  registerForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = Object.fromEntries(new FormData(registerForm).entries());
    (async () => {
      try {
        if (USE_REMOTE_API) {
          const res = await apiPost("registerUser", {
            name: formData.name,
            email: String(formData.email).toLowerCase(),
            password: formData.password,
            course: formData.course,
            major: formData.major || "-",
            batch: Number(formData.batch)
          });
          if (!res || !res.success) {
            registerStatus.textContent = (res && res.message) || "Registration failed.";
            return;
          }
          registerStatus.textContent = "Registration successful. You may now log in.";
          loginStatus.textContent = "";
          registerForm.reset();
          setAuthMode("login");
          await refreshAdminAnalytics();
          return;
        }

        const newUser = {
          user_id: "A" + String(Date.now()).slice(-6),
          name: formData.name,
          email: formData.email.toLowerCase(),
          password: formData.password,
          course: formData.course,
          major: formData.major || "-",
          batch: Number(formData.batch),
          role: "Alumni"
        };
        if (state.users.some((user) => user.email === newUser.email)) {
          registerStatus.textContent = "Registration failed: email already exists.";
          return;
        }
        state.users.push(newUser);
        registerStatus.textContent = "Registration successful. You may now log in.";
        loginStatus.textContent = "";
        registerForm.reset();
        renderAdminDashboard();
        renderAlumniKpis();
        setAuthMode("login");
      } catch {
        registerStatus.textContent = "Registration failed. Please try again.";
      }
    })();
  });

  loginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = Object.fromEntries(new FormData(loginForm).entries());
    const credential = String(formData.email).toLowerCase().trim();
    (async () => {
      try {
        if (USE_REMOTE_API) {
          const res = await apiPost("loginUser", { credential, password: formData.password });
          if (!res || !res.success) {
            loginStatus.textContent = (res && res.message) || "Invalid credentials.";
            return;
          }
          state.currentUser = res.user;
          loginStatus.textContent = "";
          registerStatus.textContent = "";
          renderProfile();
          await hydrateQuestions();
          await refreshAdminAnalytics();
          renderAlumniKpis();
          updateSessionUI();
          routeToDashboard();
          return;
        }

        const matchedUser = state.users.find(
          (user) =>
            (user.email.toLowerCase() === credential || String(user.user_id).toLowerCase() === credential) &&
            user.password === formData.password
        );
        if (!matchedUser) {
          loginStatus.textContent = "Invalid credentials.";
          return;
        }
        state.currentUser = matchedUser;
        loginStatus.textContent = "";
        registerStatus.textContent = "";
        renderProfile();
        renderAdminDashboard();
        renderAlumniKpis();
        updateSessionUI();
        routeToDashboard();
      } catch {
        loginStatus.textContent = "Login failed. Please try again.";
      }
    })();
  });

  topLogoutBtn.addEventListener("click", () => {
    state.currentUser = null;
    loginStatus.textContent = "Logged out.";
    registerStatus.textContent = "";
    document.getElementById("profileCard").textContent = "Please log in as Alumni to view profile details.";
    updateSessionUI();
    setAuthMode("login");
    showSection("authSection");
    setActiveNav(null);
  });
}

function setAuthMode(mode) {
  const loginPanel = document.getElementById("loginPanel");
  const registerPanel = document.getElementById("registerPanel");
  const showLoginBtn = document.getElementById("showLoginBtn");
  const showRegisterBtn = document.getElementById("showRegisterBtn");
  if (mode === "register") {
    loginPanel.classList.add("hidden");
    registerPanel.classList.remove("hidden");
    showLoginBtn.classList.remove("primary");
    showLoginBtn.classList.add("ghost");
    showRegisterBtn.classList.remove("ghost");
    showRegisterBtn.classList.add("primary");
    return;
  }
  registerPanel.classList.add("hidden");
  loginPanel.classList.remove("hidden");
  showRegisterBtn.classList.remove("primary");
  showRegisterBtn.classList.add("ghost");
  showLoginBtn.classList.remove("ghost");
  showLoginBtn.classList.add("primary");
}

function canAccessSection(sectionId) {
  if (sectionId === "authSection") return true;
  if (!state.currentUser) return false;
  if (sectionId === "settingsSection") return true;
  if (sectionId === "infoSection") return true;
  if (sectionId === "alumniSection") return state.currentUser.role === "Alumni";
  if (sectionId === "adminSection") return state.currentUser.role === "Admin";
  return false;
}

function routeToDashboard() {
  if (!state.currentUser) {
    showSection("authSection");
    setActiveNav(null);
    return;
  }
  if (state.currentUser.role === "Admin") {
    showSection("adminSection");
    setActiveNav("adminSection");
    return;
  }
  showSection("alumniSection");
  setActiveNav("alumniSection");
  renderBrainDashboard();
  renderSoftSkillAnalysis(getUserScoreMap());
}

function setActiveNav(sectionId) {
  document.querySelectorAll(".nav-btn").forEach((button) => {
    button.classList.toggle("active", button.dataset.section === sectionId);
  });
}

function updateSessionUI() {
  const appShell = document.getElementById("appShell");
  const authSection = document.getElementById("authSection");
  const sessionLabel = document.getElementById("sessionLabel");
  const topLogoutBtn = document.getElementById("topLogoutBtn");
  if (!state.currentUser) {
    appShell.classList.add("hidden");
    authSection.classList.remove("hidden");
    topLogoutBtn.classList.add("hidden");
    sessionLabel.textContent = "Not logged in";
    return;
  }
  appShell.classList.remove("hidden");
  authSection.classList.add("hidden");
  topLogoutBtn.classList.remove("hidden");
  sessionLabel.textContent = `${state.currentUser.name} (${state.currentUser.role})`;
}

function renderProfile() {
  const profileCard = document.getElementById("profileCard");
  if (!state.currentUser) return;
  profileCard.innerHTML = `
    <p><strong>Name:</strong> ${state.currentUser.name}</p>
    <p><strong>Email:</strong> ${state.currentUser.email}</p>
    <p><strong>Course:</strong> ${state.currentUser.course}</p>
    <p><strong>Major:</strong> ${state.currentUser.major}</p>
    <p><strong>Batch:</strong> ${state.currentUser.batch}</p>
    <p><strong>Role:</strong> ${state.currentUser.role}</p>
  `;
}

function bindAlumniActions() {
  const loadQuestionsBtn = document.getElementById("loadQuestionsBtn");
  const submitResponsesBtn = document.getElementById("submitResponsesBtn");
  const clearBrainFilterBtn = document.getElementById("clearBrainFilterBtn");

  loadQuestionsBtn.addEventListener("click", () => {
    const course = document.getElementById("questionCourseSelect").value;
    renderQuestionnaire(course);
  });

  if (clearBrainFilterBtn) {
    clearBrainFilterBtn.addEventListener("click", () => {
      state.activeBrainCategory = null;
      const course = document.getElementById("questionCourseSelect").value;
      renderBrainDashboard();
      if (document.querySelector("#questionnaireForm .assessment-item")) {
        renderQuestionnaire(course);
      }
    });
  }

  submitResponsesBtn.addEventListener("click", () => {
    if (!state.currentUser || state.currentUser.role !== "Alumni") {
      alert("Please log in as an Alumni user before submitting responses.");
      return;
    }
    const form = document.getElementById("questionnaireForm");
    const fieldsets = [...form.querySelectorAll("fieldset[data-question-id]")];
    if (fieldsets.length === 0) {
      alert("Load questionnaire first.");
      return;
    }

    const unanswered = fieldsets.filter((fs) => !form.querySelector(`input[name="${fs.dataset.questionId}"]:checked`));
    if (unanswered.length > 0) {
      alert(`Please answer all items. ${unanswered.length} question(s) remaining.`);
      return;
    }

    const newResponses = fieldsets.map((fs) => {
      const selected = form.querySelector(`input[name="${fs.dataset.questionId}"]:checked`);
      return {
        id: "R" + Math.random().toString(36).slice(2, 9),
        user_id: state.currentUser.user_id,
        question_id: fs.dataset.questionId,
        answer: selected.dataset.answerLabel,
        score: Number(selected.value)
      };
    });
    (async () => {
      try {
        if (USE_REMOTE_API) {
          const res = await apiPost("submitResponses", {
            user_id: state.currentUser.user_id,
            responses: newResponses.map((r) => ({
              question_id: r.question_id,
              answer: r.answer,
              score: r.score
            }))
          });
          if (!res || !res.success) {
            alert((res && res.message) || "Submission failed.");
            return;
          }
          const scoreMap = (res.computed && res.computed.scores) ? res.computed.scores : {};
          state.lastComputedScores = scoreMap;
          renderScoreCards(scoreMap);
          renderBrainDashboard();
          renderSoftSkillAnalysis(scoreMap);
          drawAlumniCharts(scoreMap);
          await refreshAdminAnalytics();
          renderAlumniKpis();
          alert("Responses submitted. Competency scores have been computed.");
          return;
        }

        state.responses = state.responses.filter((r) => r.user_id !== state.currentUser.user_id).concat(newResponses);
        const computed = computeScoresForUser(state.currentUser.user_id);
        state.lastComputedScores = computed;
        renderScoreCards(computed);
        renderBrainDashboard();
        renderSoftSkillAnalysis(computed);
        drawAlumniCharts(computed);
        renderAdminDashboard();
        renderAlumniKpis();
        alert("Responses submitted. Competency scores have been computed.");
      } catch {
        alert("Submission failed. Please try again.");
      }
    })();
  });
}

function renderQuestionnaire(course) {
  const form = document.getElementById("questionnaireForm");
  const filterNote = document.getElementById("questionFilterNote");
  let questions = state.questions.filter((q) => q.course === course);
  if (state.activeBrainCategory) {
    questions = questions.filter((q) => q.category === state.activeBrainCategory);
  }
  if (questions.length === 0) {
    form.innerHTML = "<p class='muted'>No questionnaire available for this course yet.</p>";
    if (filterNote) filterNote.textContent = "";
    return;
  }
  if (filterNote) {
    filterNote.textContent = state.activeBrainCategory
      ? `Showing questions for: ${state.activeBrainCategory}`
      : "Showing all skill areas for this course.";
  }
  form.innerHTML = questions
    .map(
      (q) => `
      <fieldset class="assessment-item" data-question-id="${q.id}" data-skill-type="${q.skillType || "soft"}">
        <legend>
          <span class="skill-pill ${q.skillType === "hard" ? "hard" : "soft"}">${q.skillType === "hard" ? "Hard" : "Soft"}</span>
          ${q.question}
          <small>(${q.category})</small>
        </legend>
        <div class="freq-group" role="radiogroup" aria-label="${q.category}">
          ${FREQUENCY_CHOICES.map(
            (choice) => `
            <label class="freq-choice">
              <input type="radio" name="${q.id}" data-answer-label="${choice.label}" value="${choice.value}" />
              ${choice.label}
            </label>
          `
          ).join("")}
        </div>
      </fieldset>
    `
    )
    .join("");
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function getUserScoreMap() {
  if (Object.keys(state.lastComputedScores).length > 0) return state.lastComputedScores;
  if (!state.currentUser) return {};
  const userResults = state.results.filter((r) => r.user_id === state.currentUser.user_id);
  return Object.fromEntries(userResults.map((r) => [r.category, r.score]));
}

function renderBrainDashboard() {
  const container = document.getElementById("brainDashboard");
  if (!container) return;
  const scoreMap = getUserScoreMap();

  const lobeButton = (lobe, side) => {
    const score = scoreMap[lobe.category];
    const pct = score ? Math.round((Number(score) / SCORE_MAX) * 100) : 0;
    const active = state.activeBrainCategory === lobe.category ? " active" : "";
    const scored = score ? " scored" : "";
    return `
      <button type="button" class="brain-lobe ${side}${active}${scored}" data-category="${lobe.category}" title="${lobe.label}">
        <span class="lobe-icon" aria-hidden="true">${lobe.icon}</span>
        <span class="lobe-label">${lobe.label}</span>
        ${score ? `<span class="lobe-score">${score} / ${SCORE_MAX}</span>` : `<span class="lobe-score muted">—</span>`}
        <span class="lobe-fill" style="--fill:${pct}%"></span>
      </button>
    `;
  };

  container.innerHTML = `
    <div class="brain-headers">
      <span class="brain-side-title hard">Hard Skill</span>
      <span class="brain-side-title soft">Soft Skill</span>
    </div>
    <div class="brain-map" role="img" aria-label="Interactive skills brain map">
      <div class="brain-half hard-side">
        ${BRAIN_LOBES.hard.map((lobe) => lobeButton(lobe, "hard")).join("")}
      </div>
      <div class="brain-divider" aria-hidden="true"></div>
      <div class="brain-half soft-side">
        ${BRAIN_LOBES.soft.map((lobe) => lobeButton(lobe, "soft")).join("")}
      </div>
    </div>
    <p class="brain-hint muted">Click a lobe to focus the assessment on that skill area. Complete the questionnaire to light up your brain map.</p>
  `;

  container.querySelectorAll(".brain-lobe").forEach((btn) => {
    btn.addEventListener("click", () => {
      const category = btn.dataset.category;
      state.activeBrainCategory = state.activeBrainCategory === category ? null : category;
      renderBrainDashboard();
      const courseSelect = document.getElementById("questionCourseSelect");
      if (courseSelect && document.querySelector("#questionnaireForm .assessment-item")) {
        renderQuestionnaire(courseSelect.value);
      }
    });
  });
}

function renderSoftSkillAnalysis(scoreMap) {
  const container = document.getElementById("softSkillAnalysis");
  if (!container) return;
  const entries = SOFT_SKILL_CATEGORIES.map((category) => [category, scoreMap[category]]).filter(([, score]) => score !== undefined);
  if (entries.length === 0) {
    container.innerHTML = "<p class='muted'>Complete the soft-skill assessment items to see your analysis.</p>";
    return;
  }
  const softScores = entries.map(([, score]) => Number(score));
  const average = (softScores.reduce((sum, s) => sum + s, 0) / softScores.length).toFixed(2);
  const strongest = entries.reduce((best, row) => (row[1] > best[1] ? row : best), entries[0]);
  const growth = entries.reduce((low, row) => (row[1] < low[1] ? row : low), entries[0]);

  container.innerHTML = `
    <div class="soft-summary-grid">
      <article class="soft-summary-card">
        <p class="kpi-label">Soft Skill Index</p>
        <p class="kpi-value">${average} / ${SCORE_MAX}</p>
        <p class="muted">${performanceLevel(average)}</p>
      </article>
      <article class="soft-summary-card highlight">
        <p class="kpi-label">Strongest Area</p>
        <p class="kpi-value" style="font-size:1rem;">${strongest[0]}</p>
        <p class="muted">Score: ${strongest[1]}</p>
      </article>
      <article class="soft-summary-card">
        <p class="kpi-label">Growth Focus</p>
        <p class="kpi-value" style="font-size:1rem;">${growth[0]}</p>
        <p class="muted">Score: ${growth[1]}</p>
      </article>
    </div>
    <div class="soft-bars">
      ${entries
        .map(([category, score]) => {
          const pct = Math.round((Number(score) / SCORE_MAX) * 100);
          return `
            <div class="soft-bar-row">
              <span>${category}</span>
              <div class="soft-bar-track"><div class="soft-bar-fill" style="width:${pct}%"></div></div>
              <strong>${score}</strong>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function computeScoresForUser(userId) {
  const userResponses = state.responses.filter((r) => r.user_id === userId);
  const grouped = {};
  userResponses.forEach((response) => {
    const q = state.questions.find((question) => question.id === response.question_id);
    if (!q) return;
    if (!grouped[q.category]) grouped[q.category] = [];
    grouped[q.category].push(response.score);
  });
  const result = {};
  Object.keys(grouped).forEach((category) => {
    const avg = grouped[category].reduce((sum, score) => sum + score, 0) / grouped[category].length;
    result[category] = Number(avg.toFixed(2));
  });

  state.results = state.results.filter((row) => row.user_id !== userId);
  Object.keys(result).forEach((category) => {
    state.results.push({
      id: "RES" + Math.random().toString(36).slice(2, 9),
      user_id: userId,
      category,
      score: result[category],
      date: new Date().toISOString()
    });
  });
  return result;
}

function renderScoreCards(scoreMap) {
  const scoreCards = document.getElementById("scoreCards");
  const entries = Object.entries(scoreMap);
  if (entries.length === 0) {
    scoreCards.classList.add("muted");
    scoreCards.textContent = "No computed scores yet.";
    return;
  }
  scoreCards.classList.remove("muted");
  scoreCards.innerHTML = entries
    .map(([category, score]) => {
      const level = performanceLevel(score);
      return `
        <div class="score-card">
          <p><strong>${category}</strong></p>
          <p>Competency Score: ${score} / ${SCORE_MAX}</p>
          <p>Performance Level: ${level}</p>
        </div>
      `;
    })
    .join("");
}

function drawAlumniCharts(scoreMap) {
  const entries = Object.entries(scoreMap);
  const canvasBar = document.getElementById("alumniBarChart");
  const ctxBar = canvasBar.getContext("2d");
  clearCanvas(ctxBar, canvasBar);
  const palette = entries.map(([category]) =>
    SOFT_SKILL_CATEGORIES.includes(category) ? "#e76f51" : "#2a9d8f"
  );
  drawBars(ctxBar, canvasBar, entries, palette.length ? palette : ["#2a9d8f", "#e76f51"]);

  const canvasRadar = document.getElementById("alumniRadarChart");
  const ctxRadar = canvasRadar.getContext("2d");
  clearCanvas(ctxRadar, canvasRadar);
  drawRadar(ctxRadar, canvasRadar, entries);
}

function bindAdminActions() {
  document.getElementById("closeDrillBtn").addEventListener("click", closeModal);

  document.getElementById("courseChart").addEventListener("click", (event) => {
    const course = detectBarClick(event, "course");
    if (course) showCourseDrillDown(course);
  });
  document.getElementById("categoryChart").addEventListener("click", (event) => {
    const category = detectBarClick(event, "category");
    if (category) showCategoryDrillDown(category);
  });
}

function renderAdminDashboard() {
  if (USE_REMOTE_API) {
    refreshAdminAnalytics();
    return;
  }
  const analytics = getAdminAnalytics();
  renderAdminKpis(analytics);
  renderRankingTable(analytics.performanceIndex);
  renderCourseList(analytics.courseScores);
  renderCategoryList(analytics.categoryDistribution);
  drawAdminCharts(analytics);
  document.getElementById("rankingTableWrap").classList.remove("skeleton");
}

function renderAlumniKpis() {
  const container = document.getElementById("alumniKpi");
  if (!container) return;
  const totalQuestions = state.questions.length;
  const totalResponses = state.responses.length;
  const completedUsers = new Set(state.results.map((r) => r.user_id)).size;
  const avgScore =
    state.results.length > 0
      ? (state.results.reduce((sum, row) => sum + Number(row.score), 0) / state.results.length).toFixed(2)
      : "0.00";
  container.innerHTML = [
    { label: "Assessment Items", value: totalQuestions },
    { label: "Submitted Responses", value: totalResponses },
    { label: "Alumni with Scores", value: completedUsers },
    { label: "Overall Competency Avg", value: avgScore }
  ]
    .map((item) => `<article class="kpi-card"><p class="kpi-label">${item.label}</p><p class="kpi-value">${item.value}</p></article>`)
    .join("");
}

function renderAdminKpis(analytics) {
  const container = document.getElementById("adminKpi");
  if (!container) return;
  const coursesTracked = Object.keys(analytics.courseScores).length;
  const categoriesTracked = Object.keys(analytics.categoryDistribution).length;
  const rankedAlumni = analytics.performanceIndex.length;
  const topScore = rankedAlumni ? analytics.performanceIndex[0].competencyScore.toFixed(2) : "0.00";
  container.innerHTML = [
    { label: "Courses Tracked", value: coursesTracked },
    { label: "Skill Categories", value: categoriesTracked },
    { label: "Ranked Alumni", value: rankedAlumni },
    { label: "Top Competency Score", value: topScore }
  ]
    .map((item) => `<article class="kpi-card"><p class="kpi-label">${item.label}</p><p class="kpi-value">${item.value}</p></article>`)
    .join("");
}

function getAdminAnalytics() {
  const alumniUsers = state.users.filter((u) => u.role === "Alumni");
  const courseScores = {};
  const categoryDistribution = {};
  const performanceIndex = [];

  alumniUsers.forEach((user) => {
    const userResults = state.results.filter((r) => r.user_id === user.user_id);
    const avgScore = userResults.length
      ? userResults.reduce((sum, row) => sum + row.score, 0) / userResults.length
      : 0;
    performanceIndex.push({
      alumni: anonymize(user.name),
      course: user.course,
      competencyScore: Number(avgScore.toFixed(2)),
      performanceLevel: performanceLevel(avgScore)
    });

    if (!courseScores[user.course]) courseScores[user.course] = [];
    if (avgScore > 0) courseScores[user.course].push(avgScore);

    userResults.forEach((row) => {
      if (!categoryDistribution[row.category]) categoryDistribution[row.category] = [];
      categoryDistribution[row.category].push(row.score);
    });
  });

  const courseAverages = Object.fromEntries(
    Object.entries(courseScores).map(([course, values]) => [
      course,
      values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)) : 0
    ])
  );
  const categoryAverages = Object.fromEntries(
    Object.entries(categoryDistribution).map(([category, values]) => [
      category,
      values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)) : 0
    ])
  );

  performanceIndex.sort((a, b) => b.competencyScore - a.competencyScore);

  return {
    courseScores: courseAverages,
    categoryDistribution: categoryAverages,
    performanceIndex
  };
}

function renderRankingTable(rows) {
  const container = document.getElementById("rankingTableWrap");
  if (rows.length === 0) {
    container.innerHTML = "<p class='muted'>No performance records available.</p>";
    return;
  }
  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Rank</th>
          <th>Alumni</th>
          <th>Course</th>
          <th>Competency Score</th>
          <th>Performance Level</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row, index) => `
          <tr>
            <td>${index + 1}</td>
            <td>${row.alumni}</td>
            <td>${row.course}</td>
            <td>${row.competencyScore}</td>
            <td>${row.performanceLevel}</td>
          </tr>
        `
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderCourseList(courseScores) {
  const container = document.getElementById("courseList");
  const entries = Object.entries(courseScores);
  container.innerHTML = entries
    .map(([course, score]) => `<button class="chip" data-course="${course}">${course}: ${score}</button>`)
    .join("");
  container.querySelectorAll("[data-course]").forEach((button) => {
    button.addEventListener("click", () => showCourseDrillDown(button.dataset.course));
  });
}

function renderCategoryList(categoryScores) {
  const container = document.getElementById("categoryList");
  const entries = Object.entries(categoryScores);
  container.innerHTML = entries
    .map(([category, score]) => `<button class="chip" data-category="${category}">${category}: ${score}</button>`)
    .join("");
  container.querySelectorAll("[data-category]").forEach((button) => {
    button.addEventListener("click", () => showCategoryDrillDown(button.dataset.category));
  });
}

function drawAdminCharts(analytics) {
  const courseEntries = Object.entries(analytics.courseScores);
  const categoryEntries = Object.entries(analytics.categoryDistribution);
  state.charts.courseEntries = courseEntries;
  state.charts.categoryEntries = categoryEntries;

  const courseCanvas = document.getElementById("courseChart");
  const courseCtx = courseCanvas.getContext("2d");
  clearCanvas(courseCtx, courseCanvas);
  drawBars(courseCtx, courseCanvas, courseEntries, ["#1d4e89", "#2b6cb0", "#3b82c4", "#60a5fa", "#e3b341"]);

  const categoryCanvas = document.getElementById("categoryChart");
  const categoryCtx = categoryCanvas.getContext("2d");
  clearCanvas(categoryCtx, categoryCanvas);
  drawBars(categoryCtx, categoryCanvas, categoryEntries, ["#2b6cb0", "#1d4e89", "#e3b341"]);
}

function showCourseDrillDown(course) {
  const users = state.users.filter((user) => user.role === "Alumni" && user.course === course);
  const rows = users
    .map((user) => {
      const results = state.results.filter((r) => r.user_id === user.user_id);
      const byCategory = {};
      results.forEach((r) => {
        byCategory[r.category] = r.score;
      });
      const overall = results.length
        ? (results.reduce((sum, r) => sum + r.score, 0) / results.length).toFixed(2)
        : "0.00";
      return { user, byCategory, overall };
    })
    .sort((a, b) => b.overall - a.overall);

  const content =
    rows.length === 0
      ? "<p>No records available for this course.</p>"
      : `
      <p><strong>${course}</strong> performance records and category-level competency scores.</p>
      <table>
        <thead><tr><th>Alumni</th><th>Overall Score</th><th>Category Breakdown</th></tr></thead>
        <tbody>
          ${rows
            .map(
              (row) => `
            <tr>
              <td>${anonymize(row.user.name)}</td>
              <td>${row.overall}</td>
              <td>${Object.entries(row.byCategory)
                .map(([key, val]) => `${key}: ${val}`)
                .join(" | ") || "-"}</td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>
    `;
  openModal(`${course} Performance Overview`, content);
}

function showCategoryDrillDown(category) {
  const rows = state.users
    .filter((u) => u.role === "Alumni")
    .map((user) => {
      const result = state.results.find((r) => r.user_id === user.user_id && r.category === category);
      if (!result) return null;
      const level = performanceLevel(result.score) === "High Proficiency" ? "High Proficiency" : "Development Area";
      return {
        alumni: anonymize(user.name),
        course: user.course,
        score: result.score,
        level
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  const content =
    rows.length === 0
      ? "<p>No records available for this category.</p>"
      : `
      <p>Category analysis for <strong>${category}</strong>.</p>
      <table>
        <thead><tr><th>Alumni</th><th>Course</th><th>Competency Score</th><th>Skill Proficiency</th></tr></thead>
        <tbody>
          ${rows
            .map(
              (row) => `
            <tr>
              <td>${row.alumni}</td>
              <td>${row.course}</td>
              <td>${row.score}</td>
              <td><span class="pill ${row.level === "High Proficiency" ? "high" : "emerging"}">${row.level}</span></td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>
    `;
  openModal(`${category} Drill-Down`, content);
}

function openModal(title, html) {
  document.getElementById("drillTitle").textContent = title;
  document.getElementById("drillBody").innerHTML = html;
  const panel = document.getElementById("drillDownPanel");
  panel.classList.add("open");
  panel.setAttribute("aria-hidden", "false");
}

function closeModal() {
  const panel = document.getElementById("drillDownPanel");
  panel.classList.remove("open");
  panel.setAttribute("aria-hidden", "true");
}

function drawBars(ctx, canvas, entries, palette) {
  if (entries.length === 0) {
    ctx.fillStyle = "#6b7280";
    ctx.fillText("No data available", 20, 40);
    return;
  }
  const width = canvas.width;
  const height = canvas.height;
  const baseY = height - 30;
  const barAreaHeight = height - 60;
  const barWidth = Math.max(30, Math.floor((width - 40) / entries.length - 12));
  const gap = 10;

  state.charts.lastRects = [];
  entries.forEach(([label, value], index) => {
    const x = 20 + index * (barWidth + gap);
    const barHeight = (Number(value) / SCORE_MAX) * barAreaHeight;
    const y = baseY - barHeight;
    ctx.fillStyle = palette[index % palette.length];
    ctx.fillRect(x, y, barWidth, barHeight);
    ctx.fillStyle = "#111827";
    ctx.font = "11px Segoe UI";
    ctx.fillText(String(value), x + 4, y - 6);
    ctx.fillText(label.slice(0, 12), x, baseY + 14);
    state.charts.lastRects.push({ x, y, w: barWidth, h: barHeight, label });
  });
}

function drawRadar(ctx, canvas, entries) {
  if (entries.length === 0) return;
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const radius = Math.min(centerX, centerY) - 25;
  const sides = entries.length;

  for (let layer = 1; layer <= SCORE_MAX; layer += 1) {
    ctx.beginPath();
    for (let i = 0; i < sides; i += 1) {
      const angle = (Math.PI * 2 * i) / sides - Math.PI / 2;
      const x = centerX + ((radius * layer) / SCORE_MAX) * Math.cos(angle);
      const y = centerY + ((radius * layer) / SCORE_MAX) * Math.sin(angle);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = "#d1d5db";
    ctx.stroke();
  }

  ctx.beginPath();
  entries.forEach(([_, value], i) => {
    const angle = (Math.PI * 2 * i) / sides - Math.PI / 2;
    const x = centerX + ((radius * value) / SCORE_MAX) * Math.cos(angle);
    const y = centerY + ((radius * value) / SCORE_MAX) * Math.sin(angle);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fillStyle = "rgba(43, 108, 176, 0.22)";
  ctx.fill();
  ctx.strokeStyle = "#1d4e89";
  ctx.stroke();
}

function detectBarClick(event, chartType) {
  const rect = event.target.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const entries = chartType === "course" ? state.charts.courseEntries : state.charts.categoryEntries;
  if (!entries || entries.length === 0) return null;

  const width = event.target.width;
  const height = event.target.height;
  const baseY = height - 30;
  const barAreaHeight = height - 60;
  const barWidth = Math.max(30, Math.floor((width - 40) / entries.length - 12));
  const gap = 10;

  for (let index = 0; index < entries.length; index += 1) {
    const [label, value] = entries[index];
    const barHeight = (Number(value) / SCORE_MAX) * barAreaHeight;
    const barX = 20 + index * (barWidth + gap);
    const barY = baseY - barHeight;
    if (x >= barX && x <= barX + barWidth && y >= barY && y <= baseY) return label;
  }
  return null;
}

function clearCanvas(ctx, canvas) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function anonymize(name) {
  const parts = name.split(" ");
  return parts
    .map((part, index) => (index === 0 ? part : `${part.charAt(0)}.`))
    .join(" ");
}

window.addEventListener("DOMContentLoaded", init);
