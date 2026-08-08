# Контракты артефактов прогона

Единый источник истины для всех ролей пайплайна и для подготовки импорта через
админку. Java-слоя seed (`kz.damulab.seed`, Gradle `validateSeed` / `seedImport`) в
приложении Damulab **нет**. Если меняешь поле — правь этот файл и скиллы ролей
(особенно [damulab-question-seed](../damulab-question-seed/SKILL.md)).

Проверку контракта делает ревьюер по чеклисту; детерминированный валидатор при
желании можно позже вынести в отдельный репо/скрипт **вне** Spring.

`schemaVersion` сейчас = `1`.

## Папка прогона

```text
content/runs/{subject}-{grade}-{topicSlug}-{YYYYMMDD-HHMM}/
  00-brief.json               заказ на прогон
  01-source-slice.json        срез учебника (analyst)
  02-matrix.json              матрица слотов (matrix)
  03-questions.draft.json     черновик (generator)
  04-review.json              разбор ревьюера
  05-questions.final.json     принятый контент БЕЗ id БД — коммитим
  .local/                     опционально, машинозависимое, в .gitignore
    06-import-payload.json    заготовка QuestionImportRequest с id текущей БД (вручную)
  logs/
    analyst.md matrix.md generator.md reviewer.md orchestrator.md
```

Имя прогона — латиница kebab-case: `math-5-koordinatnyy-luch-20260804-1015`.

Типы вопросов v1: **SCQ, MCQ, FILL_IN**. `MATCHING` не используется — ревьюер
отклоняет такой слот.

---

## 00-brief.json — заказ на прогон

Собирает оркестратор из реплики пользователя. Если поля нет — **спросить**, не угадывать.
Исключение: `illustrationPolicy` при молчании пользователя = `"none"`.

```json
{
  "schemaVersion": 1,
  "runId": "math-5-koordinatnyy-luch-20260804-1015",
  "createdAt": "2026-08-04T10:15:00+05:00",
  "subjectRu": "Математика",
  "subjectKk": "Математика",
  "gradeNo": 5,
  "topicRu": "Координатный луч. Изображение натуральных чисел и числа нуль на координатном луче",
  "topicKk": "Координаталық сәуле. Натурал сандарды және нөл санын координаталық сәулеге салу",
  "topicSlug": "koordinatnyy-luch",
  "topicCode": "1.2",
  "atomicSkillRu": null,
  "atomicSkillKk": null,
  "count": 12,
  "typeMix": { "SCQ": 7, "MCQ": 3, "FILL_IN": 2 },
  "difficultyMix": { "1": 1, "2": 2, "3": 6, "4": 2, "5": 1 },
  "illustrationPolicy": "none",
  "illustrationFor": [],
  "parsedTextbookPath": "Математика/parsed/math_aldamuratova_5grade_part1_parsed_v2.json",
  "methodistInstruction": null,
  "languageMode": "BOTH"
}
```

| Поле                 | Обяз. | Смысл                                                                             |
| -------------------- | ----- | --------------------------------------------------------------------------------- |
| `runId`              | да    | Совпадает с именем папки прогона                                                  |
| `subjectRu/Kk`       | да    | Предмет. Переезжает в `05` как `meta.subjectTitleRu/Kk` — ключ резолва предмета   |
| `gradeNo`            | да    | Класс числом; по нему резолвится `Grade` в БД                                     |
| `topicRu/Kk`         | да    | Название темы. В `05` это `meta.topicTitleRu/Kk` — запасной ключ резолва темы     |
| `topicSlug`          | да    | Латиница kebab-case, попадает в имя папки                                         |
| `topicCode`          | нет   | `topic_code` из учебника (`"1.2"`) — основной ключ резолва темы                   |
| `count`              | да    | Обычно 10–15                                                                      |
| `typeMix`            | да    | Сумма значений = `count`; допустимы только SCQ/MCQ/FILL_IN                        |
| `difficultyMix`      | нет   | `null` → дефолт ~20 % (1–2) / 50 % (3) / 30 % (4–5)                                |
| `illustrationPolicy` | да    | `none` (дефолт) / `explicit` / `all` / `visual-topics` — см. ниже                  |
| `parsedTextbookPath` | да    | Путь к parsed v2 JSON (относительно корня этого репо или абсолютный) — навигация |
| `pdfTextbookPath`    | нет   | Путь к PDF; если пуст — аналитик ищет по `source.file_name` в этом репо |
| `languageMode`       | да    | Пока всегда `BOTH`                                                                |

`illustrationPolicy`: `none` | `explicit` | `all` | `visual-topics`.

- `none` — матрица везде `needsIllustration: false`; роль illustrator не вызывается.
- иначе — матрица ставит флаги по политике; после `05` идёт роль illustrator → `06` +
  `illustrations/`. В `05` поле `illustration` остаётся `null` (ассеты живут только в `06`).
- **Импорт текста вопросов** в банк v1 по-прежнему без картинок. Импорт ассетов —
  отдельный будущий агент по `05`+`06` (см. ниже). Не путать: прогон с картинками
  **не** останавливается на `05`, а доводится до `06` со статусом готовности
  `ready_for_asset_import`.

---

## 01-source-slice.json — срез учебника (analyst)

```json
{
  "schemaVersion": 1,
  "runId": "math-5-koordinatnyy-luch-20260804-1015",
  "textbook": {
    "path": "C:/.../math_aldamuratova_5grade_part1_parsed_v2.json",
    "pdfPath": "C:/.../Математика Алдамуратова Т. учебник для 5 класса Часть 1.pdf",
    "titleRu": "Математика. Учебник для учащихся 5 класса общеобразовательной школы",
    "authorsShort": "Алдамуратова",
    "grade": 5,
    "part": 1,
    "publisher": "Атамура",
    "year": 2017
  },
  "unit": {
    "lessonNo": 3,
    "section": "I",
    "sectionTitle": "Натуральные числа и нуль",
    "topicCode": "1.2",
    "topicTitle": "Координатный луч. Изображение натуральных чисел и числа нуль на координатном луче",
    "pageStart": 9,
    "pageEnd": 13,
    "supplementary": false
  },
  "textbookRef": "Алдамуратова, 5 кл, ч.1, стр. 9-13",
  "rules": [
    {
      "ruleId": "PDF_p9_1",
      "name": "Координатный луч",
      "statement": "Координатный луч — луч с началом O, единичным отрезком и направлением слева направо; каждой точке соответствует число.",
      "formula": null,
      "sourcePages": [9, 10],
      "origin": "verbatim_from_pdf",
      "binding": "page_in_range",
      "role": "primary",
      "confidence": "high_verbatim",
      "needsManualCheck": false,
      "evidence": "pdf/png pages 9-10 (pdfOffset=0); перекрёстно rules[].rule_id=R004"
    }
  ],
  "verbatimExamples": [
    {
      "exactPage": 9,
      "text": "1. Начертите луч с началом в точке О, направленный слева направо.",
      "taskType": "geometry",
      "confidence": "medium_ocr",
      "usable": true,
      "note": null
    }
  ],
  "structuralExamples": [
    {
      "taskType": "geometry",
      "template": "Начерти координатный луч с единичным отрезком 1 см. Отметь точки A(3), B(8). Сравни числа 3 и 8.",
      "expectedSkill": "Координатный луч, сравнение чисел"
    }
  ],
  "generatorProfile": {
    "audience": "Учащиеся 5 класса общеобразовательных школ Республики Казахстан",
    "taskMixRecommended": { "calculation": 0.4, "word_problem": 0.25, "geometry": 0.1 },
    "formatRules": ["Три уровня сложности: А (базовый), В (продвинутый), С (творческий)"],
    "safetyAndScope": ["Только программа 5 класса части 1"]
  },
  "blockStructureNotes": "Правило даётся на стр. 9-10, дальше 4 страницы упражнений; рисунки 1.1-1.4 — координатные лучи.",
  "sliceStatus": "ready",
  "recommendedMaxCount": null,
  "gaps": ["verbatim-примеры обрываются на первой строке задания (OCR)"],
  "ocrConfidence": "medium"
}
```

Соответствие полям источников:

| Поле slice                | Источник                                                                 |
| ------------------------- | ------------------------------------------------------------------------ |
| `textbook.path`           | `brief.parsedTextbookPath`                                               |
| `textbook.pdfPath`        | PDF по `source.file_name` в **этом** репо (корень / `Математика/` / …)   |
| `textbook.*` (мета)       | parsed `metadata`                                                        |
| `unit.*`                  | элемент `topics_with_pages[]`                                            |
| `rules[]`                 | **страницы PDF** (дословно); parsed `rules[]` / `KF_*` — перекрёстная сверка |
| `verbatimExamples[]`      | задания со страниц PDF; parsed `verbatim_examples` — запасной/сверка     |
| `structuralExamples[]`    | parsed `structural_examples_for_generation[]` по смыслу + задания с PDF  |
| `generatorProfile`        | `generator_profile_kz_moem`                                              |
| `ocrConfidence`           | качество чтения страниц (PNG/OCR/текстовый слой)                         |

**Parsed не содержит текста уроков** — только навигацию (темы, страницы, выборочные
`rules[]`, ~3 строки примеров, профиль генератора). Первоисточник формулировок —
PDF; читать диапазон через `content/tools/read-textbook-pages.js` (см. скилл аналитика).

`usable: false` — обрывок, из которого нельзя восстановить задание; генератор его не берёт.

### Маркировка правил

| Поле               | Значения                                                                                   | Смысл                                                        |
| ------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `origin`           | `verbatim_from_pdf` \| `verbatim_extracted` \| `verbatim_assembled` \| `verbatim_from_examples` \| `reconstructed` | откуда взят текст правила |
| `binding`          | `explicit_link` \| `page_in_range` \| `reference_page` \| `title_match` \| `neighbour_page` | почему правило отнесено к этой теме                          |
| `role`             | `primary` \| `prerequisite`                                                                | правило темы или предпосылка из соседней темы                |
| `confidence`       | `high_verbatim` \| `medium_assembled` \| `medium_ocr` \| `low_reconstructed`                | насколько текст близок к учебнику                            |
| `needsManualCheck` | boolean                                                                                    | `true` у любой реконструкции: нужна сверка с бумажным учебником |
| `evidence`         | строка                                                                                     | ссылка на PDF/PNG страницы или на место в parsed             |

Предпочтительный `origin` — `verbatim_from_pdf`. `ruleId` с PDF: `PDF_p{стр}_{n}`;
реконструкция — `RC_*`. Parsed-id (`R004`, склейка `KF_*`) допустим, если текст
сверен со страницей.

### `sliceStatus` — итог среза

| Значение           | Когда                                                                    | Что делает оркестратор                        |
| ------------------ | ------------------------------------------------------------------------ | --------------------------------------------- |
| `ready`            | есть хотя бы одно `primary`-правило с verbatim-происхождением (предпочтительно с PDF) | обычный ход |
| `ready_unverified` | все `primary`-правила реконструированы (или есть `needsManualCheck: true`) | идём дальше, но пачка помечается как непроверенная |
| `blocked`          | страницы PDF нечитаемы / PDF не найден, **или** нет ни правил, ни пригодных примеров | стоп по теме |

`recommendedMaxCount` — сколько вопросов срез реально выдерживает (`null` = без ограничения,
`8` при одном правиле или менее трёх пригодных примеров, `6` при реконструкции без примеров).

---

## 02-matrix.json — план слотов (matrix designer)

```json
{
  "schemaVersion": 1,
  "runId": "math-5-koordinatnyy-luch-20260804-1015",
  "typeMixPlanned": { "SCQ": 7, "MCQ": 3, "FILL_IN": 2 },
  "difficultyMixPlanned": { "1": 1, "2": 2, "3": 6, "4": 2, "5": 1 },
  "slots": [
    {
      "localId": "q01",
      "type": "SCQ",
      "difficulty": 2,
      "skillFocus": "Чтение координаты точки на луче",
      "stemIdea": "Дан луч с единичным отрезком; какое число соответствует точке B",
      "trapIdeas": [
        "Отсчёт от 1, а не от 0",
        "Путаница единичного отрезка и деления"
      ],
      "needsIllustration": false,
      "illustrationReason": null,
      "sourceRuleIds": ["R004"],
      "sourceExampleRefs": ["p9#1"],
      "questionForm": "compute"
    }
  ],
  "sourceQuality": {
    "sliceStatus": "ready",
    "unverifiedRuleIds": []
  },
  "notes": "Слоты q10-q12 — FILL_IN на подсчёт координаты, чтобы не дублировать SCQ."
}
```

Правила:

- количество слотов = `brief.count`; распределение типов **точно** равно `brief.typeMix`;
- `sourceRuleIds` не пустой — каждый слот привязан к правилу из slice с `role: "primary"`.
  Правило с `role: "prerequisite"` в `sourceRuleIds` слота ставить нельзя;
- реконструированное правило (`RC_*`) — **полноценная опора для слота**. Матрица не
  придумывает обходных путей и не отказывается работать: она копирует `sliceStatus` слайса
  в `sourceQuality.sliceStatus` и перечисляет все использованные `RC_*` в
  `sourceQuality.unverifiedRuleIds`. Дальше эта пометка едет в `05` как
  `meta.sourceReliability`;
- если слот сделан от примера — дополнительно `sourceExampleRefs: ["p9#1"]`
  (`p{exactPage}#{номер задания}`), но правило всё равно указывается;
- `questionForm` — форма задания из фиксированного списка (см. ниже), не больше двух слотов
  на одну форму;
- `needsIllustration` строго по `brief.illustrationPolicy`; при `none` — везде `false`;
  при `visual-topics` — `true` только если без рисунка stem неполный (луч, множества, угол,
  диаграмма, развёртка и т.п.), причина в `illustrationReason`;
- `localId` сквозные `q01`, `q02`, … и совпадают с `03`/`05`.

### `questionForm` — форма задания

Одно и то же правило можно проверить по-разному; без явного поля генератор берёт самую
короткую форму, и пачка выходит однообразной («Вычисли: a · b» три раза).

| `questionForm`    | О чём просят ученика                                          |
| ----------------- | ------------------------------------------------------------- |
| `recall`          | назвать правило, признак, термин                              |
| `compute`         | вычислить значение                                            |
| `predict`         | сказать результат «не вычисляя» (сколько знаков, чётно ли, знак) |
| `verify`          | проверить чужой ответ или готовое равенство, найти ошибку      |
| `restore`         | восстановить пропущенное число или шаг                         |
| `compare`         | сравнить два выражения или две записи                         |
| `word_problem`    | текстовая задача с бытовым сюжетом                            |
| `inverse`         | обратная задача: дан результат, найти исходное                 |

`sourceQuality.sliceStatus` копируется из slice, `unverifiedRuleIds` — список `RC_*`-правил,
на которых стоят слоты (пустой массив, если таких нет).

---

## 03-questions.draft.json — черновик (generator)

```json
{
  "schemaVersion": 1,
  "runId": "math-5-koordinatnyy-luch-20260804-1015",
  "meta": { "...": "тот же блок meta, что в 05-questions.final.json" },
  "questions": [ "...QuestionSeed..." ],
  "matrixDeviations": [
    {
      "localId": "q05",
      "field": "type",
      "planned": "MCQ",
      "actual": "SCQ",
      "reason": "В slice нет материала на несколько верных вариантов без подсказки"
    }
  ]
}
```

Генератор не меняет слоты матрицы молча: любое отклонение — запись в `matrixDeviations`.

### QuestionSeed — общий формат вопроса (03 и 05)

```json
{
  "localId": "q01",
  "type": "SCQ",
  "difficulty": 2,
  "bodyRu": "На координатном луче единичный отрезок равен 1 клетке. Какое число соответствует точке B, если она правее начала на 7 клеток?",
  "bodyKk": "Координаталық сәуледе бірлік кесінді 1 торкөзге тең. Егер B нүктесі бас нүктеден оңға қарай 7 торкөз қашықтықта болса, оған қандай сан сәйкес келеді?",
  "explanationRu": "Координата точки — число единичных отрезков от начала O.",
  "explanationKk": "Нүктенің координатасы — O бас нүктесінен санағандағы бірлік кесінділер саны.",
  "source": "Алдамуратова, 5 кл, ч.1, стр. 9-13",
  "needsIllustration": false,
  "illustration": null,
  "options": [
    { "label": "A", "textRu": "6", "textKk": "6", "correct": false },
    { "label": "B", "textRu": "7", "textKk": "7", "correct": true },
    { "label": "C", "textRu": "8", "textKk": "8", "correct": false },
    { "label": "D", "textRu": "0", "textKk": "0", "correct": false }
  ],
  "fillAnswers": [],
  "sourceRuleIds": ["R004"]
}
```

| Поле                                | Тип                              | Правило                                                     |
| ----------------------------------- | -------------------------------- | ----------------------------------------------------------- |
| `localId`                           | `q01`…                           | уникален в пачке, совпадает со слотом матрицы               |
| `type`                              | `SCQ` \| `MCQ` \| `FILL_IN`      | `MATCHING` запрещён                                         |
| `difficulty`                        | 1..5                             | оценивается по заданию, не копируется на всю пачку          |
| `bodyRu` / `bodyKk`                 | string                           | оба непустые, один смысл и одна сложность                   |
| `explanationRu` / `explanationKk`   | string \| null                   | либо оба заполнены, либо оба `null`                         |
| `source`                            | string                           | непустой; обычно `meta.textbookRef`                         |
| `needsIllustration`                 | boolean                          | при политике `none` всегда `false`                          |
| `illustration`                      | object \| null                   | при политике `none` всегда `null`                           |
| `options`                           | array                            | только SCQ/MCQ; для FILL_IN — `[]`                          |
| `fillAnswers`                       | array                            | только FILL_IN; для SCQ/MCQ — `[]`                          |
| `sourceRuleIds`                     | array of string                  | из какого правила/примера slice сделан вопрос               |

`options[]`: `label` (A/B/C/D, уникален), `textRu`, `textKk` (**оба** непустые), `correct`.
Минимум 2 варианта, обычно 4. SCQ — ровно один `correct: true`, MCQ — минимум один.

`fillAnswers[]`:

```json
{ "placeholder": "[[1]]", "answer": "53,4", "matchMode": "NUMERIC_TOLERANCE", "tolerance": 0 }
```

- `matchMode`: `EXACT` | `NORMALIZED` | `NUMERIC_TOLERANCE` | `REGEXP`;
- `tolerance` заполняется **только** при `NUMERIC_TOLERANCE` (неотрицательное число),
  во всех остальных режимах строго `null`;
- множество плейсхолдеров `[[n]]` в `bodyRu` и в `bodyKk` должно **совпадать**
  с множеством `placeholder` — без лишних и без пропущенных.

Как режимы работают на самом деле (`kz.damulab.testing.AnswerChecker`):

| `matchMode`         | Сравнение                                                | Ключ `53,4` примет                  |
| ------------------- | -------------------------------------------------------- | ----------------------------------- |
| `EXACT`             | посимвольно, только `trim()`                             | только `53,4`                       |
| `NORMALIZED`        | `trim` + запятая → точка + схлопывание пробелов + регистр | `53,4`, `53.4`; **не** `53,40`      |
| `NUMERIC_TOLERANCE` | `BigDecimal` по значению, `|ответ − ключ| ≤ tolerance`     | `53,4`, `53.4`, `53,40`, `+53.4`    |
| `REGEXP`            | регулярное выражение по всей строке, регистр не важен     | то, что описано в шаблоне           |

Отсюда правило выбора: **любой числовой ответ идёт с `NUMERIC_TOLERANCE`**, при точном
равенстве — с `tolerance: 0`. Погрешность больше нуля ставится только там, где она правда
нужна (округление, приближённое значение). Валидатор блокирует дробный числовой ключ при
`EXACT`/`NORMALIZED` кодом `fill_numeric_mode_required` и нечисловой ключ при
`NUMERIC_TOLERANCE` кодом `fill_numeric_answer_invalid` — `BigDecimal` не разберёт «5,1 кг»,
и верный ответ никогда не примется, поэтому единицы остаются в тексте задания.

---

## 04-review.json — разбор ревьюера

```json
{
  "schemaVersion": 1,
  "runId": "math-5-koordinatnyy-luch-20260804-1015",
  "reviewedAt": "2026-08-04T11:02:00+05:00",
  "summary": { "total": 12, "accepted": 10, "fixed": 1, "rejected": 1, "rejectRate": 0.08 },
  "items": [
    {
      "localId": "q01",
      "status": "accepted",
      "solvedAnswer": "7",
      "keyAnswer": "B — 7",
      "matchesKey": true,
      "issues": [],
      "fixApplied": null
    },
    {
      "localId": "q11",
      "status": "rejected",
      "solvedAnswer": "12",
      "keyAnswer": "[[1]] = 21",
      "matchesKey": false,
      "issues": [
        { "code": "answer_key_wrong", "severity": "blocker", "message": "Ключ не сходится с решением" }
      ],
      "fixApplied": null
    }
  ],
  "duplicates": [
    {
      "localId": "q07",
      "conflictsWith": "content/runs/math-5-sravnenie-20260801-0930/05-questions.final.json#q03",
      "normalizedBody": "na koordinatnom luche ..."
    }
  ],
  "verdict": "ready_for_import"
}
```

- `status`: `accepted` | `fixed` | `rejected`. Провальный слот — `rejected` с причиной,
  а не «тихая починка смысла».
- `verdict`: `ready_for_import` | `needs_rework`. `needs_rework`, если `rejectRate > 0.3`
  или остался хотя бы один `blocker`.
- В `05-questions.final.json` попадают только `accepted` и `fixed`.

Коды issue (список открытый, но эти — базовые):
`answer_key_wrong`, `scq_multiple_correct`, `mcq_no_correct`, `fill_placeholder_mismatch`,
`tolerance_misuse`, `fill_numeric_mode_required`, `fill_numeric_answer_invalid`,
`mixed_script`, `kk_parity`, `kk_calque`, `answer_leak_in_body`, `matrix_mismatch`,
`duplicate_body`, `question_form_repeated`, `out_of_scope`, `illustration_not_allowed`.

`fill_numeric_mode_required`, `fill_numeric_answer_invalid` и `mixed_script` ревьюер
проверяет по чеклисту (смешение алфавитов в KK особенно коварно — смотри слова с `i`/`і`).

---

## 05-questions.final.json — принятый контент (коммитим)

**Никаких id БД.** Файл одинаков на всех машинах; связывание с базой — работа загрузчика.

```json
{
  "meta": {
    "schemaVersion": 1,
    "runId": "math-5-koordinatnyy-luch-20260804-1015",
    "generatedAt": "2026-08-04T11:05:00+05:00",
    "subjectTitleRu": "Математика",
    "subjectTitleKk": "Математика",
    "gradeNo": 5,
    "topicCode": "1.2",
    "topicTitleRu": "Координатный луч. Изображение натуральных чисел и числа нуль на координатном луче",
    "topicTitleKk": "Координаталық сәуле. Натурал сандарды және нөл санын координаталық сәулеге салу",
    "topicSlug": "koordinatnyy-luch",
    "atomicSkillTitleRu": null,
    "textbookRef": "Алдамуратова, 5 кл, ч.1, стр. 9-13",
    "illustrationPolicy": "none",
    "sourceReliability": "verbatim"
  },
  "questions": [ "...QuestionSeed..." ]
}
```

`meta.sourceReliability` — доехавшая до финала пометка аналитика:

| Значение                     | Когда                                                              | Что делает валидатор                             |
| ---------------------------- | ------------------------------------------------------------------ | ------------------------------------------------ |
| `verbatim`                   | `sliceStatus: "ready"` — правило взято со страниц PDF (или сверено с ними) | молчит |
| `unverified_reconstruction`  | `sliceStatus: "ready_unverified"` — правило восстановлено аналитиком | предупреждение `source_reconstructed_unverified` (не блокирует импорт) |

Поле необязательное: у пачек, собранных до появления маркировки, его нет — это читается
как `verbatim`.

Запрещённые ключи (валидатор падает, если встретит их где угодно в файле):
`subjectId`, `topicIds`, `gradeIds`, `atomicSkillId`, `gradeId`, `topicId`.

Как это читается загрузчиком:

| Поле `meta`          | Резолв в БД                                                        |
| -------------------- | ------------------------------------------------------------------ |
| `subjectTitleRu`     | `Subject` по нормализованному `titleRu`                            |
| `gradeNo`            | `Grade` по номеру класса                                           |
| `topicCode`          | `Topic.code` (сравнение по slug-нормализации: `1.2` ≡ `1-2`)       |
| `topicTitleRu`       | запасной резолв темы внутри найденных subject + grade              |
| `atomicSkillTitleRu` | `AtomicSkill` внутри найденной темы, если задан                    |
| `textbookRef`        | подставляется в `source` вопроса, если у вопроса он пуст           |

---

## 06-illustrations.json — манифест иллюстраций (illustrator)

Пишет роль [damulab-question-illustrator](../damulab-question-illustrator/SKILL.md)
**после** принятого `05`. Файл `05` **не мутируется**: связь вопрос ↔ картинка только по
`runId` + `localId`.

Файлы картинок: `illustrations/qXX.svg` (канон) и опционально `illustrations/qXX.png`
(растр из того же SVG). Пути в манифесте — **относительные** от корня папки прогона.

```json
{
  "schemaVersion": 1,
  "runId": "math-5-koordinatnyy-luch-20260804-1015",
  "sourceFinal": "05-questions.final.json",
  "styleProfile": "aldamuratova-textbook-simple",
  "items": [
    {
      "localId": "q01",
      "status": "ready",
      "role": "stem",
      "sceneKind": "coordinate_ray",
      "purpose": "Показать точки A, B, C на луче; ответ в options, не на рисунке",
      "answerLeakCheck": "pass",
      "asset": {
        "path": "illustrations/q01.svg",
        "format": "svg",
        "width": 720,
        "height": 240,
        "raster": null
      },
      "scene": {
        "kind": "coordinate_ray",
        "originLabel": "O",
        "unitCount": 8,
        "points": [{ "id": "A", "value": 2 }, { "id": "B", "value": 5 }]
      },
      "notes": null
    }
  ]
}
```

| Поле | Тип | Правило |
|------|-----|---------|
| `schemaVersion` | number | сейчас `1` |
| `runId` | string | совпадает с папкой прогона и `05.meta.runId` |
| `sourceFinal` | string | обычно `"05-questions.final.json"` |
| `styleProfile` | string | сейчас `"aldamuratova-textbook-simple"` |
| `items[]` | array | ноль или больше; пустой массив — валидный no-op |

`items[]`:

| Поле | Тип | Правило |
|------|-----|---------|
| `localId` | `q01`… | есть в `05`; уникален в `items` |
| `status` | `ready` \| `skipped` \| `blocked` | импортёр ассетов берёт только `ready` |
| `role` | string | в v1 только `"stem"` |
| `sceneKind` | string | см. список ниже |
| `purpose` | string | зачем рисунок в stem (одна фраза) |
| `answerLeakCheck` | `pass` \| `fail` | при `fail` → `status: blocked`, файлов нет |
| `asset` | object \| null | обязателен при `ready`; `null` при `blocked`/`skipped` |
| `scene` | object \| null | scene-spec; обязателен при `ready` |
| `notes` | string \| null | опционально |

`asset` при `ready`:

| Поле | Тип | Правило |
|------|-----|---------|
| `path` | string | относительный путь к SVG, напр. `illustrations/q01.svg` |
| `format` | `"svg"` | канон всегда SVG |
| `width` / `height` | number | viewBox / пиксельный размер кадра |
| `raster` | object \| null | `{ "path": "illustrations/q01.png", "format": "png" }` или `null` |

Допустимые `sceneKind` (первая волна + запас под темы):
`coordinate_ray`, `number_line_decimals`, `set_euler`, `set_venn`, `angle`,
`protractor`, `polygon`, `bar_chart`, `line_chart`, `pie_chart`, `table`,
`parallelepiped`, `net_parallelepiped`.

Правила отбора слотов:
- только `needsIllustration: true` в `02-matrix.json`;
- только `accepted` / `fixed` в `04-review.json` и присутствие в `05`;
- при `illustrationPolicy: none` файл `06` можно не создавать (оркестратор не зовёт роль);
  если создали — `items: []`.

Запрещено в `06` и на рисунке: id БД, base64, URL продакшена, токены; предложения RU/KK
на SVG; подсветка/подпись правильного ответа; лекционные типы (памятка, инфографика, декор).

Рендер: `content/tools/render-illustration-svg.js` (scene → SVG; `--png` → PNG через
`@resvg/resvg-js`).

---

## Потребитель `05`+`06`: будущий asset-import агент

Иллюстратор **не** заливает картинки на сайт. Отдельный агент (будущий скилл вроде
`damulab-question-asset-loader`, рядом с [damulab-question-loader](../damulab-question-loader/SKILL.md))
читает прогон и грузит ассеты в банк/админку, когда появится ручка вроде
`POST /api/admin/question-assets`.

Контракт заточен под него:
- ключ связи — только `runId` + `localId` (как в `05`); без id БД в `06`;
- пути относительные от корня прогона; primary = `asset.path` (SVG), растр = `asset.raster`;
- импортёр берёт `items` со `status: "ready"`; `blocked`/`skipped` пропускает;
- `05` остаётся чистым текстом (`illustration: null`): вопросы и картинки можно грузить
  в разные дни — сначала вопросы (получили id в банке), потом ассеты по тому же `runId`/`localId`;
- итог прогона с картинками: локально `ready_for_asset_import`; вызов импорта — только
  по явной просьбе пользователя.

Скилл asset-import в этом репо **пока не реализован** — только этот крючок, чтобы не ломать `06`.

---

## Импорт вопросов в банк (вне пайплайна генерации)

`05-questions.final.json` **не** содержит id БД. Резолв `subjectTitleRu` / `gradeNo` /
`topicCode` → id и вызов импорта — через админку (`/admin/questions/import` или
`POST /api/admin/question-imports`), см. [damulab-question-loader](../damulab-question-loader/SKILL.md).
Это импорт **текста** вопросов. Картинки из `06` сюда не входят.

Опциональная заготовка под текущую машину (не коммитить). Не путать с артефактом пайплайна
`06-illustrations.json` в корне прогона:

### .local/06-import-payload.json

Ровно то, что принимает `QuestionImportRequest` / админ-импорт, уже с id **этой** БД.
Готовится вручную (или внешним скриптом вне Spring), не Gradle-задачей приложения.

```json
{
  "questions": [
    {
      "subjectId": 3,
      "topicIds": [42],
      "gradeIds": [5],
      "atomicSkillId": null,
      "type": "SCQ",
      "difficulty": 2,
      "bodyRu": "...",
      "bodyKk": "...",
      "source": "Алдамуратова, 5 кл, ч.1, стр. 9-13",
      "explanationRu": "...",
      "explanationKk": "...",
      "status": "NEEDS_REVIEW",
      "options": [ { "label": "A", "textRu": "6", "textKk": "6", "correct": false } ],
      "matchingPairs": [],
      "fillAnswers": []
    }
  ]
}
```

| Поле `meta` в `05`   | Что подставить при сборке payload                                  |
| -------------------- | ------------------------------------------------------------------ |
| `subjectTitleRu`     | `subjectId` предмета с таким `titleRu`                             |
| `gradeNo`            | `gradeIds` класса с таким номером                                  |
| `topicCode` / title  | `topicIds` темы внутри предмета и класса                           |
| `atomicSkillTitleRu` | `atomicSkillId`, если навык есть                                   |
| `textbookRef`        | в `source` вопроса, если у вопроса он пуст                         |

Тема не найдена или неоднозначна — **стоп по этой теме**. Темы автоматически не
создаются: недостающие заводятся руками или через `POST /api/admin/topics/import`.
