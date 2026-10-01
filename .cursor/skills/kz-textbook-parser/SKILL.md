---
name: kz-textbook-parser
description: >-
  Parses Kazakhstan school textbooks from PDF into a standardized JSON schema
  with metadata, topics, rules, examples, and a confidence-based quality report.
  Use when the user asks to parse textbooks, extract curriculum structure, or
  prepare generation-ready datasets from учебник or PDF files.
---

# KZ Textbook Parser

## Purpose / When To Use

Build consistent, generation-ready JSON from school textbooks (RU/KK) with explicit
extraction quality. Use when the user asks to parse a textbook PDF to JSON, extract
topics/pages/rules/examples from an учебник, or prepare structured data for AI task
generation in the Kazakhstan school context.

## Output Contract

Always produce **one single JSON file** — texts and tasks live inside it, downstream
question generation reads only this file. Top-level blocks (v3, backwards-compatible
with v2): `source`, `metadata`, `topics_with_pages`, `rules`, `example_tasks_v2`,
`generator_profile_kz_moem`.

Non-negotiable rules (each rule stated once — do not re-derive it):

- `textbook_tasks` stays **inside** `example_tasks_v2`; never emit a second JSON for tasks.
- Unavailable data → `null` / `[]` plus an explanation in `quality_report.note`;
  status objects use `available`, `reason`, `next_step`.
- Never invent factual metadata (year/ISBN/pages); keep the textbook's own terminology.
- Every `structural_examples_for_generation` entry carries `source_page` — the book page
  where the prototype question was actually met; `null` only when it cannot be established.
- v2 readers must keep working: they ignore unknown optional fields and read only
  `topic_title`/`page_start` and `verbatim_examples`/`structural_examples_for_generation`.
- Keep `raw_text` separate from `normalized_text` when examples are OCR-derived.

## OCR outputs (repository layout)

Everything from an OCR pass (page images, per-page `.txt`, probes, intermediate dumps) goes
into a dedicated subfolder under the repo-root **`ocr/`** folder — e.g.
`ocr/ocr_pages_<book>_<part>/` — never next to the PDF or the final JSON. Point
`source.extraction_method` (and the user) at that path. This keeps regenerable artifacts
out of the main tree and matches `.gitignore` when `ocr/` is ignored.

## Required JSON Shape

Use this baseline structure:

```json
{
  "source": {
    "file_name": "",
    "parsed_at": "YYYY-MM-DD",
    "version": "v3",
    "subject_kind": "stem | text_heavy",
    "extraction_method": {
      "pdf_text_layer": true,
      "ocr_applied": false,
      "ocr_languages": [],
      "full_text_included": false
    },
    "quality_report": {
      "high_confidence_blocks": [],
      "medium_confidence_blocks": [],
      "low_confidence_blocks": [],
      "note": ""
    }
  },
  "metadata": {
    "title": "",
    "subject": "",
    "grade": null,
    "part": null,
    "authors": [],
    "publisher": "",
    "publication_year": null,
    "isbn": {},
    "languages": []
  },
  "topics_with_pages": [
    {
      "lesson_no": null,
      "topic_title": "",
      "page_start": null,
      "page_end_estimated": null,
      "level": "section | chapter | topic | paragraph",
      "parent_id": null,
      "level_path": [],
      "full_text": "",
      "full_text_status": {
        "available": false,
        "truncated": false,
        "chars": 0,
        "source_pages": [],
        "reason": "",
        "next_step": ""
      },
      "key_terms": [],
      "summary_1line": ""
    }
  ],
  "rules": [],
  "example_tasks_v2": {
    "verbatim_examples": [],
    "verbatim_examples_status": {
      "available": false,
      "reason": "",
      "next_step": ""
    },
    "structural_examples_for_generation": [
      {
        "task_type": "",
        "topic_refs": [],
        "template": "",
        "expected_skill": "",
        "source_page": null
      }
    ],
    "textbook_tasks": [
      {
        "task_id": "",
        "topic_ref": null,
        "page": null,
        "rubric": "",
        "question_text": "",
        "task_type": "oral | written | map | table | discussion",
        "expected_answer_if_given": null
      }
    ],
    "textbook_tasks_status": {
      "available": false,
      "count": 0,
      "reason": "",
      "next_step": ""
    }
  },
  "generator_profile_kz_moem": {
    "audience": "",
    "language_policy": {},
    "task_mix_recommended": {},
    "format_rules": [],
    "safety_and_scope": []
  }
}
```

Compatibility notes (v2 → v3), beyond the non-negotiables above:

- All v3 additions are **optional**: `full_text`, `full_text_status`, `level`,
  `parent_id`, `level_path`, `key_terms`, `summary_1line` may be `null`/empty.
- `rules[]` keeps its shape; for text-heavy subjects add optional
  `content_type: "date | term | person | cause_effect"` per rule.
- If `full_text` is not reliably readable, set `full_text: null` and
  `full_text_status.available: false` with `reason` + `next_step`.

## Workflow

1. **Read source PDF** — try a text layer first; if OCR is required, write all outputs under `ocr/<your_subfolder>/` (see **OCR outputs**).
2. **Extract core entities** — `metadata` (title, authors, class, part, year, ISBN, publisher);
   `topics_with_pages` (`page_start` + estimated end, plus for text-heavy subjects
   `level`/`parent_id`/`level_path`, verbatim `full_text` + `full_text_status`,
   `key_terms`, `summary_1line`); `rules` with `source_page`
   (history: key fact/date/term/person as `statement` + `content_type`).
3. **Build examples + textbook tasks in the same file** — `verbatim_examples` only when
   the exact text is reliable; `structural_examples_for_generation` always (with `source_page`);
   `textbook_tasks` = verbatim `Вопросы и задания` with `rubric` mirrored from the book,
   `task_type`, `expected_answer_if_given`.
4. **Assign confidence** — `high`: title/contents/glossary; `medium`: OCR-derived but
   readable; `low`: noisy, needs manual cleanup.
5. **Write quality report** — three confidence lists + one concise `note` with limitations.
6. **Validate output** — JSON syntax + consistent field names (see checklist below).

## Subject Adaptation Rule

Adjust `task_type`, `textbook_tasks.task_type` and `generator_profile_kz_moem` to subject:

- Math: `calculation`, `word_problem`, `measurement`, `geometry`, `sets_logic`.
- Language subjects (e.g., Kazakh): reading comprehension, grammar/spelling, vocabulary, text analysis.
- Science: concept check, classification, observation, short explanation, applied context.
- History / text-heavy (`subject_kind: "text_heavy"`): `oral`, `written`, `map`, `table`,
  `discussion`; rules `content_type`: `date`, `term`, `person`, `cause_effect`.
  `full_text` is required when readable; rubrics must mirror the book
  (`Вопросы и задания`, `Проверь себя`, `Тестовые задания …`).

## Execution Economy (avoid parasitic token use)

- **One rebuild + one QA pass per change batch** — never re-run the whole validation
  suite after every single edit.
- **Never dump artifacts into the conversation**: write probes/dumps to a file
  (`%TEMP%/…`, `ocr/…`) and read only the needed range or a `Select-String` pattern;
  never read whole `.col.txt`, `run.log`, `*.words.json` or the parsed JSON into context.
- **Report counts and paths, not file contents**; don't echo files you just wrote.
- **Reuse existing scripts** (`tools/pdf-extract/*.py` + QA probes); extend them instead
  of authoring a new probe per question.
- **Batch independent commands.** This repo's shell is flaky: on a silent empty output or
  `SyntaxError: Non-UTF-8 code starting with '\x90'`, rerun the *same* command once.
- Cyrillic console output is mojibake and `rg` is absent → write UTF-8 files and read
  them with the read tool; use `Select-String`. Never redirect a script's stdout onto the
  file it writes itself (it gets truncated).

## Validation Checklist

One check per line after the final build — no new ad-hoc probes needed:

1. JSON parses; top-level blocks present; `source.version == "v3"`.
2. `full_text.count("|") == 0` for every topic.
3. No `full_text` shorter than 500 chars except separators (`sec_*`, `ch_*`, `bm_toc`, `bm_title`).
4. Every `structural_examples_for_generation` entry has `source_page`.
5. Every task has `question_text`/`topic_ref`/`rubric`/`page`, `task_type` in the enum,
   ≥4 words, and no duplicate question prefixes.
6. Rubric headers absent from `full_text` (except non-task pages such as `bm_howto`).
7. The log-stats command below → `ошибок 0`.

## Final Response Style

Report four things, briefly (counts and paths, not file contents): the output JSON path
(single file — texts + tasks inside); what is high confidence (`full_text` coverage,
`textbook_tasks` count); what stays medium/low confidence; one practical next step
(OCR cleanup or a manual review sample). Then log stats (idempotent):

```text
python content/tools/log-stats.py parsing "<path_to_parsed_v2.json>"
```

Row goes to the `Парсинг` sheet of `content/stats.xlsx` (local file, gitignored).
