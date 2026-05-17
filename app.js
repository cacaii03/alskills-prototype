"use strict";

const PAGE = document.body.dataset.page || "auth";
const ALSKILL_USER_KEY = "alskill_user";
const ALSKILL_SESSION_KEY = "alskill_session_v1";
/** End session after this much inactivity (client guard). */
const SESSION_IDLE_MS = 45 * 60 * 1000;
/** Hard cap for client-side session envelope (demo and upper bound for remote). */
const SESSION_CLIENT_MAX_MS = 24 * 60 * 60 * 1000;
/** Aligns with Apps Script CacheService max session TTL (6 hours). */
const REMOTE_SESSION_MAX_MS = 21600 * 1000;

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

/** Session flag plus stored responses/results imply one official skills assessment attempt completed. */
const OFFICIAL_ATTEMPT_STORAGE_PREFIX = "alskill_official_attempt_v1_";
const LAST_ASSESSMENT_TRACK_PREFIX = "alskill_last_assessment_track_v1_";
const RESULTS_WIZARD_VIEWED_PREFIX = "alskill_results_wizard_viewed_v1_";

/** Category / overall means on the 1–4 rubric shown as `3.25 / 4.00`. */
function formatRubricOverFour(val) {
  if (val == null || Number.isNaN(Number(val))) return "— / 4.00";
  return `${Number(val).toFixed(2)} / 4.00`;
}

function markResultsWizardViewed(uid) {
  if (!uid) return;
  try {
    window.sessionStorage.setItem(RESULTS_WIZARD_VIEWED_PREFIX + uid, "1");
  } catch (e) {
    /* ignore */
  }
}

function hasViewedResultsWizard(uid) {
  if (!uid) return false;
  try {
    return !!window.sessionStorage.getItem(RESULTS_WIZARD_VIEWED_PREFIX + uid);
  } catch (e) {
    return false;
  }
}

function updateWizardPrintSummaryVisibility() {
  if (PAGE !== "home" || !state.currentUser) return;
  const uid = state.currentUser.user_id;
  const locked = hasOfficialAttemptDone(uid);
  const viewed = hasViewedResultsWizard(uid);
  const block = document.getElementById("wizardPrintSummaryBlock");
  if (block) block.classList.toggle("hidden", !(locked && viewed));
}

function hasOfficialAttemptDone(uid) {
  if (!uid) return false;
  try {
    if (window.sessionStorage.getItem(OFFICIAL_ATTEMPT_STORAGE_PREFIX + uid)) return true;
  } catch (e) {
    /* ignore */
  }
  const responsesCount = state.responses.filter((r) => r.user_id === uid).length;
  if (responsesCount >= 48) return true;
  const categories = new Set(state.results.filter((r) => r.user_id === uid).map((r) => r.category));
  return categories.size >= 10;
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
  if (o < 2.5) return { key: "learner", label: "Learner", blurb: "Solid baseline across skill areas.", cls: "game-rank--learner" };
  if (o < 3) return { key: "specialist", label: "Specialist", blurb: "Consistent judgement under pressure.", cls: "game-rank--specialist" };
  if (o < 3.5) return { key: "adept", label: "Adept", blurb: "Strong readiness signals.", cls: "game-rank--adept" };
  if (o < 3.85) return { key: "expert", label: "Expert", blurb: "High proficiency benchmark.", cls: "game-rank--expert" };
  return { key: "master", label: "Masterclass", blurb: "Top-band performance across categories.", cls: "game-rank--master" };
}

function buildPerformanceLevelLabel(overallNum) {
  if (overallNum == null || Number.isNaN(Number(overallNum))) return "Not recorded";
  return Number(overallNum) >= 3 ? "High Proficiency" : "Emerging Proficiency";
}

function buildImprovementFeedbackParagraphs(scoreMap, overallNum) {
  const entries = Object.entries(scoreMap).map(([cat, v]) => [cat, Number(v)]);
  entries.sort((a, b) => a[1] - b[1]);
  const weakest = entries.filter(([, v]) => v < 3.25);
  const strongest = entries
    .filter(([, v]) => v >= 3.25)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 1);

  const lines = [];
  const o = overallNum == null || Number.isNaN(Number(overallNum)) ? null : Number(overallNum);

  if (o != null && o < 2.5) {
    lines.push(
      "Overall signals indicate foundational gaps across the scenario rubric. Prioritize reflective practice on realistic decision points and seek structured coaching or mentorship aligned with your program competencies."
    );
  } else if (o != null && o < 3) {
    lines.push(
      "Your aggregate score sits in the development band. Focused rehearsal on the categories listed below, paired with feedback from supervisors or peers, will help lift consistency before the next formal review."
    );
  } else if (o != null && o < 3.5) {
    lines.push(
      "Performance is solid in several dimensions but uneven. Concentrate study time on the lowest-mean categories so judgement stays reliable under pressure and across diverse scenarios."
    );
  } else {
    lines.push(
      "You are operating above cohort norms in aggregate. Maintain rigor through cross-training categories that are merely adequate, and document exemplar decisions so others can learn from your judgement patterns."
    );
  }

  if (weakest.length) {
    const cats = weakest.map(([c]) => c).join(", ");
    lines.push(
      `Target improvement in: ${cats}. Review item-level rationale, compare against high-scoring exemplars, and rehearse alternative responses until the preferred judgement path feels automatic.`
    );
  } else {
    lines.push(
      "No category fell sharply below the development boundary. Keep sharpening edge cases within your lowest relative means even when all bands look healthy."
    );
  }

  if (strongest.length && entries.length > 1) {
    const top = strongest[0];
    lines.push(
      `Relative strength: ${top[0]} (mean ${top[1].toFixed(2)}). Leverage this strength when tackling complex tasks that draw on similar cognitive habits.`
    );
  }

  return lines;
}

/**
 * Short, actionable bullets for the alumni dashboard (after scores exist).
 */
function buildDashboardImprovementBullets(scoreMap, overallNum) {
  const bullets = [];
  if (!scoreMap || Object.keys(scoreMap).length === 0) return bullets;
  const entries = Object.entries(scoreMap)
    .map(([cat, v]) => [cat, Number(v)])
    .filter(([, v]) => !Number.isNaN(v));
  if (entries.length === 0) return bullets;
  entries.sort((a, b) => a[1] - b[1]);
  const weak = entries.filter(([, v]) => v < 3.25);
  const o = overallNum == null || Number.isNaN(Number(overallNum)) ? null : Number(overallNum);

  if (o != null && o < 2.5) {
    bullets.push(
      "Overall is in the foundation band — revisit assessment items slowly, one category at a time, and reflect on where Always or Sometimes fits your real practice."
    );
  } else if (o != null && o < 3) {
    bullets.push(
      "Overall is still in the development band — prioritize the weakest categories below before adding new material."
    );
  } else if (o != null && o < 3.5) {
    bullets.push(
      "You are close to a strong profile — tighten consistency on the lowest categories so judgement holds under time pressure."
    );
  } else {
    bullets.push("Strong aggregate — keep pressure-testing the categories at the bottom of your list so there is no hidden gap.");
  }

  weak.slice(0, 3).forEach(([cat, val]) => {
    bullets.push(
      `Improve ${cat} (mean ${val.toFixed(2)}) — revisit related statements honestly and practice behaviors until Always or Sometimes reflects your day-to-day work.`
    );
  });

  if (weak.length === 0 && entries.length > 1) {
    const [cat, val] = entries[0];
    bullets.push(
      `Relative focus: ${cat} (${val.toFixed(2)}) — even solid scores benefit from one more honest pass on statements in this area.`
    );
  }

  return bullets.slice(0, 6);
}

function chartScaleMaxFromEntries(entries) {
  const vals = entries.map(([, v]) => Number(v)).filter((n) => !Number.isNaN(n));
  const hi = vals.length ? Math.max(...vals) : 4;
  return Math.max(4, hi, 0.01);
}

function setupAlumniChartSurface(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const wrap = canvas.parentElement;
  const lw = Math.max(260, Math.min(640, Math.floor((wrap && wrap.clientWidth) || canvas.clientWidth || 400)));
  const lh = 280;
  canvas.style.width = `${lw}px`;
  canvas.style.height = `${lh}px`;
  canvas.width = Math.floor(lw * dpr);
  canvas.height = Math.floor(lh * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return { ctx: null, lw, lh };
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, lw, lh);
  return { ctx, lw, lh };
}

/** Resolve `filename` next to the current page so links work in subfolders and static hosts (avoids broken relative navigations). */
function resolveSiblingPageHref(filename) {
  return new URL(filename, window.location.href).href.split("#")[0];
}

function buildAssessmentResultsHref(subjectUserId) {
  const base = `${resolveSiblingPageHref("assessment-results.html")}?user=${encodeURIComponent(subjectUserId)}`;
  if (window.location.protocol === "file:" && state.currentUser) {
    return base + userToHashFragment(state.currentUser);
  }
  return base;
}

function knownAssessmentTrackKeys() {
  if (typeof ALSKILL_TRACK_CATEGORY_NAMES === "object" && ALSKILL_TRACK_CATEGORY_NAMES) {
    return Object.keys(ALSKILL_TRACK_CATEGORY_NAMES);
  }
  return ["BSIT", "BSBA:MM", "BSBA:OM", "BSBA:FM", "BSED:EN", "BSED:MA", "BECED", "BEED"];
}

/** Map legacy `question_id` prefix to the catalog track used to build items. */
function inferTrackKeyFromQuestionId(questionId) {
  const qid = String(questionId || "");
  if (qid.startsWith("BSCT_c")) return "BSIT";
  for (const tk of knownAssessmentTrackKeys()) {
    const safe = tk.replace(/:/g, "_");
    if (qid.startsWith(safe + "_c")) return tk;
  }
  return "";
}

function resolveAssessmentTrackKeyForUser(userId, subjectUser) {
  const uid = String(userId || "");
  try {
    const stored = window.sessionStorage.getItem(LAST_ASSESSMENT_TRACK_PREFIX + uid);
    if (stored) return stored;
  } catch (e) {
    /* ignore */
  }
  if (state.currentTrackKey && state.currentUser && String(state.currentUser.user_id) === uid) {
    return state.currentTrackKey;
  }
  const userResponses = state.responses.filter((r) => String(r.user_id) === uid);
  if (userResponses.length) return inferTrackKeyFromQuestionId(userResponses[0].question_id);
  if (subjectUser && subjectUser.course && subjectUser.course !== "-") {
    const cid = normalizeLegacyCourseId(subjectUser.course);
    const maj = String(subjectUser.major || "").trim();
    if (maj && maj !== "-") return `${cid}:${maj}`;
    return cid;
  }
  return "";
}

function likertLabelFromScore(score) {
  const s = Number(score);
  if (s >= 4) return "Always";
  if (s >= 3) return "Sometimes";
  if (s >= 2) return "Maybe";
  if (s >= 1) return "Never";
  return "—";
}

function masteryStatusFromMean(mean) {
  const t = typeof ALSKILL_MASTERY_THRESHOLD === "number" ? ALSKILL_MASTERY_THRESHOLD : 3.25;
  return Number(mean) >= t ? "Mastered" : "Developing";
}

function setAssessmentSubmitting(busy) {
  const overlay = document.getElementById("assessmentSubmitOverlay");
  const btn = document.getElementById("submitResponsesBtn");
  const form = document.getElementById("questionnaireForm");
  if (overlay) {
    overlay.classList.toggle("hidden", !busy);
    overlay.classList.toggle("assessment-submit-overlay--visible", busy);
    overlay.setAttribute("aria-hidden", busy ? "false" : "true");
  }
  if (btn) {
    btn.disabled = !!busy;
    btn.setAttribute("aria-busy", busy ? "true" : "false");
    btn.textContent = busy ? "Submitting…" : "Submit responses";
  }
  if (form) {
    form.querySelectorAll("input[type=radio]").forEach((el) => {
      el.disabled = !!busy;
    });
  }
}

/**
 * Printable per-item summary for the 50-item Likert self-assessment (no question stems).
 */
function buildAnonymousItemOutcomesSectionHtml(userId, trackKeyHint) {
  const uid = String(userId || "");
  const userResponses = state.responses.filter((r) => String(r.user_id) === uid);
  if (userResponses.length === 0) {
    return `<h2 class="results-doc__block-title">Response record</h2><p class="muted">No per-item responses are on file for this learner.</p>`;
  }
  if (typeof alsGetQuestionsForTrack !== "function") {
    return `<h2 class="results-doc__block-title">Response record</h2><p class="muted">Item detail requires the assessment catalog. Reload the page or open results from the alumni workspace.</p>`;
  }
  const trackKey = trackKeyHint || inferTrackKeyFromQuestionId(userResponses[0].question_id);
  if (!trackKey) {
    return `<h2 class="results-doc__block-title">Response record</h2><p class="muted">Recorded question identifiers do not match the current catalog layout.</p>`;
  }
  const catalogQs = alsGetQuestionsForTrack(trackKey);
  const metaById = new Map(catalogQs.map((q) => [q.id, q]));

  function parseOrder(qid) {
    const m = String(qid).match(/_c(\d+)_q(\d+)$/);
    if (m) return [Number(m[1]), Number(m[2])];
    return [9999, 9999];
  }

  const rows = [];
  let skipped = 0;
  const dist = { Always: 0, Sometimes: 0, Maybe: 0, Never: 0 };
  userResponses.forEach((r) => {
    const qid = String(r.question_id || "");
    const meta = metaById.get(qid);
    const sc = Number(r.score);
    if (!meta || Number.isNaN(sc)) {
      skipped += 1;
      return;
    }
    const label = likertLabelFromScore(sc);
    if (dist[label] != null) dist[label] += 1;
    rows.push({
      ordKey: parseOrder(qid),
      category: meta.category || r.category || "—",
      label,
      score: sc,
      band: masteryStatusFromMean(sc)
    });
  });
  rows.sort((a, b) => a.ordKey[0] - b.ordKey[0] || a.ordKey[1] - b.ordKey[1]);

  if (rows.length === 0) {
    return `<h2 class="results-doc__block-title">Response record</h2><p class="muted">No items could be matched to the catalog${
      skipped ? ` (${skipped} row${skipped === 1 ? "" : "s"} skipped)` : ""
    }.</p>`;
  }

  const byCategory = new Map();
  rows.forEach((row, idx) => {
    const cat = row.category;
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push({ ...row, itemNum: idx + 1 });
  });

  let tableBody = "";
  byCategory.forEach((catRows, cat) => {
    tableBody += `<tr class="results-outcome-cat-row"><td colspan="4"><strong>${escapeHtml(cat)}</strong></td></tr>`;
    catRows.forEach((row) => {
      const bandCls =
        row.band === "Mastered" ? "results-outcome-cell--mastered" : "results-outcome-cell--developing";
      tableBody += `<tr>
        <td class="results-outcome-ix">${row.itemNum}</td>
        <td>${escapeHtml(row.label)}</td>
        <td class="results-outcome-score">${row.score.toFixed(0)}</td>
        <td class="${bandCls}">${escapeHtml(row.band)}</td>
      </tr>`;
    });
  });

  const skipNote =
    skipped > 0
      ? `<p class="results-anon-note muted">${skipped} stored row${skipped === 1 ? "" : "s"} could not be matched to the catalog and ${skipped === 1 ? "was" : "were"} omitted from this table.</p>`
      : "";

  return `
      <h2 class="results-doc__block-title">Response record by category</h2>
      <p class="results-anon-lede">Statement text is omitted to protect the item bank. Each row is one self-assessment item in official order, grouped by skill category. Responses use the <strong>Always · Sometimes · Maybe · Never</strong> rubric (scores 4–1). <strong>Mastered</strong> on an item means score 4 (Always); <strong>Developing</strong> means scores 1–3.</p>
      <div class="results-outcome-summary">
        <span><strong>${dist.Always}</strong> Always</span>
        <span class="results-outcome-summary__sep" aria-hidden="true">·</span>
        <span><strong>${dist.Sometimes}</strong> Sometimes</span>
        <span class="results-outcome-summary__sep" aria-hidden="true">·</span>
        <span><strong>${dist.Maybe}</strong> Maybe</span>
        <span class="results-outcome-summary__sep" aria-hidden="true">·</span>
        <span><strong>${dist.Never}</strong> Never</span>
        <span class="results-outcome-summary__sep" aria-hidden="true">·</span>
        <span class="muted">${rows.length} / ${typeof ALSKILL_ASSESSMENT_ITEM_COUNT === "number" ? ALSKILL_ASSESSMENT_ITEM_COUNT : 50} items</span>
      </div>
      ${skipNote}
      <div class="results-outcome-table-wrap">
        <table class="results-outcome-table" aria-label="Self-assessment responses without question text">
          <thead><tr><th scope="col">#</th><th scope="col">Response</th><th scope="col">Score</th><th scope="col">Item band</th></tr></thead>
          <tbody>${tableBody}</tbody>
        </table>
      </div>`;
}

/**
 * Full printable <article> HTML for one subject (shared by assessment-results page and alumni inline print).
 */
function buildAssessmentResultsArticleHtml(subjectUser, subjectId, scores, overall) {
  const tier = getRankTier(overall);
  const level = buildPerformanceLevelLabel(overall);
  const feedbackParas = buildImprovementFeedbackParagraphs(scores, overall);
  const masteryT = typeof ALSKILL_MASTERY_THRESHOLD === "number" ? ALSKILL_MASTERY_THRESHOLD : 3.25;
  const trackKey = resolveAssessmentTrackKeyForUser(subjectId, subjectUser);
  const hardSoft =
    typeof alsHardSoftMeans === "function" ? alsHardSoftMeans(scores) : { hardMean: null, softMean: null };
  const hardMeanDisp = hardSoft.hardMean != null ? formatRubricOverFour(hardSoft.hardMean) : "—";
  const softMeanDisp = hardSoft.softMean != null ? formatRubricOverFour(hardSoft.softMean) : "—";

  function categoryListHtml(map) {
    return Object.entries(map || {})
      .sort((a, b) => b[1] - a[1])
      .map(([cat, val]) => {
        const status = masteryStatusFromMean(val);
        const statusCls =
          status === "Mastered" ? "results-cat-status--mastered" : "results-cat-status--developing";
        return `<li><span class="results-cat-name">${escapeHtml(cat)}</span><span class="results-cat-score">${formatRubricOverFour(val)}</span><span class="results-cat-status ${statusCls}">${escapeHtml(status)}</span></li>`;
      })
      .join("");
  }

  const hardCatsHtml =
    hardSoft.hard && Object.keys(hardSoft.hard).length
      ? categoryListHtml(hardSoft.hard)
      : `<li class="muted">No hard-skill categories scored.</li>`;
  const softCatsHtml =
    hardSoft.soft && Object.keys(hardSoft.soft).length
      ? categoryListHtml(hardSoft.soft)
      : `<li class="muted">No soft-skill categories scored.</li>`;

  const feedbackHtml = feedbackParas.map((p) => `<p>${escapeHtml(p)}</p>`).join("");
  const improveBullets = buildDashboardImprovementBullets(scores, overall);
  const improveNextHtml =
    improveBullets.length === 0
      ? ""
      : `<h2 class="results-doc__block-title">What to improve next</h2>
      <div class="results-improve-wrap">
        <ul class="results-improve-list">
          ${improveBullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}
        </ul>
      </div>`;
  const itemOutcomesHtml = buildAnonymousItemOutcomesSectionHtml(subjectId, trackKey);
  const majorDisplay =
    subjectUser.major && String(subjectUser.major).trim() && subjectUser.major !== "-"
      ? String(subjectUser.major)
      : "—";
  const identityHtml = `
      <dl class="results-doc__identity">
        <div><dt>Email</dt><dd>${escapeHtml(String(subjectUser.email || "").trim() || "—")}</dd></div>
        <div><dt>Program</dt><dd>${escapeHtml(String(subjectUser.course || "—"))}</dd></div>
        <div><dt>Major</dt><dd>${escapeHtml(majorDisplay)}</dd></div>
        <div><dt>Batch</dt><dd>${escapeHtml(String(subjectUser.batch))}</dd></div>
      </dl>`;

  return `
    <article class="results-doc">
      <p class="results-doc__eyebrow">Skill assessment summary</p>
      <h1 class="results-doc__title">${escapeHtml(subjectUser.name)}</h1>
      <p class="results-doc__meta">ALSKILL · Official 50-item skills self-assessment · Rubric: Always (4), Sometimes (3), Maybe (2), Never (1) · Category means as <strong>mean / 4.00</strong>${trackKey ? ` · Track: <strong>${escapeHtml(trackKey)}</strong>` : ""}</p>
      ${identityHtml}
      <p class="results-rubric-legend muted">Category <strong>Mastered</strong> when mean ≥ ${masteryT.toFixed(2)}; otherwise <strong>Developing</strong>. Brain dashboard labels use the same threshold.</p>
      <div class="results-doc__grid">
        <div class="results-stat">
          <p class="results-stat__label">Rating</p>
          <p class="results-stat__value">${escapeHtml(tier.label)}</p>
          <p class="results-stat__hint">${escapeHtml(tier.blurb)}</p>
        </div>
        <div class="results-stat">
          <p class="results-stat__label">Overall mean</p>
          <p class="results-stat__value">${formatRubricOverFour(overall)}</p>
          <p class="results-stat__hint">Mean of all category means</p>
        </div>
        <div class="results-stat">
          <p class="results-stat__label">Hard skills mean</p>
          <p class="results-stat__value">${hardMeanDisp}</p>
          <p class="results-stat__hint">Program + research categories</p>
        </div>
        <div class="results-stat">
          <p class="results-stat__label">Soft skills mean</p>
          <p class="results-stat__value">${softMeanDisp}</p>
          <p class="results-stat__hint">Six shared soft-skill themes</p>
        </div>
        <div class="results-stat">
          <p class="results-stat__label">Proficiency band</p>
          <p class="results-stat__value">${escapeHtml(level)}</p>
          <p class="results-stat__hint">Institutional label</p>
        </div>
      </div>
      <h2 class="results-doc__block-title">Comments and improvement focus</h2>
      <div class="results-feedback">${feedbackHtml}</div>
      ${improveNextHtml}
      <h2 class="results-doc__block-title">Hard skill categories</h2>
      <ul class="results-categories results-categories--split">${hardCatsHtml}</ul>
      <h2 class="results-doc__block-title">Soft skill categories</h2>
      <ul class="results-categories results-categories--split">${softCatsHtml}</ul>
      ${itemOutcomesHtml}
      <footer class="results-doc__footer">ALSKILL · ${escapeHtml(
        new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
      )} · Official self-assessment benchmark (one attempt per alumni).</footer>
    </article>`;
}

const INLINE_PRINT_HOST_ID = "alskill-inline-print-host";

function runInlinePrintFromResultsHtml(articleHtml) {
  if (PAGE !== "home") return;
  let host = document.getElementById(INLINE_PRINT_HOST_ID);
  if (!host) {
    host = document.createElement("div");
    host.id = INLINE_PRINT_HOST_ID;
    document.body.appendChild(host);
  }
  host.innerHTML = `<div class="results-print-root results-print-root--inline">${articleHtml}</div>`;
  host.classList.add("is-active");
  document.body.classList.add("alskill-printing-results");
  let finished = false;
  let failSafeId = null;
  const cleanup = () => {
    if (finished) return;
    finished = true;
    if (failSafeId != null) {
      window.clearTimeout(failSafeId);
      failSafeId = null;
    }
    document.body.classList.remove("alskill-printing-results");
    host.classList.remove("is-active");
    host.innerHTML = "";
  };
  failSafeId = window.setTimeout(cleanup, 12000);
  window.addEventListener("afterprint", cleanup, { once: true });
  window.requestAnimationFrame(() => {
    try {
      window.print();
    } catch (e) {
      cleanup();
    }
  });
}

async function openAlumniPrintableResultsPage() {
  if (!state.currentUser || normalizeRole(state.currentUser.role) !== "Alumni") {
    showHomeToast("Sign in as an alumni user to open your summary.", "error");
    return;
  }
  const uid = state.currentUser.user_id;
  if (!hasOfficialAttemptDone(uid)) {
    showHomeToast("Printable results unlock after you finish your official assessment.", "error");
    return;
  }
  if (!hasViewedResultsWizard(uid)) {
    showHomeToast("Open your results in Test your skill (step 3), review your scores, then use Print official summary.", "error");
    return;
  }
  try {
    if (USE_REMOTE_API) {
      await fetchAndMergeUserAssessmentData(uid);
    }
    hydrateScoresFromStoredResults(uid);
  } catch {
    hydrateScoresFromStoredResults(uid);
  }
  if (!state.lastComputedScores || Object.keys(state.lastComputedScores).length === 0) {
    showHomeToast("No scored results to print yet. Try again in a moment.", "error");
    return;
  }
  const fromList = state.users.find((u) => String(u.user_id) === String(uid));
  const subjectUser = fromList ? Object.assign({}, fromList, state.currentUser) : state.currentUser;
  const html = buildAssessmentResultsArticleHtml(
    subjectUser,
    uid,
    state.lastComputedScores,
    state.lastComputedOverall
  );
  runInlinePrintFromResultsHtml(html);
}

function adminDashboardHrefFromResults() {
  const base = resolveSiblingPageHref("admin-dashboard.html");
  if (window.location.protocol === "file:" && state.currentUser) {
    return base + userToHashFragment(state.currentUser);
  }
  return base;
}

function homeWorkspaceHrefFromResults() {
  const base = resolveSiblingPageHref("home.html");
  if (window.location.protocol === "file:" && state.currentUser) {
    return base + userToHashFragment(state.currentUser);
  }
  return base;
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
      ? "Your official run is locked in. Review results below, or revisit the same statements on your own to track growth."
      : "Select your program, complete the skills self-assessment (Always / Sometimes / Maybe / Never), then review your hard and soft skill profile.";
  }

  const dashLede = document.getElementById("dashboardLede");
  if (dashLede) {
    dashLede.textContent = locked
      ? "Your rank and mastery track your official assessment. Retakes are disabled so cohort scores stay comparable."
      : "Your skill rank and mastery meter update after your one official attempt in Test your skill.";
  }

  const navSkillMeta = document.querySelector('.nav-btn[data-section="skillTestSection"] .nav-btn-meta');
  if (navSkillMeta) navSkillMeta.textContent = locked ? "Results saved" : "One official attempt";

  updateWizardPrintSummaryVisibility();
}

function bindAssessmentLockActions() {
  const btn = document.getElementById("lockedViewResultsBtn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const uid = state.currentUser && state.currentUser.user_id;
    if (!uid) return;
    void (async () => {
      await openSkillResultsIfLocked();
      if (!state.lastComputedScores || Object.keys(state.lastComputedScores).length === 0) {
        showHomeToast("No scored results found yet.", "error");
        return;
      }
      document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
      const skillNav = document.querySelector('.nav-btn[data-section="skillTestSection"]');
      if (skillNav) skillNav.classList.add("active");
      showSection("skillTestSection");
      closeMobileSidebar();
    })();
  });
}

async function openSkillResultsIfLocked() {
  if (!state.currentUser || !hasOfficialAttemptDone(state.currentUser.user_id)) return;
  const uid = state.currentUser.user_id;
  if (USE_REMOTE_API) {
    await fetchAndMergeUserAssessmentData(uid);
  }
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
  if (typeof alsRecommend === "function" && state.currentTrackKey) {
    applyRecommendationFromScores(state.lastComputedScores, state.currentTrackKey);
  }
  if (PAGE === "home") renderAlumniKpis();
}

const DEMO_DB = {
  users: [
    { user_id: "A001", name: "Liam Ortega", email: "liam@nbsc.edu", password: "alumni123", course: "BSIT", major: "-", batch: 2023, role: "Alumni" },
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

function stripSensitiveUser(user) {
  if (!user || typeof user !== "object") return user;
  const o = Object.assign({}, user);
  delete o.password;
  return o;
}

function buildSessionEnvelope(user, sessionToken, sessionMaxAgeSec) {
  const now = Date.now();
  const hasRemote = !!(sessionToken && USE_REMOTE_API);
  const serverCap = hasRemote
    ? Math.min((Number(sessionMaxAgeSec) || 21600) * 1000, REMOTE_SESSION_MAX_MS)
    : SESSION_CLIENT_MAX_MS;
  return {
    v: 1,
    user: stripSensitiveUser(applyUserFromAuth(user)),
    sessionToken: hasRemote ? String(sessionToken) : null,
    createdAt: now,
    lastActivityAt: now,
    clientExpiresAt: now + Math.min(serverCap, SESSION_CLIENT_MAX_MS)
  };
}

function persistSessionEnvelope(envelope) {
  try {
    sessionStorage.setItem(ALSKILL_SESSION_KEY, JSON.stringify(envelope));
    sessionStorage.removeItem(ALSKILL_USER_KEY);
  } catch (e) {
    /* ignore quota / private mode */
  }
}

function readSessionEnvelopeFromStorage() {
  try {
    const raw = sessionStorage.getItem(ALSKILL_SESSION_KEY);
    if (raw) {
      const env = JSON.parse(raw);
      if (env && env.user && env.user.user_id) return env;
    }
    const legacy = sessionStorage.getItem(ALSKILL_USER_KEY);
    if (legacy) {
      const user = applyUserFromAuth(JSON.parse(legacy));
      if (user && user.user_id) {
        const env = buildSessionEnvelope(user, null, null);
        persistSessionEnvelope(env);
        return env;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

function clearAllSessionStorage() {
  try {
    sessionStorage.removeItem(ALSKILL_SESSION_KEY);
    sessionStorage.removeItem(ALSKILL_USER_KEY);
  } catch (e) {
    /* ignore */
  }
}

let _sessionTouchTimer = 0;
function touchSessionActivityThrottled() {
  const now = Date.now();
  if (now - _sessionTouchTimer < 45000) return;
  _sessionTouchTimer = now;
  const env = readSessionEnvelopeFromStorage();
  if (!env || !env.user) return;
  env.lastActivityAt = now;
  try {
    sessionStorage.setItem(ALSKILL_SESSION_KEY, JSON.stringify(env));
  } catch (e) {
    /* ignore */
  }
}

/**
 * Validates stored session (idle, expiry, optional remote token) before protected pages run.
 * @param {string|null} expectedRole "Alumni" | "Admin" | null (any signed-in user)
 */
async function reconcileSessionAtStartup(expectedRole) {
  const fromHashUser = tryConsumeUserFromHash();
  if (fromHashUser) {
    let u = applyUserFromAuth(fromHashUser);
    if (expectedRole != null && normalizeRole(u.role) !== normalizeRole(expectedRole)) {
      clearAllSessionStorage();
      return { ok: false, reason: "role" };
    }
    if (USE_REMOTE_API) {
      const envAfter = readSessionEnvelopeFromStorage();
      if (envAfter && envAfter.sessionToken) {
        try {
          const res = await apiGet("validateSession", { session_token: envAfter.sessionToken });
          if (!res || res.success === false || !res.user) {
            clearAllSessionStorage();
            return { ok: false, reason: "remote" };
          }
          u = stripSensitiveUser(applyUserFromAuth(res.user));
          envAfter.user = u;
          const capMs = Math.min((Number(res.sessionMaxAgeSec) || 21600) * 1000, REMOTE_SESSION_MAX_MS);
          envAfter.clientExpiresAt = Math.min(Date.now() + capMs, (envAfter.createdAt || Date.now()) + SESSION_CLIENT_MAX_MS);
          envAfter.lastActivityAt = Date.now();
          persistSessionEnvelope(envAfter);
        } catch {
          /* Offline / transient error: keep local session so reload does not brick the UI */
          envAfter.lastActivityAt = Date.now();
          persistSessionEnvelope(envAfter);
        }
      }
    }
    return { ok: true, user: u };
  }
  const env = readSessionEnvelopeFromStorage();
  if (!env || !env.user) {
    return { ok: false, reason: "missing" };
  }
  if (expectedRole != null && normalizeRole(env.user.role) !== normalizeRole(expectedRole)) {
    return { ok: false, reason: "role" };
  }
  if (Date.now() > env.clientExpiresAt) {
    clearAllSessionStorage();
    return { ok: false, reason: "expired" };
  }
  if (Date.now() - env.lastActivityAt > SESSION_IDLE_MS) {
    clearAllSessionStorage();
    return { ok: false, reason: "idle" };
  }
  if (USE_REMOTE_API && env.sessionToken) {
    try {
      const res = await apiGet("validateSession", { session_token: env.sessionToken });
      if (!res || res.success === false || !res.user) {
        clearAllSessionStorage();
        return { ok: false, reason: "remote" };
      }
      env.user = stripSensitiveUser(applyUserFromAuth(res.user));
      const capMs = Math.min((Number(res.sessionMaxAgeSec) || 21600) * 1000, REMOTE_SESSION_MAX_MS);
      env.clientExpiresAt = Math.min(Date.now() + capMs, (env.createdAt || Date.now()) + SESSION_CLIENT_MAX_MS);
    } catch {
      /* Keep cached profile when the network hiccups on reload */
    }
  }
  env.lastActivityAt = Date.now();
  persistSessionEnvelope(env);
  return { ok: true, user: applyUserFromAuth(env.user) };
}

const USER_HASH_PREFIX = "#alskill=";

/**
 * file:// pages are different opaque origins, so sessionStorage does not carry
 * between index.html and home.html. For file: we pass a one-time payload in the hash.
 * Payload may be a bare user object (legacy) or { user, sessionToken, sessionMaxAgeSec } for remote sessions.
 */
function userToHashFragment(user, sessionExtra) {
  const u = stripSensitiveUser(applyUserFromAuth(user));
  const payload =
    sessionExtra && (sessionExtra.sessionToken || sessionExtra.sessionMaxAgeSec)
      ? {
          user: u,
          sessionToken: sessionExtra.sessionToken || null,
          sessionMaxAgeSec: sessionExtra.sessionMaxAgeSec || 21600
        }
      : u;
  const json = JSON.stringify(payload);
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return USER_HASH_PREFIX + encodeURIComponent(b64);
}

function tryConsumeUserFromHash() {
  const h = window.location.hash || "";
  if (!h.startsWith(USER_HASH_PREFIX)) return null;
  try {
    const b64 = decodeURIComponent(h.slice(USER_HASH_PREFIX.length));
    const json = decodeURIComponent(escape(atob(b64)));
    const parsed = JSON.parse(json);
    let user;
    let sessionToken = null;
    let sessionMaxAgeSec = null;
    if (parsed && parsed.user && typeof parsed.user === "object" && parsed.user.user_id) {
      user = applyUserFromAuth(parsed.user);
      sessionToken = parsed.sessionToken || null;
      sessionMaxAgeSec = parsed.sessionMaxAgeSec != null ? Number(parsed.sessionMaxAgeSec) : null;
    } else if (parsed && parsed.user_id) {
      user = applyUserFromAuth(parsed);
    } else {
      return null;
    }
    persistSessionEnvelope(buildSessionEnvelope(user, sessionToken, sessionMaxAgeSec));
    history.replaceState(null, "", window.location.href.split("#")[0]);
    return user;
  } catch {
    return null;
  }
}

function saveUserToSession(user) {
  persistSessionEnvelope(buildSessionEnvelope(user, null, null));
}

function redirectAfterLogin(sessionExtra) {
  const user = state.currentUser;
  if (!user) return;
  const page = normalizeRole(user.role) === "Admin" ? "admin-dashboard.html" : "home.html";
  const targetUrl = new URL(page, window.location.href).href.split("#")[0];
  if (window.location.protocol === "file:") {
    window.location.href = targetUrl + userToHashFragment(user, sessionExtra);
    return;
  }
  persistSessionEnvelope(
    buildSessionEnvelope(
      user,
      sessionExtra && sessionExtra.sessionToken,
      sessionExtra && sessionExtra.sessionMaxAgeSec
    )
  );
  window.location.href = resolveSiblingPageHref(page);
}

function bindLogout() {
  const btn = document.getElementById("topLogoutBtn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    void (async () => {
      const env = readSessionEnvelopeFromStorage();
      if (USE_REMOTE_API && env && env.sessionToken) {
        try {
          await apiPost("logoutSession", { session_token: env.sessionToken });
        } catch {
          /* still clear client */
        }
      }
      clearAllSessionStorage();
      state.currentUser = null;
      window.location.href = resolveSiblingPageHref("index.html") + "?logout=1";
    })();
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
  const params = new URLSearchParams(window.location.search);
  const loginStatus = document.getElementById("loginStatus");
  if (loginStatus && params.get("expired") === "1") {
    loginStatus.textContent = "Your session expired or was signed out elsewhere. Please sign in again.";
  } else if (loginStatus && params.get("logout") === "1") {
    loginStatus.textContent = "You have been signed out.";
  }
}

function setHomeWorkspaceLoading(visible) {
  if (PAGE !== "home") return;
  const el = document.getElementById("workspaceLoadingOverlay");
  if (!el) return;
  const on = !!visible;
  el.classList.toggle("workspace-loading-overlay--visible", on);
  el.setAttribute("aria-busy", on ? "true" : "false");
  el.setAttribute("aria-hidden", on ? "false" : "true");
}

async function initHomePage() {
  setHomeWorkspaceLoading(true);
  const session = await reconcileSessionAtStartup("Alumni");
  if (!session.ok) {
    setHomeWorkspaceLoading(false);
    const q =
      session.reason === "expired" || session.reason === "idle" || session.reason === "remote"
        ? "?expired=1"
        : "";
    window.location.href = resolveSiblingPageHref("index.html") + q;
    return;
  }
  state.currentUser = session.user;
  state.users = [...DEMO_DB.users];
  state.questions = [...DEMO_DB.questions];
  state.responses = [...DEMO_DB.responses];
  state.results = [...DEMO_DB.results];
  try {
    try {
      await warmupRemote();
      if (USE_REMOTE_API && state.currentUser) {
        try {
          await fetchAndMergeUserAssessmentData(state.currentUser.user_id);
        } catch {
          /* network or parse error; dashboard still uses local demo slice */
        }
      }
      hydrateScoresFromStoredResults(state.currentUser.user_id);
      renderProfile();
      renderAlumniKpis();
    } catch (err) {
      /* eslint-disable no-console */
      console.error("ALSKILL: home data/render error", err);
      /* eslint-enable no-console */
      try {
        showHomeToast("Some data could not be refreshed. Navigation still works — try again in a moment.", "error");
      } catch {
        /* ignore */
      }
    }
    bindNavigation();
    bindAlumniActions();
    bindHomeWizard();
    bindAdminActions();
    bindShellInteractions();
    bindLogout();
    populateAssessmentPrograms();
    syncAssessmentSelectorsFromProfile();
    bindAssessmentLockActions();
    applyAssessmentLockUI();
    updateWizardPrintSummaryVisibility();
    showSection("alumniSection");
    setActiveNav("alumniSection");
    bindSkillSectionChrome();
    updateSessionUI();
  } finally {
    setHomeWorkspaceLoading(false);
  }
}

async function initAdminPage() {
  const session = await reconcileSessionAtStartup("Admin");
  if (!session.ok) {
    const q =
      session.reason === "expired" || session.reason === "idle" || session.reason === "remote"
        ? "?expired=1"
        : "";
    window.location.href = resolveSiblingPageHref("index.html") + q;
    return;
  }
  state.currentUser = session.user;
  state.users = [...DEMO_DB.users];
  state.questions = [...DEMO_DB.questions];
  state.responses = [...DEMO_DB.responses];
  state.results = [...DEMO_DB.results];
  try {
    await warmupRemote({ adminAnalytics: true });
    if (USE_REMOTE_API) await refreshAdminAnalytics();
    else renderAdminDashboard();
  } catch (err) {
    /* eslint-disable no-console */
    console.error("ALSKILL: admin dashboard error", err);
    /* eslint-enable no-console */
    renderAdminDashboard();
  }
  bindAdminActions();
  bindShellInteractions();
  bindLogout();
  updateSessionUI();
}

async function initResultsPage() {
  const session = await reconcileSessionAtStartup(null);
  if (!session.ok) {
    window.location.href =
      resolveSiblingPageHref("index.html") +
      (session.reason === "expired" || session.reason === "idle" || session.reason === "remote"
        ? "?expired=1"
        : "");
    return;
  }
  const me = session.user;
  state.currentUser = me;
  state.users = [...DEMO_DB.users];
  state.questions = [...DEMO_DB.questions];
  state.responses = [...DEMO_DB.responses];
  state.results = [...DEMO_DB.results];
  try {
    await warmupRemote();
  } catch (err) {
    /* eslint-disable no-console */
    console.error("ALSKILL: results warmup error", err);
    /* eslint-enable no-console */
  }
  bindShellInteractions();
  bindLogout();
  bindResultsPageChrome();

  const role = normalizeRole(me.role);
  const params = new URLSearchParams(window.location.search);
  const queryUser = params.get("user");
  let subjectId = null;
  if (role === "Admin") {
    subjectId = queryUser ? String(queryUser).trim() : null;
  } else {
    subjectId = me.user_id;
    if (queryUser && String(queryUser).trim() !== me.user_id) {
      document.getElementById("resultsRoot").innerHTML = `
        <article class="results-doc">
          <p class="muted">You can only view your own assessment results.</p>
          <p><a class="results-back-link" href="${escapeHtml(homeWorkspaceHrefFromResults())}">Return to workspace</a></p>
        </article>`;
      const back = document.getElementById("resultsBackLink");
      if (back) {
        back.href = homeWorkspaceHrefFromResults();
        back.textContent = "← Workspace";
      }
      const lab = document.getElementById("resultsSessionLabel");
      if (lab) lab.textContent = `${me.name} (${me.role})`;
      return;
    }
  }

  if (!subjectId) {
    document.getElementById("resultsRoot").innerHTML = `
      <article class="results-doc">
        <p class="results-doc__eyebrow">Evaluator</p>
        <h1 class="results-doc__title">View results</h1>
        <p class="results-doc__meta">Open a printable record from the alumni performance index using <strong>View results</strong> on a row, or add <code>?user=</code> and a user id to the URL.</p>
        <p><a class="results-back-link" href="${escapeHtml(adminDashboardHrefFromResults())}">← Admin console</a></p>
      </article>`;
    const back = document.getElementById("resultsBackLink");
    if (back) {
      back.href = adminDashboardHrefFromResults();
      back.textContent = "← Admin console";
    }
    const lab = document.getElementById("resultsSessionLabel");
    if (lab) lab.textContent = `${me.name} (${me.role})`;
    return;
  }

  const subjectUser = state.users.find((u) => u.user_id === subjectId);
  if (!subjectUser || normalizeRole(subjectUser.role) !== "Alumni") {
    document.getElementById("resultsRoot").innerHTML = `
      <article class="results-doc">
        <p class="muted">No alumni record found for this identifier.</p>
        <p><a class="results-back-link" href="${escapeHtml(role === "Admin" ? adminDashboardHrefFromResults() : homeWorkspaceHrefFromResults())}">Go back</a></p>
      </article>`;
    const back = document.getElementById("resultsBackLink");
    if (back) {
      back.href = role === "Admin" ? adminDashboardHrefFromResults() : homeWorkspaceHrefFromResults();
      back.textContent = role === "Admin" ? "← Admin console" : "← Workspace";
    }
    const lab = document.getElementById("resultsSessionLabel");
    if (lab) lab.textContent = `${me.name} (${me.role})`;
    return;
  }

  if (USE_REMOTE_API) {
    try {
      await fetchAndMergeUserAssessmentData(subjectId);
    } catch {
      /* network or parse error; fall back to local state */
    }
  }
  hydrateScoresFromStoredResults(subjectId);
  if (role === "Alumni" && subjectId === me.user_id && !hasOfficialAttemptDone(subjectId)) {
    document.getElementById("resultsRoot").innerHTML = `
      <article class="results-doc">
        <p class="results-doc__eyebrow">Printable record</p>
        <h1 class="results-doc__title">Not available yet</h1>
        <p class="muted">Official printable results open after you complete the skills self-assessment in <strong>Test your skill</strong>.</p>
        <p><a class="results-back-link" href="${escapeHtml(homeWorkspaceHrefFromResults())}">Return to workspace</a></p>
      </article>`;
    const back = document.getElementById("resultsBackLink");
    if (back) {
      back.href = homeWorkspaceHrefFromResults();
      back.textContent = "← Workspace";
    }
    const lab = document.getElementById("resultsSessionLabel");
    if (lab) lab.textContent = `${me.name} (${me.role})`;
    return;
  }
  const scores = state.lastComputedScores;
  const overall = state.lastComputedOverall;

  if (!scores || Object.keys(scores).length === 0) {
    document.getElementById("resultsRoot").innerHTML = `
      <article class="results-doc">
        <p class="muted">No scored assessment results are on file for <strong>${escapeHtml(subjectUser.name)}</strong>.</p>
        <p><a class="results-back-link" href="${escapeHtml(role === "Admin" ? adminDashboardHrefFromResults() : homeWorkspaceHrefFromResults())}">Go back</a></p>
      </article>`;
    const back = document.getElementById("resultsBackLink");
    if (back) {
      back.href = role === "Admin" ? adminDashboardHrefFromResults() : homeWorkspaceHrefFromResults();
      back.textContent = role === "Admin" ? "← Admin console" : "← Workspace";
    }
    const lab = document.getElementById("resultsSessionLabel");
    if (lab) lab.textContent = `${me.name} (${me.role})`;
    return;
  }

  document.getElementById("resultsRoot").innerHTML = buildAssessmentResultsArticleHtml(
    subjectUser,
    subjectId,
    scores,
    overall
  );

  const back = document.getElementById("resultsBackLink");
  if (back) {
    back.href = role === "Admin" ? adminDashboardHrefFromResults() : homeWorkspaceHrefFromResults();
    back.textContent = role === "Admin" ? "← Admin console" : "← Workspace";
  }
  const lab = document.getElementById("resultsSessionLabel");
  if (lab) lab.textContent = `${me.name} (${me.role})`;
}

function bindResultsPageChrome() {
  const printBtn = document.getElementById("resultsPrintBtn");
  if (printBtn) {
    printBtn.addEventListener("click", () => window.print());
  }
  const back = document.getElementById("resultsBackLink");
  if (back) {
    back.href = resolveSiblingPageHref("home.html");
  }
}

function bootstrap() {
  window.addEventListener("pageshow", (ev) => {
    if (!ev.persisted) return;
    if (PAGE === "home") {
      void (async () => {
        const s = await reconcileSessionAtStartup("Alumni");
        if (!s.ok) window.location.href = resolveSiblingPageHref("index.html") + "?expired=1";
        else state.currentUser = s.user;
      })();
    } else if (PAGE === "admin") {
      void (async () => {
        const s = await reconcileSessionAtStartup("Admin");
        if (!s.ok) window.location.href = resolveSiblingPageHref("index.html") + "?expired=1";
        else state.currentUser = s.user;
      })();
    }
  });

  if (PAGE === "home") {
    initHomePage();
    return;
  }
  if (PAGE === "admin") {
    initAdminPage();
    return;
  }
  if (PAGE === "results") {
    initResultsPage();
    return;
  }
  initAuthPage();
}

async function warmupRemote(options) {
  if (!USE_REMOTE_API) return;
  const opts = options && typeof options === "object" ? options : {};
  const runAdminAnalytics = opts.adminAnalytics === true;

  try {
    await apiGet("initializeDatabase");
  } catch {
    USE_REMOTE_API = false;
    return;
  }

  if (runAdminAnalytics && document.getElementById("adminKpi")) {
    try {
      await refreshAdminAnalytics();
    } catch {
      /* admin charts optional; do not disable API for alumni */
    }
  }
}

/**
 * Replaces this user's rows in state.results / state.responses with data from the spreadsheet (remote API).
 * Call after submit and on alumni home load so dashboards and locks reflect persisted data.
 */
async function fetchAndMergeUserAssessmentData(userId) {
  if (!USE_REMOTE_API || !userId) return false;
  try {
    const res = await apiGet("fetchUserAssessmentData", { user_id: userId });
    if (!res || !res.success) return false;
    const uid = String(userId);
    state.results = state.results.filter((r) => String(r.user_id) !== uid);
    state.responses = state.responses.filter((r) => String(r.user_id) !== uid);
    if (Array.isArray(res.results)) {
      res.results.forEach((row) => {
        state.results.push({
          id: row.id != null ? String(row.id) : "RES" + Math.random().toString(36).slice(2, 9),
          user_id: row.user_id != null ? String(row.user_id) : uid,
          category: String(row.category != null ? row.category : ""),
          score: Number(row.score),
          date: row.date != null ? String(row.date) : new Date().toISOString()
        });
      });
    }
    if (Array.isArray(res.responses)) {
      res.responses.forEach((row) => {
        state.responses.push({
          id: row.id != null ? String(row.id) : "R" + Math.random().toString(36).slice(2, 9),
          user_id: row.user_id != null ? String(row.user_id) : uid,
          question_id: String(row.question_id != null ? row.question_id : ""),
          answer: String(row.answer != null ? row.answer : ""),
          score: Number(row.score),
          category: row.category != null ? String(row.category) : ""
        });
      });
    }
    return true;
  } catch {
    return false;
  }
}

function bindNavigation() {
  if (PAGE !== "home") return;
  if (document.body.dataset.alskillHomeNavBound === "1") return;
  document.body.dataset.alskillHomeNavBound = "1";
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!canAccessSection(btn.dataset.section)) {
        window.location.href = resolveSiblingPageHref("index.html");
        return;
      }
      document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      showSection(btn.dataset.section);
      if (PAGE === "home" && btn.dataset.section === "alumniSection" && state.currentUser) {
        if (normalizeRole(state.currentUser.role) === "Alumni") {
          hydrateScoresFromStoredResults(state.currentUser.user_id);
          renderAlumniKpis();
        }
      }
      if (PAGE === "home" && btn.dataset.section === "skillTestSection") {
        if (state.currentUser && hasOfficialAttemptDone(state.currentUser.user_id)) {
          void openSkillResultsIfLocked();
        } else {
          setHomeWizardStep(1);
        }
      }
      touchSessionActivityThrottled();
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
      if (state.currentUser && normalizeRole(state.currentUser.role) === "Alumni") {
        hydrateScoresFromStoredResults(state.currentUser.user_id);
        renderAlumniKpis();
      }
      touchSessionActivityThrottled();
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
  if (document.body.dataset.alskillShellUiBound === "1") return;
  document.body.dataset.alskillShellUiBound = "1";
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
          redirectAfterLogin({
            sessionToken: res.sessionToken,
            sessionMaxAgeSec: res.sessionMaxAgeSec || 21600
          });
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
  if (state.currentUser && normalizeRole(state.currentUser.role) === "Alumni") {
    const uid = state.currentUser.user_id;
    if (n === 3) {
      markResultsWizardViewed(uid);
    } else {
      try {
        window.sessionStorage.removeItem(RESULTS_WIZARD_VIEWED_PREFIX + uid);
      } catch (e) {
        /* ignore */
      }
    }
    updateWizardPrintSummaryVisibility();
  }
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
    BSCT: "BSIT",
    "BS Computer Technology": "BSIT",
    "Bachelor of Science in Computer Technology": "BSIT",
    "Bachelor of Science in Information Technology": "BSIT",
    "BSBA - Marketing": "BSBA"
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
  const tk = trackKey || state.currentTrackKey || "BSIT";
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
    setAssessmentSubmitting(true);
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
          await fetchAndMergeUserAssessmentData(state.currentUser.user_id);
          hydrateScoresFromStoredResults(state.currentUser.user_id);
          renderScoreCards(state.lastComputedScores);
          applyRecommendationFromScores(state.lastComputedScores, state.currentTrackKey);
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
      } finally {
        setAssessmentSubmitting(false);
      }
    })();
  });

  const printableResultsBtn = document.getElementById("openPrintableResultsBtn");
  if (printableResultsBtn) {
    printableResultsBtn.addEventListener("click", () => {
      void openAlumniPrintableResultsPage();
    });
  }
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
    hint.textContent = `${questions.length} self-assessment items loaded (50 expected). Use Always, Sometimes, Maybe, or Never for each statement.`;
  }
  if (continueBtn) continueBtn.disabled = false;
  form.innerHTML = questions
    .map((q, idx) => {
      const opts = q.choices
        .map(
          (ch) => `
        <label class="option-card option-card--likert">
          <input class="option-card__input" type="radio" name="${escapeHtml(q.id)}" value="${escapeHtml(ch.key)}" data-score="${ch.score}" required />
          <span class="option-card__body">
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
          ${
            q.skillType === "soft"
              ? '<span class="question-block__skill question-block__skill--soft">Soft skill</span>'
              : '<span class="question-block__skill question-block__skill--hard">Hard skill</span>'
          }
          <span class="question-block__cat">${catUpper}</span>
        </header>
        <p class="question-block__stem">${escapeHtml(q.question)}</p>
        <div class="question-block__options question-block__options--likert" role="radiogroup" aria-label="Question ${idx + 1}">${opts}</div>
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
    const coachCard = document.getElementById("skillWizardCoachCard");
    const coachList = document.getElementById("skillWizardCoachList");
    if (coachCard) coachCard.classList.add("hidden");
    if (coachList) coachList.innerHTML = "";
    return;
  }
  scoreCards.classList.remove("muted");
  const overall = Number(
    (entries.reduce((sum, [, v]) => sum + Number(v), 0) / entries.length).toFixed(2)
  );
  state.lastComputedOverall = overall;
  const banner = `<div class="overall-score-banner"><strong>Overall mean</strong> (1–4 rubric): ${formatRubricOverFour(overall)}</div>`;
  scoreCards.innerHTML =
    banner +
    entries
      .map(([category, score]) => {
        const num = Number(score);
        const level = num >= 3.25 ? "Strong band" : "Development band";
        return `
        <div class="score-card">
          <p><strong>${escapeHtml(category)}</strong></p>
          <p>Category mean: ${formatRubricOverFour(num)}</p>
          <p>Band: ${level}</p>
        </div>
      `;
      })
      .join("");

  const coachList = document.getElementById("skillWizardCoachList");
  const coachCard = document.getElementById("skillWizardCoachCard");
  if (coachList && coachCard && PAGE === "home") {
    const bullets = buildDashboardImprovementBullets(scoreMap, overall);
    if (bullets.length) {
      coachList.innerHTML = bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("");
      coachCard.classList.remove("hidden");
    } else {
      coachList.innerHTML = "";
      coachCard.classList.add("hidden");
    }
  }
}

function drawAlumniCharts(scoreMap) {
  const entries = Object.entries(scoreMap);
  const canvasBar = document.getElementById("alumniBarChart");
  const canvasRadar = document.getElementById("alumniRadarChart");
  if (!canvasBar || !canvasRadar) return;
  if (entries.length === 0) return;
  const scaleMax = chartScaleMaxFromEntries(entries);
  const barSurf = setupAlumniChartSurface(canvasBar);
  if (barSurf.ctx) {
    drawBars(barSurf.ctx, canvasBar, entries, ["#1d4e89", "#2b6cb0", "#3b82c4", "#60a5fa", "#e3b341"], {
      scaleMax,
      layout: "alumni",
      logicalW: barSurf.lw,
      logicalH: barSurf.lh
    });
  }
  drawAlumniRadarChart(canvasRadar, entries, scaleMax);
}

function drawAlumniRadarChart(canvas, entries, scaleMax) {
  const surf = setupAlumniChartSurface(canvas);
  const ctx = surf.ctx;
  if (!ctx) return;
  const { lw, lh } = surf;
  const cx = lw / 2;
  const cy = lh / 2;
  if (entries.length < 2) {
    ctx.fillStyle = "#6b7280";
    ctx.font = "13px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Radar chart needs 2 or more categories.", cx, cy);
    ctx.textAlign = "left";
    return;
  }
  const sides = entries.length;
  const radius = Math.min(lw, lh) * 0.34;
  const layers = 4;
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 1;
  for (let layer = 1; layer <= layers; layer += 1) {
    const r = (radius * layer) / layers;
    ctx.beginPath();
    for (let i = 0; i < sides; i += 1) {
      const angle = (Math.PI * 2 * i) / sides - Math.PI / 2;
      const x = cx + r * Math.cos(angle);
      const y = cy + r * Math.sin(angle);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  }

  for (let i = 0; i < sides; i += 1) {
    const angle = (Math.PI * 2 * i) / sides - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + radius * Math.cos(angle), cy + radius * Math.sin(angle));
    ctx.strokeStyle = "#f1f5f9";
    ctx.stroke();
  }

  const sm = scaleMax > 0 ? scaleMax : 4;
  ctx.beginPath();
  entries.forEach(([_, value], i) => {
    const v = Math.min(Math.max(Number(value), 0), sm);
    const angle = (Math.PI * 2 * i) / sides - Math.PI / 2;
    const r = (radius * v) / sm;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fillStyle = "rgba(29, 78, 137, 0.18)";
  ctx.fill();
  ctx.strokeStyle = "#1d4e89";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = "#1d4e89";
  entries.forEach(([_, value], i) => {
    const v = Math.min(Math.max(Number(value), 0), sm);
    const angle = (Math.PI * 2 * i) / sides - Math.PI / 2;
    const r = (radius * v) / sm;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.fillStyle = "#374151";
  ctx.font = "11px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  entries.forEach(([label], i) => {
    const angle = (Math.PI * 2 * i) / sides - Math.PI / 2;
    const pad = sides > 8 ? 14 : 20;
    const lx = cx + (radius + pad) * Math.cos(angle);
    const ly = cy + (radius + pad) * Math.sin(angle);
    const raw = String(label);
    const short = raw.length > 18 ? `${raw.slice(0, 16)}…` : raw;
    ctx.fillText(short, lx, ly);
  });
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = "#9ca3af";
  ctx.font = "10px Inter, system-ui, sans-serif";
  const smLabel = Math.abs(sm - Math.round(sm)) < 0.06 ? String(Math.round(sm)) : sm.toFixed(2);
  ctx.fillText(`Scale 0–${smLabel} (category means)`, 10, lh - 8);
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
  const attemptLabel = attemptLocked ? "Assessment complete · locked" : "Ready · one official attempt";

  const program = state.currentUser.course && state.currentUser.course !== "-" ? state.currentUser.course : "—";
  let major = state.currentUser.major;
  if (!major || major === "-") major = "—";

  const scoreMapForCoach = {};
  Object.entries(byCat).forEach(([cat, scores]) => {
    scoreMapForCoach[cat] = Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2));
  });
  if (Object.keys(scoreMapForCoach).length === 0 && state.lastComputedScores && Object.keys(state.lastComputedScores).length > 0) {
    Object.assign(scoreMapForCoach, state.lastComputedScores);
  }
  const coachBullets = buildDashboardImprovementBullets(scoreMapForCoach, overallNum);
  const coachHtml =
    coachBullets.length === 0
      ? ""
      : `<article class="dashboard-coach-card" aria-labelledby="dash-coach-title">
          <h3 id="dash-coach-title" class="dashboard-coach-card__title">What to improve next</h3>
          <p class="dashboard-coach-card__lede">Auto-generated from your hard and soft skill means after your official run.</p>
          <ul class="dashboard-coach-list">
            ${coachBullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}
          </ul>
        </article>`;

  const hardSoft =
    typeof alsHardSoftMeans === "function"
      ? alsHardSoftMeans(scoreMapForCoach)
      : { hard: {}, soft: {}, hardMean: null, softMean: null };
  const hardMeanDisp = hardSoft.hardMean != null ? formatRubricOverFour(hardSoft.hardMean) : "—";
  const softMeanDisp = hardSoft.softMean != null ? formatRubricOverFour(hardSoft.softMean) : "—";

  container.innerHTML = `
    <div class="brain-dashboard">
      <div class="brain-scene-host" id="brainSceneHost" aria-live="polite"></div>
      <div class="brain-dashboard__summary">
        <article class="brain-summary-card ${tier.cls}">
          <p class="brain-summary-card__label">Overall profile</p>
          <p class="brain-summary-card__rank">${escapeHtml(tier.label)}</p>
          <p class="brain-summary-card__meta"><strong>${formatRubricOverFour(overallNum)}</strong> combined mean · ${escapeHtml(attemptLabel)}</p>
          <p class="brain-summary-card__program">${escapeHtml(program)} · Major: ${escapeHtml(major)}</p>
        </article>
        <div class="brain-summary-stats">
          <article class="brain-mini-stat brain-mini-stat--hard">
            <p class="brain-mini-stat__label">Hard skill mean</p>
            <p class="brain-mini-stat__value">${hardMeanDisp}</p>
          </article>
          <article class="brain-mini-stat brain-mini-stat--soft">
            <p class="brain-mini-stat__label">Soft skill mean</p>
            <p class="brain-mini-stat__value">${softMeanDisp}</p>
          </article>
          <article class="brain-mini-stat">
            <p class="brain-mini-stat__label">Responses logged</p>
            <p class="brain-mini-stat__value">${myResponses.length}</p>
          </article>
        </div>
      </div>
      ${coachHtml}
    </div>
  `;

  let brainTrack = state.currentTrackKey || "";
  try {
    const storedTrack = window.sessionStorage.getItem(LAST_ASSESSMENT_TRACK_PREFIX + uid);
    if (storedTrack) brainTrack = storedTrack;
  } catch (e) {
    /* ignore */
  }
  if (!brainTrack && myResponses.length) {
    brainTrack = inferTrackKeyFromQuestionId(myResponses[0].question_id);
  }
  if (typeof initAlskillBrainDashboard === "function") {
    initAlskillBrainDashboard(document.getElementById("brainSceneHost"), scoreMapForCoach, brainTrack);
  }
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
      userId: user.user_id,
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
          <th>View results</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row, index) => `
          <tr>
            <td>${index + 1}</td>
            <td>${escapeHtml(row.alumni)}</td>
            <td>${escapeHtml(row.course)}</td>
            <td>${row.competencyScore}</td>
            <td>${escapeHtml(row.performanceLevel)}</td>
            <td>${
              row.userId
                ? `<a class="link-results" href="${escapeHtml(buildAssessmentResultsHref(row.userId))}">View results</a>`
                : "—"
            }</td>
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

function drawBars(ctx, canvas, entries, palette, options) {
  const opts = options && typeof options === "object" ? options : {};
  const layout = opts.layout || "admin";
  const logicalW = opts.logicalW != null ? opts.logicalW : canvas.width;
  const logicalH = opts.logicalH != null ? opts.logicalH : canvas.height;
  const scaleMax =
    opts.scaleMax != null && !Number.isNaN(Number(opts.scaleMax))
      ? Number(opts.scaleMax)
      : chartScaleMaxFromEntries(entries);

  if (entries.length === 0) {
    ctx.fillStyle = "#6b7280";
    ctx.font = "13px Inter, system-ui, sans-serif";
    ctx.fillText("No data available", 16, 32);
    return;
  }

  const left = 14;
  const bottom = layout === "alumni" ? 78 : 36;
  const top = 24;
  const width = logicalW;
  const height = logicalH;
  const baseY = height - bottom;
  const plotW = width - left - 14;
  const barAreaHeight = Math.max(48, baseY - top - 6);
  const n = entries.length;
  const gap = n > 10 ? 4 : n > 6 ? 6 : 8;
  const barWidth = Math.max(10, Math.floor((plotW - gap * Math.max(0, n - 1)) / Math.max(1, n)));

  state.charts.lastRects = [];

  entries.forEach(([label, value], index) => {
    const x = left + index * (barWidth + gap);
    const num = Number(value);
    const capped = Number.isFinite(num) ? Math.min(Math.max(num, 0), scaleMax) : 0;
    const h = scaleMax > 0 ? (capped / scaleMax) * barAreaHeight : 0;
    const y = baseY - h;
    ctx.fillStyle = palette[index % palette.length];
    ctx.fillRect(x, y, barWidth, Math.max(h, 1.5));

    ctx.fillStyle = "#111827";
    ctx.font = "12px Inter, system-ui, sans-serif";
    const valStr = Number.isFinite(num) ? num.toFixed(2) : String(value);
    ctx.textAlign = "center";
    ctx.fillText(valStr, x + barWidth / 2, Math.max(y - 10, 14));
    ctx.textAlign = "left";

    if (layout === "alumni") {
      ctx.save();
      ctx.translate(x + barWidth / 2, baseY + 8);
      ctx.rotate(-Math.PI / 3.1);
      ctx.textAlign = "right";
      ctx.fillStyle = "#4b5563";
      ctx.font = "11px Inter, system-ui, sans-serif";
      const lab = String(label).length > 40 ? `${String(label).slice(0, 38)}…` : String(label);
      ctx.fillText(lab, 0, 0);
      ctx.restore();
    } else {
      ctx.fillStyle = "#4b5563";
      ctx.font = "11px Inter, system-ui, sans-serif";
      ctx.fillText(String(label).slice(0, 16), x, baseY + 12);
    }
    state.charts.lastRects.push({ x, y, w: barWidth, h, label });
  });
}

function detectBarClick(event, chartType) {
  const canvas = event.target;
  const rect = canvas.getBoundingClientRect();
  const entries = chartType === "course" ? state.charts.courseEntries : state.charts.categoryEntries;
  if (!entries || entries.length === 0) return null;

  const scaleX = rect.width > 0 ? canvas.width / rect.width : 1;
  const scaleY = rect.height > 0 ? canvas.height / rect.height : 1;
  const x = (event.clientX - rect.left) * scaleX;
  const y = (event.clientY - rect.top) * scaleY;

  const logicalW = canvas.width;
  const logicalH = canvas.height;
  const scaleMax = chartScaleMaxFromEntries(entries);
  const left = 14;
  const bottom = 36;
  const top = 24;
  const baseY = logicalH - bottom;
  const plotW = logicalW - left - 14;
  const barAreaHeight = Math.max(48, baseY - top - 6);
  const n = entries.length;
  const gap = n > 10 ? 4 : n > 6 ? 6 : 8;
  const barWidth = Math.max(10, Math.floor((plotW - gap * Math.max(0, n - 1)) / Math.max(1, n)));

  for (let index = 0; index < entries.length; index += 1) {
    const [, value] = entries[index];
    const barX = left + index * (barWidth + gap);
    const num = Number(value);
    const capped = Number.isFinite(num) ? Math.min(Math.max(num, 0), scaleMax) : 0;
    const barHeight = scaleMax > 0 ? (capped / scaleMax) * barAreaHeight : 0;
    const barY = baseY - barHeight;
    const label = entries[index][0];
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
