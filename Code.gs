/**
 * ALSKILL - Alumni Skill Analytics System
 * Backend implementation using Google Apps Script + Google Sheets.
 */

var SHEET_NAMES = {
  USERS: "Users",
  QUESTIONS: "Questions",
  RESPONSES: "Responses",
  RESULTS: "Results"
};

/**
 * If the script is not container-bound to the Sheet, paste the Spreadsheet ID from the
 * URL: https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit
 * (Required for many web app deployments; leave "" when using Sheet → Extensions → Apps Script.)
 */
var SPREADSHEET_ID = "";

/**
 * Resolves the spreadsheet. Web app calls have no "active" sheet unless the script is bound
 * to the file, so we fall back to SPREADSHEET_ID or the script property SPREADSHEET_ID.
 */
function getSpreadsheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) return ss;
  var id = String(SPREADSHEET_ID || "").trim();
  if (!id) {
    id = String(PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID") || "").trim();
  }
  if (id) {
    return SpreadsheetApp.openById(id);
  }
  throw new Error(
    "No spreadsheet: open your Google Sheet → Extensions → Apps Script and use this project from that file, " +
      "or set var SPREADSHEET_ID in Code.gs to your Sheet ID (or set script property SPREADSHEET_ID)."
  );
}

/**
 * doGet
 * Purpose:
 * Provides a lightweight HTTP GET router for the ALSKILL web app endpoint.
 * Parameters:
 * e (Object) - Apps Script event parameter containing query string values.
 * Logic:
 * 1) Read e.parameter.action.
 * 2) Route to the corresponding function.
 * 3) Return JSON response via ContentService.
 * Output:
 * JSON text response.
 */
function doGet(e) {
  var params = (e && e.parameter) ? e.parameter : {};
  var action = String(params.action || "").trim();

  try {
    // UI is served as static files (index.html, home.html, admin-dashboard.html). This URL is the JSON API.
    if (!action) {
      return ContentService.createTextOutput(
        "ALSKILL API: pass ?action=initializeDatabase, fetchQuestions, getAdminAnalytics, or getDrillDownData. Open index.html from your host for the web UI."
      ).setMimeType(ContentService.MimeType.TEXT);
    }

    if (action === "initializeDatabase") return respondJson(initializeDatabase());
    if (action === "fetchQuestions") return respondJson(fetchQuestions(params.course));
    if (action === "getAdminAnalytics") return respondJson(getAdminAnalytics());
    if (action === "getDrillDownData") return respondJson(getDrillDownData(params.type, params.key));

    return respondJson({
      success: false,
      message: "Unsupported action for GET. Provide a valid action query parameter."
    });
  } catch (err) {
    return respondJson({ success: false, message: String(err && err.message ? err.message : err) });
  }
}

/**
 * doPost
 * Purpose:
 * Provides an HTTP POST router for actions that create or modify data.
 * Parameters:
 * e (Object) - Apps Script event parameter containing POST body and metadata.
 * Logic:
 * 1) Parse JSON body (expects { action: string, payload?: any }).
 * 2) Route to the corresponding function.
 * 3) Return JSON response via ContentService.
 * Output:
 * JSON text response.
 */
function doPost(e) {
  var raw = (e && e.postData && e.postData.contents) ? e.postData.contents : "";
  if (!raw || !String(raw).trim()) {
    return respondJson({ success: false, message: "Empty POST body. Send JSON: {\"action\":\"registerUser\",\"payload\":{...}}" });
  }
  var body;
  try {
    body = JSON.parse(raw);
  } catch (parseErr) {
    return respondJson({ success: false, message: "Invalid JSON body: " + String(parseErr && parseErr.message ? parseErr.message : parseErr) });
  }

  var action = String(body.action || "").trim();
  var payload = body.payload;

  try {
    if (action === "registerUser") return respondJson(registerUser(payload));
    if (action === "loginUser") {
      var cred =
        payload &&
        (payload.credential != null && String(payload.credential).trim() !== ""
          ? payload.credential
          : payload.email);
      return respondJson(loginUser(cred, payload && payload.password));
    }
    if (action === "submitResponses") return respondJson(submitResponses(payload && payload.user_id, payload && payload.responses));

    return respondJson({
      success: false,
      message: "Unsupported action for POST. Provide a valid action in the JSON body."
    });
  } catch (err) {
    return respondJson({ success: false, message: String(err && err.message ? err.message : err) });
  }
}

/**
 * respondJson
 * Purpose:
 * Returns JSON for the web app API (used by index.html via fetch from another origin).
 * Parameters:
 * obj (Object) - response object to serialize.
 * Logic:
 * 1) JSON.stringify the object.
 * 2) Return ContentService TextOutput with JSON MIME type.
 * Note:
 * Browsers calling this from static hosting should POST with Content-Type: text/plain
 * and a JSON body (see app.js apiPost) so a CORS preflight is not required.
 * Output:
 * ContentService.TextOutput
 */
function respondJson(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * normalizeRole_
 * Maps sheet role strings to canonical Admin / Alumni for the client.
 */
function normalizeRole_(role) {
  var s = String(role == null ? "" : role).trim().toLowerCase();
  if (s === "admin" || s === "administrator" || s === "sysadmin" || s === "system administrator" || s === "system admin") {
    return "Admin";
  }
  if (s === "super admin" || s === "superadmin") return "Admin";
  return "Alumni";
}

/**
 * submitAssessment
 * Purpose:
 * Simplified "store-only" endpoint. Saves an alumni profile snapshot and
 * raw questionnaire answers directly to Google Sheets.
 *
 * Parameters:
 * payload (Object)
 * - name (String)
 * - email (String)
 * - course (String)
 * - major (String)
 * - batch (Number)
 * - answers (Array<Object>): [{ question_id, question_text, category, answer, score }]
 *
 * Logic:
 * 1) Ensure database sheets exist.
 * 2) Upsert alumni in Users (by email).
 * 3) Append answer rows to Responses (with computed score).
 *
 * Output:
 * { success: boolean, message: string, user_id: string, saved_count: number }
 */
function submitAssessment(payload) {
  initializeDatabase();
  if (!payload || !payload.email || !payload.name || !payload.course || !payload.batch) {
    return { success: false, message: "Missing required profile fields." };
  }

  var ss = getSpreadsheet_();
  var usersSheet = ss.getSheetByName(SHEET_NAMES.USERS);
  var responsesSheet = ss.getSheetByName(SHEET_NAMES.RESPONSES);

  var email = String(payload.email).toLowerCase();
  var users = usersSheet.getDataRange().getValues();
  var userId = null;
  var userRowIndex = -1;

  for (var i = 1; i < users.length; i++) {
    if (String(users[i][2]).toLowerCase() === email) {
      userId = String(users[i][0]);
      userRowIndex = i + 1; // sheet is 1-indexed
      break;
    }
  }

  if (!userId) {
    userId = "A" + new Date().getTime().toString().slice(-6);
    usersSheet.appendRow([
      userId,
      payload.name,
      email,
      "", // password (unused in simple mode)
      payload.course,
      payload.major || "-",
      Number(payload.batch),
      "Alumni"
    ]);
  } else {
    // Update basic profile fields to keep the latest snapshot
    usersSheet.getRange(userRowIndex, 2, 1, 6).setValues([[
      payload.name,
      email,
      "", // password
      payload.course,
      payload.major || "-",
      Number(payload.batch)
    ]]);
  }

  var answers = payload.answers || [];
  if (!Array.isArray(answers)) answers = [];

  if (answers.length === 0) {
    return { success: true, message: "Profile saved. No answers provided.", user_id: userId, saved_count: 0 };
  }

  var rows = answers.map(function(a) {
    return [
      "R" + Utilities.getUuid().slice(0, 8),
      userId,
      a.question_id || "",
      a.answer || "",
      Number(a.score || 0)
    ];
  });

  responsesSheet.getRange(responsesSheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);

  return { success: true, message: "Assessment saved successfully.", user_id: userId, saved_count: rows.length };
}

/**
 * initializeDatabase
 * Purpose:
 * Creates required Google Sheets and header rows for ALSKILL.
 * Parameters:
 * None.
 * Logic:
 * 1) Open active spreadsheet.
 * 2) Ensure each required sheet exists.
 * 3) Write standardized header rows when empty.
 * 4) Seed default questionnaire entries if Questions is empty.
 * Output:
 * Object with success flag and details.
 */
function initializeDatabase() {
  var ss = getSpreadsheet_();
  var structures = [
    { name: SHEET_NAMES.USERS, headers: ["user_id", "name", "email", "password", "course", "major", "batch", "role"] },
    { name: SHEET_NAMES.QUESTIONS, headers: ["id", "course", "category", "question", "type"] },
    { name: SHEET_NAMES.RESPONSES, headers: ["id", "user_id", "question_id", "answer", "score", "category"] },
    { name: SHEET_NAMES.RESULTS, headers: ["id", "user_id", "category", "score", "date"] }
  ];

  structures.forEach(function(item) {
    var sheet = ss.getSheetByName(item.name) || ss.insertSheet(item.name);
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, item.headers.length).setValues([item.headers]);
    }
  });

  var responseSheet0 = ss.getSheetByName(SHEET_NAMES.RESPONSES);
  if (responseSheet0) {
    var lastCol = responseSheet0.getLastColumn();
    if (lastCol < 6) {
      responseSheet0.getRange(1, 6).setValue("category");
    } else {
      var headerRow = responseSheet0.getRange(1, 1, 1, lastCol).getValues()[0];
      var hasCategoryHeader = false;
      for (var hi = 0; hi < headerRow.length; hi++) {
        if (String(headerRow[hi]).toLowerCase() === "category") hasCategoryHeader = true;
      }
      if (!hasCategoryHeader) {
        responseSheet0.getRange(1, 6).setValue("category");
      }
    }
  }

  var usersSheet = ss.getSheetByName(SHEET_NAMES.USERS);
  if (usersSheet.getLastRow() === 1) {
    usersSheet.appendRow(["ADM1", "System Administrator", "admin@alskill.local", "admin123", "-", "-", 0, "Admin"]);
  }

  var questionsSheet = ss.getSheetByName(SHEET_NAMES.QUESTIONS);
  if (questionsSheet.getLastRow() === 1) {
    var seed = [
      ["Q1", "BSIT", "Technical Skills", "Rate your programming proficiency (1-5).", "scale"],
      ["Q2", "BSIT", "Professional Skills", "Rate your experience in system development (1-5).", "scale"],
      ["Q3", "BSIT", "Technical Skills", "Rate your knowledge in database management (1-5).", "scale"],
      ["Q4", "BSBA - Marketing", "Professional Skills", "Rate your ability to design marketing strategies (1-5).", "scale"],
      ["Q5", "BSBA - Marketing", "Technical Skills", "Rate your digital campaign management skills (1-5).", "scale"],
      ["Q6", "BSED", "Professional Skills", "Rate your lesson planning effectiveness (1-5).", "scale"],
      ["Q7", "BSED", "Soft Skills", "Rate your classroom management competency (1-5).", "scale"],
      ["Q8", "BSED", "Soft Skills", "Rate your communication clarity (1-5).", "scale"],
      ["Q9", "BEED", "Professional Skills", "Rate your lesson planning effectiveness (1-5).", "scale"],
      ["Q10", "BEED", "Soft Skills", "Rate your classroom management competency (1-5).", "scale"],
      ["Q11", "BEED", "Soft Skills", "Rate your communication clarity (1-5).", "scale"],
      ["Q12", "BECED", "Professional Skills", "Rate your lesson planning effectiveness (1-5).", "scale"],
      ["Q13", "BECED", "Soft Skills", "Rate your classroom management competency (1-5).", "scale"],
      ["Q14", "BECED", "Soft Skills", "Rate your communication clarity (1-5).", "scale"]
    ];
    questionsSheet.getRange(2, 1, seed.length, seed[0].length).setValues(seed);
  }

  return { success: true, message: "Database initialized successfully." };
}

/**
 * registerUser
 * Purpose:
 * Registers a new alumni account in the Users sheet.
 * Parameters:
 * payload (Object) - contains name, email, password, course, major, batch.
 * Logic:
 * 1) Validate mandatory fields.
 * 2) Check if email already exists.
 * 3) Create unique user ID and append user row with role Alumni.
 * Output:
 * Object with success flag, message, and created user metadata.
 */
function registerUser(payload) {
  if (!payload) {
    return { success: false, message: "Missing payload." };
  }
  initializeDatabase();
  var name = String(payload.name != null ? payload.name : "").trim();
  var email = String(payload.email != null ? payload.email : "")
    .trim()
    .toLowerCase();
  var password = payload.password != null ? String(payload.password) : "";
  var course = String(payload.course != null ? payload.course : "").trim();
  var major = payload.major != null && String(payload.major).trim() !== "" ? String(payload.major).trim() : "-";
  var batchNum = Number(payload.batch);

  if (!name || !email || !password || !course) {
    return { success: false, message: "Missing name, email, password, or course." };
  }
  if (!isFinite(batchNum)) {
    return { success: false, message: "Invalid or missing batch (use a year number, e.g. 2023)." };
  }

  var usersSheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.USERS);
  var data = usersSheet.getDataRange().getValues();

  for (var row = 1; row < data.length; row++) {
    if (String(data[row][2]).toLowerCase() === email) {
      return { success: false, message: "Email already registered." };
    }
  }

  var userId = "A" + new Date().getTime().toString().slice(-6);
  usersSheet.appendRow([userId, name, email, password, course, major, batchNum, "Alumni"]);

  return { success: true, message: "Registration successful.", user_id: userId };
}

/**
 * loginUser
 * Purpose:
 * Authenticates user credentials and returns role-specific profile details.
 * Parameters:
 * email (String) - account email.
 * password (String) - account password.
 * Logic:
 * 1) Retrieve Users sheet records.
 * 2) Match email/password.
 * 3) Return user profile when found.
 * Output:
 * Object with success flag, message, and user data.
 */
function loginUser(email, password) {
  initializeDatabase();
  var usersSheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.USERS);
  var data = usersSheet.getDataRange().getValues();
  var credential = String(email || "").toLowerCase();

  for (var row = 1; row < data.length; row++) {
    var rowEmail = String(data[row][2]).toLowerCase();
    var rowId = String(data[row][0]).toLowerCase();
    var rowPassword = String(data[row][3]);
    if ((rowEmail === credential || rowId === credential) && rowPassword === String(password)) {
      var b = data[row][6];
      var batchOut = b instanceof Date ? b.getFullYear() : Number(b);
      if (!isFinite(batchOut)) batchOut = b;
      return {
        success: true,
        message: "Login successful.",
        user: {
          user_id: data[row][0],
          name: data[row][1],
          email: data[row][2],
          course: data[row][4],
          major: data[row][5],
          batch: batchOut,
          role: normalizeRole_(data[row][7])
        }
      };
    }
  }
  return { success: false, message: "Invalid credentials." };
}

/**
 * fetchQuestions
 * Purpose:
 * Retrieves questionnaire items filtered by course.
 * Parameters:
 * course (String) - target course (e.g., BSIT).
 * Logic:
 * 1) Read Questions sheet.
 * 2) Filter rows where course matches requested course.
 * 3) Convert rows into structured objects.
 * Output:
 * Object containing success flag and question array.
 */
function fetchQuestions(course) {
  initializeDatabase();
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.QUESTIONS);
  var data = sheet.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][1]) === String(course)) {
      out.push({
        id: data[i][0],
        course: data[i][1],
        category: data[i][2],
        question: data[i][3],
        type: data[i][4]
      });
    }
  }
  return { success: true, questions: out };
}

/**
 * submitResponses
 * Purpose:
 * Stores submitted questionnaire responses and scores.
 * Parameters:
 * userId (String) - alumni user ID.
 * responses (Array<Object>) - each object has question_id, answer, score.
 * Logic:
 * 1) Validate payload.
 * 2) Append every response row into Responses sheet.
 * 3) Trigger computeSkillScores for current user.
 * Output:
 * Object with success flag and computed score details.
 */
function submitResponses(userId, responses) {
  initializeDatabase();
  if (!userId || !responses || !responses.length) {
    return { success: false, message: "Missing userId or responses." };
  }
  var sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES.RESPONSES);
  var rows = responses.map(function(item) {
    var cat = item.category != null ? String(item.category) : "";
    return [
      "R" + Utilities.getUuid().slice(0, 8),
      userId,
      item.question_id,
      item.answer,
      Number(item.score),
      cat
    ];
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);

  var compute = computeSkillScores(userId);
  return { success: true, message: "Responses saved.", computed: compute };
}

/**
 * computeSkillScores
 * Purpose:
 * Computes category-level competency scores for a specific user.
 * Parameters:
 * userId (String) - alumni user ID.
 * Logic:
 * 1) Load user responses from Responses.
 * 2) Map each response to its question category.
 * 3) Compute average score per category.
 * 4) Replace previous result rows for the user.
 * 5) Save fresh scores into Results sheet.
 * Output:
 * Object with success flag and computed category scores.
 */
function computeSkillScores(userId) {
  initializeDatabase();
  var ss = getSpreadsheet_();
  var responseSheet = ss.getSheetByName(SHEET_NAMES.RESPONSES);
  var questionSheet = ss.getSheetByName(SHEET_NAMES.QUESTIONS);
  var resultSheet = ss.getSheetByName(SHEET_NAMES.RESULTS);

  var responses = responseSheet.getDataRange().getValues();
  var questions = questionSheet.getDataRange().getValues();
  var questionMap = {};
  for (var q = 1; q < questions.length; q++) {
    questionMap[questions[q][0]] = questions[q][2];
  }

  var grouped = {};
  for (var r = 1; r < responses.length; r++) {
    if (String(responses[r][1]) !== String(userId)) continue;
    var qid = responses[r][2];
    var fromRow = responses[r].length > 5 ? responses[r][5] : "";
    var category =
      fromRow !== undefined &&
      fromRow !== null &&
      String(fromRow).trim() !== ""
        ? String(fromRow).trim()
        : questionMap[qid];
    if (!category) continue;
    if (!grouped[category]) grouped[category] = [];
    grouped[category].push(Number(responses[r][4]));
  }

  var scores = {};
  Object.keys(grouped).forEach(function(category) {
    var values = grouped[category];
    var total = values.reduce(function(sum, val) { return sum + val; }, 0);
    scores[category] = Number((total / values.length).toFixed(2));
  });

  var existing = resultSheet.getDataRange().getValues();
  for (var i = existing.length; i >= 2; i--) {
    if (String(existing[i - 1][1]) === String(userId)) {
      resultSheet.deleteRow(i);
    }
  }

  var now = new Date();
  var inserts = Object.keys(scores).map(function(category) {
    return ["RES" + Utilities.getUuid().slice(0, 8), userId, category, scores[category], now];
  });
  if (inserts.length > 0) {
    resultSheet.getRange(resultSheet.getLastRow() + 1, 1, inserts.length, inserts[0].length).setValues(inserts);
  }

  return { success: true, user_id: userId, scores: scores };
}

/**
 * getAdminAnalytics
 * Purpose:
 * Produces aggregated dashboard analytics for admin users.
 * Parameters:
 * None.
 * Logic:
 * 1) Read Users and Results data.
 * 2) Compute average competency score per course.
 * 3) Compute category distribution averages.
 * 4) Build anonymized Alumni Performance Index ranking.
 * Output:
 * Object containing course analytics, category analytics, and rankings.
 */
function getAdminAnalytics() {
  initializeDatabase();
  var ss = getSpreadsheet_();
  var users = ss.getSheetByName(SHEET_NAMES.USERS).getDataRange().getValues();
  var results = ss.getSheetByName(SHEET_NAMES.RESULTS).getDataRange().getValues();

  var userMap = {};
  for (var i = 1; i < users.length; i++) {
    userMap[users[i][0]] = {
      name: users[i][1],
      course: users[i][4],
      role: normalizeRole_(users[i][7])
    };
  }

  var byCourse = {};
  var byCategory = {};
  var userTotals = {};

  for (var r = 1; r < results.length; r++) {
    var userId = results[r][1];
    var user = userMap[userId];
    if (!user || user.role !== "Alumni") continue;
    var category = results[r][2];
    var score = Number(results[r][3]);

    if (!byCourse[user.course]) byCourse[user.course] = [];
    byCourse[user.course].push(score);

    if (!byCategory[category]) byCategory[category] = [];
    byCategory[category].push(score);

    if (!userTotals[userId]) userTotals[userId] = [];
    userTotals[userId].push(score);
  }

  var courseAverages = {};
  Object.keys(byCourse).forEach(function(course) {
    var arr = byCourse[course];
    courseAverages[course] = Number((arr.reduce(function(a, b) { return a + b; }, 0) / arr.length).toFixed(2));
  });

  var categoryAverages = {};
  Object.keys(byCategory).forEach(function(category) {
    var arr = byCategory[category];
    categoryAverages[category] = Number((arr.reduce(function(a, b) { return a + b; }, 0) / arr.length).toFixed(2));
  });

  var performanceIndex = Object.keys(userTotals).map(function(userId) {
    var arr = userTotals[userId];
    var avg = Number((arr.reduce(function(a, b) { return a + b; }, 0) / arr.length).toFixed(2));
    var name = userMap[userId].name;
    var anonymized = anonymizeName(name);
    return {
      alumni: anonymized,
      course: userMap[userId].course,
      competencyScore: avg,
      performanceLevel: avg >= 4 ? "High Proficiency" : "Emerging Proficiency"
    };
  });

  performanceIndex.sort(function(a, b) { return b.competencyScore - a.competencyScore; });

  return {
    success: true,
    courseScores: courseAverages,
    categoryDistribution: categoryAverages,
    performanceIndex: performanceIndex
  };
}

/**
 * getDrillDownData
 * Purpose:
 * Returns detailed records based on selected analytics type/value.
 * Parameters:
 * type (String) - "course" or "category".
 * key (String) - selected course name or category name.
 * Logic:
 * 1) Read Users and Results.
 * 2) Filter result records by requested drill-down key.
 * 3) Return anonymized detailed rows with professional labels.
 * Output:
 * Object with success flag and drill-down records array.
 */
function getDrillDownData(type, key) {
  initializeDatabase();
  var ss = getSpreadsheet_();
  var users = ss.getSheetByName(SHEET_NAMES.USERS).getDataRange().getValues();
  var results = ss.getSheetByName(SHEET_NAMES.RESULTS).getDataRange().getValues();

  var userMap = {};
  for (var i = 1; i < users.length; i++) {
    userMap[users[i][0]] = {
      name: users[i][1],
      course: users[i][4],
      role: normalizeRole_(users[i][7])
    };
  }

  var rows = [];
  for (var r = 1; r < results.length; r++) {
    var userId = results[r][1];
    var user = userMap[userId];
    if (!user || user.role !== "Alumni") continue;
    var category = String(results[r][2]);
    var score = Number(results[r][3]);

    if (type === "course" && user.course === key) {
      rows.push({
        alumni: anonymizeName(user.name),
        course: user.course,
        category: category,
        competencyScore: score,
        skillProficiency: score >= 4 ? "High Proficiency" : "Development Area"
      });
    }
    if (type === "category" && category === key) {
      rows.push({
        alumni: anonymizeName(user.name),
        course: user.course,
        category: category,
        competencyScore: score,
        skillProficiency: score >= 4 ? "High Proficiency" : "Development Area"
      });
    }
  }

  rows.sort(function(a, b) { return b.competencyScore - a.competencyScore; });
  return { success: true, type: type, key: key, records: rows };
}

/**
 * Utility: anonymizeName
 * Converts a full name into anonymized format for ranking privacy.
 */
function anonymizeName(fullName) {
  var parts = String(fullName).split(" ");
  return parts.map(function(part, index) {
    return index === 0 ? part : part.charAt(0) + ".";
  }).join(" ");
}
