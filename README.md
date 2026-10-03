# kz-textboox-parser

Репозиторий школьных учебников Казахстана: PDF, parsed JSON и (опционально) OCR-кэш.

## Парсинг учебников

Запуск, схема работы и журнал версий: [PARSER_GUIDE.md](PARSER_GUIDE.md).
Скилл Cursor: [`.cursor/skills/kz-textbook-parser/SKILL.md`](.cursor/skills/kz-textbook-parser/SKILL.md).
Для Codex тот же скилл зеркалируется в `.agents/skills/kz-textbook-parser/`.

Типичная раскладка:

- `sources/<предмет>/<класс>/` — исходные PDF
- `parsed_outputs/<предмет>/<класс>/` — итоговые JSON
- `ocr/cache/<sha256>/` — общий кэш текста и PNG (локально, в `.gitignore`)
- `ocr/jobs/` — планы структуры, прогресс, метрики (локально)
- `content/tools/` — версионируемые инструменты парсера

## Пайплайн генерации вопросов (Damulab)

Мультиагентный пайплайн живёт **здесь**, рядом с учебниками — не в репозитории платформы Damulab.
Готовые пачки (`05-questions.final.json`) потом импортируются в банк вопросов через админку Damulab.

### Как запустить в Cursor

Одна реплика оркестратору (скилл `damulab-question-pipeline`):

> Сгенерируй 12 вопросов по теме «…» для 5 класса математики.
> Учебник: `parsed_outputs/математика/5 класс/math_aldamuratova_5grade_part1_parsed_v2.json`

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
