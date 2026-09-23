# Контракты артефактов лекционного прогона

Единый источник истины для всех ролей лекционного пайплайна.
Если меняешь поле — правь этот файл и скиллы ролей.

`schemaVersion` сейчас = `1`.

## Папка прогона

```text
content/runs-lectures/
  _coverage.md                        общий индекс всех лекций (корень)
  <предмет>/<класс>/                  зеркалит sources/ и parsed_outputs/
    _coverage.md                      индекс лекций этого предмета+класса
    {topicSlug}-{YYYYMMDD-HHMM}/      один прогон = одна тема
      00-brief.json                   (~2 КБ, коммитим)
      01-lecture-source.json          (~10 КБ, коммитим)
      02-lecture-plan.json            (~5 КБ, коммитим)
      03-lecture.draft.md             (~8 КБ, коммитим)
      04-lecture-review.json          (~5 КБ, коммитим)
      05-lecture.final.md             ✅ главный результат (~8 КБ, коммитим)
      .local/pages/                   PNG+TXT страниц, manifest (тяжёлое, в .gitignore)
      logs/                           журналы ролей (в .gitignore)
```

Пример:
```text
content/runs-lectures/
  математика/5 класс/
    koordinatnyy-luch-20260923-1030/
      00-brief.json … 05-lecture.final.md
      .local/pages/  logs/
    _coverage.md
  казахский язык/4 класс/
    ...
```

`<предмет>/<класс>` — те же имена, что в `sources/` и `parsed_outputs/`
(например `математика/5 класс`, `история казахстана/4 класс`).
Папка прогона внутри — короткий `{topicSlug}-{метка времени}`, без дублирования
предмета и класса (они уже есть в пути). `runId` = имя папки прогона.

Имя прогона — латиница kebab-case: `math-5-koordinatnyy-luch-20260923-1030`.

---

## 00-brief.json — заказ на прогон

```json
{
  "schemaVersion": 1,
  "runId": "math-5-koordinatnyy-luch-20260923-1030",
  "createdAt": "2026-09-23T10:30:00+05:00",
  "subjectRu": "Математика",
  "subjectKk": "Математика",
  "gradeNo": 5,
  "topicRu": "Координатный луч",
  "topicKk": "Координаталық сәуле",
  "topicSlug": "koordinatnyy-luch",
  "topicCode": "1.2",
  "parsedTextbookPath": "parsed_outputs/математика/5 класс/math_aldamuratova_5grade_part1_parsed_v2.json",
  "pdfTextbookPath": "sources/математика/5 класс/Математика Алдамуратова 5 класс Часть 1.pdf",
  "languageMode": "BOTH",
  "targetLength": "short",
  "methodistInstruction": null
}
```

| Поле | Обяз. | Смысл |
| ---- | ----- | ----- |
| `runId` | да | совпадает с именем папки |
| `subjectRu/Kk` | да | предмет |
| `gradeNo` | да | класс числом |
| `topicRu/Kk` | да | название темы |
| `topicSlug` | да | латиница kebab-case |
| `topicCode` | нет | код темы из учебника |
| `parsedTextbookPath` | да* | путь к parsed v2 (*или `pdfTextbookPath`) |
| `languageMode` | да | `BOTH` / `RU` / `KK` |
| `targetLength` | да | `short` (400–600 слов/язык) / `medium` (800–1200) |
| `methodistInstruction` | нет | пожелания учителя |

---

## 01-lecture-source.json — выжимка учебника (parser)

```json
{
  "schemaVersion": 1,
  "runId": "...",
  "textbook": {
    "path": "..._parsed_v2.json",
    "pdfPath": "C:/.../учебник.pdf",
    "titleRu": "...",
    "authorsShort": "Алдамуратова",
    "grade": 5,
    "part": 1,
    "publisher": "Атамура",
    "year": 2017
  },
  "unit": {
    "topicCode": "1.2",
    "topicTitle": "Координатный луч",
    "pageStart": 9,
    "pageEnd": 13
  },
  "textbookRef": "Алдамуратова, 5 кл, ч.1, стр. 9-13",
  "keyIdeas": [
    {
      "ideaId": "K1",
      "title": "Координатный луч",
      "statement": "Дословная формулировка из учебника",
      "formula": null,
      "sourcePages": [9, 10],
      "origin": "verbatim_from_pdf",
      "confidence": "high_verbatim",
      "needsManualCheck": false,
      "evidence": "pdf p.9 правило в рамке"
    }
  ],
  "workedExamples": [
    { "ref": "p9#1", "exactPage": 9, "text": "Текст разобранного примера", "usable": true }
  ],
  "terms": [
    { "ru": "координатный луч", "kk": "координаталық сәуле", "note": null }
  ],
  "sourceStatus": "ready",
  "gaps": [],
  "ocrInfo": { "languages": ["kaz", "rus", "eng"], "confidence": "high", "pdfOffset": 0 }
}
```

- `origin`: `verbatim_from_pdf` | `verbatim_extracted` | `reconstructed`.
- `confidence`: `high_verbatim` | `medium_ocr` | `low_reconstructed`.
- `sourceStatus`: `ready` | `ready_unverified` | `blocked`.
- Реконструкция (`reconstructed`) всегда с `needsManualCheck: true`.

---

## 02-lecture-plan.json — план лекции (planner)

```json
{
  "schemaVersion": 1,
  "runId": "...",
  "audience": "Ученик 5 класса",
  "goals": ["Понять, что такое координатный луч", "Научиться находить координату точки"],
  "blocks": [
    {
      "blockId": "b1",
      "kind": "hook",
      "titleRu": "Зачем нам луч с числами?",
      "titleKk": "Сандар сәулесі не үшін керек?",
      "sourceIdeaIds": [],
      "targetWords": 60,
      "notes": "Жизненный пример, без новых терминов"
    },
    {
      "blockId": "b2",
      "kind": "explanation",
      "titleRu": "Что такое координатный луч",
      "titleKk": "Координаталық сәуле дегеніміз не",
      "sourceIdeaIds": ["K1"],
      "targetWords": 150,
      "notes": "Строго по K1, шаги построения списком"
    },
    {
      "blockId": "b3",
      "kind": "example",
      "titleRu": "Смотрим пример из учебника",
      "titleKk": "Оқулықтағы мысалды қараймыз",
      "sourceIdeaIds": ["K1"],
      "targetWords": 120,
      "notes": "Разобрать p9#1 по шагам"
    },
    {
      "blockId": "b4",
      "kind": "check",
      "titleRu": "Проверь себя",
      "titleKk": "Өзіңді тексер",
      "sourceIdeaIds": ["K1"],
      "targetWords": 80,
      "notes": "2–3 вопроса без новых фактов"
    }
  ],
  "termsToExplain": ["координатный луч / координаталық сәуле"],
  "coverageCheck": { "allPrimaryCovered": true, "uncovered": [] }
}
```

`kind`: `hook` | `explanation` | `example` | `check` | `recap`.
Каждый `primary`-keyIdea из `01` должен быть покрыт хотя бы одним блоком
`explanation` — иначе `allPrimaryCovered: false` и оркестратор возвращает план.

---

## 03-lecture.draft.md и 05-lecture.final.md — текст лекции

Markdown, структура строго по блокам `02`:

```markdown
# Лекция: Координатный луч / Координаталық сәуле

> Учебник: Алдамуратова, 5 кл, ч.1, стр. 9-13. Класс: 5.

## 1. Зачем нам луч с числами? / Сандар сәулесі не үшін керек?

[RU-текст...]

[KK-текст...]

## 2. Что такое координатный луч / Координаталық сәуле дегеніміз не

...
```

Правила:
- заголовки двуязычные `RU / KK` в одном заголовке;
- под каждым заголовком сначала RU-абзац, потом KK-абзац (при `languageMode: BOTH`);
- формулы — KaTeX `$...$`, обратные слэши экранировать не нужно (это MD, не JSON);
- в конце — блок `## Проверь себя / Өзіңді тексер` с 2–3 вопросами и краткими ответами;
- никаких фактов вне `01`; никаких id БД.

---

## 04-lecture-review.json — разбор ревьюера

```json
{
  "schemaVersion": 1,
  "runId": "...",
  "reviewedAt": "2026-09-23T11:00:00+05:00",
  "summary": { "blocksChecked": 4, "accepted": 3, "fixed": 1, "rejected": 0 },
  "items": [
    {
      "blockId": "b2",
      "status": "fixed",
      "issues": [
        { "code": "fact_mismatch", "severity": "blocker", "message": "В черновике луч направлен вправо без начала O, в учебнике — с началом O" }
      ],
      "fixApplied": "Вернул начало O по K1"
    }
  ],
  "verdict": "ready"
}
```

- `status`: `accepted` | `fixed` | `rejected`.
- `verdict`: `ready` | `needs_rework` (`needs_rework` при любом `blocker` или `rejected`).
- Коды issue: `fact_mismatch`, `invented_fact`, `out_of_scope`, `too_hard_language`,
  `kk_calque`, `kk_parity`, `mixed_script`, `plan_mismatch`, `formula_broken`,
  `missing_source`, `answer_leak_in_check`.
- Severity: `blocker` | `major` | `minor`.
