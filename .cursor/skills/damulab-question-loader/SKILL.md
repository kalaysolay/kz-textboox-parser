---
name: damulab-question-loader
description: >-
  Guides importing finished Damulab question packs (05-questions.final.json) into the question
  bank via the existing admin UI/API — not via Gradle or Spring seed tasks. Use when the user
  asks to import or load generated questions, залить вопросы в базу, импортировать пачку,
  or asks how to map subject/topic/grade titles to database ids before admin import.
---

# Damulab: загрузка пачек вопросов (без Java seed)

Отдельный шаг, **не часть генерации**. Часто в другой день и на другой машине:
можно нагенерировать темы на одном ноуте, а залить через админку на другом.

Платформа Damulab **не** валидирует и **не** импортирует seed-пачки из `content/runs/`
этого репозитория через Gradle/Spring. Пакета `kz.damulab.seed`, задач `validateSeed` / `seedImport` и профиля
`seed-import` в приложении нет. Прогоны лежат здесь (`content/runs/`); загрузка — внешний шаг в админке Damulab.

Контент в `05-questions.final.json` не знает про id БД — тема описана названием, кодом из
учебника и номером класса. Связывание с базой — ответственность **человека в админке**
(или будущего внешнего скрипта **вне** основного приложения). Новый Java-код в Damulab
для этого не пишем.

Формат файлов: [contracts.md](../damulab-question-pipeline/contracts.md).

## Как загрузить пачку

1. Убедись, что ревьюер отдал `05-questions.final.json` с `verdict: ready_for_import`
   (чеклист скилла [damulab-question-seed](../damulab-question-seed/SKILL.md) и
   [damulab-question-reviewer](../damulab-question-reviewer/SKILL.md)).
2. В админке найди `subjectId`, `gradeId` и `topicId` для `meta.subjectTitleRu` /
   `meta.gradeNo` / `meta.topicCode` (или `topicTitleRu`). Тему **не создавай** из пачки —
   если темы нет, сначала оглавление (`POST /api/admin/topics/import` или ручное заведение).
3. Собери payload `QuestionImportRequest`: у каждой строки — `subjectId`, `topicIds`,
   `gradeIds` плюс поля вопроса из `05` (`type`, `difficulty`, `bodyRu`/`bodyKk`, `source`,
   `options` / `fillAnswers`, …). Статус строк обычно `NEEDS_REVIEW`.
4. Импорт через существующий UI или API:
   - страница `/admin/questions/import` (вставить JSON payload);
   - либо `POST /api/admin/question-imports` (роль ADMIN, с CSRF как у остальной админки);
   - Excel: `/admin/questions/import/excel` или `POST /api/admin/question-imports/excel`.
5. Проверь в банке, что вопросы пришли в `needs_review` и выглядят корректно.

Опционально сохрани машинозависимый payload в
`content/runs/<прогон>/.local/06-import-payload.json` (папка в `.gitignore`) — это удобная
заготовка для админки, не артефакт пайплайна и не результат Spring-задачи.

## Что остаётся без DB id

`05-questions.final.json` коммитится как есть: только названия и коды в `meta`.
Резолв id — на стороне человека/админки при импорте. Детерминированный валидатор контракта
и авто-резолв **не** живут в Spring; при необходимости их можно позже вынести в отдельный
репозиторий или скрипт вне приложения.

## Границы роли

- Не править содержание вопросов при загрузке. Проблема в контенте — вернуть ревьюеру.
- Не создавать темы и предметы «по пути». Не найдено — стоп по этой теме.
- Не добавлять Java/Gradle seed в Damulab.
- Статус загрузки не идёт в `content/runs/_coverage.md` — он у каждой машины свой.

Если всплыл системный косяк — 1–3 пункта в
[content/pipeline-gaps.md](../../../content/pipeline-gaps.md).
