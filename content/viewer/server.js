#!/usr/bin/env node
/**
 * Local preview server for Damulab question packs.
 *
 *   node content/viewer/server.js
 *   → http://localhost:4173
 *
 * Serves the viewer UI and content/runs so illustrations resolve by path.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = Number(process.env.PORT) || 4173;
const ROOT = path.resolve(__dirname);
const CONTENT = path.resolve(__dirname, "..");
const RUNS = path.join(CONTENT, "runs");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(body);
}

function sendJson(res, status, data) {
  send(res, status, JSON.stringify(data, null, 2), {
    "Content-Type": "application/json; charset=utf-8",
  });
}

function safeJoin(base, rel) {
  const resolved = path.resolve(base, rel);
  if (!resolved.startsWith(base + path.sep) && resolved !== base) return null;
  return resolved;
}

function findQuestionJson(dir) {
  const preferred = [
    "05-questions.final.json",
    "03-questions.draft.json",
    "05-questions.json",
    "questions.final.json",
    "questions.json",
  ];
  for (const name of preferred) {
    const p = path.join(dir, name);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return name;
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  const hit = files.find(
    (f) =>
      f.includes("questions") &&
      !f.startsWith("00-") &&
      !f.startsWith("01-") &&
      !f.startsWith("02-") &&
      !f.startsWith("04-") &&
      !f.startsWith("06-")
  );
  return hit || null;
}

function listRuns() {
  if (!fs.existsSync(RUNS)) return [];
  const entries = fs.readdirSync(RUNS, { withFileTypes: true });
  const runs = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (ent.name.startsWith("_") || ent.name.startsWith(".")) continue;
    const dir = path.join(RUNS, ent.name);
    const questionsFile = findQuestionJson(dir);
    if (!questionsFile) continue;
    let meta = {};
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, questionsFile), "utf8"));
      meta = raw.meta || {};
    } catch {
      /* ignore broken packs in listing */
    }
    const hasIllustrations = fs.existsSync(path.join(dir, "06-illustrations.json"));
    const mtime = fs.statSync(path.join(dir, questionsFile)).mtimeMs;
    runs.push({
      id: ent.name,
      questionsFile,
      hasIllustrations,
      mtime,
      meta: {
        runId: meta.runId || ent.name,
        subjectTitleRu: meta.subjectTitleRu || null,
        gradeNo: meta.gradeNo ?? null,
        topicCode: meta.topicCode || null,
        topicTitleRu: meta.topicTitleRu || null,
        questionCount: null,
      },
    });
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, questionsFile), "utf8"));
      runs[runs.length - 1].meta.questionCount = Array.isArray(raw.questions)
        ? raw.questions.length
        : null;
    } catch {
      /* already handled */
    }
  }
  runs.sort((a, b) => b.mtime - a.mtime);
  return runs;
}

function serveFile(res, filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    send(res, 404, "Not found");
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || "application/octet-stream";
  send(res, 200, fs.readFileSync(filePath), { "Content-Type": type });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === "/api/runs") {
    sendJson(res, 200, { runs: listRuns() });
    return;
  }

  if (pathname.startsWith("/api/pack/")) {
    const runId = pathname.slice("/api/pack/".length).replace(/\/+$/, "");
    const dir = safeJoin(RUNS, runId);
    if (!dir || !fs.existsSync(dir)) {
      sendJson(res, 404, { error: "run_not_found" });
      return;
    }
    const questionsFile = findQuestionJson(dir);
    if (!questionsFile) {
      sendJson(res, 404, { error: "questions_not_found" });
      return;
    }
    let questions;
    let illustrations = null;
    try {
      questions = JSON.parse(fs.readFileSync(path.join(dir, questionsFile), "utf8"));
    } catch (e) {
      sendJson(res, 500, { error: "questions_parse_failed", message: String(e.message || e) });
      return;
    }
    const illPath = path.join(dir, "06-illustrations.json");
    if (fs.existsSync(illPath)) {
      try {
        illustrations = JSON.parse(fs.readFileSync(illPath, "utf8"));
      } catch {
        illustrations = null;
      }
    }
    sendJson(res, 200, {
      runId,
      questionsFile,
      baseUrl: `/runs/${encodeURIComponent(runId)}/`,
      questions,
      illustrations,
    });
    return;
  }

  if (pathname === "/" || pathname === "/index.html") {
    serveFile(res, path.join(ROOT, "index.html"));
    return;
  }

  if (pathname.startsWith("/runs/")) {
    const rel = pathname.slice("/runs/".length);
    const filePath = safeJoin(RUNS, rel);
    if (!filePath) {
      send(res, 403, "Forbidden");
      return;
    }
    serveFile(res, filePath);
    return;
  }

  const local = safeJoin(ROOT, pathname.replace(/^\//, ""));
  if (local) {
    serveFile(res, local);
    return;
  }

  send(res, 404, "Not found");
});

server.listen(PORT, () => {
  console.log(`Damulab question viewer → http://localhost:${PORT}`);
  console.log(`Runs root: ${RUNS}`);
});
