# Покрытие тем — генерация вопросов

Один прогон = одна тема. На класс приходится 30–40 тем, поэтому без индекса легко
потерять, что уже сделано.

**Здесь только статус генерации.** Загружены ли вопросы в конкретную БД — у каждой машины
своё, это смотрят в `content/runs/{прогон}/.local/07-import-report.json`.

Темы берём из `topics_with_pages` учебника, чтобы список совпадал с госпрограммой.
Порядок работы: сначала одна тема целиком до импорта, потом пачками по 5 тем.

## Как заполнять

Строку добавляет оркестратор после того, как прогон дошёл до валидного
`05-questions.final.json` (или остановился — тогда честно пишем `needs_rework`).

| Колонка       | Что писать                                                                 |
| ------------- | -------------------------------------------------------------------------- |
| Предмет       | Как в `meta.subjectTitleRu`                                                |
| Класс         | Число                                                                      |
| Код           | `topicCode` из учебника, например `1.2`; `—` если у темы кода нет          |
| Тема          | Короткое название, по нему человек ищет глазами                            |
| Прогон        | Имя папки в `content/runs/`                                                |
| Дата          | `YYYY-MM-DD`                                                               |
| Принято       | Сколько вопросов в `05-questions.final.json`                               |
| Отклонено     | Сколько слотов ушло в `rejected` по `04-review.json`                       |
| Статус        | `ready` — можно грузить; `ready-unverified` — можно грузить, но правило реконструировано и нужна сверка с бумажным учебником (`meta.sourceReliability: unverified_reconstruction`); `needs_rework` — вернулось генератору; `blocked` — по теме нет ни правил, ни пригодных примеров |

## Таблица

| Предмет | Класс | Код | Тема | Прогон | Дата | Принято | Отклонено | Статус |
| ------- | ----- | --- | ---- | ------ | ---- | ------- | --------- | ------ |
| Математика | 5 | 3.14 | Нахождение дроби от числа. Нахождение числа по его дроби | `math-5-nahozhdenie-drobi-ot-chisla-20260808-0105` | 2026-08-08 | 30 | 0 | `ready` (verbatim стр. 3–10; пачка `_batch-math5-ch3-6-20260808`) |
| Математика | 5 | 3.15 | Задачи на совместную работу | `math-5-zadachi-na-sovmestnuyu-rabotu-20260808-0130` | 2026-08-08 | 30 | 0 | `ready` (verbatim стр. 11–15; пачка `_batch-math5-ch3-6-20260808`; illustrator skip) |
| Математика | 5 | 4.1 | Десятичная дробь. Чтение и запись десятичных дробей | `math-5-desyatichnaya-drob-chtenie-zapis-20260808-0200` | 2026-08-08 | 30 | 0 | `ready` (verbatim стр. 16–23; пачка `_batch-math5-ch3-6-20260808`; illustrator skip) |
| Математика | 5 | 4.2 | Перевод десятичной дроби в обыкновенную, обыкновенной дроби в десятичную | `math-5-perevod-des-i-obykn-drobi-20260808-0230` | 2026-08-08 | 30 | 0 | `ready` (verbatim стр. 24–29; пачка `_batch-math5-ch3-6-20260808`; illustrator skip; новый 30 vs старый 12) |
| Математика | 5 | 4.3 | Изображение десятичной дроби на координатном луче. Сравнение десятичных дробей | `math-5-izobrazhenie-des-drobi-na-luche-20260808-0300` | 2026-08-08 | 30 | 0 | `ready_for_asset_import` (verbatim стр. 30–35; 8 SVG/PNG в `06`; пачка `_batch-math5-ch3-6-20260808`) |
| Математика | 5 | 4.4 | Сложение и вычитание десятичных дробей | `math-5-slozhenie-vychitanie-des-drobei-20260808-0330` | 2026-08-08 | 30 | 0 | `ready` (verbatim стр. 37–44; пачка `_batch-math5-ch3-6-20260808`; illustrator skip) |
| Математика | 5 | 4.5 | Умножение десятичной дроби на натуральное число | `math-5-umnozhenie-des-drobi-na-nat-chislo-20260808-0400` | 2026-08-08 | 30 | 0 | `ready` (verbatim стр. 45–50; targeted fill q22; новый 30 vs старый 12 ready-unverified; пачка `_batch-math5-ch3-6-20260808`; illustrator skip) |
| Математика | 5 | 4.6 | Умножение десятичных дробей | `math-5-umnozhenie-desyatichnyh-drobei-20260808-0430` | 2026-08-08 | 30 | 0 | `ready` (verbatim стр. 51–56; targeted fill q09/q20/q26; пачка `_batch-math5-ch3-6-20260808`; illustrator skip) |
| Математика | 5 | 4.7 | Деление десятичной дроби на натуральное число | `math-5-delenie-des-drobi-na-nat-chislo-20260808-0500` | 2026-08-08 | 30 | 0 | `ready` (verbatim стр. 57–64; пачка `_batch-math5-ch3-6-20260808`; illustrator skip) |
| Математика | 5 | 4.8 | Деление десятичной дроби на десятичную дробь | `math-5-delenie-des-drobi-na-des-drob-20260808-0530` | 2026-08-08 | 30 | 0 | `ready` (verbatim стр. 65–71; 1 fixed q09; пачка `_batch-math5-ch3-6-20260808`; illustrator skip) |
| Математика | 5 | 4.9 | Умножение и деление десятичной дроби на 10, 100, 1000… и на 0,1; 0,01… | `math-5-umn-del-des-drobi-na-10-01-20260808-0600` | 2026-08-08 | 30 | 0 | `ready` (verbatim стр. 72–77; 3 fixed; пачка `_batch-math5-ch3-6-20260808`; illustrator skip) |
| Математика | 5 | — | Арифметические действия над обыкновенными и десятичными дробями. Упражнения для повторения главы IV | `math-5-povtorenie-glavy-iv-drobi-20260808-0630` | 2026-08-08 | 15 | 0 | `ready-unverified` (стр. 78–81; count 30→15; RC_*; 1 rewrite q12; пачка `_batch-math5-ch3-6-20260808`; illustrator skip) |
| Математика | 5 | 4.11 | Округление десятичных дробей | `math-5-okruglenie-desyatichnyh-drobei-20260808-0700` | 2026-08-08 | 30 | 0 | `ready` (verbatim стр. 82–88; 3 fixed; пачка `_batch-math5-ch3-6-20260808`; illustrator skip) |
| Математика | 5 | 4.12 | Числовые последовательности, составленные из дробей | `math-5-chisloyye-posledovatelnosti-drobi-20260808-0730` | 2026-08-08 | 10 | 0 | `ready` (verbatim стр. 90–91; count 30→10; пачка `_batch-math5-ch3-6-20260808`; illustrator skip) |
| Математика | 5 | 5.1 | Множество. Элементы множества. Изображения множеств | `math-5-mnozhestvo-elementy-izobrazheniya-20260808-0800` | 2026-08-08 | 30 | 0 | `ready_for_asset_import` (verbatim стр. 92–96; 11 SVG/PNG set_euler/venn; пачка `_batch-math5-ch3-6-20260808`) |
| Математика | 5 | 5.2 | Подмножество | `math-5-podmnozhestvo-20260808-0830` | 2026-08-08 | 30 | 0 | `ready_for_asset_import` (verbatim стр. 97–101; 9 SVG/PNG set_euler; пачка `_batch-math5-ch3-6-20260808`) |
| Математика | 5 | 5.3 | Пересечение множеств. Объединение множеств | `math-5-peresechenie-obedinenie-mnozhestv-20260808-0900` | 2026-08-08 | 30 | 0 | `ready_for_asset_import` (verbatim стр. 102–106; 14 SVG/PNG set_venn/euler; 1 fixed; пачка `_batch-math5-ch3-6-20260808`) |
| Математика | 5 | 5.4 | Задачи на множества | `math-5-zadachi-na-mnozhestva-20260808-0930` | 2026-08-08 | 10 | 0 | `ready_for_asset_import` (verbatim стр. 107–108; count 30→10; 6 SVG/PNG set_venn; пачка `_batch-math5-ch3-6-20260808`) |
| Математика | 5 | 6.2 | Нахождение процентов от данного числа | `math-5-nahozhdenie-protsentov-ot-chisla-20260808-1000` | 2026-08-08 | 30 | 0 | `ready` (verbatim стр. 118–123; 1 fixed q18; illustrator skip; пачка `_batch-math5-ch3-6-20260808`) |
| Математика | 5 | 6.3 | Нахождение числа по его процентам | `math-5-nahozhdenie-chisla-po-protsentam-20260808-1030` | 2026-08-08 | 30 | 0 | `ready` (verbatim стр. 125–129; 1 fixed q26; illustrator skip; пачка `_batch-math5-ch3-6-20260808`) |
| Математика | 5 | — | Упражнения для повторения главы VI. Задачи на проценты | `math-5-povtorenie-glavy-vi-protsenty-20260808-1100` | 2026-08-08 | 12 | 0 | `ready-unverified` (стр. 130–132; count 30→12; RC_*; 1 fixed q03; пачка `_batch-math5-ch3-6-20260808`; illustrator skip) |
| Математика | 5 | 6.1 | Проценты | `math-5-protsenty-20260808-1200` | 2026-08-08 | 30 | 0 | `ready` (verbatim стр. 111–117; 2 fixed q05/q09; illustrator skip; пачка `_batch-math5-ch3-6-20260808` B1) |
| Математика | 5 | 7.1 | Угол. Градусная мера угла | `math-5-ugol-gradusnaya-mera-20260808-1230` | 2026-08-08 | 30 | 0 | `ready_for_asset_import` (verbatim стр. 133–137; новый 30 vs старый 15; 12 SVG/PNG angle; rewrite 4 anti-dup; пачка `_batch-math5-ch3-6-20260808` B2) |
| Математика | 5 | 7.2 | Транспортир. Измерение и построение углов | `math-5-transportir-izmerenie-postroenie-20260808-1300` | 2026-08-08 | 30 | 0 | `ready_for_asset_import` (verbatim стр. 139–142; 9 SVG/PNG angle; 2 blocked protractor G020; 1 fixed q29; пачка `_batch-math5-ch3-6-20260808` B3) |
| Математика | 5 | 7.3 | Сравнение углов. Виды углов. Чертежный треугольник | `math-5-sravnenie-vidy-uglov-20260808-1330` | 2026-08-08 | 30 | 0 | `ready_for_asset_import` (verbatim стр. 143–149; 10 SVG/PNG angle; 1 fixed q13; пачка `_batch-math5-ch3-6-20260808` B4) |
| Математика | 5 | 7.4 | Многоугольники | `math-5-mnogougolniki-20260808-1400` | 2026-08-08 | 30 | 0 | `ready_for_asset_import` (verbatim стр. 150–154; 10 SVG/PNG polygon; пачка `_batch-math5-ch3-6-20260808` B5) |
| Математика | 5 | — | Упражнения для повторения главы VII | `math-5-povtorenie-glavy-vii-20260808-1430` | 2026-08-08 | 8 | 0 | `ready-unverified` + `ready_for_asset_import` (стр. 155–156; count 30→8; RC_*; 2 fixed; 2 SVG/PNG angle/polygon; пачка `_batch-math5-ch3-6-20260808` B6) |
| Математика | 5 | 8.1 | Окружность. Круг | `math-5-okruzhnost-krug-20260808-1500` | 2026-08-08 | 30 | 0 | `ready_for_asset_import` (verbatim стр. 157–161; 2 fixed; 4 SVG/PNG set_euler/venn workaround G021; пачка `_batch-math5-ch3-6-20260808` B7) |
| Математика | 5 | 8.2 | Круговой сектор | `math-5-krugovoy-sektor-20260808-1530` | 2026-08-08 | 30 | 0 | `ready_for_asset_import` (verbatim стр. 162–164; 1 rewrite q16; 5 SVG/PNG angle workaround G021; пачка `_batch-math5-ch3-6-20260808` B8) |
| Математика | 5 | 8.3 | Способы представления статистических данных. Столбчатые, линейные, круговые и графические диаграммы. Таблицы | `math-5-sposoby-predstavleniya-stat-dannyh-20260808-1600` | 2026-08-08 | 30 | 0 | `ready_for_asset_import` (verbatim стр. 165–172; 2 fixed KK; 13 SVG/PNG bar_chart/angle; q13/q24 blocked G022; пачка `_batch-math5-ch3-6-20260808` B9) |
| Математика | 5 | 9.1 | Прямоугольный параллелепипед и его развертка | `math-5-parallelepiped-razvertka-20260808-1630` | 2026-08-08 | 30 | 0 | `ready_for_asset_import` (verbatim стр. 173–176; 2 fixed; 10 SVG/PNG parallelepiped/net; пачка `_batch-math5-ch3-6-20260808` B10) |
| Математика | 5 | 1.1 | Натуральные числа и нуль | `math-5-naturalnye-chisla-i-nol-20260808-1700` | 2026-08-08 | 30 | 0 | `ready` (verbatim стр. 4–8; illustrator skip; пачка `_batch-math5-ch3-6-20260808` B11) |
| Математика | 5 | 1.2 | Координатный луч. Изображение натуральных чисел и числа нуль на координатном луче | `math-5-koordinatnyy-luch-20260808-1800` | 2026-08-08 | 30 | 0 | `ready_for_asset_import` (verbatim стр. 9–13; 8 fixed; 12 SVG/PNG coordinate_ray; anti-dup vs probe+B11; пачка `_batch-math5-ch3-6-20260808` C1) |
| Математика | 5 | 1.3 | Сравнение натуральных чисел. Двойное неравенство | `math-5-sravnenie-naturalnyh-chisel-20260808-1830` | 2026-08-08 | 30 | 0 | `ready_for_asset_import` (verbatim стр. 14–17; rewrite q27; 3 SVG/PNG coordinate_ray; пачка `_batch-math5-ch3-6-20260808` C2) |
| Математика | 5 | — | Исторические сведения о системах счисления и записи чисел | `math-5-istor-sistemy-schisleniya-20260808-1900` | 2026-08-08 | 12 | 0 | `ready` (стр. 18–19 supplementary; count 30→12; 3 fixed KK; illustrator skip; пачка `_batch-math5-ch3-6-20260808` C3) |
| Математика | 5 | 1.4 | Сложение и вычитание натуральных чисел | `math-5-slozhenie-vychitanie-naturalnyh-20260808-1930` | 2026-08-08 | 30 | 0 | `ready_for_asset_import` (verbatim стр. 20–23; 4 SVG/PNG coordinate_ray; anti-dup vs C1–C3+B11; пачка `_batch-math5-ch3-6-20260808` C4) |
| Математика | 5 | 1.5 | Умножение и деление натуральных чисел. Основное свойство частного | `math-5-umnozhenie-delenie-naturalnyh-20260808-2000` | 2026-08-08 | 30 | 0 | `ready` (verbatim стр. 24–27; 1 fixed q02 anti-dup vs C4; illustrator skip; пачка `_batch-math5-ch3-6-20260808` C5) |
| Математика | 5 | — | История возникновения арифметических действий, знаков равенства и неравенства | `math-5-istor-arifmeticheskih-deystviy-20260808-2030` | 2026-08-08 | 10 | 0 | `ready` (стр. 28–29 supplementary; count 30→10; 2 fixed KK; illustrator skip; пачка `_batch-math5-ch3-6-20260808` C6) |
| Математика | 5 | 1.6 | Свойства арифметических действий | `math-5-svoystva-arifmeticheskih-deystviy-20260808-2100` | 2026-08-08 | 30 | 0 | `ready` (verbatim стр. 29–33; illustrator skip; пачка `_batch-math5-ch3-6-20260808` C7) |
| Математика | 5 | — | Способ сложения Гаусса | `math-5-sposob-slozheniya-gaussa-20260808-2130` | 2026-08-08 | 10 | 0 | `ready` (стр. 34–35 supplementary; count 30→10; illustrator skip; пачка `_batch-math5-ch3-6-20260808` C8) |
| Математика | 5 | 1.7 | Арифметические действия над натуральными числами | `math-5-arifmeticheskie-deystviya-naturalnye-20260808-2200` | 2026-08-08 | 12 | 0 | `ready` (verbatim стр. 36–37; count 30→12; order of ops; illustrator skip; пачка `_batch-math5-ch3-6-20260808` C9) |
| Математика | 5 | 1.8 | Числовые выражения. Буквенные выражения | `math-5-chislovye-bukvennye-vyrazheniya-20260808-2230` | 2026-08-08 | 30 | 0 | `ready` (verbatim стр. 38–42; 2 fixed anti-dup; illustrator skip; пачка `_batch-math5-ch3-6-20260808` C10) |
| Математика | 5 | 1.9 | Упрощение выражений | `math-5-uproshchenie-vyrazheniy-20260808-2300` | 2026-08-08 | 30 | 0 | `ready` (verbatim стр. 43–47; illustrator skip; пачка `_batch-math5-ch3-6-20260808` C11) |
| Математика | 5 | 7.1 | Угол. Градусная мера угла | `math-5-ugol-gradusnaya-mera-20260805-0019` | 2026-08-05 | 15 | 0 | `ready_for_asset_import` (текст ready; 6 SVG/PNG в `06`; правила verbatim стр. 133–137) |
| Математика | 5 | 4.5 | Умножение десятичной дроби на натуральное число | `math-5-umnozhenie-des-drobi-na-nat-chislo-20260804-1400` | 2026-08-04 | 12 | 0 | `ready-unverified` (правила RC_4501/RC_4502 реконструированы, нужна сверка с бумажным учебником) |
| Математика | 5 | 4.2 | Перевод десятичной дроби в обыкновенную, обыкновенной дроби в десятичную | `math-5-perevod-des-i-obykn-drobi-20260804-1752` | 2026-08-04 | 12 | 0 | `ready` (правила verbatim с PDF стр. 24–29; Java seed не использовался) |

## Пробы отдельных шагов

Папка `content/runs/_probes/` — не прогоны, а проверки одного шага пайплайна; в таблицу
покрытия они не попадают.

- `analyst-20260804/` — срезы по пяти темам из трёх учебников (сбор правил аналитиком).
- `illustrator-20260805/` — роль illustrator + CLI SVG/PNG на теме «координатный луч»
  (4 картинки, `06-illustrations.json`; см. README в папке).
