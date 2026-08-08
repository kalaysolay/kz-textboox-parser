(() => {
  "use strict";

  const QUESTION_CANDIDATES = [
    "05-questions.final.json",
    "03-questions.draft.json",
    "05-questions.json",
    "questions.final.json",
    "questions.json",
  ];

  const state = {
    lang: "ru",
    showAnswers: true,
    showExplanations: true,
    filterType: "all",
    pack: null,
    illustrations: null,
    assetUrls: Object.create(null), // relative path -> blob/http url
    sourceLabel: "",
    activeRunId: null,
  };

  const el = {
    packTitle: document.getElementById("pack-title"),
    packMeta: document.getElementById("pack-meta"),
    empty: document.getElementById("empty"),
    stats: document.getElementById("stats"),
    questions: document.getElementById("questions"),
    runsPanel: document.getElementById("runs-panel"),
    runsList: document.getElementById("runs-list"),
    runsCount: document.getElementById("runs-count"),
    fileJson: document.getElementById("file-json"),
    fileFolder: document.getElementById("file-folder"),
    toggleAnswers: document.getElementById("toggle-answers"),
    toggleExplanations: document.getElementById("toggle-explanations"),
    filterType: document.getElementById("filter-type"),
  };

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function normalizeRel(p) {
    return String(p || "").replace(/\\/g, "/").replace(/^\.\//, "");
  }

  function pickQuestionFile(names) {
    const set = new Set(names.map(normalizeRel));
    for (const c of QUESTION_CANDIDATES) {
      if (set.has(c)) return c;
      const nested = [...set].find((n) => n.endsWith("/" + c) || n === c);
      if (nested) return nested;
    }
    const loose = [...set].find(
      (n) =>
        /questions/i.test(n) &&
        n.endsWith(".json") &&
        !/(^|\/)(00-|01-|02-|04-|06-)/.test(n)
    );
    return loose || null;
  }

  function stripCommonPrefix(paths) {
    if (!paths.length) return paths;
    const parts = paths.map((p) => p.split("/").filter(Boolean));
    const minLen = Math.min(...parts.map((p) => p.length));
    let i = 0;
    while (i < minLen - 1 && parts.every((p) => p[i] === parts[0][i])) i++;
    if (i === 0) return paths;
    return paths.map((p) => p.split("/").filter(Boolean).slice(i).join("/"));
  }

  async function readJsonFromFile(file) {
    const text = await file.text();
    return JSON.parse(text);
  }

  function revokeAssets() {
    for (const url of Object.values(state.assetUrls)) {
      if (url && url.startsWith("blob:")) URL.revokeObjectURL(url);
    }
    state.assetUrls = Object.create(null);
  }

  async function loadFromFolderFiles(fileList) {
    const files = [...fileList];
    if (!files.length) throw new Error("Папка пуста");

    const entries = files.map((f) => ({
      file: f,
      path: normalizeRel(f.webkitRelativePath || f.name),
    }));

    // Drop the top folder name from webkitRelativePath: "runId/05-...."
    const rels = entries.map((e) => e.path);
    const stripped = stripCommonPrefix(rels);
    const byRel = Object.create(null);
    entries.forEach((e, i) => {
      byRel[stripped[i]] = e.file;
      byRel[e.path] = e.file;
    });

    const qName = pickQuestionFile(stripped);
    if (!qName) throw new Error("Не найден JSON вопросов (ожидался 05-questions.final.json)");

    const questions = await readJsonFromFile(byRel[qName]);
    let illustrations = null;
    const illName =
      stripped.find((n) => n === "06-illustrations.json" || n.endsWith("/06-illustrations.json")) ||
      null;
    if (illName && byRel[illName]) {
      try {
        illustrations = await readJsonFromFile(byRel[illName]);
      } catch {
        illustrations = null;
      }
    }

    revokeAssets();
    for (const rel of stripped) {
      if (/\.(svg|png|jpe?g|webp)$/i.test(rel)) {
        state.assetUrls[rel] = URL.createObjectURL(byRel[rel]);
        const base = rel.split("/").pop();
        if (base) state.assetUrls["illustrations/" + base] = state.assetUrls[rel];
      }
    }

    setPack(questions, illustrations, qName + " (папка)");
  }

  async function loadFromJsonFile(file) {
    const questions = await readJsonFromFile(file);
    revokeAssets();
    setPack(questions, null, file.name);
  }

  async function loadFromServerPack(runId) {
    const res = await fetch(`/api/pack/${encodeURIComponent(runId)}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    revokeAssets();
    const base = data.baseUrl || `/runs/${encodeURIComponent(runId)}/`;
    if (data.illustrations && Array.isArray(data.illustrations.items)) {
      for (const item of data.illustrations.items) {
        if (item.status !== "ready" || !item.asset) continue;
        const p = normalizeRel(item.asset.path);
        state.assetUrls[p] = base + p;
        if (item.asset.raster && item.asset.raster.path) {
          const rp = normalizeRel(item.asset.raster.path);
          state.assetUrls[rp] = base + rp;
        }
      }
    }
    state.activeRunId = runId;
    setPack(data.questions, data.illustrations, `${runId}/${data.questionsFile}`);
    highlightActiveRun();
  }

  function setPack(questions, illustrations, sourceLabel) {
    if (!questions || !Array.isArray(questions.questions)) {
      throw new Error("Неверный формат: нужен объект с массивом questions[]");
    }
    state.pack = questions;
    state.illustrations = illustrations;
    state.sourceLabel = sourceLabel || "";
    render();
  }

  function illustrationMap() {
    const map = Object.create(null);
    const items = state.illustrations && state.illustrations.items;
    if (!Array.isArray(items)) return map;
    for (const item of items) map[item.localId] = item;
    return map;
  }

  function assetUrlFor(item) {
    if (!item || !item.asset) return null;
    const svg = normalizeRel(item.asset.path);
    const png = item.asset.raster && item.asset.raster.path
      ? normalizeRel(item.asset.raster.path)
      : null;
    // Prefer SVG when available; fall back to raster.
    if (svg && state.assetUrls[svg]) return state.assetUrls[svg];
    if (png && state.assetUrls[png]) return state.assetUrls[png];
    if (svg) return state.assetUrls[svg] || null;
    return null;
  }

  function bodyField(q) {
    return state.lang === "kk" ? q.bodyKk : q.bodyRu;
  }

  function optionText(opt) {
    return state.lang === "kk" ? opt.textKk : opt.textRu;
  }

  function explanationField(q) {
    return state.lang === "kk" ? q.explanationKk : q.explanationRu;
  }

  function fillAnswerByPlaceholder(q) {
    const map = Object.create(null);
    for (const fa of q.fillAnswers || []) {
      map[fa.placeholder] = fa;
    }
    return map;
  }

  /** Escape HTML, keep $...$ / $$...$$ for KaTeX, inject FILL_IN blanks. */
  function renderStemHtml(q) {
    const raw = bodyField(q) || "";
    const answers = fillAnswerByPlaceholder(q);
    // Split on LaTeX segments so we don't escape inside math.
    const parts = raw.split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g);
    return parts
      .map((part) => {
        if (part.startsWith("$$") || (part.startsWith("$") && part.endsWith("$"))) {
          return part;
        }
        let html = esc(part);
        html = html.replace(/\[\[(\d+)\]\]/g, (_, n) => {
          const ph = `[[${n}]]`;
          const fa = answers[ph];
          if (!fa) {
            return `<span class="fill-blank" title="нет ключа"><span class="ph">${esc(ph)}</span></span>`;
          }
          if (state.showAnswers) {
            return (
              `<span class="fill-blank" title="${esc(fa.matchMode || "")}">` +
              `<span class="ph">${esc(ph)}</span>` +
              `<span class="ans">${esc(fa.answer)}</span>` +
              `</span>`
            );
          }
          return `<span class="fill-slot" title="${esc(ph)}">____</span>`;
        });
        return html;
      })
      .join("");
  }

  function renderOptions(q) {
    if (q.type === "FILL_IN") return "";
    const opts = Array.isArray(q.options) ? q.options : [];
    if (!opts.length) return `<p class="hint">Нет вариантов</p>`;
    return (
      `<div class="options">` +
      opts
        .map((opt) => {
          const correct = !!opt.correct;
          return (
            `<div class="option${correct ? " correct" : ""}">` +
            `<div class="label">${esc(opt.label || "?")}</div>` +
            `<div class="text">${esc(optionText(opt))}</div>` +
            `${correct ? `<div class="mark">✓ верный</div>` : `<div></div>`}` +
            `</div>`
          );
        })
        .join("") +
      `</div>`
    );
  }

  function renderFillKey(q) {
    if (q.type !== "FILL_IN") return "";
    const rows = Array.isArray(q.fillAnswers) ? q.fillAnswers : [];
    if (!rows.length) {
      return `<div class="fill-answers"><h4>FILL_IN</h4><p>Нет fillAnswers</p></div>`;
    }
    return (
      `<div class="fill-answers">` +
      `<h4>Ключ FILL_IN</h4>` +
      `<table class="fill-table">` +
      `<thead><tr><th>Плейсхолдер</th><th>Ответ</th><th>Режим</th><th>Tolerance</th></tr></thead>` +
      `<tbody>` +
      rows
        .map((fa) => {
          const tol =
            fa.matchMode === "NUMERIC_TOLERANCE"
              ? fa.tolerance == null
                ? "—"
                : esc(String(fa.tolerance))
              : "—";
          return (
            `<tr>` +
            `<td class="mono">${esc(fa.placeholder)}</td>` +
            `<td class="answer-cell">${esc(fa.answer)}</td>` +
            `<td><span class="mode-pill">${esc(fa.matchMode || "")}</span></td>` +
            `<td>${tol}</td>` +
            `</tr>`
          );
        })
        .join("") +
      `</tbody></table></div>`
    );
  }

  function renderIllustration(q, illMap) {
    const item = illMap[q.localId];
    if (!item) {
      if (q.needsIllustration) {
        return `<div class="illustration"><div class="illust-cap">needsIllustration=true, но 06-illustrations.json нет ассета для ${esc(q.localId)}</div></div>`;
      }
      return "";
    }
    if (item.status !== "ready") {
      return `<div class="illustration"><div class="illust-cap">Иллюстрация ${esc(q.localId)}: status=${esc(item.status)}${item.notes ? " — " + esc(item.notes) : ""}</div></div>`;
    }
    const url = assetUrlFor(item);
    if (!url) {
      return `<div class="illustration"><div class="illust-cap">Ассет объявлен (${esc(item.asset && item.asset.path)}), файл не загружен. Откройте папку прогона или запустите server.js.</div></div>`;
    }
    const isSvg = /\.svg($|\?)/i.test(url) || (item.asset && item.asset.format === "svg");
    const media = isSvg
      ? `<img src="${esc(url)}" alt="illustration ${esc(q.localId)}" />`
      : `<img src="${esc(url)}" alt="illustration ${esc(q.localId)}" />`;
    const cap = [
      item.sceneKind ? `kind: ${item.sceneKind}` : null,
      item.purpose || null,
    ]
      .filter(Boolean)
      .join(" · ");
    return (
      `<figure class="illustration">${media}` +
      `${cap ? `<figcaption class="illust-cap">${esc(cap)}</figcaption>` : ""}` +
      `</figure>`
    );
  }

  function renderQuestion(q, illMap) {
    const exp = explanationField(q);
    return (
      `<article class="q-card" id="${esc(q.localId)}" data-type="${esc(q.type)}">` +
      `<div class="q-head">` +
      `<div class="q-id">${esc(q.localId)}</div>` +
      `<div class="q-tags">` +
      `<span class="tag type-${esc(q.type)}">${esc(q.type)}</span>` +
      `<span class="tag diff">diff ${esc(q.difficulty)}</span>` +
      `${q.needsIllustration ? `<span class="tag illust">иллюстрация</span>` : ""}` +
      `</div></div>` +
      `<div class="q-body">` +
      `<div class="stem">${renderStemHtml(q)}</div>` +
      renderIllustration(q, illMap) +
      renderOptions(q) +
      renderFillKey(q) +
      `${
        exp
          ? `<div class="explanation"><strong>Разбор</strong>${esc(exp)}</div>`
          : ""
      }` +
      `<div class="q-foot">` +
      `${q.source ? `<span>source: ${esc(q.source)}</span>` : ""}` +
      `${
        Array.isArray(q.sourceRuleIds) && q.sourceRuleIds.length
          ? `<span>rules: ${esc(q.sourceRuleIds.join(", "))}</span>`
          : ""
      }` +
      `</div>` +
      `</div></article>`
    );
  }

  function applyBodyFlags() {
    document.body.classList.toggle("hide-answers", !state.showAnswers);
    document.body.classList.toggle("hide-explanations", !state.showExplanations);
  }

  function typeset(root) {
    if (window.renderMathInElement) {
      window.renderMathInElement(root, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "$", right: "$", display: false },
          { left: "\\(", right: "\\)", display: false },
          { left: "\\[", right: "\\]", display: true },
        ],
        throwOnError: false,
      });
    }
  }

  function render() {
    applyBodyFlags();
    const pack = state.pack;
    if (!pack) {
      el.empty.hidden = false;
      el.stats.hidden = true;
      el.questions.hidden = true;
      el.packTitle.textContent = "Выберите пачку вопросов";
      el.packMeta.textContent = "";
      return;
    }

    el.empty.hidden = true;
    el.stats.hidden = false;
    el.questions.hidden = false;

    const meta = pack.meta || {};
    el.packTitle.textContent =
      meta.topicTitleRu ||
      meta.topicTitleKk ||
      meta.runId ||
      "Пачка вопросов";
    el.packMeta.textContent = [
      meta.subjectTitleRu,
      meta.gradeNo != null ? `${meta.gradeNo} кл` : null,
      meta.topicCode ? `тема ${meta.topicCode}` : null,
      meta.runId,
      state.sourceLabel ? `файл: ${state.sourceLabel}` : null,
    ]
      .filter(Boolean)
      .join(" · ");

    const all = pack.questions || [];
    const filtered =
      state.filterType === "all"
        ? all
        : all.filter((q) => q.type === state.filterType);

    const counts = { SCQ: 0, MCQ: 0, FILL_IN: 0, illust: 0 };
    for (const q of all) {
      if (counts[q.type] != null) counts[q.type]++;
      if (q.needsIllustration) counts.illust++;
    }

    el.stats.innerHTML =
      `<span class="chip"><strong>${all.length}</strong> вопросов</span>` +
      `<span class="chip">SCQ <strong>${counts.SCQ}</strong></span>` +
      `<span class="chip">MCQ <strong>${counts.MCQ}</strong></span>` +
      `<span class="chip">FILL_IN <strong>${counts.FILL_IN}</strong></span>` +
      `<span class="chip">с иллюстрацией <strong>${counts.illust}</strong></span>` +
      `${
        state.filterType !== "all"
          ? `<span class="chip">показано <strong>${filtered.length}</strong></span>`
          : ""
      }`;

    const illMap = illustrationMap();
    el.questions.innerHTML = filtered.map((q) => renderQuestion(q, illMap)).join("");
    typeset(el.questions);
  }

  function highlightActiveRun() {
    for (const btn of el.runsList.querySelectorAll(".run-item")) {
      btn.classList.toggle("active", btn.dataset.runId === state.activeRunId);
    }
  }

  async function loadRunsList() {
    try {
      const res = await fetch("/api/runs");
      if (!res.ok) return;
      const data = await res.json();
      const runs = data.runs || [];
      if (!runs.length) return;
      el.runsPanel.hidden = false;
      el.runsCount.textContent = `(${runs.length})`;
      el.runsList.innerHTML = runs
        .map((r) => {
          const m = r.meta || {};
          return (
            `<button type="button" class="run-item" data-run-id="${esc(r.id)}">` +
            `<div class="run-id">${esc(r.id)}</div>` +
            `<div class="run-topic">${esc(m.topicTitleRu || m.runId || r.id)}</div>` +
            `<div class="run-meta">` +
            `${m.gradeNo != null ? m.gradeNo + " кл · " : ""}` +
            `${m.topicCode ? m.topicCode + " · " : ""}` +
            `${m.questionCount != null ? m.questionCount + " q" : ""}` +
            `${r.hasIllustrations ? " · illust" : ""}` +
            `</div></button>`
          );
        })
        .join("");
    } catch {
      /* opened as file:// or without server — ok */
    }
  }

  // Events
  document.getElementById("btn-open-json").addEventListener("click", () => el.fileJson.click());
  document.getElementById("btn-open-folder").addEventListener("click", () => el.fileFolder.click());

  el.fileJson.addEventListener("change", async () => {
    const file = el.fileJson.files && el.fileJson.files[0];
    if (!file) return;
    try {
      state.activeRunId = null;
      highlightActiveRun();
      await loadFromJsonFile(file);
    } catch (e) {
      alert("Не удалось прочитать JSON: " + (e.message || e));
    } finally {
      el.fileJson.value = "";
    }
  });

  el.fileFolder.addEventListener("change", async () => {
    const list = el.fileFolder.files;
    if (!list || !list.length) return;
    try {
      state.activeRunId = null;
      highlightActiveRun();
      await loadFromFolderFiles(list);
    } catch (e) {
      alert("Не удалось открыть папку: " + (e.message || e));
    } finally {
      el.fileFolder.value = "";
    }
  });

  el.runsList.addEventListener("click", async (ev) => {
    const btn = ev.target.closest(".run-item");
    if (!btn) return;
    try {
      await loadFromServerPack(btn.dataset.runId);
    } catch (e) {
      alert("Не удалось загрузить прогон: " + (e.message || e));
    }
  });

  document.querySelectorAll(".seg-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".seg-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.lang = btn.dataset.lang;
      render();
    });
  });

  el.toggleAnswers.addEventListener("change", () => {
    state.showAnswers = el.toggleAnswers.checked;
    render();
  });
  el.toggleExplanations.addEventListener("change", () => {
    state.showExplanations = el.toggleExplanations.checked;
    render();
  });
  el.filterType.addEventListener("change", () => {
    state.filterType = el.filterType.value;
    render();
  });

  // Deep-link: ?run=math-5-...
  async function boot() {
    applyBodyFlags();
    await loadRunsList();
    const params = new URLSearchParams(location.search);
    const run = params.get("run");
    if (run) {
      try {
        await loadFromServerPack(run);
      } catch (e) {
        console.warn(e);
      }
    }
  }

  boot();
})();
