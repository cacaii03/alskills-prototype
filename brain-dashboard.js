/**
 * Interactive skills brain (brain.html template) for the alumni dashboard.
 */
(function (global) {
  "use strict";

  var HARD_PILL_IDS = ["pill-h1", "pill-h2", "pill-h3"];
  var SOFT_PILL_IDS = ["pill-s1", "pill-s2", "pill-s3", "pill-s4", "pill-s5", "pill-s6"];

  function formatMean(score) {
    if (score == null || Number.isNaN(Number(score))) return "—";
    return Number(score).toFixed(2) + " / 4.00";
  }

  function truncateLabel(name, maxLen) {
    var s = String(name || "");
    if (s.length <= maxLen) return s;
    return s.slice(0, maxLen - 1) + "…";
  }

  function setPillLabel(pillEl, displayName, score) {
    if (!pillEl) return;
    var labelEl = pillEl.querySelector(".brain-pill__label");
    var scoreEl = pillEl.querySelector(".brain-pill__score");
    if (labelEl) labelEl.textContent = truncateLabel(displayName, 22);
    if (scoreEl) scoreEl.textContent = formatMean(score);
    pillEl.setAttribute("data-category", displayName);
    pillEl.setAttribute("data-tip", "Mastered skill · mean " + formatMean(score));
  }

  function getMastered(categoryScores) {
    if (typeof alsGetMasteredSkills === "function") {
      return alsGetMasteredSkills(categoryScores || {});
    }
    return { hard: [], soft: [], hasData: Object.keys(categoryScores || {}).length > 0 };
  }

  function softCategoryForPillId(pillId) {
    var softCats =
      typeof ALSKILL_SOFT_SKILL_CATEGORIES !== "undefined"
        ? ALSKILL_SOFT_SKILL_CATEGORIES
        : ["Problem Solving", "Storytelling", "Collaboration", "Curiosity", "Communication", "Creativity"];
    var idx = SOFT_PILL_IDS.indexOf(pillId);
    return idx >= 0 ? softCats[idx] : null;
  }

  function buildPillSvgHard(id, ax, ay, lx, ly, rx, ry, label) {
    return (
      '<g class="brain-pill brain-pill--hard" id="' +
      id +
      '" style="transform:translateX(-20px)">' +
      '<line x1="' +
      ax +
      '" y1="' +
      ay +
      '" x2="' +
      lx +
      '" y2="' +
      ly +
      '" stroke="rgba(32,210,160,0.4)" stroke-width="1"/>' +
      '<circle cx="' +
      ax +
      '" cy="' +
      ay +
      '" r="3" fill="rgba(32,210,160,0.7)"/>' +
      '<rect x="' +
      rx +
      '" y="' +
      ry +
      '" width="120" height="30" rx="15" fill="rgba(15,80,60,0.9)" stroke="rgba(32,210,160,0.55)" stroke-width="1"/>' +
      '<text class="brain-pill__label" x="' +
      (rx + 60) +
      '" y="' +
      (ry + 15) +
      '" text-anchor="middle" fill="#7fffd4" font-size="10.5" font-family="Inter,system-ui,sans-serif" dominant-baseline="central">' +
      label +
      '</text><text class="brain-pill__score" x="' +
      (rx + 60) +
      '" y="' +
      (ry + 26) +
      '" text-anchor="middle" fill="rgba(255,255,255,0.75)" font-size="9" font-family="Inter,system-ui,sans-serif" dominant-baseline="central"></text></g>'
    );
  }

  function buildPillSvgSoft(id, ax, ay, lx, ly, rx, ry, label) {
    return (
      '<g class="brain-pill brain-pill--soft" id="' +
      id +
      '" style="transform:translateX(20px)">' +
      '<line x1="' +
      ax +
      '" y1="' +
      ay +
      '" x2="' +
      lx +
      '" y2="' +
      ly +
      '" stroke="rgba(244,167,40,0.4)" stroke-width="1"/>' +
      '<circle cx="' +
      ax +
      '" cy="' +
      ay +
      '" r="3" fill="rgba(244,167,40,0.7)"/>' +
      '<rect x="' +
      rx +
      '" y="' +
      ry +
      '" width="120" height="30" rx="15" fill="rgba(90,50,5,0.9)" stroke="rgba(244,167,40,0.55)" stroke-width="1"/>' +
      '<text class="brain-pill__label" x="' +
      (rx + 60) +
      '" y="' +
      (ry + 15) +
      '" text-anchor="middle" fill="#ffe0a0" font-size="10.5" font-family="Inter,system-ui,sans-serif" dominant-baseline="central">' +
      label +
      '</text><text class="brain-pill__score" x="' +
      (rx + 60) +
      '" y="' +
      (ry + 26) +
      '" text-anchor="middle" fill="rgba(255,255,255,0.75)" font-size="9" font-family="Inter,system-ui,sans-serif" dominant-baseline="central"></text></g>'
    );
  }

  function brainSceneHtml() {
    var h =
      '<div class="brain-scene" id="alsBrainScene" aria-label="Interactive skills brain map">' +
      '<div class="brain-scene__empty" id="alsBrainEmpty" hidden>' +
      '<p class="brain-scene__empty-title">No data yet</p>' +
      '<p class="brain-scene__empty-hint">Complete your official skills assessment in <strong>Test your skill</strong>.</p>' +
      '<p class="brain-scene__empty-sub">Mastered skills (mean ≥ 3.25) will appear as labels on the brain.</p>' +
      "</div>" +
      '<div class="brain-scene__glow brain-scene__glow--teal"></div>' +
      '<div class="brain-scene__glow brain-scene__glow--amber"></div>' +
      '<div class="brain-scene__tooltip" id="alsBrainTooltip" role="tooltip"></div>' +
      '<svg class="brain-scene__svg" viewBox="0 0 760 600" xmlns="http://www.w3.org/2000/svg" id="alsBrainSvg">';
    h = h.replace(/<\/motion>/g, "</div>");
    return (
      h +
      '<defs>' +
      '<radialGradient id="als-teal-grad" cx="35%" cy="40%" r="65%"><stop offset="0%" stop-color="#25d4a0"/><stop offset="100%" stop-color="#0f8060"/></radialGradient>' +
      '<radialGradient id="als-amber-grad" cx="65%" cy="40%" r="65%"><stop offset="0%" stop-color="#f7b733"/><stop offset="100%" stop-color="#c47a10"/></radialGradient>' +
      '<clipPath id="als-clip-left"><rect x="0" y="0" width="380" height="600"/></clipPath>' +
      '<clipPath id="als-clip-right"><rect x="380" y="0" width="380" height="600"/></clipPath>' +
      '<clipPath id="als-clip-lobe-left"><path d="M380,175 C370,155 348,142 325,140 C298,138 275,148 258,162 C238,178 228,200 224,222 C218,248 222,270 214,292 C206,316 190,330 188,355 C186,378 196,398 212,412 C226,424 246,430 262,434 C278,438 296,438 312,436 C328,434 342,428 355,420 C364,414 372,406 378,396 C381,390 382,384 382,378 L382,175 Z"/></clipPath>' +
      '<clipPath id="als-clip-lobe-right"><path d="M380,175 C390,155 412,142 435,140 C462,138 485,148 502,162 C522,178 532,200 536,222 C542,248 538,270 546,292 C554,316 570,330 572,355 C574,378 564,398 548,412 C534,424 514,430 498,434 C482,438 464,438 448,436 C432,434 418,428 405,420 C396,414 388,406 382,396 C381,390 380,384 380,378 L380,175 Z"/></clipPath>' +
      '<filter id="als-brain-shadow" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="12" stdDeviation="22" flood-color="#000" flood-opacity="0.5"/></filter>' +
      "</defs>" +
      '<g class="brain-scene__label-title"><text x="380" y="42" text-anchor="middle" fill="rgba(255,255,255,0.8)" font-size="12" letter-spacing="4" font-family="Inter,system-ui,sans-serif">SKILLS OVERVIEW</text></g>' +
      '<g class="brain-scene__brain-group" filter="url(#als-brain-shadow)">' +
      '<path id="als-lobe-left" clip-path="url(#als-clip-left)" d="M380,175 C370,155 348,142 325,140 C298,138 275,148 258,162 C238,178 228,200 224,222 C218,248 222,270 214,292 C206,316 190,330 188,355 C186,378 196,398 212,412 C226,424 246,430 262,434 C278,438 296,438 312,436 C328,434 342,428 355,420 C364,414 372,406 378,396 C381,390 382,384 382,378 L382,175 Z" fill="url(#als-teal-grad)" opacity="0.96"/>' +
      '<g clip-path="url(#als-clip-lobe-left)" id="als-scan-left" style="opacity:0;transition:opacity 0.3s"><rect class="brain-scene__scan" x="150" y="140" width="230" height="7" rx="3.5" fill="rgba(127,255,212,0.3)"/></g>' +
      '<path id="als-lobe-right" clip-path="url(#als-clip-right)" d="M380,175 C390,155 412,142 435,140 C462,138 485,148 502,162 C522,178 532,200 536,222 C542,248 538,270 546,292 C554,316 570,330 572,355 C574,378 564,398 548,412 C534,424 514,430 498,434 C482,438 464,438 448,436 C432,434 418,428 405,420 C396,414 388,406 382,396 C381,390 380,384 380,378 L380,175 Z" fill="url(#als-amber-grad)" opacity="0.96"/>' +
      '<g clip-path="url(#als-clip-lobe-right)" id="als-scan-right" style="opacity:0;transition:opacity 0.3s"><rect class="brain-scene__scan" x="380" y="140" width="210" height="7" rx="3.5" fill="rgba(255,224,160,0.3)"/></g>' +
      '<path id="als-hover-left" d="M380,175 C370,155 348,142 325,140 C298,138 275,148 258,162 C238,178 228,200 224,222 C218,248 222,270 214,292 C206,316 190,330 188,355 C186,378 196,398 212,412 C226,424 246,430 262,434 C278,438 296,438 312,436 C328,434 342,428 355,420 C364,414 372,406 378,396 C381,390 382,384 382,378 L382,175 Z" fill="transparent" style="cursor:pointer"/>' +
      '<path id="als-hover-right" d="M380,175 C390,155 412,142 435,140 C462,138 485,148 502,162 C522,178 532,200 536,222 C542,248 538,270 546,292 C554,316 570,330 572,355 C574,378 564,398 548,412 C534,424 514,430 498,434 C482,438 464,438 448,436 C432,434 418,428 405,420 C396,414 388,406 382,396 C381,390 380,384 380,378 L380,175 Z" fill="transparent" style="cursor:pointer"/>' +
      '<line x1="380" y1="162" x2="380" y2="432" stroke="rgba(255,255,255,0.25)" stroke-width="1.5" stroke-dasharray="5 4"/>' +
      "</g><g id=\"als-ripple-layer\"></g>" +
      buildPillSvgHard("pill-h1", 248, 200, 152, 210, 30, 194, "Hard skill") +
      buildPillSvgHard("pill-h2", 228, 278, 152, 278, 30, 262, "Hard skill") +
      buildPillSvgHard("pill-h3", 218, 360, 152, 360, 30, 344, "Hard skill") +
      buildPillSvgSoft("pill-s1", 512, 193, 608, 193, 610, 177, "💡 Problem Solving") +
      buildPillSvgSoft("pill-s2", 532, 243, 608, 243, 610, 227, "📖 Storytelling") +
      buildPillSvgSoft("pill-s3", 545, 295, 608, 295, 610, 279, "🤝 Collaboration") +
      buildPillSvgSoft("pill-s4", 548, 345, 608, 345, 610, 329, "🔍 Curiosity") +
      buildPillSvgSoft("pill-s5", 535, 393, 608, 393, 610, 377, "💬 Communication") +
      buildPillSvgSoft("pill-s6", 505, 424, 608, 430, 610, 414, "🎨 Creativity") +
      '<g class="brain-scene__label-hard"><circle cx="160" cy="132" r="5" fill="#20d2a0"/><text x="173" y="136" fill="#20d2a0" font-size="11" letter-spacing="2.5" font-family="Inter,system-ui,sans-serif" font-weight="600" dominant-baseline="central">HARD SKILL</text></g>' +
      '<g class="brain-scene__label-soft"><circle cx="537" cy="132" r="5" fill="#f4a728"/><text x="550" y="136" fill="#f4a728" font-size="11" letter-spacing="2.5" font-family="Inter,system-ui,sans-serif" font-weight="600" dominant-baseline="central">SOFT SKILL</text></g>' +
      '<circle cx="380" cy="300" r="6" fill="rgba(255,255,255,0.1)" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>' +
      "</svg></div>"
    );
  }

  function wireBrainScene(scene, categoryScores) {
    var tooltip = scene.querySelector("#alsBrainTooltip");
    var scanL = scene.querySelector("#als-scan-left");
    var scanR = scene.querySelector("#als-scan-right");
    var hoverL = scene.querySelector("#als-hover-left");
    var hoverR = scene.querySelector("#als-hover-right");
    var rl = scene.querySelector("#als-ripple-layer");
    var svg = scene.querySelector("#alsBrainSvg");
    var hardPills = scene.querySelectorAll(".brain-pill--hard");
    var softPills = scene.querySelectorAll(".brain-pill--soft");
    var allPills = [];
    var i;
    for (i = 0; i < hardPills.length; i++) allPills.push(hardPills[i]);
    for (i = 0; i < softPills.length; i++) allPills.push(softPills[i]);

    var mastered = getMastered(categoryScores);
    var emptyEl = scene.querySelector("#alsBrainEmpty");
    var visiblePills = [];
    var hi;
    var si;
    var pillEl;
    var m;

    for (i = 0; i < allPills.length; i++) {
      allPills[i].style.display = "none";
      allPills[i].classList.remove("brain-pill--visible", "brain-pill--has-score");
    }

    if (!mastered.hasData) {
      scene.classList.add("brain-scene--empty");
      if (emptyEl) emptyEl.hidden = false;
      return;
    }

    scene.classList.remove("brain-scene--empty");
    if (emptyEl) emptyEl.hidden = true;

    for (hi = 0; hi < HARD_PILL_IDS.length; hi++) {
      m = mastered.hard[hi];
      pillEl = scene.querySelector("#" + HARD_PILL_IDS[hi]);
      if (!m || !pillEl) continue;
      pillEl.style.display = "";
      setPillLabel(pillEl, m.name, m.score);
      pillEl.classList.add("brain-pill--has-score");
      visiblePills.push(pillEl);
    }

    for (si = 0; si < SOFT_PILL_IDS.length; si++) {
      var softKey = softCategoryForPillId(SOFT_PILL_IDS[si]);
      if (!softKey) continue;
      m = null;
      for (i = 0; i < mastered.soft.length; i++) {
        if (mastered.soft[i].name === softKey) {
          m = mastered.soft[i];
          break;
        }
      }
      pillEl = scene.querySelector("#" + SOFT_PILL_IDS[si]);
      if (!m || !pillEl) continue;
      pillEl.style.display = "";
      setPillLabel(pillEl, m.name, m.score);
      pillEl.classList.add("brain-pill--has-score");
      visiblePills.push(pillEl);
    }

    if (visiblePills.length === 0) {
      scene.classList.add("brain-scene--empty");
      if (emptyEl) {
        emptyEl.hidden = false;
        emptyEl.querySelector(".brain-scene__empty-title").textContent = "No mastered skills yet";
        var hint = emptyEl.querySelector(".brain-scene__empty-hint");
        if (hint) {
          hint.innerHTML =
            "You have assessment data, but no category reached the mastery band (mean ≥ 3.25). Retake practice or review weaker areas in <strong>Test your skill</strong>.";
        }
      }
      return;
    }

    for (i = 0; i < visiblePills.length; i++) {
      (function (el, idx) {
        setTimeout(function () {
          el.style.transform = "translateX(0)";
          el.classList.add("brain-pill--visible");
        }, 600 + idx * 120);
      })(visiblePills[i], i);
    }

    allPills = visiblePills;
    hardPills = scene.querySelectorAll(".brain-pill--hard.brain-pill--visible");
    softPills = scene.querySelectorAll(".brain-pill--soft.brain-pill--visible");

    function activateSide(side) {
      scene.classList.add(side === "hard" ? "brain-scene--hover-hard" : "brain-scene--hover-soft");
      (side === "hard" ? scanL : scanR).style.opacity = "1";
      var pills = side === "hard" ? hardPills : softPills;
      for (i = 0; i < pills.length; i++) {
        pills[i].classList.add(side === "hard" ? "brain-pill--active-hard" : "brain-pill--active-soft");
      }
    }
    function deactivateSide(side) {
      scene.classList.remove(side === "hard" ? "brain-scene--hover-hard" : "brain-scene--hover-soft");
      (side === "hard" ? scanL : scanR).style.opacity = "0";
      var pills = side === "hard" ? hardPills : softPills;
      for (i = 0; i < pills.length; i++) {
        pills[i].classList.remove(side === "hard" ? "brain-pill--active-hard" : "brain-pill--active-soft");
      }
    }
    function dimOthers(except) {
      for (i = 0; i < allPills.length; i++) {
        if (allPills[i] !== except) allPills[i].style.opacity = "0.35";
      }
    }
    function undimAll() {
      for (i = 0; i < allPills.length; i++) allPills[i].style.opacity = "1";
    }

    if (hoverL) {
      hoverL.addEventListener("mouseenter", function () {
        activateSide("hard");
      });
      hoverL.addEventListener("mouseleave", function () {
        deactivateSide("hard");
      });
    }
    if (hoverR) {
      hoverR.addEventListener("mouseenter", function () {
        activateSide("soft");
      });
      hoverR.addEventListener("mouseleave", function () {
        deactivateSide("soft");
      });
    }

    var isHovered = false;
    var cycleIdx = 0;
    var cycleTimer = null;

    for (i = 0; i < allPills.length; i++) {
      (function (pill) {
        var isHard = pill.classList.contains("brain-pill--hard");
        var ac = isHard ? "brain-pill--active-hard" : "brain-pill--active-soft";
        var sc = isHard ? "brain-scene--hover-hard" : "brain-scene--hover-soft";
        var scanEl = isHard ? scanL : scanR;

        pill.addEventListener("mouseenter", function () {
          isHovered = true;
          pill.classList.add(ac);
          scene.classList.add(sc);
          scanEl.style.opacity = "1";
          dimOthers(pill);
          var cat = pill.getAttribute("data-category") || "";
          var tip = pill.getAttribute("data-tip") || "";
          if (tooltip) {
            tooltip.innerHTML = "<strong>" + cat + "</strong><br>" + tip;
            tooltip.classList.add("brain-scene__tooltip--show");
          }
        });

        pill.addEventListener("mousemove", function (e) {
          if (!tooltip) return;
          var r = scene.getBoundingClientRect();
          var x = e.clientX - r.left + 14;
          var y = e.clientY - r.top - 40;
          if (x + 190 > r.width) x = e.clientX - r.left - 190;
          tooltip.style.left = x + "px";
          tooltip.style.top = y + "px";
        });

        pill.addEventListener("mouseleave", function () {
          isHovered = false;
          pill.classList.remove(ac);
          scene.classList.remove(sc);
          scanEl.style.opacity = "0";
          undimAll();
          if (tooltip) tooltip.classList.remove("brain-scene__tooltip--show");
        });

        pill.addEventListener("click", function (e) {
          if (!svg || !rl) return;
          var r = svg.getBoundingClientRect();
          var cx = (e.clientX - r.left) * (760 / r.width);
          var cy = (e.clientY - r.top) * (600 / r.height);
          var color = isHard ? "rgba(32,210,160,0.7)" : "rgba(244,167,40,0.7)";
          var c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          c.setAttribute("cx", cx);
          c.setAttribute("cy", cy);
          c.setAttribute("r", "4");
          c.setAttribute("fill", "none");
          c.setAttribute("stroke", color);
          c.setAttribute("stroke-width", "2");
          c.classList.add("brain-scene__ripple");
          rl.appendChild(c);
          setTimeout(function () {
            c.remove();
          }, 650);
        });
      })(allPills[i]);
    }

    function clearAllHighlights() {
      scene.classList.remove("brain-scene--hover-hard", "brain-scene--hover-soft");
      if (scanL) scanL.style.opacity = "0";
      if (scanR) scanR.style.opacity = "0";
      for (i = 0; i < allPills.length; i++) {
        allPills[i].classList.remove("brain-pill--active-hard", "brain-pill--active-soft");
        allPills[i].style.opacity = "1";
      }
    }

    function startCycle() {
      cycleTimer = setInterval(function () {
        if (isHovered) return;
        clearAllHighlights();
        var p = allPills[cycleIdx % allPills.length];
        if (!p) return;
        var isH = p.classList.contains("brain-pill--hard");
        p.classList.add(isH ? "brain-pill--active-hard" : "brain-pill--active-soft");
        scene.classList.add(isH ? "brain-scene--hover-hard" : "brain-scene--hover-soft");
        (isH ? scanL : scanR).style.opacity = "0.5";
        dimOthers(p);
        cycleIdx++;
      }, 1800);
    }

    scene.addEventListener("mouseenter", function () {
      isHovered = true;
      clearInterval(cycleTimer);
      clearAllHighlights();
    });
    scene.addEventListener("mouseleave", function () {
      isHovered = false;
      startCycle();
    });

    setTimeout(startCycle, 2800);
  }

  function initAlskillBrainDashboard(hostEl, categoryScores) {
    if (!hostEl) return;
    hostEl.innerHTML = brainSceneHtml();
    var scene = hostEl.querySelector(".brain-scene");
    if (!scene) return;
    wireBrainScene(scene, categoryScores || {});
  }

  global.initAlskillBrainDashboard = initAlskillBrainDashboard;
})(typeof window !== "undefined" ? window : globalThis);
