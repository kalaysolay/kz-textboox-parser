---
name: damulab-question-seed
description: >-
  Defines the final export format for a bilingual (RU/KK) Damulab question pack —
  05-questions.final.json with SCQ/MCQ/FILL_IN questions, full answer keys and no database ids.
  Use when writing or fixing the final seed JSON, checking that a pack matches the Damulab import
  contract, оформить финальный JSON пачки, проверить формат seed-вопросов, or preparing import
  JSON for Damulab. For running the whole generation pipeline use damulab-question-pipeline.
---

# Damulab: финальный формат пачки вопросов

Этот скилл — **контракт экспорта**, последний шаг генерации. Он отвечает на один вопрос:
как должен выглядеть готовый JSON, чтобы его принял импорт Damulab.

Сам прогон (brief → аналитик → матрица → генератор → ревьюер) описан в
[damulab-question-pipeline](../damulab-question-pipeline/SKILL.md).
Загрузка в БД — в [damulab-question-loader](../damulab-question-loader/SKILL.md).

- Куда пишем: `content/runs/{прогон}/05-questions.final.json`
- Схема полей: [schema.md](schema.md)
- Полный контракт всех артефактов прогона: [contracts.md](../damulab-question-pipeline/contracts.md)
- Текст промпта для разовой генерации вне пайплайна:
  [content/prompts/question-seed-generation.md](../../../content/prompts/question-seed-generation.md)

Не писать сразу в БД. Id (`subjectId`, `topicIds`, `gradeIds`) в файле быть **не должно** —
их подставляет человек (или внешний скрипт вне приложения) при импорте через админку.

## Типы вопросов

Только **SCQ, MCQ, FILL_IN**.

| Тип       | Ключ ответа                                                                 |
| --------- | ---------------------------------------------------------------------------- |
| `SCQ`     | ровно 1 `correct: true`, минимум 2 варианта (обычно 4)                      |
| `MCQ`     | минимум 1 `correct: true`, минимум 2 варианта; «все верны» — почти всегда ошибка |
| `FILL_IN` | плейсхолдеры `[[1]]`, `[[2]]`… + `fillAnswers` с `matchMode`                |

`MATCHING` в системе поддержан, но в пайплайне **не используется**: для предметного среза по
учебнику он даёт слабую проверку понимания и усложняет ревью. Вернём, когда появится запрос.

`difficulty` 1..5 оценивай по конкретному заданию для конкретного класса, не копируй одно
число на всю пачку.

## Что обязан обеспечить файл

Жёсткие требования импорта (`QuestionBankService`) — без них строка упадёт:

- `bodyRu`, `bodyKk`, `source` — непустые;
- `difficulty` в диапазоне 1..5;
- у каждого варианта заполнены **и** `textRu`, **и** `textKk`; минимум 2 варианта;
- SCQ — ровно один `correct`, MCQ — минимум один;
- FILL_IN — у каждого ключа есть `placeholder`, `answer`, `matchMode`;
  при `NUMERIC_TOLERANCE` обязателен неотрицательный `tolerance`.

Дополнительно (сервер это не проверяет, значит проверяем мы):

- каждый `[[n]]` из тела имеет свой `fillAnswer` и наоборот — в обе стороны и в обоих языках;
- `tolerance` только при `NUMERIC_TOLERANCE`; **числовые ответы — `NUMERIC_TOLERANCE`**
  с `tolerance: 0`, потому что `EXACT` и `NORMALIZED` отвергают равноценные записи
  (`53.4`, `53,40` при ключе `53,4`);
- в KK-полях нет слов, где смешаны кириллица и латиница (`mixed_script`): латинская `i`
  вместо казахской `і` глазами не видна, но ломает поиск и озвучку;
- нет дублей вопросов внутри пачки и против уже принятых прогонов;
- нет id БД нигде в файле;
- `meta.sourceReliability` = `unverified_reconstruction`, если правило темы реконструировано
  аналитиком (пометка для человека; админ-импорт сам по себе не блокируется).

Проверка контракта — чеклист выше + роль [damulab-question-reviewer](../damulab-question-reviewer/SKILL.md).
Gradle `validateSeed` / пакет `kz.damulab.seed` из приложения удалены; при необходимости
детерминированный валидатор — отдельный скрипт/репо вне Spring.

## Языки

Каждый вопрос — **полная** пара RU/KK:

- `bodyRu` ↔ `bodyKk` — тот же смысл и та же сложность;
- варианты и объяснения — тоже оба языка;
- KK — естественный школьный казахский (кириллица), не дословная калька с русского;
- не смешивать языки внутри одного поля.

Формулировки подстраиваются под `gradeNo`:

- **1–4**: короткие предложения, бытовые примеры, без лишней абстракции;
- **5–7**: можно 2–3 шага рассуждения, аккуратные термины из источника;
- **8–11**: более плотные формулировки и символика, всё ещё школьный тон.

## Иллюстрации

**В v1 их нет.** В банке вопросов нет ни поля картинки, ни загрузки ассетов (вложения есть
только у лекций), поэтому любой маркер `{{IMG:...}}` просто отобразится ученику как текст.

Значит в файле: `illustrationPolicy: "none"`, у всех вопросов `needsIllustration: false`,
`illustration: null`, никаких маркеров в теле. Ревьюер отклоняет остальное кодами
`illustration_not_allowed` / политика `illustration_policy_unsupported` на стороне импорта.

Иллюстратор вернётся в v2, после ручки `POST /api/admin/question-assets`.

## Чего не делать

- Не ставить `subjectId` / `topicIds` / `gradeIds` / `atomicSkillId` в файл.
- Не использовать `MATCHING`.
- Не добавлять картинки и не генерировать бинарники.
- Не копировать длинные абзацы учебника дословно — переформулировать в задание.
- Не подсказывать ответ в тексте задания.
- Не импортировать в БД и не коммитить, пока пользователь не попросит.
