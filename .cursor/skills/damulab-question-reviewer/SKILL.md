---
name: damulab-question-reviewer
description: >-
  Independently solves each drafted Damulab question before looking at the answer key,
  then writes 04-review.json (issues, duplicates, verdict) and 05-questions.final.json
  with accepted and fixed questions only, validating the seed contract via the skill checklist
  (no Gradle validateSeed). Use when asked to review a question draft, verify answer keys,
  проверить вопросы, отревьюить черновик, найти дубли вопросов, сверить ключи ответов,
  or as the reviewer step of damulab-question-pipeline.
---

# Damulab: независимый решатель / ревьюер

Роль 4 пайплайна [damulab-question-pipeline](../damulab-question-pipeline/SKILL.md).
Запускается **отдельным Task**, изолированно от генератора: своя история, свой контекст,
никаких «я же так и задумал». Формат артефактов — строго
[contracts.md](../damulab-question-pipeline/contracts.md), разделы `04-review.json` и `05-questions.final.json`.

| Что | Где |
|-----|-----|
| Вход | `03-questions.draft.json` — черновик |
| Вход | `01-source-slice.json` — факты, `textbookRef`, `generatorProfile.safetyAndScope` |
| Вход | `02-matrix.json` — слоты, с которыми сверяется вопрос |
| Выход | `04-review.json` — `summary`, `items[]`, `duplicates[]`, `verdict` |
| Выход | `05-questions.final.json` — только `accepted` и `fixed` |
| Выход | журнал `logs/reviewer.md` — что решал руками, что скриптом, спорные места |

## Главный принцип: сначала решить, потом смотреть ключ

1. Читаешь `bodyRu` (и `bodyKk`), **не глядя** на `options[].correct` и `fillAnswers[].answer`.
2. Решаешь сам и записываешь результат в `solvedAnswer`.
   Для арифметики считать **явно** — по шагам в журнале или маленьким скриптом, не «на глаз»;
   деление в столбик и многозначные операции — обязательно проверяемо.
3. Только потом открываешь ключ, пишешь `keyAnswer` (например `"B — 7"` или `"[[1]] = 306"`)
   и `matchesKey`.
4. `matchesKey: false` → это `answer_key_wrong` с severity `blocker` и статусом `rejected`,
   даже если «почти сходится».

## Чеклист проверки

**(а) Ключ и решение**

- `solvedAnswer` получен независимо; `keyAnswer` записан дословно из вопроса;
- второй правдоподобный ответ невозможен (задание однозначно);
- `explanationRu`/`explanationKk` описывают тот же путь решения, что и ключ.

**(б) Схема и типы**

- `type` ∈ `SCQ` | `MCQ` | `FILL_IN`; `MATCHING` — сразу `rejected`;
- SCQ — ровно один `correct: true` (`scq_multiple_correct`), MCQ — минимум один (`mcq_no_correct`);
- вариантов минимум 2 (обычно 4), `label` уникальны, у каждого непустые `textRu` **и** `textKk`;
- множество `[[n]]` в `bodyRu` и `bodyKk` совпадает с `fillAnswers[].placeholder`
  **в обе стороны** (`fill_placeholder_mismatch`);
- `tolerance` заполнен только при `NUMERIC_TOLERANCE` и неотрицателен; иначе `null` (`tolerance_misuse`);
- числовой ключ идёт с `NUMERIC_TOLERANCE` (при точном равенстве `tolerance: 0`), потому что
  `EXACT` сравнивает строку и отвергает `53.4` / `53,40` при ключе `53,4`
  (`fill_numeric_mode_required`); в числовом ключе нет единиц измерения
  (`fill_numeric_answer_invalid`);
- `difficulty` 1..5, непустые `bodyRu`, `bodyKk`, `source`, непустой `sourceRuleIds`;
- у SCQ/MCQ `fillAnswers: []`, у FILL_IN `options: []`.

**(в) Язык**

- паритет RU/KK по смыслу и сложности, включая варианты и объяснения (`kk_parity`);
- KK не калька: порядок слов, падежи и термины естественны для школьного казахского (`kk_calque`);
- нет смешения языков внутри одного поля;
- нет смешения **алфавитов внутри слова** (`mixed_script`): латинская `i` вместо казахской `і`
  и подобные буквы-двойники. Проверь `bodyKk`, `explanationKk` и `options[].textKk`
  пословно (формулы `$...$` не считаются); отдельного Gradle-валидатора в платформе нет.

**(г) Методика**

- соответствие слоту матрицы: `type`, `difficulty`, `sourceRuleIds`, `questionForm`
  (`matrix_mismatch`); заявленное в `matrixDeviations` отклонение с внятной причиной — не issue;
- одна и та же форма задания встречается не больше двух раз на пачку
  (`question_form_repeated`, severity `major`): три задания «Вычисли: a · b» — брак, даже если
  числа разные и `duplicate_body` не срабатывает;
- в теле нет подсказки ответа (`answer_leak_in_body`);
- дистракторы правдоподобны и отражают `trapIdeas`; нет «все верны» / «нет верного ответа»;
  правильный вариант не выделяется длиной;
- задание в границах темы и `generatorProfile.safetyAndScope` (`out_of_scope`).

**(е) Надёжность источника**

- если у slice `sliceStatus: "ready_unverified"` или матрица прислала непустой
  `sourceQuality.unverifiedRuleIds`, в `05` должно быть
  `meta.sourceReliability: "unverified_reconstruction"`; иначе `verbatim`;
- реконструированное правило — **не повод отклонять вопрос**. Проверяй по нему смысл так же,
  как по обычному, но в `logs/reviewer.md` отдельной строкой напиши, что формулировка правила
  требует сверки с бумажным учебником. Пометка `source_reconstructed_unverified` /
  `meta.sourceReliability: "unverified_reconstruction"` — ожидаема и импорт через админку
  сама по себе не блокирует, но человек должен знать про сверку.

**(д) Иллюстрации**

- при `illustrationPolicy: none` любая картинка или маркер `{{IMG:…}}` — `illustration_not_allowed`;
- картинка у слота с `needsIllustration: false` — тоже `illustration_not_allowed`.

## Дедупликация

Нормализация `bodyRu`: NFKC → нижний регистр → все символы, кроме букв и цифр, в пробел →
схлопнуть пробелы. Сравнивать:

1. внутри пачки (вопросы между собой);
2. против уже принятых прогонов — `content/runs/**/05-questions.final.json`.

Совпадение нормализованного тела (или отличие только числами при том же навыке и
той же формулировке) → `duplicate_body`, статус `rejected`, запись в блок `duplicates`
файла `04` с `localId`, `conflictsWith` (`путь/файл#localId`) и `normalizedBody`.

## Коды issue и severity

`answer_key_wrong`, `scq_multiple_correct`, `mcq_no_correct`, `fill_placeholder_mismatch`,
`tolerance_misuse`, `fill_numeric_mode_required`, `fill_numeric_answer_invalid`,
`mixed_script`, `kk_parity`, `kk_calque`, `answer_leak_in_body`, `matrix_mismatch`,
`duplicate_body`, `question_form_repeated`, `out_of_scope`, `illustration_not_allowed`.
Severity: `blocker` | `major` | `minor`.

## Что чинить, а что отклонять

| Ситуация | Статус | Что делать |
|----------|--------|------------|
| Опечатка, кривая формулировка варианта, порядок вариантов, мелкая шероховатость KK | `fixed` | починить и описать правку в `fixApplied` |
| Всё чисто | `accepted` | `issues: []`, `fixApplied: null` |
| Неверный ключ, задание вне темы, дубль, сломанная логика или нерешаемое условие | `rejected` | причина в `issues`, `fixApplied: null` |

«Тихо починить смысл» запрещено: менять условие, числа или правильный ответ — это уже
новый вопрос, его должен сделать генератор по слоту.

## Итог прогона

- `summary`: `total`, `accepted`, `fixed`, `rejected`, `rejectRate` (= `rejected / total`);
- `verdict` = `needs_rework`, если `rejectRate > 0.3` **или** остался хотя бы один `blocker`;
  иначе `ready_for_import`;
- в `05-questions.final.json` попадают только `accepted` и `fixed`;
  блок `meta` собирается из brief и slice (`subjectTitleRu/Kk`, `gradeNo`, `topicCode`,
  `topicTitleRu/Kk`, `topicSlug`, `atomicSkillTitleRu`, `textbookRef`, `illustrationPolicy`) —
  см. contracts.md; **никаких id БД** в файле быть не должно.

После записи `05` обязательно пройти чеклист контракта из
[damulab-question-seed](../damulab-question-seed/SKILL.md) (схема, ключи, RU/KK, без id БД).
Gradle-задачи `validateSeed` в приложении нет. Всё найденное чинишь **до** передачи
оркестратору; если правка требует нового условия — вопрос уходит в `rejected`.

## Системные косяки → `pipeline-gaps.md`

Если ошибка **повторяющаяся** (одна и та же дыра у нескольких вопросов или второй
прогон подряд) — допиши 1–3 пункта в раздел «Открытые gaps» файла
[content/pipeline-gaps.md](../../../content/pipeline-gaps.md): роль, симптом со ссылкой
на прогон, гипотеза, предлагаемый фикс, приоритет `P0`|`P1`|`P2`.
Разовые баги конкретного вопроса живут **только** в `04-review.json`.

## Чеклист перед сдачей

- [ ] у каждого вопроса есть `items[]`-запись с `solvedAnswer`, `keyAnswer`, `matchesKey`
- [ ] `solvedAnswer` получен до просмотра ключа; арифметика посчитана явно
- [ ] пройдены все шесть групп чеклиста (ключ, схема, язык, методика, иллюстрации, источник)
- [ ] дедуп сделан и внутри пачки, и против `content/runs/**/05-questions.final.json`
- [ ] коды issue и severity — из списка выше; у каждого issue понятный `message`
- [ ] `summary` арифметически сходится: `accepted + fixed + rejected` = `total`
- [ ] `verdict` выставлен по правилу `rejectRate > 0.3` / наличию `blocker`
- [ ] в `05` только `accepted` и `fixed`; нет `subjectId`/`topicIds`/`gradeIds`, нет `MATCHING`
- [ ] чеклист [damulab-question-seed](../damulab-question-seed/SKILL.md) пройден без блокирующих дыр
- [ ] `logs/reviewer.md` заполнен; системные косяки (если есть) — в `content/pipeline-gaps.md`
