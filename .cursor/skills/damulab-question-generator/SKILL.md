---
name: damulab-question-generator
description: >-
  Writes 03-questions.draft.json for a Damulab run: bilingual RU/KK SCQ/MCQ/FILL_IN
  questions built slot by slot from 02-matrix.json and facts from 01-source-slice.json,
  with error-based distractors, KaTeX formulas and matrixDeviations for any deviation.
  Use when asked to generate the question draft, write questions from a matrix,
  сгенерировать черновик вопросов, написать вопросы по матрице, наполнить пачку заданий,
  or as the generator step of damulab-question-pipeline.
---

# Damulab: генератор черновика вопросов

Роль 3 пайплайна [damulab-question-pipeline](../damulab-question-pipeline/SKILL.md).
Ты не придумываешь тему и не решаешь, сколько чего надо: **идёшь по слотам матрицы**
и превращаешь каждый в готовый двуязычный вопрос на фактах из slice.

| Что | Где |
|-----|-----|
| Вход | `02-matrix.json` — слоты (`type`, `difficulty`, `skillFocus`, `stemIdea`, `trapIdeas`, `needsIllustration`, `sourceRuleIds`) |
| Вход | `01-source-slice.json` — `rules`, примеры (`usable: true`), `textbookRef`, `generatorProfile` |
| Вход | `00-brief.json` — `languageMode`, `illustrationPolicy`, `methodistInstruction` |
| Выход | `03-questions.draft.json`: `schemaVersion`, `runId`, `meta`, `questions[]`, `matrixDeviations[]` |
| Выход | журнал `logs/generator.md` — на что опирался, где было тесно с материалом |

Формат вопроса — `QuestionSeed` из [contracts.md](../damulab-question-pipeline/contracts.md)
(там же таблица всех полей и блок `meta`, который дублируется в `05`). Стилевые правила
формулировок и возрастная лексика — [damulab-question-seed](../damulab-question-seed/SKILL.md)
и [schema.md](../damulab-question-seed/schema.md); текст промпта —
[content/prompts/question-seed-generation.md](../../../content/prompts/question-seed-generation.md).

## Компактные примеры

SCQ:

```json
{
  "localId": "q01", "type": "SCQ", "difficulty": 2,
  "bodyRu": "На координатном луче единичный отрезок — 1 клетка. Какое число соответствует точке B, если она правее начала O на 7 клеток?",
  "bodyKk": "Координаталық сәуледе бірлік кесінді — 1 торкөз. Егер B нүктесі O бас нүктесінен оңға 7 торкөз қашықтықта болса, оған қандай сан сәйкес келеді?",
  "explanationRu": "Координата точки — число единичных отрезков от начала O.",
  "explanationKk": "Нүктенің координатасы — O бас нүктесінен санағандағы бірлік кесінділер саны.",
  "source": "Алдамуратова, 5 кл, ч.1, стр. 9-13",
  "needsIllustration": false, "illustration": null,
  "options": [
    { "label": "A", "textRu": "6", "textKk": "6", "correct": false },
    { "label": "B", "textRu": "7", "textKk": "7", "correct": true },
    { "label": "C", "textRu": "8", "textKk": "8", "correct": false },
    { "label": "D", "textRu": "0", "textKk": "0", "correct": false }
  ],
  "fillAnswers": [], "sourceRuleIds": ["R004"]
}
```

FILL_IN:

```json
{
  "localId": "q11", "type": "FILL_IN", "difficulty": 3,
  "bodyRu": "Вычисли: 918 : 3 = [[1]].",
  "bodyKk": "Есепте: 918 : 3 = [[1]].",
  "explanationRu": "Делим по разрядам: 9:3=3, 1:3=0 (остаток 1), 18:3=6.",
  "explanationKk": "Разряд бойынша бөлеміз: 9:3=3, 1:3=0 (қалдық 1), 18:3=6.",
  "source": "Алдамуратова, 5 кл, ч.1, стр. 24-27",
  "needsIllustration": false, "illustration": null,
  "options": [],
  "fillAnswers": [ { "placeholder": "[[1]]", "answer": "306", "matchMode": "NUMERIC_TOLERANCE", "tolerance": 0 } ],
  "sourceRuleIds": ["R005"]
}
```

## Работа по слотам

Идёшь по `slots[]` **в порядке `localId`**; `localId`, `type`, `difficulty` и
`sourceRuleIds` берутся из слота как есть. Любое отклонение — запись в `matrixDeviations`:

```json
{ "localId": "q05", "field": "type", "planned": "MCQ", "actual": "SCQ",
  "reason": "В slice нет материала на несколько верных вариантов без подсказки" }
```

Молча менять тип, сложность или привязку к правилу нельзя: ревьюер пометит это как
`matrix_mismatch`. `stemIdea` и `skillFocus` — обязательная рамка сюжета, а не пожелание.

## `questionForm`: форма формулировки задана слотом

У слота есть поле `questionForm` — оно определяет, **о чём просят ученика**, и брать
самую короткую форму («Вычисли: a · b») там, где слот просит другую, нельзя.

| `questionForm` | Как это звучит в `bodyRu` |
|----------------|---------------------------|
| `recall` | «Что нужно сделать с произведением дальше?», «Как называется …?» |
| `compute` | «Вычисли: … = [[1]]», «Найди значение произведения» |
| `predict` | «Не выполняя умножения, определи, сколько цифр будет после запятой» |
| `verify` | «Айгуль записала 0,45 · 3 = 13,5. Верно ли это? В чём ошибка?» |
| `restore` | «Какое число пропущено: 1,2 · [[1]] = 6?» |
| `compare` | «Что больше: 2,5 · 4 или 1,5 · 7?» |
| `word_problem` | «Масса одного пакета 0,85 кг. Какова масса 6 пакетов?» |
| `inverse` | «При каком наименьшем натуральном множителе произведение станет целым?» |

Три задания подряд формы «Вычисли: a · b» — брак, даже если числа разные и `duplicate_body`
не срабатывает: пачка читается однообразно и проверяет один и тот же навык. Если слот
требует формы, для которой в срезе не хватает материала, — это `matrixDeviations`
с внятной причиной, а не тихий возврат к `compute`.

Форма `verify` (проверить чужой ответ) и `restore` (восстановить пропущенное) особенно
полезны при бедном срезе: они делаются из тех же чисел, что и `compute`, но проверяют
понимание правила, а не навык счёта.

## Двуязычность RU/KK

- полная пара у `bodyRu`/`bodyKk`, `explanationRu`/`explanationKk` (оба заполнены либо оба `null`),
  и у **каждого** варианта — `textRu` и `textKk`;
- KK — естественный школьный казахский (кириллица), не калька с русского: считай, что
  текст читает казахоязычный пятиклассник, а не переводчик;
- одинаковый смысл и одинаковая сложность в двух языках; нельзя упрощать KK-версию;
- не смешивать языки внутри одного поля; термины — согласованно с учебником
  (`generatorProfile.formatRules` и формулировки `rules[].statement` из slice);
- **не смешивать алфавиты внутри слова.** Казахская `і` (U+0456) и латинская `i` (U+0069)
  выглядят одинаково, но это разные символы: «тексеремiз» с латинской `i` ломает поиск по
  банку вопросов и озвучку. То же с `о`/`o`, `е`/`e`, `а`/`a`, `с`/`c`, `р`/`p`, `х`/`x`.
  Валидатор ловит это кодом `mixed_script`; законные исключения — латиница внутри формулы
  `$...$`, единицы и аббревиатуры через пробел или дефис (`PISA-ның`), обозначение величины
  из одной заглавной латинской буквы с кириллическим индексом (`Sтөрт`).

## Дистракторы (SCQ/MCQ)

- 4 варианта, `label` — `A`, `B`, `C`, `D`, уникальны; оба языка у каждого;
- каждый неверный вариант = результат конкретной ошибки из `trapIdeas` слота;
- SCQ — ровно один `correct: true`; MCQ — минимум один, обычно 2–3, и остальные должны
  быть по-настоящему неверными;
- нельзя: «все варианты верны», «нет верного ответа», варианты разной длины и
  детальности (когда правильный заметно длиннее и подробнее — это подсказка);
- порядок вариантов не должен намекать (не держи правильный всегда на `B`).

## FILL_IN

- плейсхолдеры `[[1]]`, `[[2]]`, … — **одинаковое множество** в `bodyRu` и `bodyKk`
  и ровно то же в `fillAnswers[].placeholder`;
### `matchMode`: числа проверяются по значению, а не по строке

Режим выбирается **не по вкусу**, а по тому, как реально сравнивает ответ
`kz.damulab.testing.AnswerChecker`:

| `matchMode` | Как сравнивает | Ключ `53,4` примет |
|-------------|----------------|--------------------|
| `EXACT` | `trim()` и посимвольное равенство | только `53,4` |
| `NORMALIZED` | `trim`, запятая → точка, схлопывание пробелов, нижний регистр | `53,4`, `53.4`, но **не** `53,40` |
| `NUMERIC_TOLERANCE` | `BigDecimal` по значению: `|ответ − ключ| ≤ tolerance` | `53,4`, `53.4`, `53,40`, `+53.4` |
| `REGEXP` | регулярное выражение по всей строке, регистр не важен | что описано в шаблоне |

Отсюда правила выбора:

| Какой ответ | `matchMode` | `tolerance` |
|-------------|-------------|-------------|
| **любое число** — целое или дробное (`306`, `53,4`, `0,072`) | `NUMERIC_TOLERANCE` | `0` |
| число с погрешностью — округление, приближённое значение | `NUMERIC_TOLERANCE` | нужная точность, например `0.01` |
| короткий текст (термин, название, «да»/«нет») | `NORMALIZED` | `null` |
| проверяется именно **форма записи** («запиши с двумя знаками после запятой») | `REGEXP` | `null` |
| дробь-строка, где важна запись (`3/8`) | `EXACT` | `null` |

`tolerance: 0` — это не «нулевая погрешность на всякий случай», а штатный способ сказать
«числовое равенство»: ученик с `53.4` и `53,40` получит зачёт, а с `53,5` — нет.

Два запрета, которые ловит валидатор:

- **единицы в ключе** (`5,1 кг`) при `NUMERIC_TOLERANCE` — `BigDecimal` такую строку не
  разберёт и верный ответ никогда не примется (`fill_numeric_answer_invalid`). Единицы
  оставляй в тексте задания: «Ответ дай в килограммах: [[1]] кг»;
- **дробный числовой ключ при `EXACT`/`NORMALIZED`** — `fill_numeric_mode_required`.

При любом режиме кроме `NUMERIC_TOLERANCE` поле `tolerance` строго `null`.

## Прочее

- `source` заполняется **всегда** — обычно `meta.textbookRef` (учебник + страницы из slice).
- Формулы — KaTeX (`$...$`), в JSON обратные слэши экранировать: `"$\\frac{3}{8}$"`.
- `needsIllustration` копируется из слота; `illustration` в черновике **всегда `null`**
  (файлы рисует illustrator в `06` после ревью). Маркеры `{{IMG:…}}` в тексте запрещены.

## Запреты

- Не копировать длинные абзацы учебника дословно — переформулировать в задание.
- Не подсказывать ответ в теле задания (ни числом, ни «как известно, получится …»).
- Не выходить за `generatorProfile.safetyAndScope` из slice (например десятичные дроби
  и проценты — часть 2, их в 5 классе части 1 нет).
- Не писать SVG/PNG и не заполнять `illustration` объектом — это роль illustrator.
- Не ставить `subjectId` / `topicIds` / `gradeIds` и не использовать `MATCHING`.
- Не проставлять `status`, id БД и `matchingPairs` — это забота загрузчика.

## Чеклист перед сдачей `03-questions.draft.json`

- [ ] `schemaVersion: 1`, `runId`, блок `meta` как в `05` (см. contracts.md)
- [ ] число вопросов = число слотов; `localId` совпадают со слотами один в один
- [ ] распределение `type` и `difficulty` совпало с матрицей (иначе — `matrixDeviations`)
- [ ] у всех непустые `bodyRu`, `bodyKk`, `source`, непустой `sourceRuleIds`
- [ ] SCQ: ровно один `correct: true`; MCQ: минимум один; ≥ 2 (обычно 4) варианта с оба языка
- [ ] FILL_IN: `options: []`, множества `[[n]]` в двух языках = `fillAnswers[].placeholder`
- [ ] FILL_IN: у каждого числового ключа `NUMERIC_TOLERANCE`; при точном равенстве `tolerance: 0`;
      единиц в ключе нет
- [ ] `tolerance` заполнен только при `NUMERIC_TOLERANCE`; иначе `null`
- [ ] `questionForm` слота соблюдён; одинаковых форм в пачке не больше двух
- [ ] в KK-полях нет слов со смешением кириллицы и латиницы
- [ ] `meta.sourceReliability` = `unverified_reconstruction`, если матрица прислала
      непустой `sourceQuality.unverifiedRuleIds`; иначе `verbatim`
- [ ] SCQ/MCQ: `fillAnswers: []`
- [ ] при `illustrationPolicy: none` — все `needsIllustration: false`, `illustration: null`
- [ ] `logs/generator.md`: опора на правила/примеры, где материала не хватило
