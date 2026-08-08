# Probe: illustrator (2026-08-05)

Проверка роли `damulab-question-illustrator` и CLI `render-illustration-svg.js`
на теме «Координатный луч» (учебниковый минимализм, без декора).

Не полный прогон пайплайна: минимальные `02` / `04` / `05` + собранный `06`.
В `_coverage.md` не учитывается.

Сверка стиля: тонкие линии, подписи `O`/`A`/`B`/`C`, числа на шкале — как схемы
в Алдамуратовой 5 кл. (без персонажей и цветных фонов из старого
`Математика/Задачи 5/generate_illustrations.mjs`).

Пересборка SVG:

```text
node content/tools/render-illustration-svg.js --scene content/runs/_probes/illustrator-20260805/illustrations/_scenes/q01.json --out content/runs/_probes/illustrator-20260805/illustrations/q01.svg
```
