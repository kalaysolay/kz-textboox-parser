# content/tools

Утилиты мультиагентного пайплайна генерации вопросов Damulab.
Живут **в этом репозитории** рядом с PDF и parsed JSON — не в приложении платформы.
Импорт готовых пачек в банк вопросов — внешний шаг через админку Damulab
(скилл `damulab-question-loader`). Импорт картинок из `06` — будущий asset-import агент.

Зависимости для PNG-экспорта иллюстраций:

```text
npm install --prefix content/tools
```

## read-textbook-pages.js

CLI для роли `damulab-textbook-analyst`.

Читает диапазон **печатных** страниц учебника (как в `topics_with_pages`) и кладёт в `--out`:
`page_NNN.png`, опционально `page_NNN.txt`, `manifest.json`.

Запускать из **корня этого репо**:

```text
node content/tools/read-textbook-pages.js ^
  --parsed "Математика/parsed/math_aldamuratova_5grade_part2_parsed_v2.json" ^
  --pages 45-50 ^
  --out content/runs/<run>/pages

node content/tools/read-textbook-pages.js --parsed ... --detect-offset --out tmp-offset
```

Корень репо определяется автоматически (расположение скрипта `content/tools/` → `../..`).
При необходимости: `--parser-root .`

Приоритет источников: кэш OCR/текста парсера (`ocr/…`) → `pdftoppm` (Poppler) → `pdftotext`
(если слой не водяной знак).

`pdfPage = bookPage + pdfOffset` (`--pdf-offset`, по умолчанию 0). Для Алдамуратовой 5 кл ч.2 offset = 0.

## render-illustration-svg.js

CLI для роли `damulab-question-illustrator`.

Читает scene-spec JSON (`kind` + параметры) и пишет SVG; с `--png` дополнительно PNG
через `@resvg/resvg-js` (нужен `npm install --prefix content/tools`).

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
