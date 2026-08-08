---
name: damulab-question-illustrator
description: >-
  Builds 06-illustrations.json and SVG (optional PNG) for accepted Damulab questions
  that need stem visuals: scene-spec first, textbook-simple style, no answer leak.
  Use when asked to illustrate questions, generate SVGs for a run, нарисовать иллюстрации
  к вопросам, после ревьюера сделать картинки, or as the illustrator step of
  damulab-question-pipeline.
---

# Damulab: иллюстратор вопросов

Роль 5 пайплайна [damulab-question-pipeline](../damulab-question-pipeline/SKILL.md).
Работаешь **только после** принятого `05`: текст вопросов не трогаешь, картинки кладёшь
рядом. Формат — [contracts.md](../damulab-question-pipeline/contracts.md), раздел
`06-illustrations.json`. Промпт: [illustration-generation.md](../../../content/prompts/illustration-generation.md).

| Что | Где |
|-----|-----|
| Вход | `02-matrix.json` — `needsIllustration`, `illustrationReason` |
| Вход | `04-review.json` — статус слота (`accepted` / `fixed`) |
| Вход | `05-questions.final.json` — финальный текст (для scene и anti-leak) |
| Вход | опционально страницы PDF / референс учебника |
| Выход | `06-illustrations.json` |
| Выход | `illustrations/qXX.svg` (+ `qXX.png` если нужен растр) |
| Выход | журнал `logs/illustrator.md` |

## Когда роль вызывается

- `brief.illustrationPolicy` ≠ `none` **и** в матрице есть хотя бы один
  `needsIllustration: true`;
- иначе — no-op: можно не писать `06`, либо `items: []`.

## Отбор слотов

Бери `localId`, для которых одновременно:
1. в `02` — `needsIllustration: true`;
2. в `04` — `status` ∈ {`accepted`, `fixed`};
3. вопрос есть в `05.questions[]`.

Не придумывай картинки «для красоты» к слотам с `needsIllustration: false`.

## Порядок работы

1. Для каждого отобранного `localId` сформулируй `purpose` и `sceneKind`.
2. Собери `scene` (параметры: точки, углы, множества, ряды диаграммы…).
3. Проверь **answerLeak**: рисунок не должен содержать или подсвечивать правильный ответ
   (верные options, FILL_IN-ключ, «подсказку градуса», если она и есть ответ).
   При утечке — `answerLeakCheck: "fail"`, `status: "blocked"`, файлов нет.
4. Рендер через CLI (не пиши SVG руками, если kind поддержан):

```text
node content/tools/render-illustration-svg.js ^
  --scene scene.json ^
  --out content/runs/<run>/illustrations/q01.svg
```

С PNG (когда brief/methodist/импортёр просит растр):

```text
node content/tools/render-illustration-svg.js --scene scene.json --out .../q01.svg --png
```

5. Запиши манифест `06-illustrations.json` и короткий `logs/illustrator.md`.

`05` **не изменяй**. Поле `illustration` в вопросах остаётся `null`.

## Стиль

Профиль `aldamuratova-textbook-simple`:
- светлый/белый фон, тонкие тёмные линии, редкая полупрозрачная заливка (множества);
- без персонажей, градиентов, теней, стикеров, пиксель-шрифтов, цветных «милых» фонов;
- текст на рисунке — только `O` / `A`/`B`/`C` / `AB` / `∠ABC`, числа шкалы, градусы `°`;
- никаких предложений RU/KK на SVG (один ассет на оба языка body).

Антипаттерн: старый `Математика/Задачи 5/generate_illustrations.mjs` (домики, собаки, glyph-font).

## role и sceneKind

- `role` в v1 — только `"stem"`.
- Лекционные типы (смысловая / памятка / инфографика / декоративная) — **вне** этого
  пайплайна (будущие лекции).
- `sceneKind` — из списка в contracts (`coordinate_ray`, `angle`, `set_venn`, …).
  Первая волна рендерера: `coordinate_ray`, `number_line_decimals`, `angle`, `set_venn`,
  `set_euler`, `bar_chart`, `polygon`. Нет kind в туле — `status: blocked` + запись в
  `content/pipeline-gaps.md`, не «нарисуй что-нибудь».

## Форматы файлов

- Канон: SVG (`asset.format: "svg"`).
- PNG: производный экспорт из того же SVG (`asset.raster`), не отдельная генерация.
- Пути относительные: `illustrations/q01.svg`.

## Потребитель

Манифест читает будущий **asset-import** агент (скилл пока не реализован). Готовь `06`
так, чтобы импортёру не гадать: стабильный `localId`, относительные пути, только
`status: "ready"` для заливки. Импорт на сайт — по явной просьбе пользователя, не здесь.

## Чеклист

- [ ] отобраны только нужные слоты (матрица + review + `05`)
- [ ] `05` не изменён
- [ ] у каждого `ready` есть SVG по `asset.path` и валидный `scene`
- [ ] `answerLeakCheck: pass` у всех `ready`
- [ ] нет RU/KK-предложений на рисунке
- [ ] нет id БД / base64 / URL в `06`
- [ ] `logs/illustrator.md` написан

## Чего не делать

- Не править `03` / `05` и не вставлять `{{IMG:…}}` в body.
- Не звать GenerateImage / креативные raster-модели.
- Не рисовать декор, памятки, инфографику.
- Не импортировать ассеты в банк самостоятельно.
