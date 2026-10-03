# Контракт парсера 1.0.0

Этот файл нужен агенту при записи `structure.json`. Пользовательский запуск и журнал
версий — в `../PARSER_GUIDE.md`. Все номера `pdf_page` ниже — физические страницы PDF,
не печатные номера в книге. Печатный номер = PDF-номер минус проверенный offset.

## Выходные файлы

- `ocr/<job>/index.json` — ссылки на кэш, хеш PDF, качество кандидатов, метрики.
- `ocr/<job>/structure.json` — решения агента о структуре; тексты не перепечатываются.
- `parsed_outputs/<предмет>/<класс>/<book>_parsed_v3.json` — один итоговый JSON,
  содержащий metadata, topics_with_pages, rules, example_tasks_v2,
  generator_profile_kz_moem и source. OCR-кэш и планы — внутренние артефакты.
- `ocr/<job>/navigation/toc.json` и `toc.md` — оглавление/граф без полного текста.

## structure.json

```json
{
  "pdfSha256": "значение из index.json",
  "subject_kind": "stem",
  "metadata": {
    "title": "Название со страницы",
    "subject": "Математика",
    "grade": 5,
    "part": 1,
    "authors": [],
    "publisher": null,
    "publication_year": null,
    "isbn": {},
    "languages": ["ru"]
  },
  "topics_with_pages": [
    {
      "id": "topic_1_2",
      "topic_code": "1.2",
      "lesson_no": 3,
      "topic_title": "Координатный луч",
      "page_start": 9,
      "page_end_estimated": 13,
      "level": "topic",
      "parent_id": null,
      "level_path": [],
      "key_terms": [],
      "summary_1line": null,
      "block_refs": [{"pdf_page": 9, "block_id": "p9.b2"}]
    }
  ],
  "rules": [
    {
      "rule_id": "R_1",
      "name": "Координатный луч",
      "formula": null,
      "block_refs": [{"pdf_page": 9, "block_id": "p9.b2"}]
    }
  ],
  "textbook_tasks": [
    {
      "task_id": "T_1",
      "topic_ref": "topic_1_2",
      "rubric": "Ответьте на вопросы",
      "task_type": "oral",
      "block_refs": [{"pdf_page": 9, "block_id": "p9.b3"}],
      "answer_block_refs": []
    }
  ],
  "structural_examples_for_generation": [],
  "generator_profile_kz_moem": {},
  "verified_block_refs": [],
  "text_corrections": [],
  "ignored_blocks": [],
  "page_dispositions": []
}
```

Пример показывает формат, а не фактическое расположение определения на странице.
Используй ID из `select-textbook.js`, не копируй ID этого примера.

`block_refs` сохраняются в порядке чтения. Каждый блок можно включить в тему и
одновременно в правило. Для части строки укажи `start`/`end` — позиции UTF-16,
как в JavaScript `slice`; конец исключающий. Остальная часть должна быть явно
распределена или исключена с причиной. Нельзя silently обрезать длинные темы.

Для последовательности строк используй компактную ссылку:
`{"pdf_page":9,"from_block":"p9.b2","to_block":"p9.b20"}`.
Обе границы включаются; диапазон только внутри одной страницы, по порядку блоков
из пакета. Так не нужно писать двадцать однотипных ссылок. Формат поддерживается
в block_refs, answer_block_refs, verified_block_refs и ignored_blocks; для последних
нужна reason. Частичные start/end совместимы только с одиночным block_id.

`statement`, `question_text`, `full_text`, страницы правил и ответы заданий собирает
код. Не записывай эти тексты вручную. Описательные поля (название, тип, термины,
краткое резюме) пишет агент на основе материала. Не выдумывай библиографию.

Каждый извлечённый блок должен попасть в тему/правило/задание либо в
`ignored_blocks`: `{pdf_page, block_id, reason}`. Пример причины: водяной знак,
колонтитул, номер страницы, справочный ответ предыдущего урока. У страницы без
блоков должна быть запись `page_dispositions`: `{pdf_page, kind, reason}`;
`kind` — `blank`, `image_only`, `unreadable`, `front_matter`. Нечитаемую страницу
нельзя объявлять пустой только ради успешной валидации.

`verified_block_refs` содержит только реально сверенные по PNG фрагменты
с обязательным `evidence` (например, "PNG PDF 9: определение в рамке, символы сверены").
Свидетельства сохраняются в итоговом `source.verification`, чтобы следующие
роли могли проверить происхождение, а не верить одной пометке high.
OCR confidence и `allAvailable` не дают права добавлять эту пометку.
Непроверенные тексты сохраняются с medium-confidence; пригодность к генерации
определяется по всем используемым опорным фрагментам.

Исправление OCR выполняется через `text_corrections`:

```json
{
  "pdf_page": 9,
  "block_id": "p9.b7",
  "original_text": "83. Концы каждого отрезка…",
  "corrected_text": "3. Концы каждого отрезка…",
  "evidence": "PNG PDF 9: номер пункта 3, проверен визуально"
}
```

`original_text` должен точно совпасть с блоком из пакета. Сырые OCR-файлы не
меняются. Если после исправления выбирается часть блока, `start`/`end` относятся
к исправленному тексту. Изменение символа без визуального подтверждения запрещено.
Формулы/единицы/алфавиты сверяются отдельно; обычный OCR не гарантирует их точность.

Типы заданий по предмету: история — oral/written/map/table/discussion; математика —
calculation/word_problem/measurement/geometry/sets_logic; язык — reading/grammar/
vocabulary/text_analysis. Другой тип допустим с предметным обоснованием.
Structural-примеры имеют task_type/topic_refs/template/expected_skill/source_page.
Отсутствующая страница — null с объяснением в quality_report, не выдуманный номер.

## Совместимость и контроль

Выход остаётся v3 с прежними блоками. `textbook_tasks` находятся внутри
`example_tasks_v2`. `full_text` дословный, отдельно от резюме. Статусы unavailable
имеют reason/next_step. Иерархия использует уникальные id/parent_id.
Потребители v2 могут игнорировать новые source_block_refs/source.coverage/verified.

Валидация контролирует структуру, ссылки, символическую целостность копирования и
покрытие извлечённых блоков. Она не доказывает, что OCR обнаружил все надписи,
не распознаёт смысл таблиц и не заменяет визуальную проверку. Легальные короткие
задания и одинаковые начала разных вопросов не являются ошибкой автоматически.
Полная книга требует всех PDF-страниц в index.json; частичная явно маркируется.

Обнаруженные отсутствующие source_page или ссылки в старых JSON — ошибки старого
артефакта; исправляй по источнику, не подставляй произвольные значения.
