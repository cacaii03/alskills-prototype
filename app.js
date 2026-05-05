"use strict";

const PAGE = document.body.dataset.page || "auth";
const ALSKILL_USER_KEY = "alskill_user";

/**
 * Google Apps Script Web App: Deploy → Web app → copy the …/exec URL here.
 * Leave placeholder text below to use the built-in demo data (no Sheets).
 */
const GAS_WEBAPP_URL =
  "https://script.google.com/macros/s/AKfycbwRCic38f94xfVlvKIowHXlbA7DEDxJFtyp8diQes6yZ3YBwcLpR22ux3cPknYT5lttsg/exec";

/**
 * Calls your GAS backend when GAS_WEBAPP_URL looks configured.
 * After a failed warmup, this is turned off so login still works against demo users.
 */
let USE_REMOTE_API = (function () {
  const u = String(GAS_WEBAPP_URL || "").trim();
  if (u.length < 16) return false;
  if (/YOUR_DEPLOYMENT_ID|your-worker-name|your-subdomain\.workers\.dev/i.test(u)) return false;
  return /^https:\/\//i.test(u);
})();

const FETCH_OPTS = { redirect: "follow" };

async function apiGet(action, params = {}) {
  const url = new URL(GAS_WEBAPP_URL);
  url.searchParams.set("action", action);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const res = await fetch(url.toString(), { method: "GET", ...FETCH_OPTS });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("GET response was not JSON. Check the web app URL and redeploy if needed.");
  }
}

/**
 * POST uses Content-Type text/plain so the browser does not send a CORS preflight
 * (Google Apps Script web apps do not handle OPTIONS). Body is still JSON for doPost.
 */
async function apiPost(action, payload) {
  const body = JSON.stringify({ action, payload });
  const res = await fetch(GAS_WEBAPP_URL, {
    method: "POST",
    ...FETCH_OPTS,
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("POST response was not JSON. Check the web app URL and deployment access.");
  }
}

const state = {
  currentUser: null,
  users: [],
  questions: [],
  responses: [],
  results: [],
  lastComputedScores: {},
  lastComputedOverall: null,
  currentTrackKey: null,
  lastRecommendation: null,
  charts: {}
};

/** Session flag plus stored responses/results imply one official 30-question attempt completed. */
const OFFICIAL_ATTEMPT_STORAGE_PREFIX = "alskill_official_attempt_v1_";
const LAST_ASSESSMENT_TRACK_PREFIX = "alskill_last_assessment_track_v1_";

function hasOfficialAttemptDone(uid) {
  if (!uid) return false;
  try {
    if (window.sessionStorage.getItem(OFFICIAL_ATTEMPT_STORAGE_PREFIX + uid)) return true;
  } catch (e) {
    /* ignore */
  }
  const responsesCount = state.responses.filter((r) => r.user_id === uid).length;
  if (responsesCount >= 30) return true;
  const categories = new Set(state.results.filter((r) => r.user_id === uid).map((r) => r.category));
  return categories.size >= 6;
}

function markOfficialAttemptDone(uid) {
  if (!uid) return;
  try {
    window.sessionStorage.setItem(OFFICIAL_ATTEMPT_STORAGE_PREFIX + uid, String(Date.now()));
  } catch (e) {
    /* ignore */
  }
}

function hydrateScoresFromStoredResults(uid) {
  const mine = state.results.filter((r) => r.user_id === uid);
  if (mine.length === 0) return;
  const grouped = {};
  mine.forEach((row) => {
    const k = row.category;
    if (!grouped[k]) grouped[k] = [];
    grouped[k].push(Number(row.score));
  });
  const scoreMap = {};
  Object.keys(grouped).forEach((cat) => {
    const arr = grouped[cat];
    scoreMap[cat] = Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2));
  });
  if (Object.keys(scoreMap).length === 0) return;
  state.lastComputedScores = scoreMap;
  const vals = Object.values(scoreMap);
  state.lastComputedOverall = Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2));
}

function getRankTier(overallNum) {
  if (overallNum == null || Number.isNaN(overallNum)) {
    return { key: "scout", label: "Scout", blurb: "Complete your official run to earn a rank.", cls: "game-rank--scout" };
  }
  const o = Number(overallNum);
  if (o < 2) return { key: "novice", label: "Novice", blurb: "Foundation skills — keep building.", cls: "game-rank--novice" };
  if (o < 2.5) return { key: "learner", label: "Learner", blurb: "Solid baseline across scenarios.", cls: "game-rank--learner" };
  if (o < 3) return { key: "specialist", label: "Specialist", blurb: "Consistent judgement under pressure.", cls: "game-rank--specialist" };
  if (o < 3.5) return { key: "adept", label: "Adept", blurb: "Strong readiness signals.", cls: "game-rank--adept" };
  if (o < 3.85) return { key: "expert", label: "Expert", blurb: "High proficiency benchmark.", cls: "game-rank--expert" };
  return { key: "master", label: "Masterclass", blurb: "Top-band performance across categories.", cls: "game-rank--master" };
}

function applyAssessmentLockUI() {
  if (PAGE !== "home" || !state.currentUser) return;
  const uid = state.currentUser.user_id;
  const locked = hasOfficialAttemptDone(uid);
  const sec = document.getElementById("skillTestSection");
  const banner = document.getElementById("assessmentLockBanner");

  if (sec) sec.classList.toggle("is-assessment-locked", locked);
  if (banner) banner.classList.toggle("hidden", !locked);

  const loadBtn = document.getElementById("loadQuestionsBtn");
  const submitBtn = document.getElementById("submitResponsesBtn");
  const continueBtn = document.getElementById("wizardContinueFromCourse");
  const prog = document.getElementById("assessmentProgramSelect");
  const maj = document.getElementById("assessmentMajorSelect");

  [loadBtn, submitBtn, continueBtn].forEach((el) => {
    if (el) el.disabled = !!locked;
  });
  [prog, maj].forEach((el) => {
    if (el) el.disabled = !!locked;
  });

  const skillLede = document.getElementById("skillSectionLede");
  if (skillLede) {
    skillLede.textContent = locked
      ? "Your official run is locked in. Review results below, or practice the same scenarios independently to sharpen judgement."
      : "Select your program, complete the questionnaire, then review scores. You have one official submission for your profile benchmark.";
  }

  const dashLede = document.getElementById("dashboardLede");
  if (dashLede) {
    dashLede.textContent = locked
      ? "Your rank and mastery track your official assessment. Retakes are disabled so cohort scores stay comparable."
      : "Your skill rank and mastery meter update after your one official attempt in Test your skill.";
  }

  const navSkillMeta = document.querySelector('.nav-btn[data-section="skillTestSection"] .nav-btn-meta');
  if (navSkillMeta) navSkillMeta.textContent = locked ? "Results saved" : "One official attempt";
}

function bindAssessmentLockActions() {
  const btn = document.getElementById("lockedViewResultsBtn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const uid = state.currentUser && state.currentUser.user_id;
    if (!uid) return;
    hydrateScoresFromStoredResults(uid);
    const scores = state.lastComputedScores;
    if (!scores || Object.keys(scores).length === 0) {
      showHomeToast("No scored results found yet.", "error");
      return;
    }
    let track = state.currentTrackKey;
    try {
      const stored = window.sessionStorage.getItem(LAST_ASSESSMENT_TRACK_PREFIX + uid);
      if (stored) track = stored;
    } catch (e) {
      /* ignore */
    }
    if (track) state.currentTrackKey = track;
    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
    const skillNav = document.querySelector('.nav-btn[data-section="skillTestSection"]');
    if (skillNav) skillNav.classList.add("active");
    showSection("skillTestSection");
    setHomeWizardStep(3);
    renderScoreCards(scores);
    drawAlumniCharts(scores);
    if (typeof alsRecommend === "function" && track) {
      applyRecommendationFromScores(scores, track);
    }
    closeMobileSidebar();
  });
}

function openSkillResultsIfLocked() {
  if (!state.currentUser || !hasOfficialAttemptDone(state.currentUser.user_id)) return;
  const uid = state.currentUser.user_id;
  hydrateScoresFromStoredResults(uid);
  if (!state.lastComputedScores || Object.keys(state.lastComputedScores).length === 0) return;
  try {
    const t = window.sessionStorage.getItem(LAST_ASSESSMENT_TRACK_PREFIX + uid);
    if (t) state.currentTrackKey = t;
  } catch (e) {
    /* ignore */
  }
  setHomeWizardStep(3);
  renderScoreCards(state.lastComputedScores);
  drawAlumniCharts(state.lastComputedScores);
  if (typeof alsRecommend === "function" && state.currentTrackKey) {
    applyRecommendationFromScores(state.lastComputedScores, state.currentTrackKey);
  }
}

const DEMO_DB = {
  users: [
    { user_id: "A001", name: "Liam Ortega", email: "liam@nbsc.edu", password: "alumni123", course: "BSCT", major: "-", batch: 2023, role: "Alumni" },
    { user_id: "A002", name: "Ava Medina", email: "ava@nbsc.edu", password: "alumni123", course: "BSBA", major: "MM", batch: 2022, role: "Alumni" },
    { user_id: "A003", name: "Noah Villanueva", email: "noah@nbsc.edu", password: "alumni123", course: "BSED", major: "EN", batch: 2021, role: "Alumni" },
    { user_id: "A004", name: "Mia Navarro", email: "mia@nbsc.edu", password: "alumni123", course: "BEED", major: "-", batch: 2020, role: "Alumni" },
    { user_id: "A005", name: "Ethan Cruz", email: "ethan@nbsc.edu", password: "alumni123", course: "BECED", major: "-", batch: 2023, role: "Alumni" },
    { user_id: "ADM1", name: "System Administrator", email: "admin@alskill.local", password: "admin123", course: "-", major: "-", batch: 0, role: "Admin" }
  ],
  questions: [],
  responses: [],
  results: [
    { id: "RES01", user_id: "A001", category: "Technical Skills", score: 4.6, date: "2026-05-01T09:00:00.000Z" },
    { id: "RES02", user_id: "A001", category: "Professional Skills", score: 4.2, date: "2026-05-01T09:00:00.000Z" },
    { id: "RES03", user_id: "A002", category: "Technical Skills", score: 3.8, date: "2026-05-01T09:00:00.000Z" },
    { id: "RES04", user_id: "A002", category: "Professional Skills", score: 4.4, date: "2026-05-01T09:00:00.000Z" },
    { id: "RES05", user_id: "A003", category: "Soft Skills", score: 4.3, date: "2026-05-01T09:00:00.000Z" },
    { id: "RES06", user_id: "A003", category: "Professional Skills", score: 4.1, date: "2026-05-01T09:00:00.000Z" },
    { id: "RES07", user_id: "A004", category: "Soft Skills", score: 3.7, date: "2026-05-01T09:00:00.000Z" },
    { id: "RES08", user_id: "A004", category: "Professional Skills", score: 3.9, date: "2026-05-01T09:00:00.000Z" },
    { id: "RES09", user_id: "A005", category: "Soft Skills", score: 4.0, date: "2026-05-01T09:00:00.000Z" },
    { id: "RES10", user_id: "A005", category: "Professional Skills", score: 3.8, date: "2026-05-01T09:00:00.000Z" }
  ]
};

function normalizeRole(role) {
  const s = String(role == null ? "" : role)
    .trim()
    .toLowerCase();
  if (
    s === "admin" ||
    s === "administrator" ||
    s === "sysadmin" ||
    s === "system administrator" ||
    s === "system admin" ||
    s === "super admin" ||
    s === "superadmin"
  ) {
    return "Admin";
  }
  return "Alumni";
}

function applyUserFromAuth(user) {
  if (!user) return null;
  return Object.assign({}, user, { role: normalizeRole(user.role) });
}

const USER_HASH_PREFIX = "#alskill=";

/**
 * file:// pages are different opaque origins, so sessionStorage does not carry
 * between index.html and home.html. For file: we pass a one-time user payload in the hash.
 */
function userToHashFragment(user) {
  const json = JSON.stringify(user);
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return USER_HASH_PREFIX + encodeURIComponent(b64);
}

function tryConsumeUserFromHash() {
  const h = window.location.hash || "";
  if (!h.startsWith(USER_HASH_PREFIX)) return null;
  try {
    const b64 = decodeURIComponent(h.slice(USER_HASH_PREFIX.length));
    const json = decodeURIComponent(escape(atob(b64)));
    const user = applyUserFromAuth(JSON.parse(json));
    sessionStorage.setItem(ALSKILL_USER_KEY, JSON.stringify(user));
    history.replaceState(null, "", window.location.href.split("#")[0]);
    return user;
  } catch {
    return null;
  }
}

function loadUserFromSession() {
  const fromHash = tryConsumeUserFromHash();
  if (fromHash) return fromHash;
  try {
    const raw = sessionStorage.getItem(ALSKILL_USER_KEY);
    if (!raw) return null;
    return applyUserFromAuth(JSON.parse(raw));
  } catch {
    return null;
  }
}

function saveUserToSession(user) {
  sessionStorage.setItem(ALSKILL_USER_KEY, JSON.stringify(user));
}

function redirectAfterLogin() {
  const user = state.currentUser;
  if (!user) return;
  const page = normalizeRole(user.role) === "Admin" ? "admin-dashboard.html" : "home.html";
  const targetUrl = new URL(page, window.location.href).href.split("#")[0];
  if (window.location.protocol === "file:") {
    window.location.href = targetUrl + userToHashFragment(user);
    return;
  }
  saveUserToSession(user);
  window.location.href = page;
}

function bindLogout() {
  const btn = document.getElementById("topLogoutBtn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    sessionStorage.removeItem(ALSKILL_USER_KEY);
    state.currentUser = null;
    window.location.href = "index.html";
  });
}

function initAuthPage() {
  state.users = [...DEMO_DB.users];
  state.questions = [...DEMO_DB.questions];
  state.responses = [...DEMO_DB.responses];
  state.results = [...DEMO_DB.results];
  warmupRemote();
  bindAuthForms();
  bindRegisterMajorField();
  bindShellInteractions();
  setAuthMode("login");
}

async function initHomePage() {
  state.currentUser = loadUserFromSession();
  if (!state.currentUser || normalizeRole(state.currentUser.role) !== "Alumni") {
    window.location.href = "index.html";
    return;
  }
  state.users = [...DEMO_DB.users];
  state.questions = [...DEMO_DB.questions];
  state.responses = [...DEMO_DB.responses];
  state.results = [...DEMO_DB.results];
  warmupRemote();
  bindNavigation();
  bindAlumniActions();
  bindHomeWizard();
  bindAdminActions();
  bindShellInteractions();
  bindLogout();
  populateAssessmentPrograms();
  hydrateScoresFromStoredResults(state.currentUser.user_id);
  renderProfile();
  renderAlumniKpis();
  syncAssessmentSelectorsFromProfile();
  bindAssessmentLockActions();
  applyAssessmentLockUI();
  showSection("alumniSection");
  setActiveNav("alumniSection");
  bindSkillSectionChrome();
  updateSessionUI();
}

async function initAdminPage() {
  state.currentUser = loadUserFromSession();
  if (!state.currentUser || normalizeRole(state.currentUser.role) !== "Admin") {
    window.location.href = "index.html";
    return;
  }
  state.users = [...DEMO_DB.users];
  state.questions = [...DEMO_DB.questions];
  state.responses = [...DEMO_DB.responses];
  state.results = [...DEMO_DB.results];
  warmupRemote();
  bindAdminActions();
  bindShellInteractions();
  bindLogout();
  if (USE_REMOTE_API) await refreshAdminAnalytics();
  else renderAdminDashboard();
  updateSessionUI();
}

function bootstrap() {
  if (PAGE === "home") {
    initHomePage();
    return;
  }
  if (PAGE === "admin") {
    initAdminPage();
    return;
  }
  initAuthPage();
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

/**
 * Optional sync of legacy Questions sheet rows (does not overwrite client catalog questions).
 */
async function hydrateQuestions() {
  if (!USE_REMOTE_API) return;
  const courses = ["BSCT", "BSBA", "BSED", "BEED", "BECED"];
  const all = [];
  for (const course of courses) {
    const res = await apiGet("fetchQuestions", { course });
    if (res && res.success && Array.isArray(res.questions)) all.push(...res.questions);
  }
  state.sheetQuestionsFallback = all;
}

function bindNavigation() {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!canAccessSection(btn.dataset.section)) {
        window.location.href = "index.html";
        return;
      }
      document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      showSection(btn.dataset.section);
      if (PAGE === "home" && btn.dataset.section === "skillTestSection") {
        if (state.currentUser && hasOfficialAttemptDone(state.currentUser.user_id)) {
          openSkillResultsIfLocked();
        } else {
          setHomeWizardStep(1);
        }
      }
      closeMobileSidebar();
    });
  });
}

function closeMobileSidebar() {
  const sidebar = document.getElementById("sidebar");
  const backdrop = document.getElementById("sidebarBackdrop");
  if (sidebar) sidebar.classList.remove("open");
  if (backdrop) backdrop.classList.remove("is-visible");
}

function bindSkillSectionChrome() {
  if (PAGE !== "home") return;
  document.querySelectorAll(".nav-go-dashboard, .wizard-jump-dashboard").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
      const dash = document.querySelector('.nav-btn[data-section="alumniSection"]');
      if (dash) dash.classList.add("active");
      showSection("alumniSection");
      closeMobileSidebar();
    });
  });
}

function showSection(sectionId) {
  if (!canAccessSection(sectionId)) {
    if (PAGE === "home") sectionId = "alumniSection";
    else if (PAGE === "admin") sectionId = "adminSection";
    else sectionId = "authSection";
  }
  document.querySelectorAll("#appShell .panel").forEach((panel) => {
    panel.classList.remove("active");
  });
  const authSection = document.getElementById("authSection");
  const target = document.getElementById(sectionId);
  if (sectionId === "authSection") {
    if (authSection) authSection.classList.add("active");
    return;
  }
  if (target) target.classList.add("active");
  if (authSection) authSection.classList.remove("active");
}

function bindShellInteractions() {
  const toggleBtn = document.getElementById("sidebarToggleBtn");
  const sidebar = document.getElementById("sidebar");
  const appShell = document.getElementById("appShell");
  const backdrop = document.getElementById("sidebarBackdrop");

  if (toggleBtn && sidebar && appShell) {
    toggleBtn.addEventListener("click", () => {
      if (window.innerWidth <= 980) {
        sidebar.classList.toggle("open");
        const open = sidebar.classList.contains("open");
        if (backdrop) backdrop.classList.toggle("is-visible", open);
        toggleBtn.setAttribute("aria-expanded", open ? "true" : "false");
      } else {
        appShell.classList.toggle("sidebar-collapsed");
        const collapsed = appShell.classList.contains("sidebar-collapsed");
        sidebar.classList.toggle("collapsed", collapsed);
        toggleBtn.setAttribute("aria-expanded", collapsed ? "false" : "true");
        toggleBtn.title = collapsed ? "Expand sidebar" : "Collapse sidebar";
      }
    });
  }

  if (backdrop && sidebar) {
    backdrop.addEventListener("click", () => {
      sidebar.classList.remove("open");
      backdrop.classList.remove("is-visible");
      if (toggleBtn) toggleBtn.setAttribute("aria-expanded", "false");
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

  window.addEventListener("resize", () => {
    if (window.innerWidth > 980) {
      closeMobileSidebar();
    }
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

function syncRegisterMajorField() {
  const courseSel = document.getElementById("registerCourseSelect");
  const majorSel = document.getElementById("registerMajorSelect");
  const hint = document.getElementById("registerMajorHelp");
  if (!majorSel) return;

  const course = courseSel ? courseSel.value : "";

  majorSel.innerHTML = "";

  if (course === "BSBA") {
    [
      ["", "Select major"],
      ["MM", "Marketing Management"],
      ["OM", "Operational Management"],
      ["FM", "Financial Management"]
    ].forEach(([value, label]) => {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      majorSel.appendChild(opt);
    });
    majorSel.required = true;
    if (hint) hint.textContent = "Required: choose your BSBA emphasis track.";
  } else if (course === "BSED") {
    [
      ["", "Select major"],
      ["EN", "English"],
      ["MA", "Math"]
    ].forEach(([value, label]) => {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      majorSel.appendChild(opt);
    });
    majorSel.required = true;
    if (hint) hint.textContent = "Required: choose your secondary education specialization.";
  } else if (course) {
    const opt = document.createElement("option");
    opt.value = "-";
    opt.textContent = "Not applicable";
    majorSel.appendChild(opt);
    majorSel.required = false;
    majorSel.value = "-";
    if (hint) hint.textContent = "This program does not use a major selection.";
  } else {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Select a program first";
    majorSel.appendChild(opt);
    majorSel.required = false;
    if (hint) hint.textContent = "";
  }
}

function bindRegisterMajorField() {
  const courseSel = document.getElementById("registerCourseSelect");
  if (!courseSel) return;
  courseSel.addEventListener("change", syncRegisterMajorField);
}

function bindAuthForms() {
  const registerForm = document.getElementById("registerForm");
  const loginForm = document.getElementById("loginForm");
  if (!registerForm || !loginForm) return;
  const loginStatus = document.getElementById("loginStatus");
  const registerStatus = document.getElementById("registerStatus");
  const showLoginBtn = document.getElementById("showLoginBtn");
  const showRegisterBtn = document.getElementById("showRegisterBtn");
  if (!loginStatus || !registerStatus || !showLoginBtn || !showRegisterBtn) return;

  showLoginBtn.addEventListener("click", () => setAuthMode("login"));
  showRegisterBtn.addEventListener("click", () => setAuthMode("register"));

  registerForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = Object.fromEntries(new FormData(registerForm).entries());
    const email = String(formData.email || "")
      .trim()
      .toLowerCase();
    const batchNum = Number(formData.batch);
    if (!formData.name || !email || !formData.password || !formData.course) {
      registerStatus.textContent = "Please fill all required fields.";
      return;
    }
    if (!Number.isFinite(batchNum) || batchNum < 1990) {
      registerStatus.textContent = "Please enter a valid batch year.";
      return;
    }

    const courseVal = String(formData.course || "").trim();
    const majorRaw = String(formData.major != null ? formData.major : "").trim();

    if (courseVal === "BSBA") {
      if (!majorRaw || !["MM", "OM", "FM"].includes(majorRaw)) {
        registerStatus.textContent = "Please select your major for Bachelor of Science in Business Administration.";
        return;
      }
    } else if (courseVal === "BSED") {
      if (!majorRaw || !["EN", "MA"].includes(majorRaw)) {
        registerStatus.textContent = "Please select your major for Bachelor of Science in Secondary Education.";
        return;
      }
    }

    const majorOut =
      courseVal === "BSBA" || courseVal === "BSED" ? majorRaw : majorRaw === "" ? "-" : majorRaw;

    (async () => {
      try {
        if (USE_REMOTE_API) {
          const res = await apiPost("registerUser", {
            name: String(formData.name).trim(),
            email,
            password: formData.password,
            course: formData.course,
            major: majorOut,
            batch: batchNum
          });
          if (!res || !res.success) {
            registerStatus.textContent = (res && res.message) || "Registration failed.";
            return;
          }
          registerStatus.textContent = "Registration successful. You may now log in.";
          loginStatus.textContent = "";
          registerForm.reset();
          syncRegisterMajorField();
          setAuthMode("login");
          if (document.getElementById("adminKpi")) await refreshAdminAnalytics();
          return;
        }

        const newUser = {
          user_id: "A" + String(Date.now()).slice(-6),
          name: String(formData.name).trim(),
          email,
          password: formData.password,
          course: formData.course,
          major: majorOut,
          batch: batchNum,
          role: "Alumni"
        };
        if (state.users.some((user) => String(user.email).toLowerCase() === email)) {
          registerStatus.textContent = "Registration failed: email already exists.";
          return;
        }
        state.users.push(newUser);
        registerStatus.textContent = "Registration successful. You may now log in.";
        loginStatus.textContent = "";
        registerForm.reset();
        syncRegisterMajorField();
        if (document.getElementById("adminKpi")) renderAdminDashboard();
        if (document.getElementById("alumniKpi")) renderAlumniKpis();
        setAuthMode("login");
      } catch (err) {
        registerStatus.textContent =
          err && err.message ? String(err.message) : "Registration failed. Check API URL or network.";
      }
    })();
  });

  loginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = Object.fromEntries(new FormData(loginForm).entries());
    const credential = String(formData.email || "")
      .trim()
      .toLowerCase();
    const password = formData.password != null ? String(formData.password) : "";
    if (!credential || !password) {
      loginStatus.textContent = "Enter email or ID and password.";
      return;
    }
    (async () => {
      try {
        if (USE_REMOTE_API) {
          const res = await apiPost("loginUser", { credential, password });
          if (!res || !res.success) {
            loginStatus.textContent = (res && res.message) || "Invalid credentials.";
            return;
          }
          if (!res.user) {
            loginStatus.textContent = "Invalid server response (missing user).";
            return;
          }
          state.currentUser = applyUserFromAuth(res.user);
          loginStatus.textContent = "";
          registerStatus.textContent = "";
          redirectAfterLogin();
          return;
        }

        const matchedUser = state.users.find(
          (user) =>
            (String(user.email).toLowerCase() === credential ||
              String(user.user_id).toLowerCase() === credential) &&
            String(user.password) === password
        );
        if (!matchedUser) {
          loginStatus.textContent = "Invalid credentials.";
          return;
        }
        state.currentUser = applyUserFromAuth({ ...matchedUser });
        loginStatus.textContent = "";
        registerStatus.textContent = "";
        redirectAfterLogin();
      } catch (err) {
        loginStatus.textContent =
          err && err.message ? String(err.message) : "Login failed. Check API URL or network.";
      }
    })();
  });
}

function setAuthMode(mode) {
  const loginPanel = document.getElementById("loginPanel");
  const registerPanel = document.getElementById("registerPanel");
  const showLoginBtn = document.getElementById("showLoginBtn");
  const showRegisterBtn = document.getElementById("showRegisterBtn");
  if (!loginPanel || !registerPanel || !showLoginBtn || !showRegisterBtn) return;
  if (mode === "register") {
    loginPanel.classList.add("hidden");
    registerPanel.classList.remove("hidden");
    showLoginBtn.classList.remove("primary");
    showLoginBtn.classList.add("ghost");
    showRegisterBtn.classList.remove("ghost");
    showRegisterBtn.classList.add("primary");
    syncRegisterMajorField();
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
  if (sectionId === "authSection") return !!document.getElementById("authSection");
  if (!state.currentUser) return false;
  const role = normalizeRole(state.currentUser.role);
  if (sectionId === "settingsSection") return true;
  if (sectionId === "infoSection") return true;
  if (sectionId === "alumniSection") return role === "Alumni" && !!document.getElementById("alumniSection");
  if (sectionId === "skillTestSection") return role === "Alumni" && !!document.getElementById("skillTestSection");
  if (sectionId === "adminSection") return role === "Admin" && !!document.getElementById("adminSection");
  return false;
}

function setActiveNav(sectionId) {
  document.querySelectorAll(".nav-btn").forEach((button) => {
    button.classList.toggle("active", button.dataset.section === sectionId);
  });
}

function showHomeToast(message, variant = "info") {
  const el = document.getElementById("homeToast");
  if (!el) {
    window.alert(message);
    return;
  }
  el.textContent = message;
  el.classList.remove("home-toast--error", "home-toast--success");
  if (variant === "error") el.classList.add("home-toast--error");
  else if (variant === "success") el.classList.add("home-toast--success");
  el.classList.add("is-visible");
  clearTimeout(showHomeToast._t);
  showHomeToast._t = setTimeout(() => el.classList.remove("is-visible"), 5200);
}

function setHomeWizardStep(step) {
  if (PAGE !== "home") return;
  const root = document.getElementById("skillTestSection");
  if (!root) return;
  const max = 3;
  const n = Math.min(Math.max(Number(step) || 1, 1), max);
  root.querySelectorAll(".wizard-panel").forEach((panel) => {
    const ps = Number(panel.dataset.step);
    const active = ps === n;
    panel.classList.toggle("wizard-panel--active", active);
    panel.hidden = !active;
  });
  root.querySelectorAll(".stepper-step").forEach((item) => {
    const s = Number(item.dataset.wizardStep);
    item.classList.toggle("is-active", s === n);
    item.classList.toggle("is-done", s < n);
  });
}

function bindHomeWizard() {
  if (PAGE !== "home") return;
  document.querySelectorAll(".wizard-next").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.dataset.next;
      if (next) setHomeWizardStep(next);
    });
  });
  document.querySelectorAll(".wizard-back").forEach((btn) => {
    btn.addEventListener("click", () => {
      const prev = btn.dataset.prev;
      if (prev) setHomeWizardStep(prev);
    });
  });
  document.querySelectorAll(".wizard-jump").forEach((btn) => {
    btn.addEventListener("click", () => {
      const jump = btn.dataset.jump;
      if (jump) setHomeWizardStep(jump);
    });
  });
  const continueCourse = document.getElementById("wizardContinueFromCourse");
  if (continueCourse) {
    continueCourse.addEventListener("click", () => {
      if (continueCourse.disabled) return;
      setHomeWizardStep(2);
    });
  }
}

function escapeHtml(text) {
  const d = document.createElement("div");
  d.textContent = text == null ? "" : String(text);
  return d.innerHTML;
}

function normalizeLegacyCourseId(courseRaw) {
  const s = String(courseRaw || "").trim();
  const map = {
    BSIT: "BSCT",
    "BSBA - Marketing": "BSBA",
    "BS Computer Technology": "BSCT",
    "Bachelor of Science in Computer Technology": "BSCT"
  };
  return map[s] || s;
}

function populateAssessmentPrograms() {
  const sel = document.getElementById("assessmentProgramSelect");
  if (!sel || typeof ALSKILL_COURSE_CATALOG === "undefined") return;
  sel.innerHTML = ALSKILL_COURSE_CATALOG.map(
    (c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`
  ).join("");
  bindAssessmentCascade();
}

function bindAssessmentCascade() {
  const prog = document.getElementById("assessmentProgramSelect");
  const majorWrap = document.getElementById("majorSelectWrap");
  const majorSel = document.getElementById("assessmentMajorSelect");
  if (!prog || !majorWrap || !majorSel || typeof ALSKILL_COURSE_CATALOG === "undefined") return;

  const refreshMajors = () => {
    const entry = ALSKILL_COURSE_CATALOG.find((c) => c.id === prog.value);
    majorSel.innerHTML = "";
    if (!entry || !entry.majors || entry.majors.length === 0) {
      majorWrap.classList.add("hidden");
      majorSel.removeAttribute("required");
      return;
    }
    majorWrap.classList.remove("hidden");
    majorSel.required = true;
    entry.majors.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.name;
      majorSel.appendChild(opt);
    });
  };

  prog.addEventListener("change", refreshMajors);
  refreshMajors();
}

function getAssessmentTrackKey() {
  const prog = document.getElementById("assessmentProgramSelect");
  const majorWrap = document.getElementById("majorSelectWrap");
  const majorSel = document.getElementById("assessmentMajorSelect");
  if (!prog) return "";
  const pid = prog.value;
  if (!majorWrap || majorWrap.classList.contains("hidden") || !majorSel) return pid;
  const mid = majorSel.value;
  return mid ? `${pid}:${mid}` : pid;
}

function syncAssessmentSelectorsFromProfile() {
  const prog = document.getElementById("assessmentProgramSelect");
  const major = document.getElementById("assessmentMajorSelect");
  const wrap = document.getElementById("majorSelectWrap");
  if (!prog || !state.currentUser) return;
  const cid = normalizeLegacyCourseId(state.currentUser.course);
  const opt = [...prog.options].find((o) => o.value === cid);
  if (opt) {
    prog.value = cid;
    prog.dispatchEvent(new Event("change"));
  }
  if (major && wrap && !wrap.classList.contains("hidden")) {
    const maj = String(state.currentUser.major || "").trim();
    if (!maj || maj === "-") return;
    const byVal = [...major.options].find((o) => o.value.toLowerCase() === maj.toLowerCase());
    const byText = [...major.options].find((o) =>
      maj.length >= 2 ? o.textContent.toLowerCase().includes(maj.toLowerCase()) : false
    );
    const pick = byVal || byText;
    if (pick) major.value = pick.value;
  }
}

function applyRecommendationFromScores(scoreMap, trackKey) {
  if (typeof alsRecommend !== "function") return;
  const tk = trackKey || state.currentTrackKey || "BSCT";
  state.lastRecommendation = alsRecommend(scoreMap, tk);
  renderRecommendations(state.lastRecommendation);
}

function renderRecommendations(rec) {
  const el = document.getElementById("recommendationBody");
  if (!el || !rec) return;
  const progs = rec.rankedPrograms || [];
  const majors = rec.rankedMajors || [];
  const topP = rec.topProgram;
  const topM = rec.topMajorTrack;
  el.classList.remove("muted");
  el.innerHTML = `
    <p><strong>Top program match:</strong> ${escapeHtml(topP.programName)} (fit index ${topP.fit})</p>
    <p><strong>Top major track match:</strong> ${escapeHtml(topM.trackKey)} (fit index ${topM.fit})</p>
    <p class="recommendation-meta">${escapeHtml(rec.narrative)}</p>
    <p><strong>Ranked programs</strong></p>
    <ol class="rank-list">
      ${progs
        .slice(0, 5)
        .map((p) => `<li>${escapeHtml(p.programName)} — ${p.fit}</li>`)
        .join("")}
    </ol>
    <p><strong>Ranked major tracks</strong></p>
    <ol class="rank-list">
      ${majors
        .slice(0, 5)
        .map((m) => `<li>${escapeHtml(m.trackKey)} — ${m.fit}</li>`)
        .join("")}
    </ol>
  `;
}

function updateSessionUI() {
  const appShell = document.getElementById("appShell");
  const authSection = document.getElementById("authSection");
  const sessionLabel = document.getElementById("sessionLabel");
  const topLogoutBtn = document.getElementById("topLogoutBtn");

  if (authSection && appShell) {
    if (!state.currentUser) {
      appShell.classList.add("hidden");
      authSection.classList.remove("hidden");
      if (topLogoutBtn) topLogoutBtn.classList.add("hidden");
      if (sessionLabel) sessionLabel.textContent = "Not logged in";
    } else {
      appShell.classList.remove("hidden");
      authSection.classList.add("hidden");
      if (topLogoutBtn) topLogoutBtn.classList.remove("hidden");
      if (sessionLabel) sessionLabel.textContent = `${state.currentUser.name} (${state.currentUser.role})`;
    }
    updateNavVisibility();
    return;
  }

  if (sessionLabel) {
    sessionLabel.textContent = state.currentUser
      ? `${state.currentUser.name} (${state.currentUser.role})`
      : "Not logged in";
  }
  if (topLogoutBtn) topLogoutBtn.classList.toggle("hidden", !state.currentUser);
}

function updateNavVisibility() {
  const adminBtn = document.querySelector('.nav-btn[data-section="adminSection"]');
  if (!adminBtn) return;
  const showAdmin = state.currentUser && normalizeRole(state.currentUser.role) === "Admin";
  adminBtn.classList.toggle("hidden", !showAdmin);
}

function renderProfile() {
  const profileCard = document.getElementById("profileCard");
  if (!profileCard || !state.currentUser) return;
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
  if (!loadQuestionsBtn || !submitResponsesBtn) return;

  loadQuestionsBtn.addEventListener("click", () => {
    if (state.currentUser && hasOfficialAttemptDone(state.currentUser.user_id)) {
      showHomeToast("Your official assessment is already submitted. Review results or practice offline.", "error");
      return;
    }
    const trackKey = getAssessmentTrackKey();
    if (!trackKey) {
      showHomeToast("Select a program (and major if required).", "error");
      return;
    }
    renderQuestionnaire(trackKey);
  });

  submitResponsesBtn.addEventListener("click", () => {
    if (!state.currentUser || normalizeRole(state.currentUser.role) !== "Alumni") {
      showHomeToast("Sign in as an alumni user to submit responses.", "error");
      return;
    }
    if (hasOfficialAttemptDone(state.currentUser.user_id)) {
      showHomeToast("Official attempt already recorded.", "error");
      return;
    }
    const form = document.getElementById("questionnaireForm");
    if (!form) return;
    const picked = [...form.querySelectorAll("input[type=radio]:checked")];
    if (picked.length === 0 || picked.length !== state.questions.length) {
      showHomeToast("Answer every question, then submit.", "error");
      if (PAGE === "home") setHomeWizardStep(2);
      return;
    }

    const newResponses = picked.map((input) => {
      const qMeta = state.questions.find((q) => q.id === input.name);
      return {
        id: "R" + Math.random().toString(36).slice(2, 9),
        user_id: state.currentUser.user_id,
        question_id: input.name,
        answer: input.value,
        score: Number(input.dataset.score),
        category: qMeta ? qMeta.category : ""
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
              score: r.score,
              category: r.category || ""
            }))
          });
          if (!res || !res.success) {
            showHomeToast((res && res.message) || "Submission failed.", "error");
            return;
          }
          const scoreMap = (res.computed && res.computed.scores) ? res.computed.scores : {};
          state.lastComputedScores = scoreMap;
          renderScoreCards(scoreMap);
          drawAlumniCharts(scoreMap);
          applyRecommendationFromScores(scoreMap, state.currentTrackKey);
          await refreshAdminAnalytics();
          markOfficialAttemptDone(state.currentUser.user_id);
          try {
            window.sessionStorage.setItem(
              LAST_ASSESSMENT_TRACK_PREFIX + state.currentUser.user_id,
              state.currentTrackKey || ""
            );
          } catch (e) {
            /* ignore */
          }
          renderAlumniKpis();
          applyAssessmentLockUI();
          showHomeToast("Official run saved. Your benchmark is locked in.", "success");
          if (PAGE === "home") setHomeWizardStep(3);
          return;
        }

        state.responses = state.responses.filter((r) => r.user_id !== state.currentUser.user_id).concat(newResponses);
        const computed = computeScoresForUser(state.currentUser.user_id);
        state.lastComputedScores = computed;
        renderScoreCards(computed);
        drawAlumniCharts(computed);
        applyRecommendationFromScores(computed, state.currentTrackKey);
        markOfficialAttemptDone(state.currentUser.user_id);
        try {
          window.sessionStorage.setItem(
            LAST_ASSESSMENT_TRACK_PREFIX + state.currentUser.user_id,
            state.currentTrackKey || ""
          );
        } catch (e) {
          /* ignore */
        }
        if (document.getElementById("adminKpi")) renderAdminDashboard();
        renderAlumniKpis();
        applyAssessmentLockUI();
        showHomeToast("Official run saved. Your benchmark is locked in.", "success");
        if (PAGE === "home") setHomeWizardStep(3);
      } catch {
        showHomeToast("Submission failed. Please try again.", "error");
      }
    })();
  });
}

function renderQuestionnaire(trackKey) {
  if (state.currentUser && hasOfficialAttemptDone(state.currentUser.user_id)) {
    showHomeToast("You cannot load another official questionnaire.", "error");
    return;
  }
  const form = document.getElementById("questionnaireForm");
  const hint = document.getElementById("courseStepHint");
  const continueBtn = document.getElementById("wizardContinueFromCourse");
  if (!form || typeof alsGetQuestionsForTrack !== "function") {
    if (hint) hint.textContent = "Assessment module failed to load. Refresh the page.";
    return;
  }
  const questions = alsGetQuestionsForTrack(trackKey);
  state.currentTrackKey = trackKey;
  state.questions = questions;
  if (questions.length === 0) {
    form.innerHTML = "";
    if (hint) hint.textContent = "No assessment items are defined for this selection.";
    if (continueBtn) continueBtn.disabled = true;
    if (PAGE === "home") showHomeToast("No questions found for the selected track.", "error");
    return;
  }
  if (hint) {
    hint.textContent = `${questions.length} scenario items loaded (30 expected). Continue to responses when ready.`;
  }
  if (continueBtn) continueBtn.disabled = false;
  form.innerHTML = questions
    .map((q, idx) => {
      const opts = q.choices
        .map(
          (ch) => `
        <label class="option-card">
          <input class="option-card__input" type="radio" name="${escapeHtml(q.id)}" value="${escapeHtml(ch.key)}" data-score="${ch.score}" required />
          <span class="option-card__body">
            <span class="option-card__key">${escapeHtml(ch.key)}.</span>
            <span class="option-card__text">${escapeHtml(ch.text)}</span>
          </span>
        </label>`
        )
        .join("");
      const catUpper = escapeHtml(String(q.category || "").toUpperCase());
      return `
      <article class="question-block" aria-labelledby="q-head-${idx}">
        <header class="question-block__header" id="q-head-${idx}">
          <span class="question-block__num">Question ${idx + 1}</span>
          <span class="question-block__cat">${catUpper}</span>
        </header>
        <p class="question-block__stem">${escapeHtml(q.question)}</p>
        <div class="question-block__options" role="radiogroup" aria-label="Question ${idx + 1}">${opts}</div>
      </article>`;
    })
    .join("");
  if (PAGE === "home") setHomeWizardStep(2);
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
  if (!scoreCards) return;
  const entries = Object.entries(scoreMap);
  if (entries.length === 0) {
    scoreCards.classList.add("muted");
    scoreCards.textContent = "No computed scores yet.";
    state.lastComputedOverall = null;
    return;
  }
  scoreCards.classList.remove("muted");
  const overall = Number(
    (entries.reduce((sum, [, v]) => sum + Number(v), 0) / entries.length).toFixed(2)
  );
  state.lastComputedOverall = overall;
  const banner = `<div class="overall-score-banner"><strong>Overall mean</strong> (1–4 rubric): ${overall}</div>`;
  scoreCards.innerHTML =
    banner +
    entries
      .map(([category, score]) => {
        const num = Number(score);
        const level = num >= 3.25 ? "Strong band" : "Development band";
        return `
        <div class="score-card">
          <p><strong>${category}</strong></p>
          <p>Category mean: ${score}</p>
          <p>Band: ${level}</p>
        </div>
      `;
      })
      .join("");
}

function drawAlumniCharts(scoreMap) {
  const entries = Object.entries(scoreMap);
  const canvasBar = document.getElementById("alumniBarChart");
  const canvasRadar = document.getElementById("alumniRadarChart");
  if (!canvasBar || !canvasRadar) return;
  const ctxBar = canvasBar.getContext("2d");
  clearCanvas(ctxBar, canvasBar);
  drawBars(ctxBar, canvasBar, entries, ["#1d4e89", "#2b6cb0", "#e3b341"]);

  const ctxRadar = canvasRadar.getContext("2d");
  clearCanvas(ctxRadar, canvasRadar);
  drawRadar(ctxRadar, canvasRadar, entries);
}

function bindAdminActions() {
  const closeDrillBtn = document.getElementById("closeDrillBtn");
  if (closeDrillBtn) closeDrillBtn.addEventListener("click", closeModal);

  const courseChart = document.getElementById("courseChart");
  if (courseChart) {
    courseChart.addEventListener("click", (event) => {
      const course = detectBarClick(event, "course");
      if (course) showCourseDrillDown(course);
    });
  }
  const categoryChart = document.getElementById("categoryChart");
  if (categoryChart) {
    categoryChart.addEventListener("click", (event) => {
      const category = detectBarClick(event, "category");
      if (category) showCategoryDrillDown(category);
    });
  }
}

function renderAdminDashboard() {
  if (!document.getElementById("adminKpi")) return;
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
  if (!container || !state.currentUser) return;
  const uid = state.currentUser.user_id;
  const myResults = state.results.filter((r) => r.user_id === uid);
  const myResponses = state.responses.filter((r) => r.user_id === uid);
  const byCat = {};
  myResults.forEach((row) => {
    const k = row.category;
    if (!byCat[k]) byCat[k] = [];
    byCat[k].push(Number(row.score));
  });
  const catAvgs = Object.values(byCat).map((arr) => arr.reduce((a, b) => a + b, 0) / arr.length);
  let overallNum = null;
  if (typeof state.lastComputedOverall === "number" && !Number.isNaN(state.lastComputedOverall)) {
    overallNum = state.lastComputedOverall;
  } else if (catAvgs.length > 0) {
    overallNum = catAvgs.reduce((a, b) => a + b, 0) / catAvgs.length;
  }
  const overallDisp =
    overallNum != null && !Number.isNaN(overallNum) ? Number(overallNum).toFixed(2) : "—";
  const masteryPct =
    overallNum != null && !Number.isNaN(overallNum)
      ? Math.min(100, Math.round(((overallNum - 1) / 3) * 100))
      : 0;
  const xpDisplay =
    overallNum != null && !Number.isNaN(overallNum)
      ? Math.round(((overallNum - 1) / 3) * 1000)
      : 0;

  const tier = getRankTier(overallNum);
  const attemptLocked = hasOfficialAttemptDone(uid);
  const attemptLabel = attemptLocked ? "Quest cleared · locked" : "Quest ready · 1 attempt";

  let badgeDefs = [];
  if (Object.keys(byCat).length > 0) {
    badgeDefs = Object.entries(byCat).map(([cat, scores]) => {
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      const unlocked = avg >= 3.25;
      return { cat, avg: avg.toFixed(2), unlocked };
    });
  } else if (state.lastComputedScores && Object.keys(state.lastComputedScores).length > 0) {
    badgeDefs = Object.entries(state.lastComputedScores).map(([cat, v]) => {
      const avg = Number(v);
      const unlocked = !Number.isNaN(avg) && avg >= 3.25;
      return { cat, avg: Number.isNaN(avg) ? "—" : avg.toFixed(2), unlocked };
    });
  }

  const program = state.currentUser.course && state.currentUser.course !== "-" ? state.currentUser.course : "—";
  let major = state.currentUser.major;
  if (!major || major === "-") major = "—";

  const badgesHtml =
    badgeDefs.length === 0
      ? `<p class="game-badges-empty muted">Finish your official run to unlock category badges.</p>`
      : `<div class="game-badges">
          ${badgeDefs
            .map((b) => {
              const cls = b.unlocked ? "game-badge game-badge--unlocked" : "game-badge game-badge--locked";
              const icon = b.unlocked ? "" : '<span class="game-badge__lock" aria-hidden="true"></span>';
              return `<span class="${cls}" title="${escapeHtml(b.cat)}: ${b.avg}">${icon}<span class="game-badge__name">${escapeHtml(b.cat)}</span></span>`;
            })
            .join("")}
        </div>`;

  container.innerHTML = `
    <div class="game-hub">
      <article class="game-hero ${tier.cls}">
        <div class="game-hero__rank">
          <p class="game-hero__rank-label">Skill rank</p>
          <p class="game-hero__rank-title">${escapeHtml(tier.label)}</p>
          <p class="game-hero__rank-blurb">${escapeHtml(tier.blurb)}</p>
        </div>
        <div class="game-hero__meter">
          <p class="game-hero__meter-label">Mastery meter</p>
          <div class="game-xp-bar" role="progressbar" aria-valuenow="${masteryPct}" aria-valuemin="0" aria-valuemax="100">
            <span class="game-xp-bar__fill" style="width:${masteryPct}%"></span>
          </div>
          <div class="game-hero__meter-meta">
            <span><strong>${overallDisp}</strong> mean · scale 1–4</span>
            <span>${xpDisplay} mastery XP</span>
          </div>
        </div>
      </article>
      <div class="game-stat-grid">
        <article class="game-stat-tile game-stat-tile--quest">
          <p class="game-stat-tile__label">Official attempt</p>
          <p class="game-stat-tile__value">${escapeHtml(attemptLabel)}</p>
          <p class="game-stat-tile__hint">One scored run — same items for your own study after.</p>
        </article>
        <article class="game-stat-tile game-stat-tile--loadout">
          <p class="game-stat-tile__label">Loadout</p>
          <p class="game-stat-tile__value">${escapeHtml(program)}</p>
          <p class="game-stat-tile__hint">Major: ${escapeHtml(major)}</p>
        </article>
        <article class="game-stat-tile game-stat-tile--items">
          <p class="game-stat-tile__label">Response log</p>
          <p class="game-stat-tile__value">${myResponses.length} items</p>
          <p class="game-stat-tile__hint">30 items = one full scenario run.</p>
        </article>
      </div>
      <div class="game-badges-section">
        <p class="game-badges-title">Category badges</p>
        ${badgesHtml}
      </div>
    </div>
  `;
}

function renderAdminKpis(analytics) {
  const container = document.getElementById("adminKpi");
  if (!container) return;
  const coursesTracked = Object.keys(analytics.courseScores).length;
  const categoriesTracked = Object.keys(analytics.categoryDistribution).length;
  const rankedAlumni = analytics.performanceIndex.length;
  const topScore = rankedAlumni ? analytics.performanceIndex[0].competencyScore.toFixed(2) : "0.00";
  const tiles = [
    {
      mod: "programs",
      label: "Programs",
      hint: "Distinct course codes in dataset",
      value: String(coursesTracked)
    },
    {
      mod: "categories",
      label: "Skill categories",
      hint: "Aggregated competency dimensions",
      value: String(categoriesTracked)
    },
    {
      mod: "alumni",
      label: "Alumni indexed",
      hint: "Rows in performance index",
      value: String(rankedAlumni)
    },
    {
      mod: "leader",
      label: "Top cohort score",
      hint: "Highest mean competency",
      value: topScore
    }
  ];
  container.innerHTML = tiles
    .map(
      (t) => `
    <article class="admin-kpi-tile admin-kpi-tile--${t.mod}">
      <div class="admin-kpi-tile__meta">
        <p class="admin-kpi-tile__label">${t.label}</p>
        <p class="admin-kpi-tile__hint">${t.hint}</p>
      </div>
      <p class="admin-kpi-tile__value">${escapeHtml(t.value)}</p>
    </article>`
    )
    .join("");
}

function getAdminAnalytics() {
  const alumniUsers = state.users.filter((u) => normalizeRole(u.role) === "Alumni");
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
      performanceLevel: avgScore >= 3 ? "High Proficiency" : "Emerging Proficiency"
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
  if (!container) return;
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
  if (!container) return;
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
  if (!container) return;
  const entries = Object.entries(categoryScores);
  container.innerHTML = entries
    .map(([category, score]) => `<button class="chip" data-category="${category}">${category}: ${score}</button>`)
    .join("");
  container.querySelectorAll("[data-category]").forEach((button) => {
    button.addEventListener("click", () => showCategoryDrillDown(button.dataset.category));
  });
}

function drawAdminCharts(analytics) {
  const courseCanvas = document.getElementById("courseChart");
  const categoryCanvas = document.getElementById("categoryChart");
  if (!courseCanvas || !categoryCanvas) return;

  const courseEntries = Object.entries(analytics.courseScores);
  const categoryEntries = Object.entries(analytics.categoryDistribution);
  state.charts.courseEntries = courseEntries;
  state.charts.categoryEntries = categoryEntries;

  const courseCtx = courseCanvas.getContext("2d");
  clearCanvas(courseCtx, courseCanvas);
  drawBars(courseCtx, courseCanvas, courseEntries, ["#1d4e89", "#2b6cb0", "#3b82c4", "#60a5fa", "#e3b341"]);

  const categoryCtx = categoryCanvas.getContext("2d");
  clearCanvas(categoryCtx, categoryCanvas);
  drawBars(categoryCtx, categoryCanvas, categoryEntries, ["#2b6cb0", "#1d4e89", "#e3b341"]);
}

function showCourseDrillDown(course) {
  const users = state.users.filter((user) => normalizeRole(user.role) === "Alumni" && user.course === course);
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
    .filter((u) => normalizeRole(u.role) === "Alumni")
    .map((user) => {
      const result = state.results.find((r) => r.user_id === user.user_id && r.category === category);
      if (!result) return null;
      const level = result.score >= 3 ? "High Proficiency" : "Development Area";
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
  const titleEl = document.getElementById("drillTitle");
  const bodyEl = document.getElementById("drillBody");
  const panel = document.getElementById("drillDownPanel");
  if (!titleEl || !bodyEl || !panel) return;
  titleEl.textContent = title;
  bodyEl.innerHTML = html;
  panel.classList.add("open");
  panel.setAttribute("aria-hidden", "false");
}

function closeModal() {
  const panel = document.getElementById("drillDownPanel");
  if (!panel) return;
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
    const barHeight = (Number(value) / 5) * barAreaHeight;
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

  for (let layer = 1; layer <= 5; layer += 1) {
    ctx.beginPath();
    for (let i = 0; i < sides; i += 1) {
      const angle = (Math.PI * 2 * i) / sides - Math.PI / 2;
      const x = centerX + ((radius * layer) / 5) * Math.cos(angle);
      const y = centerY + ((radius * layer) / 5) * Math.sin(angle);
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
    const x = centerX + ((radius * value) / 5) * Math.cos(angle);
    const y = centerY + ((radius * value) / 5) * Math.sin(angle);
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
    const barHeight = (Number(value) / 5) * barAreaHeight;
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

window.addEventListener("DOMContentLoaded", bootstrap);
