/**
 * ALSKILL dynamic course assessment catalog.
 * Modular structure: programs, majors, per-track categories, shared Research Skills,
 * scenario MCQs (4 options A-D -> scores 1-4), scoring + recommendation helpers.
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

  /** Program-specific five categories + shared sixth "Research Skills" added by builder. */
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

  function choices(a, b, c, d, scores) {
    scores = scores || [1, 2, 3, 4];
    return [
      { key: "A", text: a, score: scores[0] },
      { key: "B", text: b, score: scores[1] },
      { key: "C", text: c, score: scores[2] },
      { key: "D", text: d, score: scores[3] }
    ];
  }

  /** Shared sixth category: Research Skills (same scenarios; IDs differ per track). */
  var RESEARCH_SKILL_SCENARIOS = [
    {
      stem:
        "You must evaluate whether a grey-literature blog post is admissible evidence for a capstone brief. What is your first step?",
      options: choices(
        "Use it if it ranks high on search engines.",
        "Check author credentials, publication date, cited sources, and potential conflicts of interest.",
        "Paraphrase it extensively so it appears original.",
        "Exclude it automatically because it is not peer-reviewed.",
        [1, 4, 1, 2]
      )
    },
    {
      stem:
        "Your team disagrees on sample size for a survey. What is the most defensible move before fieldwork?",
      options: choices(
        "Skip power analysis to save time.",
        "Document assumptions, estimate required power or margin of error, and justify the sample plan.",
        "Copy sample sizes from unrelated studies.",
        "Let the largest subgroup dictate the entire design without rationale.",
        [1, 4, 1, 2]
      )
    },
    {
      stem:
        "After collecting survey data, you find missing values clustered in one demographic group. What should you do?",
      options: choices(
        "Delete those rows silently.",
        "Investigate whether missingness is random or systematic; document handling and limitations.",
        "Impute the mean for everyone without recording it.",
        "Fabricate plausible answers to balance cells.",
        [1, 4, 2, 1]
      )
    },
    {
      stem:
        "A stakeholder asks for conclusions beyond what your instrument can support. How do you respond?",
      options: choices(
        "Expand claims to satisfy them.",
        "State limits clearly, propose additional data collection if needed, and align conclusions to evidence.",
        "Use anecdotal evidence to bridge the gap.",
        "Agree verbally but omit caveats from the report.",
        [1, 4, 1, 1]
      )
    },
    {
      stem:
        "You synthesize five sources with conflicting findings. What makes the synthesis academically sound?",
      options: choices(
        "Report only the majority opinion.",
        "Compare methods, contexts, and quality; explain divergence and implications for practice.",
        "Average numeric results across incompatible scales.",
        "Select the newest paper as definitive.",
        [1, 4, 1, 2]
      )
    }
  ];

  /**
   * Program-specific scenario banks: each category has five { stem, options } entries.
   * options = return value of choices(...)
   */
  var SCENARIO_BANKS = {};

  SCENARIO_BANKS.BSCT = {
    Programming: [
      {
        stem:
          "A legacy payroll module throws intermittent null-pointer errors under load. Logs point to a shared cache key. What do you do first?",
        options: choices(
          "Restart servers nightly without tracing.",
          "Reproduce under profiling, inspect concurrency around the cache, and add targeted synchronization or revision of key strategy.",
          "Disable caching entirely in production.",
          "Mask errors in the UI so users stop reporting them.",
          [2, 4, 1, 1]
        )
      },
      {
        stem:
          "You inherit undocumented string-parsing routines used for enrollment imports. Requirements change weekly. What approach reduces long-term risk?",
        options: choices(
          "Patch regex per ticket indefinitely.",
          "Introduce a documented schema, validation layer, and automated tests tied to sample files.",
          "Ask clients to send cleaner CSVs only.",
          "Rewrite everything in a new language immediately without tests.",
          [2, 4, 2, 1]
        )
      },
      {
        stem:
          "Security audit flags unsanitized SQL fragments built from UI filters. What is the responsible remediation path?",
        options: choices(
          "Escape outputs only on the client.",
          "Move to parameterized queries or an ORM, validate inputs, and add regression tests for injection attempts.",
          "Hide the feature behind admin login.",
          "Log warnings but ship on schedule.",
          [1, 4, 2, 1]
        )
      },
      {
        stem:
          "Your CI pipeline passes locally but fails on integration tests in cloud runners due to timing. What is the best next step?",
        options: choices(
          "Retry tests until green.",
          "Stabilize async boundaries with deterministic waits or fakes, reduce shared global state, and record flaky-test metrics.",
          "Disable integration tests in CI.",
          "Run tests only before release.",
          [2, 4, 1, 2]
        )
      },
      {
        stem:
          "Product asks for a quick feature that doubles memory use on small devices. Engineering suspects leak-prone patterns. How do you proceed?",
        options: choices(
          "Ship first and profile later.",
          "Prototype under memory constraints, measure allocations, and negotiate scope based on evidence.",
          "Lower quality settings without measuring impact.",
          "Increase device minimums in marketing copy only.",
          [1, 4, 2, 2]
        )
      }
    ],
    Hardware: [
      {
        stem:
          "Workstations randomly power-cycle after a firmware push. Rollback is possible but delays security patches. What is the disciplined response?",
        options: choices(
          "Disable automatic updates permanently.",
          "Isolate affected models, reproduce with logging, verify PSU and thermal headroom, stage a tested firmware path before fleet rollout.",
          "Replace all PSUs immediately across the site.",
          "Ignore until warranty expires.",
          [1, 4, 2, 2]
        )
      },
      {
        stem:
          "A lab shows Ethernet collisions and late collisions on an older hub-style segment. Modern switches are available. What should you recommend?",
        options: choices(
          "Add repeaters to boost signal.",
          "Replace collision-domain gear with switched segments, verify cabling category, and validate port speeds.",
          "Lower MTU on all hosts.",
          "Turn off flow control everywhere.",
          [1, 4, 2, 1]
        )
      },
      {
        stem:
          "New GPUs draw more power than labeled rack circuits allow during simultaneous training jobs. What mitigates risk before scaling?",
        options: choices(
          "Use extension cords across circuits.",
          "Model peak draw per PDU, enforce job schedulers or power caps, and upgrade distribution where sustained peaks exceed safe margins.",
          "Throttle CPUs instead of GPUs arbitrarily.",
          "Run only during off-hours without measurement.",
          [1, 4, 3, 2]
        )
      },
      {
        stem:
          "Field tablets fail after humidity exposure even though IP rating matches vendor claims. What investigation comes first?",
        options: choices(
          "Blame users and close tickets.",
          "Verify gasket integrity on repaired units, environmental logs, and whether accessories compromise seals.",
          "Switch brands without root-cause review.",
          "Apply conformal coat ad hoc to everything.",
          [1, 4, 2, 2]
        )
      },
      {
        stem:
          "Memory diagnostics show intermittent single-bit errors only under heat soak. Warranty RAM passes vendor quick tests. What next?",
        options: choices(
          "Mark systems good and return to service.",
          "Run extended memtests under thermal load, log ECC stats if available, and replace modules showing correlated errors.",
          "Disable ECC to silence logs.",
          "Underclock CPUs globally.",
          [1, 4, 2, 2]
        )
      }
    ],
    Networking: [
      {
        stem:
          "After VLAN changes, one subnet can reach the gateway but not peer subnets. ACLs are suspected. What is the structured check?",
        options: choices(
          "Ping random internet hosts.",
          "Verify SVIs, trunk allowed VLANs, routing tables, and ACL line order with traceroute to each hop boundary.",
          "Reboot all switches.",
          "Assign static IPs on clients without coordination.",
          [1, 4, 2, 2]
        )
      },
      {
        stem:
          "DNS intermittently resolves external sites to stale addresses after ISP failover. Internal DNS forwards public queries. What fixes root cause?",
        options: choices(
          "Flush caches manually hourly.",
          "Reduce TTL oversights, align forwarders with health checks, and validate resolver bonding during failover tests.",
          "Hardcode hosts files on clients.",
          "Block DNS logging to reduce noise.",
          [1, 4, 2, 2]
        )
      },
      {
        stem:
          "Wireless VoIP roams poorly between APs on same SSID. Controller shows sticky clients and overlapping channels. What do you adjust?",
        options: choices(
          "Raise transmit power on all APs maximum.",
          "Tune roaming thresholds, channel plan, and minimum RSSI to reduce stickiness while avoiding overlap.",
          "Disable 5 GHz.",
          "Add SSIDs per floor only.",
          [1, 4, 3, 2]
        )
      },
      {
        stem:
          "Penetration test finds exposed management interfaces on a VLAN reachable from student Wi-Fi. What remediation aligns with least privilege?",
        options: choices(
          "Change passwords quarterly only.",
          "Segment management plane, restrict source IPs, enforce jump hosts, and verify with periodic scans.",
          "Hide SSID names.",
          "Disable student Wi-Fi.",
          [1, 4, 3, 2]
        )
      },
      {
        stem:
          "Satellite link shows high latency but low packet loss; interactive apps suffer. What practical mitigation helps most?",
        options: choices(
          "Increase bandwidth blindly.",
          "Apply QoS, optimize protocol chatter, cache where safe, and tune buffers with realistic RTT models.",
          "Disable encryption to save bytes.",
          "Move servers without measuring RTT paths.",
          [2, 4, 2, 1]
        )
      }
    ],
    "Web Design": [
      {
        stem:
          "Homepage hero images tank Largest Contentful Paint on mobile. Design insists on full-bleed uncompressed PNGs. What path balances UX and brand?",
        options: choices(
          "Ignore metrics if brand objects.",
          "Serve responsive sources with modern formats, prioritize visible hero load, and validate with field and lab data.",
          "Remove all images.",
          "Load HD video backgrounds instead.",
          [2, 4, 1, 1]
        )
      },
      {
        stem:
          "Keyboard users cannot reach modal dialogs because focus stays behind overlay. Which fix is standards-aligned?",
        options: choices(
          "Remove keyboard shortcuts.",
          "Trap focus within the modal, restore on close, and ensure visible focus order per WCAG patterns.",
          "Hide modals from screen readers only.",
          "Use positive tabindex on everything.",
          [1, 4, 2, 1]
        )
      },
      {
        stem:
          "A/B test shows higher clicks on a deceptive label but accessibility advisors flag misleading copy. What should product do?",
        options: choices(
          "Ship the winning variant anyway.",
          "Reject manipulative patterns; iterate honest copy with usability testing that includes diverse users.",
          "Show deceptive copy only to mobile users.",
          "Measure clicks only, exclude assistive tech sessions.",
          [1, 4, 3, 1]
        )
      },
      {
        stem:
          "Design system drift causes six button styles with conflicting hover states. Maintenance cost spikes. What stabilizes the UI?",
        options: choices(
          "Freeze new pages.",
          "Codify tokens, components, and lint rules in CI; migrate incrementally with ownership.",
          "Let each squad choose frameworks freely.",
          "Inline CSS per page for speed.",
          [2, 4, 3, 2]
        )
      },
      {
        stem:
          "Client demands autoplaying promotional audio on landing. Which response respects users and policy?",
        options: choices(
          "Autoplay muted with clear unmute control and pause-on-tab-hidden behavior.",
          "Autoplay loud audio on entry.",
          "Move audio to second page to bypass blockers.",
          "Use invisible audio elements.",
          [4, 1, 1, 1]
        )
      }
    ],
    "Graphic Design": [
      {
        stem:
          "Print supplier rejects artwork for thin strokes below minimum weight at poster scale. Digital proof looked fine. What prevents rework?",
        options: choices(
          "Upscale raster proofs only.",
          "Confirm bleed, stroke scaling rules, and vendor ICC profiles before finalizing vector masters.",
          "Switch to RGB exports for vibrancy.",
          "Rasterize everything to JPEG maximum compression.",
          [2, 4, 2, 1]
        )
      },
      {
        stem:
          "Brand palette fails WCAG contrast on several secondary backgrounds. Marketing wants exact hues. What is the constructive move?",
        options: choices(
          "Ignore contrast for secondary UI.",
          "Adjust lightness systematically, document accessible pairs, and involve marketing in approved alternates.",
          "Use smaller text so contrast rules relax.",
          "Drop accessibility checks for alumni pages.",
          [1, 4, 2, 1]
        )
      },
      {
        stem:
          "Photo assets include recognizable minors without releases in archival folders. The campaign timeline is tight. What is compliant?",
        options: choices(
          "Blur faces slightly.",
          "Remove or replace unreleased assets; seek releases if originals are essential.",
          "Crop tightly to hide faces.",
          "Use photos only in PDFs.",
          [1, 4, 3, 1]
        )
      },
      {
        stem:
          "Motion guidelines disagree on easing curves; some animations exceed 300 ms for critical UI. What aligns UX and accessibility?",
        options: choices(
          "Let designers choose freely per ticket.",
          "Define motion tokens, respect prefers-reduced-motion, and cap durations for essential interactions.",
          "Disable all animation.",
          "Slow animations to 2s for emphasis everywhere.",
          [2, 4, 3, 2]
        )
      },
      {
        stem:
          "Infographic data came from a student blog without verification. Leadership likes the layout. What should you insist on?",
        options: choices(
          "Ship with a disclaimer only.",
          "Replace with verified sources and annotate methodology; revise layout after facts change.",
          "Anonymize labels to hide sources.",
          "Copy Wikipedia tables verbatim.",
          [1, 4, 2, 1]
        )
      }
    ]
  };

  /**
   * Generator for tracks that reuse parallel structure: builds plausible situational MCQs from seeds.
   * Keeps file smaller while remaining scenario-based (not direct self-rating).
   */
  function generatedCategoryQuestions(trackKey, categoryName, verbPack) {
    var stems = [
      "During a tight deadline, " +
        verbPack.context +
        " Your stakeholder expects a defensible decision. What is the strongest professional move?",
      "A teammate proposes a shortcut that improves speed but weakens traceability for " +
        categoryName +
        ". How do you respond?",
      "Evidence from two mentors conflicts about prioritizing work in " +
        categoryName +
        ". What process reduces bias?",
      "Resources shrink mid-project for outcomes tied to " +
        categoryName +
        ". Where should you cut last?",
      "Quality review surfaces recurring gaps in " +
        categoryName +
        ". What systemic improvement comes first?"
    ];
    var outs = [];
    for (var i = 0; i < 5; i++) {
      outs.push({
        stem: stems[i],
        options: choices(
          "Proceed without documenting assumptions.",
          verbPack.strong[i],
          "Privately blame individuals in chat.",
          "Stop measurement to avoid bad news.",
          [1, 4, 1, 1]
        )
      });
    }
    return outs;
  }

  var VERB_PACKS = {
    MM: {
      context: "customer segments disagree on message tests and channel ROI looks noisy.",
      strong: [
        "Align on metrics definitions, run disciplined experiments with controls, and document learning across segments.",
        "Insist on ethical targeting and transparent success metrics before scaling spend.",
        "Facilitate structured debate with data slices everyone agrees are valid.",
        "Protect brand promises and learning budget before vanity placements.",
        "Introduce a blameless retrospective tied to metrics and customer evidence."
      ]
    },
    OM: {
      context: "throughput improved locally but end-to-end lead time worsened after a local optimization.",
      strong: [
        "Map the full value stream, identify bottlenecks systemically, and tune WIP limits based on evidence.",
        "Standardize work instructions with frontline input and measure variation.",
        "Use structured root-cause sessions instead of ad hoc fixes.",
        "Prioritize constraints that control overall delivery, not busy local cells.",
        "Stand up visual management with cadence reviews tied to customer deadlines."
      ]
    },
    FM: {
      context: "cash forecasts diverge from actuals after policy changes you did not document.",
      strong: [
        "Rebuild assumptions collaboratively, reconcile ledgers, and publish scenario ranges with controls.",
        "Tighten approval workflows where variances cluster and add detective controls.",
        "Separate one-off items from recurring drivers before repricing risk.",
        "Escalate policy gaps with finance leadership using reconciled evidence.",
        "Instrument monthly variance rituals with accountable owners."
      ]
    },
    EN: {
      context: "learners struggle to cite textual evidence in argumentative essays.",
      strong: [
        "Model close-reading routines, scaffold prompts, and assess drafts against explicit rubrics.",
        "Differentiate mentor texts by readiness while keeping standards constant.",
        "Use formative checks that reveal misunderstanding early.",
        "Balance fluency practice with structured revision cycles.",
        "Coach peer feedback protocols grounded in criteria."
      ]
    },
    MA: {
      context: "students apply formulas without explaining structure and fail unfamiliar problems.",
      strong: [
        "Lead with reasoning routines, multiple representations, and error-analysis talks.",
        "Sequence tasks from concrete to abstract with purposeful variation.",
        "Use formative probes that reward justification, not answer-only speed.",
        "Align remediation to conceptual gaps surfaced by student explanations.",
        "Collaborate across grades to align prerequisite expectations."
      ]
    },
    EC: {
      context: "families report inconsistent communication about child milestones.",
      strong: [
        "Co-create a concise developmental roadmap with translators and accessible formats.",
        "Schedule predictable touchpoints and document agreed goals.",
        "Partner with specialists using shared observation notes.",
        "Train staff on culturally responsive family engagement.",
        "Evaluate interventions using documented developmental checkpoints."
      ]
    },
    EL: {
      context: "literacy results lag while time-on-task in worksheets rises.",
      strong: [
        "Shift toward guided reading blocks with formative diagnostics and targeted groups.",
        "Integrate writing across subjects with explicit strategy instruction.",
        "Balance practice with metacognitive prompts visible to learners.",
        "Align interventions to phonics data and comprehension checks.",
        "Coach teachers on pacing guides tied to standards evidence."
      ]
    }
  };

  SCENARIO_BANKS["BSBA:MM"] = {};
  TRACK_CATEGORY_NAMES["BSBA:MM"].forEach(function (cat, idx) {
    var pack = VERB_PACKS.MM;
    var rows = generatedCategoryQuestions("BSBA:MM", cat, pack);
    /** tweak stems slightly per category to avoid duplicate feel */
    rows.forEach(function (r, j) {
      r.stem = "Context (" + cat + "): " + r.stem;
    });
    SCENARIO_BANKS["BSBA:MM"][cat] = rows;
  });

  SCENARIO_BANKS["BSBA:OM"] = {};
  TRACK_CATEGORY_NAMES["BSBA:OM"].forEach(function (cat) {
    var rows = generatedCategoryQuestions("BSBA:OM", cat, VERB_PACKS.OM);
    rows.forEach(function (r) {
      r.stem = "Context (" + cat + "): " + r.stem;
    });
    SCENARIO_BANKS["BSBA:OM"][cat] = rows;
  });

  SCENARIO_BANKS["BSBA:FM"] = {};
  TRACK_CATEGORY_NAMES["BSBA:FM"].forEach(function (cat) {
    var rows = generatedCategoryQuestions("BSBA:FM", cat, VERB_PACKS.FM);
    rows.forEach(function (r) {
      r.stem = "Context (" + cat + "): " + r.stem;
    });
    SCENARIO_BANKS["BSBA:FM"][cat] = rows;
  });

  SCENARIO_BANKS["BSED:EN"] = {};
  TRACK_CATEGORY_NAMES["BSED:EN"].forEach(function (cat) {
    var rows = generatedCategoryQuestions("BSED:EN", cat, VERB_PACKS.EN);
    rows.forEach(function (r) {
      r.stem = "Context (" + cat + "): " + r.stem;
    });
    SCENARIO_BANKS["BSED:EN"][cat] = rows;
  });

  SCENARIO_BANKS["BSED:MA"] = {};
  TRACK_CATEGORY_NAMES["BSED:MA"].forEach(function (cat) {
    var rows = generatedCategoryQuestions("BSED:MA", cat, VERB_PACKS.MA);
    rows.forEach(function (r) {
      r.stem = "Context (" + cat + "): " + r.stem;
    });
    SCENARIO_BANKS["BSED:MA"][cat] = rows;
  });

  SCENARIO_BANKS.BECED = {};
  TRACK_CATEGORY_NAMES.BECED.forEach(function (cat) {
    var rows = generatedCategoryQuestions("BECED", cat, VERB_PACKS.EC);
    rows.forEach(function (r) {
      r.stem = "Early childhood (" + cat + "): " + r.stem;
    });
    SCENARIO_BANKS.BECED[cat] = rows;
  });

  SCENARIO_BANKS.BEED = {};
  TRACK_CATEGORY_NAMES.BEED.forEach(function (cat) {
    var rows = generatedCategoryQuestions("BEED", cat, VERB_PACKS.EL);
    rows.forEach(function (r) {
      r.stem = "Elementary (" + cat + "): " + r.stem;
    });
    SCENARIO_BANKS.BEED[cat] = rows;
  });

  function buildQuestion(trackKey, categoryName, catIndex, qIndex, stem, choiceList) {
    var safeKey = trackKey.replace(/:/g, "_");
    return {
      id: safeKey + "_c" + catIndex + "_q" + qIndex,
      course: trackKey,
      category: categoryName,
      question: stem,
      type: "mcq",
      choices: choiceList
    };
  }

  function alsGetQuestionsForTrack(trackKey) {
    var cats = TRACK_CATEGORY_NAMES[trackKey];
    if (!cats) return [];
    var bank = SCENARIO_BANKS[trackKey];
    if (!bank) return [];
    var list = [];
    for (var ci = 0; ci < 5; ci++) {
      var catName = cats[ci];
      var rows = bank[catName];
      if (!rows || rows.length !== 5) continue;
      for (var qi = 0; qi < 5; qi++) {
        var row = rows[qi];
        list.push(buildQuestion(trackKey, catName, ci, qi, row.stem, row.options));
      }
    }
    for (var ri = 0; ri < RESEARCH_SKILL_SCENARIOS.length; ri++) {
      var rs = RESEARCH_SKILL_SCENARIOS[ri];
      list.push(
        buildQuestion(trackKey, "Research Skills", 5, ri, rs.stem, rs.options)
      );
    }
    return list;
  }

  /** Category means (1-4 scale) and overall mean across categories. */
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

  /**
   * Maps user category performance to abstract dimensions, compares to program ideals,
   * returns ranked recommendations. Uses completed assessment track for context only.
   */
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
    /** Map 1-4 Likert to 0-1 */
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
    var wSum = 0;
    cats.forEach(function (name) {
      var val = normalized[name];
      if (val == null) return;
      var w = mapCategoryToVector(trackKey, name);
      DIM.forEach(function (d) {
        v[d] += val * (w[d] || 0);
      });
      wSum += 1;
    });
    var rs = normalized["Research Skills"];
    if (rs != null) v.research += rs * 0.65;
    /** soften if only research present */
    DIM.forEach(function (d) {
      if (v[d] > 1) v[d] = 1;
    });
    return v;
  }

  function mapCategoryToVector(trackKey, categoryName) {
    var base = { technical: 0.2, business: 0.2, operations: 0.2, pedagogy: 0.2, research: 0.2 };
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
      "Recommendations compare your category profile (mapped to skill dimensions) with typical program emphasis. " +
      "Use them as guidance alongside advising—not as a sole placement decision.";

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

  global.ALSKILL_COURSE_CATALOG = ALSKILL_COURSE_CATALOG;
  global.ALSKILL_TRACK_CATEGORY_NAMES = TRACK_CATEGORY_NAMES;
  global.alsGetQuestionsForTrack = alsGetQuestionsForTrack;
  global.alsComputeCategoryScores = alsComputeCategoryScores;
  global.alsRecommend = alsRecommend;
})(typeof window !== "undefined" ? window : globalThis);
