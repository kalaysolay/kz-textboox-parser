# content/tools

Утилиты мультиагентного пайплайна генерации вопросов Damulab.
Живут **в этом репозитории** рядом с PDF и parsed JSON — не в приложении платформы.
Импорт готовых пачек в банк вопросов — внешний шаг через админку Damulab
(скилл `damulab-question-loader`). Импорт картинок из `06` — будущий asset-import агент.

Зависимости для парсера и PNG-экспорта иллюстраций (Node >=22.13):

```text
pnpm --dir content/tools install --frozen-lockfile
```

## read-textbook-pages.js

CLI для аналитика и парсера лекций. Основной запуск парсинга и журнал изменений:
[PARSER_GUIDE.md](../../PARSER_GUIDE.md).

Читает диапазон **печатных** страниц (как в `topics_with_pages`) и кладёт в `--out`
`manifest.json` и `index.json`. Поля `pngPath`/`textPath` — абсолютные ссылки
на общий кэш `ocr/cache/<SHA-256-PDF>/`. PNG/TXT больше не копируются в каждый run.
`allReadable` — материал доступен, а не проверен на точность.

Запускать из **корня этого репо**:

```text
node content/tools/read-textbook-pages.js --pdf "<полный путь PDF>" --pages 45-50 --pdf-offset 0 --ocr --lang rus --out "ocr/jobs/topic/pages"

node content/tools/read-textbook-pages.js --parsed ... --detect-offset --out tmp-offset
```

Корень репо определяется автоматически. Явный `--pdf` приоритетен;
без него точное `source.file_name` из `--parsed` ищется в `sources/`.

Текст извлекается PDF.js; водяной знак не считается текстом урока.
Непригодные страницы распознаются локально Tesseract (`--ocr --lang rus|kaz+rus`).
Для PNG нужен `pdftoppm` (Poppler). Старые OCR-кэши поддерживаются как
непроверенные подсказки. `.cjs` оставлен как совместимая обёртка ESM.

`pdfPage = bookPage + pdfOffset`. Offset без проверки больше не равен 0
автоматически: сохранённая карта, `--pdf-offset` или `--page-numbering pdf`.
Из `--detect-offset` читай PNG по manifest. Если первые пять страниц без номеров,
выбери более поздний диапазон физических страниц.

## Инструменты парсера 1.0.0

| CLI | Задача |
|---|---|
| `parser-doctor.js` | проверить Node, зависимости, Poppler, языковые модели |
| `prepare-textbook.js` | текст/OCR/PNG один раз, индекс, локальные метрики |
| `select-textbook.js` | ограниченная выборка блоков, страницы физические, nextCursor |
| `assemble-textbook.js` | скопировать текст по ссылкам агента в итоговый v3 |
| `validate-textbook.js` | проверить структуру, ссылки, статусы и счётчики |
| `textbook-nav.js` | оглавление, граф, `topic.json` одной темы |

У всех CLI есть `--help`. Контракт плана: [parser-contract.md](../parser-contract.md).
Автотесты: `node --test content/tools/tests/textbook.test.js`.
Менеджер зависимостей — pnpm, lockfile — `pnpm-lock.yaml`.

## render-illustration-svg.js

CLI для роли `damulab-question-illustrator`.

Читает scene-spec JSON (`kind` + параметры) и пишет SVG; с `--png` дополнительно PNG
через `@resvg/resvg-js` (зависимости устанавливаются командой выше).

Первая волна `kind`: `coordinate_ray`, `number_line_decimals`, `angle`, `set_venn`,
`set_euler`, `bar_chart`, `polygon`.

Для `angle` кроме простого режима (`degrees` + `armALabel`/`armCLabel`) поддержаны
`rays[{label,deg}]`, `arcs[{fromDeg,toDeg,label?,radius?}]` и `points[{id,deg,t}]`.

```text
node content/tools/render-illustration-svg.js ^
  --scene content/runs/<run>/illustrations/_scenes/q01.json ^
  --out content/runs/<run>/illustrations/q01.svg

node content/tools/render-illustration-svg.js --scene ... --out .../q01.svg --png
```
