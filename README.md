# kz-textboox-parser

Репозиторий школьных учебников Казахстана: PDF, parsed JSON и (опционально) OCR-кэш.

## Парсинг учебников

Скилл Cursor: [`.cursor/skills/kz-textbook-parser/SKILL.md`](.cursor/skills/kz-textbook-parser/SKILL.md).

Типичная раскладка:

- `Математика/`, `Казахский язык N класс/` — PDF и/или `parsed/`
- `ocr/` — кэш страниц (локально, в `.gitignore`)
- `tools/` — tooling парсера (локально, в `.gitignore`)

## Пайплайн генерации вопросов (Damulab)

Мультиагентный пайплайн живёт **здесь**, рядом с учебниками — не в репозитории платформы Damulab.
Готовые пачки (`05-questions.final.json`) потом импортируются в банк вопросов через админку Damulab.

### Как запустить в Cursor

Одна реплика оркестратору (скилл `damulab-question-pipeline`):

> Сгенерируй 12 вопросов по теме «…» для 5 класса математики.
> Учебник: `Математика/parsed/math_aldamuratova_5grade_part1_parsed_v2.json`

Роли по порядку: analyst → matrix → generator → reviewer.
Импорт в БД — отдельный шаг (`damulab-question-loader`), только по явной просьбе.

### Где что лежит

| Путь | Назначение |
|------|------------|
| `.cursor/skills/damulab-question-pipeline/` | оркестратор + `contracts.md` |
| `.cursor/skills/damulab-textbook-analyst/` | срез учебника с PDF |
| `.cursor/skills/damulab-question-matrix/` | матрица слотов |
| `.cursor/skills/damulab-question-generator/` | черновик вопросов |
| `.cursor/skills/damulab-question-reviewer/` | ревью + финал |
| `.cursor/skills/damulab-question-seed/` | контракт `05-questions.final.json` |
| `.cursor/skills/damulab-question-loader/` | импорт через админку Damulab |
| `content/runs/` | прогоны (`00-brief` … `05-questions.final`) |
| `content/tools/read-textbook-pages.js` | чтение страниц PDF/OCR |
| `content/prompts/` | промпты генерации |
| `content/pipeline-gaps.md` | системные дыры пайплайна |
| `content/runs/_coverage.md` | покрытие тем |

Подробности — в скилле пайплайна и в [`content/tools/README.md`](content/tools/README.md).
