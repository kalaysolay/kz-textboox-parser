# content/tools

Утилиты мультиагентного пайплайна генерации вопросов Damulab.
Живут **в этом репозитории** рядом с PDF и parsed JSON — не в приложении платформы.
Импорт готовых пачек в банк вопросов — внешний шаг через админку Damulab
(скилл `damulab-question-loader`).

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
