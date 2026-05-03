---
name: kz-textbook-parser
description: Parse Kazakhstan school textbooks from PDF into a standardized JSON schema with metadata, topics, rules, examples, and confidence-based quality report. Use when the user asks to parse textbooks, extract curriculum structure, or prepare generation-ready datasets from учебник/PDF.
---

# KZ Textbook Parser

## Purpose

Build consistent, generation-ready JSON from school textbooks (RU/KK) with explicit extraction quality.

## When To Use

Use this skill when the user asks to:
- parse a textbook PDF to JSON;
- extract topics/pages/rules/examples from учебник;
- prepare structured data for AI task generation aligned with Kazakhstan school context.

## Output Contract

Always produce JSON with these top-level blocks:
- `source`
- `metadata`
- `topics_with_pages`
- `rules`
- `example_tasks_v2`
- `generator_profile_kz_moem`

If some data is unavailable, keep fields with `null`/empty arrays and explain in `quality_report.note`.

## Required JSON Shape

Use this baseline structure:

```json
{
  "source": {
    "file_name": "",
    "parsed_at": "YYYY-MM-DD",
    "version": "v2",
    "extraction_method": {
      "pdf_text_layer": true,
      "ocr_applied": false,
      "ocr_languages": []
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
  "topics_with_pages": [],
  "rules": [],
  "example_tasks_v2": {
    "verbatim_examples": [],
    "verbatim_examples_status": {
      "available": false,
      "reason": "",
      "next_step": ""
    },
    "structural_examples_for_generation": []
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

## Workflow

1. **Read source PDF**  
   Try PDF text extraction first.

2. **Extract and map core entities**
   - `metadata`: title, authors, class, part, year, ISBN, publisher.
   - `topics_with_pages`: lesson/section/topic + `page_start` (+ optional estimated end).
   - `rules`: definitions/formulas/algorithms with `source_page`.

3. **Build examples**
   - `verbatim_examples`: only when exact text can be read reliably.
   - `structural_examples_for_generation`: always provide templates aligned to textbook style.

4. **Assign confidence**
   - `high`: cleanly parsed title/contents/glossary blocks.
   - `medium`: OCR-derived but readable fragments.
   - `low`: noisy fragments requiring manual cleanup.

5. **Write quality report**
   Fill confidence block lists and one concise `note` with limitations.

6. **Validate output**
   Ensure JSON is syntactically valid and fields are consistently named.

## Quality Rules

- Do not invent factual metadata (year/ISBN/pages).
- Keep `raw_text` separate from `normalized_text` when examples are OCR-derived.
- Use page references whenever possible.
- Keep terminology aligned with the textbook.

## Subject Adaptation Rule

Adjust `task_type` and `generator_profile_kz_moem` to subject:
- Math: `calculation`, `word_problem`, `measurement`, `geometry`, `sets_logic`.
- Language subjects (e.g., Kazakh): reading comprehension, grammar/spelling, vocabulary, text analysis.
- Science: concept check, classification, observation, short explanation, applied context.

## Final Response Style

When done, report:
- output JSON path;
- what was extracted with high confidence;
- what remains medium/low confidence;
- one practical next step (e.g., OCR cleanup or manual review sample).
