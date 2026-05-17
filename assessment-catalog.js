/**
 * ALSKILL dynamic course assessment catalog.
 * Self-assessment items (Always / Sometimes / Maybe / Never → scores 4–1),
 * program hard-skill domains, cross-cutting hard skills, and shared soft skills.
 */
(function (global) {
  "use strict";

  var ALSKILL_COURSE_CATALOG = [
    {
      id: "BSCT",
      name: "Bachelor of Science in Computer Technology",
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
    BSCT: ["Programming", "Hardware", "Networking", "Web Design", "Graphic Design"],
    "BSBA:MM": [
      "Consumer Insight",
      "Brand Strategy",
      "Digital Campaigns",
      "Sales & Negotiation",
      "Marketing Analytics"
    ],
    "BSBA:OM": [
      "Operations Strategy",
      "Process Improvement",
      "Supply & Logistics",
      "Quality Systems",
      "Project Operations"
    ],
    "BSBA:FM": [
      "Financial Reporting",
      "Corporate Finance",
      "Budgeting & Forecasting",
      "Investment & Risk",
      "Cost Management"
    ],
    "BSED:EN": [
      "Literature & Interpretation",
      "Composition Instruction",
      "Language Arts Pedagogy",
      "Assessment in English",
      "Discourse & Feedback"
    ],
    "BSED:MA": [
      "Algebraic Reasoning",
      "Geometry & Spatial Reasoning",
      "Mathematical Modeling",
      "Assessment in Mathematics",
      "STEM Integration"
    ],
    BECED: [
      "Child Development",
      "Early Curriculum",
      "Play-Based Learning",
      "Family Partnership",
      "Inclusive Early Learning"
    ],
    BEED: [
      "Elementary Curriculum",
      "Literacy Across Content",
      "Classroom Leadership",
      "Differentiated Instruction",
      "Assessment & Evidence"
    ]
  };

  /** Cross-cutting hard skills (shared across all tracks). */
  var HARD_CROSS_CATEGORIES = ["Math & Statistics", "Data & Technical Skill"];

  /** Soft skills analyzed on every track (right-brain profile). */
  var SOFT_SKILL_CATEGORIES = [
    "Problem Solving",
    "Storytelling",
    "Collaboration",
    "Curiosity",
    "Communication",
    "Creativity"
  ];

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
      "I confidently apply " + categoryName + " knowledge when completing tasks in my field.",
      "I can explain essential " + categoryName + " ideas to others without heavy preparation.",
      "When I face an unfamiliar " + categoryName + " challenge, I know how to learn and verify what I need.",
      "I seek feedback on my " + categoryName + " work and use it to improve."
    ];
  }

  var HARD_CROSS_STEMS = {
    "Math & Statistics": [
      "I interpret numbers, tables, and basic statistics correctly when reviewing information.",
      "I question assumptions behind figures before using them in decisions or reports.",
      "I use mathematical or statistical reasoning appropriately in my professional context."
    ],
    "Data & Technical Skill": [
      "I use digital tools and data resources relevant to my role effectively.",
      "I organize technical work so others can follow, audit, or reuse it.",
      "I keep core technical skills current for the standards expected in my profession."
    ]
  };

  var SOFT_SKILL_STEMS = {
    "Problem Solving": [
      "I break complex problems into clear steps before choosing a solution.",
      "I test ideas and adjust when my first approach does not work."
    ],
    Storytelling: [
      "I present ideas with a clear beginning, structure, and takeaway for my audience.",
      "I use examples and narrative to help others understand technical or abstract topics."
    ],
    Collaboration: [
      "I contribute reliably on team tasks and follow through on shared commitments.",
      "I listen to teammates and integrate their input when making group decisions."
    ],
    Curiosity: [
      "I ask questions to deepen understanding before settling on an answer.",
      "I explore new methods or perspectives related to my work without being asked."
    ],
    Communication: [
      "I express my ideas clearly in writing and conversation for the situation at hand.",
      "I check that others understood my message and clarify when needed."
    ],
    Creativity: [
      "I propose original approaches when routine methods are not enough.",
      "I combine ideas from different areas to improve outcomes in my work."
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
    var cats = TRACK_CATEGORY_NAMES[trackKey];
    if (!cats) return [];
    var list = [];
    var ci;
    var qi;
    var catName;
    var stems;

    for (ci = 0; ci < 5; ci++) {
      catName = cats[ci];
      stems = programCategoryStems(catName);
      for (qi = 0; qi < stems.length; qi++) {
        list.push(
          buildQuestion(trackKey, catName, ci, qi, stems[qi], frequencyChoices(), "hard")
        );
      }
    }

    HARD_CROSS_CATEGORIES.forEach(function (crossCat, crossIdx) {
      stems = HARD_CROSS_STEMS[crossCat] || [];
      for (qi = 0; qi < stems.length; qi++) {
        list.push(
          buildQuestion(
            trackKey,
            crossCat,
            10 + crossIdx,
            qi,
            stems[qi],
            frequencyChoices(),
            "hard"
          )
        );
      }
    });

    SOFT_SKILL_CATEGORIES.forEach(function (softCat, softIdx) {
      stems = SOFT_SKILL_STEMS[softCat] || [];
      for (qi = 0; qi < stems.length; qi++) {
        list.push(
          buildQuestion(
            trackKey,
            softCat,
            20 + softIdx,
            qi,
            stems[qi],
            frequencyChoices(),
            "soft"
          )
        );
      }
    });

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
      var sum = arr.reduce(function (a, b) {
        return a + b;
      }, 0);
      scores[cat] = Number((sum / arr.length).toFixed(2));
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

  function alsSplitHardSoftScores(categoryScores) {
    var hard = {};
    var soft = {};
    Object.keys(categoryScores || {}).forEach(function (cat) {
      if (SOFT_SKILL_CATEGORIES.indexOf(cat) >= 0) {
        soft[cat] = categoryScores[cat];
      } else {
        hard[cat] = categoryScores[cat];
      }
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

  var DIM = ["technical", "business", "operations", "pedagogy", "research"];

  var PROGRAM_TARGETS = {
    BSCT: { technical: 0.92, business: 0.25, operations: 0.35, pedagogy: 0.2, research: 0.45 },
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
    var cats = TRACK_CATEGORY_NAMES[trackKey];
    if (!cats) return { technical: 0.2, business: 0.2, operations: 0.2, pedagogy: 0.2, research: 0.2 };
    var v = { technical: 0, business: 0, operations: 0, pedagogy: 0, research: 0 };
    cats.forEach(function (name) {
      var val = normalized[name];
      if (val == null) return;
      var w = mapCategoryToVector(trackKey, name);
      DIM.forEach(function (d) {
        v[d] += val * (w[d] || 0);
      });
    });
    var mathVal = normalized["Math & Statistics"];
    if (mathVal != null) v.research += mathVal * 0.35;
    var dataVal = normalized["Data & Technical Skill"];
    if (dataVal != null) v.technical += dataVal * 0.45;
    DIM.forEach(function (d) {
      if (v[d] > 1) v[d] = 1;
    });
    return v;
  }

  function mapCategoryToVector(trackKey, categoryName) {
    var base = { technical: 0.2, business: 0.2, operations: 0.2, pedagogy: 0.2, research: 0.2 };
    if (categoryName === "Math & Statistics") {
      return { technical: 0.35, business: 0.15, operations: 0.1, pedagogy: 0.1, research: 0.3 };
    }
    if (categoryName === "Data & Technical Skill") {
      return { technical: 0.65, business: 0.1, operations: 0.12, pedagogy: 0.05, research: 0.08 };
    }
    if (trackKey === "BSCT") {
      if (categoryName === "Programming" || categoryName === "Hardware" || categoryName === "Networking")
        return { technical: 0.72, business: 0.06, operations: 0.14, pedagogy: 0.04, research: 0.04 };
      if (categoryName === "Web Design" || categoryName === "Graphic Design")
        return { technical: 0.45, business: 0.18, operations: 0.1, pedagogy: 0.12, research: 0.15 };
    }
    if (trackKey.indexOf("BSBA") === 0) {
      if (categoryName.indexOf("Financial") >= 0 || categoryName.indexOf("Budget") >= 0)
        return { technical: 0.25, business: 0.55, operations: 0.12, pedagogy: 0.04, research: 0.04 };
      if (categoryName.indexOf("Supply") >= 0 || categoryName.indexOf("Process") >= 0 || categoryName.indexOf("Project") >= 0)
        return { technical: 0.22, business: 0.28, operations: 0.42, pedagogy: 0.04, research: 0.04 };
      return { technical: 0.18, business: 0.52, operations: 0.14, pedagogy: 0.08, research: 0.08 };
    }
    if (trackKey.indexOf("BSED") === 0) {
      if (categoryName.indexOf("Math") >= 0 || categoryName === "STEM Integration" || categoryName === "Algebraic")
        return { technical: 0.48, business: 0.08, operations: 0.08, pedagogy: 0.3, research: 0.06 };
      return { technical: 0.18, business: 0.1, operations: 0.08, pedagogy: 0.58, research: 0.06 };
    }
    if (trackKey === "BECED" || trackKey === "BEED") {
      return { technical: 0.12, business: 0.08, operations: 0.1, pedagogy: 0.62, research: 0.08 };
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
      { key: "BSCT", name: "Bachelor of Science in Computer Technology", target: PROGRAM_TARGETS.BSCT },
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

    var topProgram = ranked[0];
    var topMajor = majors[0];
    var narrative =
      "Recommendations compare your hard-skill profile (mapped to skill dimensions) with typical program emphasis. " +
      "Soft-skill means are shown separately on your brain dashboard. Use results as guidance alongside advising.";

    return {
      overallScore: categoryScores,
      userVector: userVec,
      rankedPrograms: ranked,
      rankedMajors: majors,
      topProgram: topProgram,
      topMajorTrack: topMajor,
      narrative: narrative
    };
  }

  global.ALSKILL_ASSESSMENT_ITEM_COUNT = 38;

  global.ALSKILL_COURSE_CATALOG = ALSKILL_COURSE_CATALOG;
  global.ALSKILL_TRACK_CATEGORY_NAMES = TRACK_CATEGORY_NAMES;
  global.ALSKILL_SOFT_SKILL_CATEGORIES = SOFT_SKILL_CATEGORIES;
  global.ALSKILL_HARD_CROSS_CATEGORIES = HARD_CROSS_CATEGORIES;
  global.alsGetQuestionsForTrack = alsGetQuestionsForTrack;
  global.alsComputeCategoryScores = alsComputeCategoryScores;
  global.alsSplitHardSoftScores = alsSplitHardSoftScores;
  global.alsHardSoftMeans = alsHardSoftMeans;
  global.alsRecommend = alsRecommend;
})(typeof window !== "undefined" ? window : globalThis);
