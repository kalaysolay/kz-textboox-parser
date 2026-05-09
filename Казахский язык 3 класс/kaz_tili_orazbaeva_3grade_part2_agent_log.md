# Агент логі — Қазақ тілі 3 сынып (2-бөлім)

**PDF:** қазақ тілі Оразбаева 3 сынып 2 бөлім (жаңартылған түп).

**Күні:** 2026-05-09

## Өңдеу
1. `extract-pdfjs.mjs` → `ocr/ocr_text_kaz_tili_orazbaeva_3grade_part2` (128 бет).
2. МОН ескертпе жолы беттестіру regex арқылы алынып тасталды.
3. `ocr-pdfjs.mjs` (tesseract.js, kaz+rus, scale 2) → `ocr/ocr_pages_orazbaeva_3grade_part2_glyph_fix` беттер: 107–109, 122–127; builder мәтін қабатында OCR бар болса оны алдымен қолданады (verbatim, сөздік raw).

## Сенім
- **[High]** бөлім бөліктері page 127 + титул/колофон бөлікті дәлелі.
- **[Medium]** OCR фрагменттері шумды; 107 мәтіні мен Мазмұн жолдары орташа сенім; сөздікті kk|ru entry split әлі жоқ.

## Шығарылым
- `kaz_tili_orazbaeva_3grade_part2_parsed_v2.json`
- `kaz_tili_orazbaeva_3grade_part2_agent_log.md`
