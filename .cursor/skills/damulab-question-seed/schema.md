# Схема финального seed JSON

Файл: `content/runs/{прогон}/05-questions.final.json`

Id БД (`subjectId`, `topicIds`, `gradeIds`, `atomicSkillId`) **не** входят в файл — маппинг
делает человек (или внешний скрипт) при импорте через админку. Полный контракт всех
артефактов прогона: [contracts.md](../damulab-question-pipeline/contracts.md).

## Корень

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
    "illustrationPolicy": "none"
  },
  "questions": []
}
```

`meta` — то, по чему загрузчик находит предмет, класс и тему в конкретной БД:
`subjectTitleRu` → предмет, `gradeNo` → класс, `topicCode` → тема (при промахе `topicTitleRu`).

## Вопрос

| Поле                              | Тип                          | Обязательно                       |
| --------------------------------- | ---------------------------- | --------------------------------- |
| `localId`                         | string (`q01`…)              | да, уникален в пачке              |
| `type`                            | `SCQ` \| `MCQ` \| `FILL_IN`  | да                                |
| `difficulty`                      | int 1..5                     | да                                |
| `bodyRu` / `bodyKk`               | string                       | да, оба непустые                  |
| `explanationRu` / `explanationKk` | string \| null               | либо оба, либо ни одного          |
| `source`                          | string                       | да, непустой                      |
| `needsIllustration`               | boolean                      | да; в v1 всегда `false`           |
| `illustration`                    | object \| null               | да; в v1 всегда `null`            |
| `options`                         | array                        | SCQ/MCQ; для FILL_IN — `[]`       |
| `fillAnswers`                     | array                        | FILL_IN; для SCQ/MCQ — `[]`       |
| `sourceRuleIds`                   | array of string              | желательно: откуда взято правило  |

```json
{
  "localId": "q01",
  "type": "SCQ",
  "difficulty": 2,
  "bodyRu": "...",
  "bodyKk": "...",
  "explanationRu": "краткий разбор",
  "explanationKk": "қысқаша талдау",
  "source": "Алдамуратова, 5 кл, ч.1, стр. 9-13",
  "needsIllustration": false,
  "illustration": null,
  "options": [],
  "fillAnswers": [],
  "sourceRuleIds": ["R004"]
}
```

### options (SCQ / MCQ)

```json
{ "label": "A", "textRu": "...", "textKk": "...", "correct": false }
```

`label` уникален в пределах вопроса. **Оба** языка обязательны: без `textKk` импорт вернёт
`choice_option_text_required`. Минимум 2 варианта, обычно 4.

### fillAnswers (FILL_IN)

```json
{ "placeholder": "[[1]]", "answer": "30", "matchMode": "NUMERIC_TOLERANCE", "tolerance": 0 }
```

`matchMode`: `EXACT` | `NORMALIZED` | `NUMERIC_TOLERANCE` | `REGEXP`.

- **Числовой ответ — всегда `NUMERIC_TOLERANCE`**, при точном равенстве с `tolerance: 0`.
  `EXACT` сравнивает строку посимвольно, `NORMALIZED` приводит запятую к точке, но
  хвостовой нуль оставляет, — поэтому к ключу `53,4` ученик с `53.4` или `53,40` не пройдёт.
  Валидатор блокирует дробный числовой ключ при `EXACT`/`NORMALIZED`
  (`fill_numeric_mode_required`).
- Единицы измерения в числовом ключе запрещены (`fill_numeric_answer_invalid`):
  `BigDecimal` не разберёт «5,1 кг». Единицы остаются в тексте задания.
- `tolerance` заполняется **только** при `NUMERIC_TOLERANCE` (неотрицательное число);
  в остальных режимах строго `null` — иначе он просто вводит в заблуждение.
- Множество плейсхолдеров `[[n]]` в `bodyRu` и `bodyKk` должно совпадать между собой
  и с множеством `placeholder`.

### illustration

В v1 всегда `null`: в банке вопросов нет хранения картинок. Поле оставлено под v2, когда
появится ручка `POST /api/admin/question-assets`.

## Проверка

Контракт проверяет ревьюер по чеклисту [SKILL.md](SKILL.md) и
[damulab-question-reviewer](../damulab-question-reviewer/SKILL.md).
В приложении Damulab нет `validateSeed` / `kz.damulab.seed` — детерминированный
валидатор при желании выносится в отдельный репо/скрипт вне Spring.
