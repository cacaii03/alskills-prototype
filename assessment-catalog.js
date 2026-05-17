/**
 * ALSKILL assessment catalog (per questions.txt).
 * Per track: 5 program categories × 5 items + Research Skills × 5 + Soft Skills × 20 = 50 items.
 * Choices: Always / Sometimes / Maybe / Never (scores 4–1).
 */
(function (global) {
  "use strict";

  var ALSKILL_COURSE_CATALOG = [
    {
      id: "BSIT",
      name: "Bachelor of Science in Information Technology",
      majors: []
    },
    {
      id: "BSBA",
      name: "Bachelor of Science in Business Administration",
      majors: [
        { id: "MM", name: "Marketing Management" },
        { id: "OM", name: "Operational Management" },
        { id: "FM", name: "Financial Management" }
      ]
    },
    {
      id: "BSED",
      name: "Bachelor of Science in Secondary Education",
      majors: [
        { id: "EN", name: "English" },
        { id: "MA", name: "Math" }
      ]
    },
    {
      id: "BECED",
      name: "Bachelor of Science in Early Childhood Education",
      majors: []
    },
    {
      id: "BEED",
      name: "Bachelor of Science in Elementary Education",
      majors: []
    }
  ];

  var TRACK_CATEGORY_NAMES = {
    BSIT: ["Programming", "Hardware", "Networking", "Web Design", "Graphic Design"],
    "BSBA:MM": [
      "Marketing & Advertising",
      "Communication",
      "Creativity & Branding",
      "Sales & Customer Relations",
      "Digital Marketing"
    ],
    "BSBA:OM": [
      "Leadership & Supervision",
      "Problem-Solving",
      "Organization & Planning",
      "Communication & Coordination",
      "Business Operations"
    ],
    "BSBA:FM": [
      "Financial Analysis",
      "Accounting Skills",
      "Problem-Solving",
      "Business Management",
      "Technology & Finance Tools"
    ],
    "BSED:EN": [
      "Reading & Literature",
      "Writing Skills",
      "Communication",
      "Teaching & Instruction",
      "Creativity & Critical Thinking"
    ],
    "BSED:MA": [
      "Mathematical Skills",
      "Problem-Solving",
      "Teaching & Instruction",
      "Organization & Accuracy",
      "Critical Thinking"
    ],
    BECED: [
      "Child Development",
      "Creativity & Learning Activities",
      "Communication",
      "Patience & Emotional Support",
      "Classroom Management"
    ],
    BEED: [
      "Teaching & Instruction",
      "Communication Skills",
      "Creativity & Learning Activities",
      "Patience & Emotional Support",
      "Classroom Management"
    ]
  };

  var RESEARCH_SKILL_CATEGORY = "Research Skills";

  /** Six soft-skill themes; 20 items total (4+4+3+3+3+3). */
  var SOFT_SKILL_CATEGORIES = [
    "Problem Solving",
    "Storytelling",
    "Collaboration",
    "Curiosity",
    "Communication",
    "Creativity"
  ];

  var SOFT_SKILL_QUESTION_COUNTS = [4, 4, 3, 3, 3, 3];

  var MASTERY_THRESHOLD = 3.25;

  function frequencyChoices() {
    return [
      { key: "always", text: "Always", score: 4 },
      { key: "sometimes", text: "Sometimes", score: 3 },
      { key: "maybe", text: "Maybe", score: 2 },
      { key: "never", text: "Never", score: 1 }
    ];
  }

  function programCategoryStems(categoryName) {
    return [
      "I confidently apply " + categoryName + " skills when completing work in my field.",
      "I can explain essential " + categoryName + " concepts to others without heavy preparation.",
      "When I face an unfamiliar " + categoryName + " task, I know how to learn and verify what I need.",
      "I use feedback to improve my " + categoryName + " practice over time.",
      "I keep my " + categoryName + " skills aligned with current professional expectations."
    ];
  }

  var RESEARCH_SKILL_STEMS = [
    "I identify credible sources before using information in academic or professional work.",
    "I organize research notes so others can follow my reasoning and evidence.",
    "I cite and reference sources appropriately for my field.",
    "I evaluate whether evidence supports a claim before I act on it.",
    "I complete research tasks with clear methodology, not guesswork."
  ];

  var SOFT_SKILL_STEM_BANK = {
    "Problem Solving": [
      "I break complex problems into clear steps before choosing a solution.",
      "I test ideas and adjust when my first approach does not work.",
      "I stay calm and systematic when problems are ambiguous or urgent.",
      "I involve the right people when a problem needs expertise I do not have."
    ],
    Storytelling: [
      "I present ideas with a clear structure and takeaway for my audience.",
      "I use examples and narrative to help others understand difficult topics.",
      "I adapt my story to the listener's background and goals.",
      "I revise how I tell a story when the audience does not follow my point."
    ],
    Collaboration: [
      "I contribute reliably on team tasks and follow through on commitments.",
      "I listen to teammates and integrate their input when making decisions.",
      "I resolve disagreements respectfully while keeping the team goal in focus.",
      "I share credit and acknowledge others' contributions openly."
    ],
    Curiosity: [
      "I ask questions to deepen understanding before settling on an answer.",
      "I explore new methods or perspectives related to my work without being asked.",
      "I read or learn outside my comfort zone to grow professionally.",
      "I challenge assumptions—including my own—with evidence."
    ],
    Communication: [
      "I express my ideas clearly in writing and conversation for the situation.",
      "I check that others understood my message and clarify when needed.",
      "I adjust tone and detail level for different audiences.",
      "I give constructive feedback that others can act on."
    ],
    Creativity: [
      "I propose original approaches when routine methods are not enough.",
      "I combine ideas from different areas to improve outcomes.",
      "I brainstorm multiple options before committing to one solution.",
      "I encourage creative thinking in group settings."
    ]
  };

  function buildQuestion(trackKey, categoryName, catIndex, qIndex, stem, choiceList, skillType) {
    var safeKey = trackKey.replace(/:/g, "_");
    return {
      id: safeKey + "_c" + catIndex + "_q" + qIndex,
      course: trackKey,
      category: categoryName,
      skillType: skillType || (SOFT_SKILL_CATEGORIES.indexOf(categoryName) >= 0 ? "soft" : "hard"),
      question: stem,
      type: "likert",
      choices: choiceList
    };
  }

  function alsGetQuestionsForTrack(trackKey) {
    var normalized = trackKey === "BSCT" ? "BSIT" : trackKey;
    var cats = TRACK_CATEGORY_NAMES[normalized];
    if (!cats) return [];
    var list = [];
    var ci;
    var qi;
    var catName;
    var stems;
    var softIdx;
    var count;
    var bank;

    for (ci = 0; ci < 5; ci++) {
      catName = cats[ci];
      stems = programCategoryStems(catName);
      for (qi = 0; qi < 5; qi++) {
        list.push(buildQuestion(normalized, catName, ci, qi, stems[qi], frequencyChoices(), "hard"));
      }
    }

    for (qi = 0; qi < RESEARCH_SKILL_STEMS.length; qi++) {
      list.push(
        buildQuestion(
          normalized,
          RESEARCH_SKILL_CATEGORY,
          5,
          qi,
          RESEARCH_SKILL_STEMS[qi],
          frequencyChoices(),
          "hard"
        )
      );
    }

    for (softIdx = 0; softIdx < SOFT_SKILL_CATEGORIES.length; softIdx++) {
      catName = SOFT_SKILL_CATEGORIES[softIdx];
      bank = SOFT_SKILL_STEM_BANK[catName] || [];
      count = SOFT_SKILL_QUESTION_COUNTS[softIdx] || 3;
      for (qi = 0; qi < count; qi++) {
        list.push(
          buildQuestion(
            normalized,
            catName,
            10 + softIdx,
            qi,
            bank[qi] || "I demonstrate " + catName + " in my daily work.",
            frequencyChoices(),
            "soft"
          )
        );
      }
    }

    return list;
  }

  function alsComputeCategoryScores(questions, responsesByQuestionId) {
    var byCat = {};
    questions.forEach(function (q) {
      var resp = responsesByQuestionId[q.id];
      if (!resp || resp.score == null) return;
      if (!byCat[q.category]) byCat[q.category] = [];
      byCat[q.category].push(Number(resp.score));
    });
    var scores = {};
    Object.keys(byCat).forEach(function (cat) {
      var arr = byCat[cat];
      scores[cat] = Number(
        (
          arr.reduce(function (a, b) {
            return a + b;
          }, 0) / arr.length
        ).toFixed(2)
      );
    });
    var cats = Object.keys(scores);
    var overall =
      cats.length === 0
        ? 0
        : Number(
            (
              cats.reduce(function (s, k) {
                return s + scores[k];
              }, 0) / cats.length
            ).toFixed(2)
          );
    return { byCategory: scores, overall: overall };
  }

  function isSoftCategory(cat) {
    return SOFT_SKILL_CATEGORIES.indexOf(cat) >= 0;
  }

  function alsSplitHardSoftScores(categoryScores) {
    var hard = {};
    var soft = {};
    Object.keys(categoryScores || {}).forEach(function (cat) {
      if (isSoftCategory(cat)) soft[cat] = categoryScores[cat];
      else hard[cat] = categoryScores[cat];
    });
    return { hard: hard, soft: soft };
  }

  function alsHardSoftMeans(categoryScores) {
    var split = alsSplitHardSoftScores(categoryScores);
    function meanOf(obj) {
      var keys = Object.keys(obj);
      if (!keys.length) return null;
      var sum = keys.reduce(function (s, k) {
        return s + Number(obj[k]);
      }, 0);
      return Number((sum / keys.length).toFixed(2));
    }
    return {
      hardMean: meanOf(split.hard),
      softMean: meanOf(split.soft),
      hard: split.hard,
      soft: split.soft
    };
  }

  function alsGetMasteredSkills(categoryScores, threshold) {
    var t = threshold != null ? Number(threshold) : MASTERY_THRESHOLD;
    var split = alsSplitHardSoftScores(categoryScores || {});
    function masteredFrom(map) {
      return Object.keys(map)
        .filter(function (k) {
          return Number(map[k]) >= t;
        })
        .sort(function (a, b) {
          return Number(map[b]) - Number(map[a]);
        })
        .map(function (k) {
          return { name: k, score: Number(map[k]) };
        });
    }
    return {
      hard: masteredFrom(split.hard),
      soft: masteredFrom(split.soft),
      hasData: Object.keys(categoryScores || {}).length > 0
    };
  }

  function normalizeTrackKey(trackKey) {
    return trackKey === "BSCT" ? "BSIT" : trackKey;
  }

  var DIM = ["technical", "business", "operations", "pedagogy", "research"];

  var PROGRAM_TARGETS = {
    BSIT: { technical: 0.92, business: 0.25, operations: 0.35, pedagogy: 0.2, research: 0.45 },
    BSBA: { technical: 0.25, business: 0.85, operations: 0.55, pedagogy: 0.35, research: 0.5 },
    BSED: { technical: 0.28, business: 0.3, operations: 0.25, pedagogy: 0.9, research: 0.55 },
    BECED: { technical: 0.22, business: 0.28, operations: 0.25, pedagogy: 0.88, research: 0.42 },
    BEED: { technical: 0.25, business: 0.32, operations: 0.3, pedagogy: 0.9, research: 0.52 }
  };

  var MAJOR_TARGETS = {
    "BSBA:MM": { technical: 0.28, business: 0.88, operations: 0.42, pedagogy: 0.32, research: 0.48 },
    "BSBA:OM": { technical: 0.32, business: 0.62, operations: 0.9, pedagogy: 0.28, research: 0.45 },
    "BSBA:FM": { technical: 0.38, business: 0.78, operations: 0.48, pedagogy: 0.22, research: 0.52 },
    "BSED:EN": { technical: 0.26, business: 0.35, operations: 0.22, pedagogy: 0.9, research: 0.58 },
    "BSED:MA": { technical: 0.55, business: 0.28, operations: 0.3, pedagogy: 0.88, research: 0.55 }
  };

  function normalizeScores01(categoryScores) {
    var o = {};
    Object.keys(categoryScores).forEach(function (k) {
      o[k] = Math.max(0, Math.min(1, (Number(categoryScores[k]) - 1) / 3));
    });
    return o;
  }

  function inferVector(trackKey, normalized) {
    var tk = normalizeTrackKey(trackKey);
    var cats = TRACK_CATEGORY_NAMES[tk];
    if (!cats) return { technical: 0.2, business: 0.2, operations: 0.2, pedagogy: 0.2, research: 0.2 };
    var v = { technical: 0, business: 0, operations: 0, pedagogy: 0, research: 0 };
    cats.forEach(function (name) {
      var val = normalized[name];
      if (val == null) return;
      var w = mapCategoryToVector(tk, name);
      DIM.forEach(function (d) {
        v[d] += val * (w[d] || 0);
      });
    });
    var rs = normalized[RESEARCH_SKILL_CATEGORY];
    if (rs != null) v.research += rs * 0.55;
    DIM.forEach(function (d) {
      if (v[d] > 1) v[d] = 1;
    });
    return v;
  }

  function mapCategoryToVector(trackKey, categoryName) {
    var base = { technical: 0.2, business: 0.2, operations: 0.2, pedagogy: 0.2, research: 0.2 };
    if (categoryName === RESEARCH_SKILL_CATEGORY) {
      return { technical: 0.2, business: 0.15, operations: 0.1, pedagogy: 0.15, research: 0.7 };
    }
    if (trackKey === "BSIT") {
      if (categoryName === "Programming" || categoryName === "Hardware" || categoryName === "Networking")
        return { technical: 0.72, business: 0.06, operations: 0.14, pedagogy: 0.04, research: 0.04 };
      if (categoryName === "Web Design" || categoryName === "Graphic Design")
        return { technical: 0.45, business: 0.18, operations: 0.1, pedagogy: 0.12, research: 0.15 };
    }
    if (trackKey.indexOf("BSBA") === 0) {
      if (categoryName.indexOf("Financial") >= 0 || categoryName.indexOf("Accounting") >= 0)
        return { technical: 0.25, business: 0.55, operations: 0.12, pedagogy: 0.04, research: 0.04 };
      if (categoryName.indexOf("Operations") >= 0 || categoryName.indexOf("Organization") >= 0)
        return { technical: 0.22, business: 0.28, operations: 0.42, pedagogy: 0.04, research: 0.04 };
      return { technical: 0.18, business: 0.52, operations: 0.14, pedagogy: 0.08, research: 0.08 };
    }
    if (trackKey.indexOf("BSED") === 0 || trackKey === "BECED" || trackKey === "BEED") {
      return { technical: 0.15, business: 0.1, operations: 0.1, pedagogy: 0.62, research: 0.08 };
    }
    return base;
  }

  function vecDistance(a, b) {
    var s = 0;
    DIM.forEach(function (d) {
      var x = (a[d] || 0) - (b[d] || 0);
      s += x * x;
    });
    return Math.sqrt(s / DIM.length);
  }

  function alsRecommend(categoryScores, completedTrackKey) {
    var norm = normalizeScores01(categoryScores);
    var userVec = inferVector(completedTrackKey, norm);
    var programs = [
      { key: "BSIT", name: "Bachelor of Science in Information Technology", target: PROGRAM_TARGETS.BSIT },
      { key: "BSBA", name: "Bachelor of Science in Business Administration", target: PROGRAM_TARGETS.BSBA },
      { key: "BSED", name: "Bachelor of Science in Secondary Education", target: PROGRAM_TARGETS.BSED },
      { key: "BECED", name: "Bachelor of Science in Early Childhood Education", target: PROGRAM_TARGETS.BECED },
      { key: "BEED", name: "Bachelor of Science in Elementary Education", target: PROGRAM_TARGETS.BEED }
    ];
    var ranked = programs
      .map(function (p) {
        return {
          programKey: p.key,
          programName: p.name,
          fit: Number((1 - vecDistance(userVec, p.target)).toFixed(3))
        };
      })
      .sort(function (a, b) {
        return b.fit - a.fit;
      });

    var majors = Object.keys(MAJOR_TARGETS).map(function (mk) {
      return {
        trackKey: mk,
        fit: Number((1 - vecDistance(userVec, MAJOR_TARGETS[mk])).toFixed(3))
      };
    });
    majors.sort(function (a, b) {
      return b.fit - a.fit;
    });

    return {
      overallScore: categoryScores,
      userVector: userVec,
      rankedPrograms: ranked,
      rankedMajors: majors,
      topProgram: ranked[0],
      topMajorTrack: majors[0],
      narrative:
        "Recommendations compare your profile with typical program emphasis. Mastered skills appear on your brain dashboard."
    };
  }

  /** Ordered pill slots for brain dashboard (hard = program + research, soft = six themes). */
  function alsGetTrackCategoryLayout(trackKey) {
    var tk = normalizeTrackKey(trackKey);
    var cats = TRACK_CATEGORY_NAMES[tk];
    if (!cats) return { hard: [], soft: [] };
    var hard = [];
    var i;
    for (i = 0; i < cats.length; i++) {
      hard.push({ name: cats[i], pillId: "pill-h" + (i + 1), side: "hard" });
    }
    hard.push({ name: RESEARCH_SKILL_CATEGORY, pillId: "pill-h6", side: "hard" });
    var soft = SOFT_SKILL_CATEGORIES.map(function (name, idx) {
      return { name: name, pillId: "pill-s" + (idx + 1), side: "soft" };
    });
    return { hard: hard, soft: soft };
  }

  global.ALSKILL_ASSESSMENT_ITEM_COUNT = 50;
  global.ALSKILL_MASTERY_THRESHOLD = MASTERY_THRESHOLD;
  global.ALSKILL_COURSE_CATALOG = ALSKILL_COURSE_CATALOG;
  global.ALSKILL_TRACK_CATEGORY_NAMES = TRACK_CATEGORY_NAMES;
  global.ALSKILL_SOFT_SKILL_CATEGORIES = SOFT_SKILL_CATEGORIES;
  global.ALSKILL_RESEARCH_SKILL_CATEGORY = RESEARCH_SKILL_CATEGORY;
  global.alsGetQuestionsForTrack = alsGetQuestionsForTrack;
  global.alsComputeCategoryScores = alsComputeCategoryScores;
  global.alsSplitHardSoftScores = alsSplitHardSoftScores;
  global.alsHardSoftMeans = alsHardSoftMeans;
  global.alsGetMasteredSkills = alsGetMasteredSkills;
  global.alsGetTrackCategoryLayout = alsGetTrackCategoryLayout;
  global.alsNormalizeTrackKey = normalizeTrackKey;
  global.alsRecommend = alsRecommend;
})(typeof window !== "undefined" ? window : globalThis);
