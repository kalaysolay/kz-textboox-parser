#!/usr/bin/env python3
"""Логирование статистики пайплайнов в локальный Excel-файл.

Три листа: Парсинг, Лекции, Вопросы. Строки добавляются идемпотентно:
повторный запуск по тому же runId / JSON-файлу обновляет строку, а не дублирует.

Использование:
    python log-stats.py parsing <parsed_v2.json> [--stats PATH]
    python log-stats.py parsing --all <parsed_outputs_dir> [--stats PATH]
    python log-stats.py lecture <run_dir> [--stats PATH]
        [--model-parser M --model-planner M --model-generator M --model-reviewer M]
    python log-stats.py questions <run_dir> [--stats PATH]
    python log-stats.py questions --all <runs_dir> [--stats PATH]

По умолчанию файл статистики: content/stats.xlsx (относительно корня репо).
Файл в .gitignore — это локальный бинарник, в коммиты не идёт.
"""

import argparse
import json
import os
import sys
from datetime import datetime

try:
    import openpyxl
    from openpyxl.styles import Font, PatternFill
except ImportError:
    sys.exit("Нужен openpyxl: pip install openpyxl")

DEFAULT_STATS = os.path.join("content", "stats.xlsx")

SHEETS = {
    "parsing": (
        "Парсинг",
        ["Дата записи", "JSON файл", "Предмет", "Класс", "Часть", "Авторы",
         "Год", "Метод извлечения", "Тем", "Правил",
         "Verbatim примеров", "Structural примеров",
         "High", "Medium", "Low", "Примечание"],
        "JSON файл",
    ),
    "lecture": (
        "Лекции",
        ["Дата записи", "RunId", "Предмет", "Класс", "Тема RU", "Код темы",
         "Страницы", "Статус источника", "Вердикт",
         "Блоков всего", "Принято", "Исправлено", "Отклонено",
         "Модели (parser/planner/generator/reviewer)", "Путь к 05"],
        "RunId",
    ),
    "questions": (
        "Вопросы",
        ["Дата записи", "RunId", "Предмет", "Класс", "Тема RU", "Код темы",
         "Заказано", "Всего", "Принято", "Исправлено", "Отклонено",
         "RejectRate", "SCQ", "MCQ", "FILL_IN",
         "Вердикт", "Иллюстрации", "Надёжность источника", "Путь к 05"],
        "RunId",
    ),
}

HEADER_FILL = PatternFill("solid", fgColor="D9E2F3")
HEADER_FONT = Font(bold=True)


def load_json(path):
    with open(path, encoding="utf-8-sig") as f:
        return json.load(f)


def now_str():
    return datetime.now().strftime("%Y-%m-%d %H:%M")


def ensure_sheet(wb, key):
    title, headers, _ = SHEETS[key]
    if title in wb.sheetnames:
        ws = wb[title]
    else:
        ws = wb.create_sheet(title)
        ws.append(headers)
        for cell in ws[1]:
            cell.font = HEADER_FONT
            cell.fill = HEADER_FILL
        ws.freeze_panes = "A2"
        ws.auto_filter.ref = ws.dimensions
    return ws


def polish_sheet(ws):
    for col in ws.columns:
        width = 0
        for cell in col:
            if cell.value is not None:
                width = max(width, len(str(cell.value)))
        ws.column_dimensions[col[0].column_letter].width = min(width + 2, 60)
    ws.auto_filter.ref = ws.dimensions


def upsert_row(ws, key_col_idx, key_value, row):
    for r in range(2, ws.max_row + 1):
        if ws.cell(row=r, column=key_col_idx).value == key_value:
            for c, v in enumerate(row, start=1):
                ws.cell(row=r, column=c).value = v
            return "updated"
    ws.append(row)
    return "added"


def save_stats(path, key, row, key_value):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    if os.path.exists(path):
        wb = openpyxl.load_workbook(path)
    else:
        wb = openpyxl.Workbook()
        if "Sheet" in wb.sheetnames and len(wb.sheetnames) == 1:
            wb.remove(wb["Sheet"])
    title, headers, key_name = SHEETS[key]
    ws = ensure_sheet(wb, key)
    key_col_idx = headers.index(key_name) + 1
    # Старые файлы без отступа под заголовок не трогаем, дописываем структуру при нужды
    status = upsert_row(ws, key_col_idx, key_value, row)
    polish_sheet(ws)
    wb.save(path)
    print(f"{title}: {status} ({key_name}={key_value}) -> {path}")
    return status


# ---------- Краулеры артефактов ----------

def parsing_stats(parsed_path):
    d = load_json(parsed_path)
    source = d.get("source", {}) or {}
    meta = d.get("metadata", {}) or {}
    em = source.get("extraction_method", {}) or {}
    qr = source.get("quality_report", {}) or {}
    ex = d.get("example_tasks_v2", {}) or {}

    if em.get("ocr_applied"):
        langs = ",".join(em.get("ocr_languages", []) or [])
        method = f"OCR ({langs})" if langs else "OCR"
    elif em.get("pdf_text_layer"):
        method = "текстовый слой"
    else:
        method = "неизвестно"

    authors = meta.get("authors", []) or []
    return [
        now_str(),
        os.path.basename(parsed_path),
        meta.get("subject", ""),
        meta.get("grade", ""),
        meta.get("part", ""),
        ", ".join(authors),
        meta.get("publication_year", ""),
        method,
        len(d.get("topics_with_pages", []) or []),
        len(d.get("rules", []) or []),
        len(ex.get("verbatim_examples", []) or []),
        len(ex.get("structural_examples_for_generation", []) or []),
        len(qr.get("high_confidence_blocks", []) or []),
        len(qr.get("medium_confidence_blocks", []) or []),
        len(qr.get("low_confidence_blocks", []) or []),
        (qr.get("note", "") or "")[:500],
    ]


def lecture_stats(run_dir, models):
    b = load_json(os.path.join(run_dir, "00-brief.json"))
    s = load_json(os.path.join(run_dir, "01-lecture-source.json"))
    p = load_json(os.path.join(run_dir, "02-lecture-plan.json"))
    r = load_json(os.path.join(run_dir, "04-lecture-review.json"))
    unit = s.get("unit", {}) or {}
    pages = f"{unit.get('pageStart', '')}-{unit.get('pageEnd', '')}"
    summary = r.get("summary", {}) or {}
    final = os.path.join(run_dir, "05-lecture.final.md")
    return [
        now_str(),
        b.get("runId", os.path.basename(os.path.abspath(run_dir))),
        b.get("subjectRu", ""),
        b.get("gradeNo", ""),
        b.get("topicRu", ""),
        b.get("topicCode", ""),
        pages,
        s.get("sourceStatus", ""),
        r.get("verdict", ""),
        summary.get("blocksChecked", ""),
        summary.get("accepted", ""),
        summary.get("fixed", ""),
        summary.get("rejected", ""),
        (f"parser:{models['parser']}/planner:{models['planner']}/"
         f"generator:{models['generator']}/reviewer:{models['reviewer']}"),
        final if os.path.exists(final) else "",
    ]


def questions_stats(run_dir):
    b = load_json(os.path.join(run_dir, "00-brief.json"))
    r = load_json(os.path.join(run_dir, "04-review.json"))
    final_path = os.path.join(run_dir, "05-questions.final.json")
    final = load_json(final_path) if os.path.exists(final_path) else {}
    fmeta = final.get("meta", {}) or {}
    summary = r.get("summary", {}) or {}
    # Фактический микс типов считаем по финалу, заказ — по brief
    types = {"SCQ": 0, "MCQ": 0, "FILL_IN": 0}
    for q in final.get("questions", []) or []:
        if q.get("type") in types:
            types[q["type"]] += 1
    return [
        now_str(),
        b.get("runId", os.path.basename(os.path.abspath(run_dir))),
        b.get("subjectRu", ""),
        b.get("gradeNo", ""),
        b.get("topicRu", ""),
        b.get("topicCode", ""),
        b.get("count", ""),
        summary.get("total", ""),
        summary.get("accepted", ""),
        summary.get("fixed", ""),
        summary.get("rejected", ""),
        summary.get("rejectRate", ""),
        types["SCQ"],
        types["MCQ"],
        types["FILL_IN"],
        r.get("verdict", ""),
        b.get("illustrationPolicy", ""),
        fmeta.get("sourceReliability", ""),
        final_path if final else "",
    ]


def iter_run_dirs(root):
    for name in sorted(os.listdir(root)):
        d = os.path.join(root, name)
        if os.path.isdir(d) and os.path.exists(os.path.join(d, "00-brief.json")):
            yield d


def iter_parsed(root):
    for dirpath, _, files in os.walk(root):
        for f in sorted(files):
            if f.endswith("_parsed_v2.json"):
                yield os.path.join(dirpath, f)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Статистика пайплайнов в Excel")
    ap.add_argument("stage", choices=["parsing", "lecture", "questions"])
    ap.add_argument("target", nargs="?",
                    help="JSON парсинга / папка прогона (не нужно с --all)")
    ap.add_argument("--all", metavar="DIR",
                    help="бэкфилл: все прогоны / все parsed JSON в DIR")
    ap.add_argument("--stats", default=DEFAULT_STATS)
    ap.add_argument("--model-parser", default="mimo-2.6")
    ap.add_argument("--model-planner", default="nemotron-3-ultra")
    ap.add_argument("--model-generator", default="gpt-5.6")
    ap.add_argument("--model-reviewer", default="nemotron-3-ultra")
    a = ap.parse_args(argv)

    models = {"parser": a.model_parser, "planner": a.model_planner,
              "generator": a.model_generator, "reviewer": a.model_reviewer}
    counts = {"added": 0, "updated": 0, "errors": 0}

    def handle(stage, target):
        try:
            if stage == "parsing":
                row = parsing_stats(target)
                key = os.path.basename(target)
            elif stage == "lecture":
                row = lecture_stats(target, models)
                key = row[1]
            else:
                row = questions_stats(target)
                key = row[1]
            st = save_stats(a.stats, stage, row, key)
            counts["updated" if st == "updated" else "added"] += 1
        except Exception as e:  # noqa: BLE001 — одна битая папка не роняет бэкфилл
            counts["errors"] += 1
            print(f"ОШИБКА {target}: {e}", file=sys.stderr)

    if a.all:
        if a.stage == "parsing":
            targets = list(iter_parsed(a.all))
        elif a.stage == "questions":
            targets = [d for d in iter_run_dirs(a.all)
                       if os.path.exists(os.path.join(d, "04-review.json"))]
        else:
            sys.exit("--all поддерживается только для parsing и questions")
        print(f"Найдено целей: {len(targets)}")
        for t in targets:
            handle(a.stage, t)
    else:
        if not a.target:
            sys.exit("Укажи цель или --all DIR")
        handle(a.stage, a.target)

    print(f"Итог: добавлено {counts['added']}, обновлено {counts['updated']}, "
          f"ошибок {counts['errors']}")


if __name__ == "__main__":
    main()
