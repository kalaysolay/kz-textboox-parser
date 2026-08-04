---
name: damulab-textbook-analyst
description: >-
  Locates a textbook unit by topic_code/title via parsed v2 JSON navigation, then
  reads the corresponding PDF page range for verbatim rules and examples, and writes
  01-source-slice.json for the Damulab question pipeline. Use when asked to analyse
  a textbook topic, build a source slice, собрать срез учебника, найти правила и
  примеры по теме, прочитать страницы PDF учебника, or as the analyst step of
  damulab-question-pipeline.
---

# Damulab: аналитик учебника

Роль 1 пайплайна [damulab-question-pipeline](../damulab-question-pipeline/SKILL.md).
Ты находишь единицу содержания (урок / раздел) и **читаешь её страницы в PDF учебника**,
вынося правила и примеры **дословно**. Parsed v2 JSON — навигация и перекрёстная проверка,
не первоисточник формулировок. Формат артефакта —
[contracts.md](../damulab-question-pipeline/contracts.md), раздел `01-source-slice.json`.

| Что | Где |
|-----|-----|
| Вход | `00-brief.json` (`parsedTextbookPath`, `topicCode`, `topicRu`, `gradeNo`) |
| Вход | parsed v2 JSON — оглавление, диапазон страниц, метаданные |
| Вход | PDF учебника (+ кэш OCR/рендер страниц) |
| Выход | `01-source-slice.json` в папке прогона |
| Выход | журнал `logs/analyst.md` |

## Порядок источников (обязательный)

1. **Страницы PDF** (или их PNG/OCR-кэш) — дословные правила, определения, разобранные
   примеры, задания. Это главный источник.
2. **Parsed v2 JSON** — найти тему, диапазон страниц, имя PDF, профиль генератора;
   сверить, что не пропустил правило из `rules[]` / `topic_rule_links`.
3. **Реконструкция** (`origin: "reconstructed"`) — только если страницы прочитаны, правило
   на них явно есть (методический вопрос, рамка «Правило…»), но текст не удаётся надёжно
   выписать (схема, засвет, обрыв). Всегда `needsManualCheck: true`.

Парсер **не обязан** выгружать текст уроков: в parsed нет блоков контента и постраничного
текста. Ожидать формулировки только из `rules[]` / `verbatim_examples[]` — ошибка постановки
(см. G013 в `content/pipeline-gaps.md`).

## Как найти и прочитать PDF

### 1. Навигация по parsed

Открой `brief.parsedTextbookPath`. Возьми:

- `source.file_name` — имя PDF;
- `source.extraction_method.ocr_output_dir` или `text_layer_dir` — кэш страниц (если есть);
- `metadata` — авторы, класс, часть;
- `topics_with_pages[]` — единица содержания и `page_start`…`page_end_estimated`.

Корень учебников = **корень этого репозитория** (рядом с `Математика/`, `content/`, `.cursor/`).
PDF лежит в корне репо или в предметной папке (`Математика/`, `Казахский язык N класс/`).
Имя файла = `source.file_name` (сравнивать точно; пробелы в имени Акпаевой — двойные).
В `brief.parsedTextbookPath` предпочтительны пути относительно корня репо
(например `Математика/parsed/..._parsed_v2.json`); абсолютные тоже допустимы.

### 2. Диапазон страниц учебника

Как раньше: найди тему по `topic_code` / нормализованному названию → `unit.pageStart` /
`unit.pageEnd`. Диапазон **не расширяй**. Supplementary по умолчанию не бери.

### 3. Соответствие «страница учебника ↔ страница PDF»

Номера в `topics_with_pages` — **печатные** страницы учебника. В PDF перед ними могут быть
обложка и форзацы, поэтому:

`pdfPage = bookPage + pdfOffset`.

**Как узнать offset (один раз на книгу):**

```text
node content/tools/read-textbook-pages.js --parsed "<parsed_v2.json>" --detect-offset --out <tmp>
```

Открой `detect_pdf_001.png`…`005.png`, прочитай печатный номер в углу. Если на PDF-странице
N напечатано M, то `pdfOffset = N - M`.

Проверено: **Алдамуратова, 5 класс, часть 2** — PDF 45 = печатная 45 → `pdfOffset = 0`
(192 стр. в PDF = `metadata.page_count`). Для новой книги без проверки offset не угадывай:
либо `--detect-offset`, либо явный `--pdf-offset` от человека.

### 4. Утилита чтения страниц (в этом репо, рядом с учебниками)

```text
node content/tools/read-textbook-pages.js ^
  --parsed "<parsed_v2.json>" ^
  --pages <pageStart>-<pageEnd> ^
  --out "<runDir>/pages" ^
  [--pdf-offset N]
```

Утилита по приоритету:

1. копирует PNG+TXT из кэша парсера (`ocr/ocr_pages_*` или `ocr/ocr_text_*`);
2. иначе рендерит PNG через `pdftoppm` (Poppler);
3. `pdftotext` — только если слой не водяной знак (у Алдамуратовой слой = OKULYK, бесполезен).

В `--out` появятся `page_NNN.png`, опционально `page_NNN.txt`, `manifest.json`.
**Сначала читай PNG** инструментом Read (схемы, рамки правил, казахская типографика).
TXT — подсказка OCR; при расхождении верит PNG.

Если `manifest.summary.allReadable != true` → `sliceStatus: "blocked"`, дальше не иди.

## Порядок работы

1. Открыть parsed: `source`, `metadata`, `topics_with_pages`.
2. Найти единицу содержания (код → название). Несколько кандидатов — в `gaps`, бери с
   совпавшим `topic_code`.
3. Заполнить `unit`, `textbookRef`, `textbook.pdfPath` (абсолютный путь к PDF).
4. Запустить `read-textbook-pages.js` на `pageStart`–`pageEnd`.
5. **Прочитать каждую страницу** (PNG): выписать правила, определения, разобранные примеры,
   типы заданий. Правило, переходящее через разрыв страницы, склеивай в одно.
6. Перекрёстно сверить с `rules[]`, `topic_rule_links`, `example_tasks_v2` — дополнить
   то, что на страницах не видно, но есть в parsed (глоссарий → `binding: reference_page`,
   соседняя тема → `role: prerequisite`). Не подменять дословный текст PDF текстом из parsed,
   если они расходятся: в `statement` — PDF, расхождение — в `gaps`.
7. Собрать `verbatimExamples` / `structuralExamples`, `generatorProfile`, `blockStructureNotes`.
8. Выставить `sliceStatus`, `recommendedMaxCount`, `gaps`, `ocrConfidence`.

## Как маркировать правила

У каждого правила: `origin`, `binding`, `role`, `confidence`, `needsManualCheck`, `evidence`.

| `origin` | Когда | `confidence` | `needsManualCheck` |
|----------|-------|--------------|--------------------|
| `verbatim_from_pdf` | текст выписан со страниц PDF/PNG | `high_verbatim` | `false` |
| `verbatim_extracted` | готовое правило из parsed `rules[]`, подтверждённое страницами или глоссарием | `high_verbatim` | `false` |
| `verbatim_assembled` | склейка `KF_*` из parsed, сверена со страницей | `medium_assembled` | `false` |
| `verbatim_from_examples` | строка правила из parsed-примеров, сверена со страницей | `medium_ocr` | `false` |
| `reconstructed` | страницы читаемы, правило есть, текст не выписывается надёжно | `low_reconstructed` | `true` |

`evidence` для PDF: `pdf p.45-46 rule box` или `png page_045.png + page_046.png`.
`ruleId`: если в parsed есть id и текст совпал — используй его; иначе `PDF_p{стр}_{n}`
(например `PDF_p45_1`). Реконструкция — по-прежнему `RC_*`.

### `binding` (без изменений по смыслу)

| `binding` | Когда |
|-----------|-------|
| `explicit_link` | `topic_rule_links` (primary) |
| `page_in_range` | правило на страницах урока |
| `reference_page` | глоссарий / справочник вне урока, смысл совпал |
| `title_match` | страниц нет, смысл = тема |
| `neighbour_page` | страница соседней темы → `role: "prerequisite"` |

## Диалекты parsed (навигация)

Перед сбором посмотри первый элемент массивов — имена полей плывут между учебниками:

| Сущность | Варианты | Куда |
|----------|----------|------|
| id правила | `rule_id` / `id` | `ruleId` |
| текст | `statement` / `short_formulation` | сверка, не замена PDF |
| страницы правила | `source_pages` / `source_page` | массив `sourcePages` |
| код темы | `topic_code` / нет / `id` | резолв |
| конец диапазона | `page_end_estimated` / только `page_start` | иначе `page_start(next)−1` |
| PDF | `source.file_name` | поиск файла |
| кэш страниц | `ocr_output_dir` / `text_layer_dir` | утилита читает сама |

Полная таблица диалектов для structural/verbatim примеров — как раньше: отбор
`structural_examples` по смыслу `expected_skill`/`template`, не слепо по `topic_refs`
(в математике 5 кл ч.2 `topic_refs` часто сдвинуты относительно `lesson_no`).

## Стоп-критерии: `sliceStatus`

| Условие | `sliceStatus` |
|---------|---------------|
| PDF не найден, диапазон страниц не извлекается, или страница нечитаема (`manifest` / пустой PNG) | `blocked` |
| нет ни одного `primary`-правила **и** нет пригодной опоры для заданий после чтения PDF | `blocked` |
| есть `primary`-правило с `origin: "reconstructed"` / `needsManualCheck: true` и нет более надёжного primary | `ready_unverified` |
| есть хотя бы одно `primary` с verbatim-происхождением (`verbatim_from_pdf` или подтверждённый parsed) | `ready` |

`recommendedMaxCount`: `null` при ≥2 primary и ≥3 пригодных примерах; `8` при одном правиле
или <3 примерах; `6` только при реконструкции без примеров.

## Запреты

- Не писать тестовые вопросы и матрицу.
- Не считать parsed единственным источником формулировок.
- Не выдавать реконструкцию за выдержку.
- Не расширять диапазон страниц урока.
- Не ставить `subjectId` / `topicIds` / `gradeIds`.
- Не тянуть соседние темы как `primary`.

## Чеклист перед сдачей

- [ ] `schemaVersion: 1`, `runId` = имя папки
- [ ] `textbook.pdfPath` заполнен (или явная строка в `gaps`, почему PDF нет)
- [ ] страницы прогнаны через `read-textbook-pages.js`, `manifest.summary.allReadable`
- [ ] правила с урока имеют `origin: "verbatim_from_pdf"` там, где текст взят с PNG/PDF
- [ ] у каждого правила есть `origin`, `binding`, `role`, `confidence`, `needsManualCheck`, `evidence`
- [ ] `RC_*` → `needsManualCheck: true` + строка в `gaps`
- [ ] `sliceStatus` по таблице стоп-критериев
- [ ] `logs/analyst.md`: как нашли PDF, какой offset, что выписано со страниц
