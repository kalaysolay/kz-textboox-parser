/* Общий рендерер содержимого для Damulab и локальной Мастерской.
 * Получает уже очищенный/собранный HTML. Он не является HTML-sanitizer:
 * сервер проверяет разметку, а этот модуль строит только интерфейс чтения. */
(function () {
    const labels = {
        ru: {answer: 'Показать ответ', question: 'Проверь себя', definition: 'Определение', example: 'Пример', warning: 'Обрати внимание', summary: 'Главное'},
        kk: {answer: 'Жауапты көрсету', question: 'Өзіңді тексер', definition: 'Анықтама', example: 'Мысал', warning: 'Назар аудар', summary: 'Ең бастысы'}
    };

    function render(root, options = {}) {
        if (!root) return;
        const lang = options.language === 'kk' ? 'kk' : 'ru';
        const text = labels[lang];
        root.classList.add('damulab-lecture');
        root.lang = lang;

        for (const link of root.querySelectorAll('a[href]')) {
            // Источник открывается отдельно, чтобы переход не заменял iframe урока.
            // Явно заданный автором target сохраняется и на основной странице.
            if (/^https?:\/\//i.test(link.getAttribute('href')) && !link.hasAttribute('target')) link.target = '_blank';
            if (link.target === '_blank') link.relList.add('noopener', 'noreferrer');
        }

        for (const block of root.querySelectorAll('blockquote[data-lecture-tone]')) {
            const label = text[block.dataset.lectureTone];
            if (label) block.setAttribute('aria-label', label);
        }

        for (const heading of root.querySelectorAll('[data-lecture-section="goals"]')) {
            if (heading.closest('.lecture-goals')) continue;
            const list = heading.nextElementSibling;
            if (!list || !['UL', 'OL'].includes(list.tagName)) continue;
            const section = document.createElement('section');
            section.className = 'lecture-goals';
            heading.before(section);
            section.append(heading, list);
        }

        for (const prompt of root.querySelectorAll('[data-lecture-part="prompt"]')) {
            if (prompt.closest('.lecture-self-check')) continue;
            const id = prompt.dataset.lectureQuestion;
            if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(id || '')) continue;
            const prompts = [], answers = [];
            let current = prompt;
            // При нажатии Enter Quill может разбить ответ на несколько абзацев.
            // Объединяем только соседние строки одной пары, не захватывая другой текст.
            while (current?.dataset.lectureQuestion === id) {
                const part = current.dataset.lecturePart;
                if (part === 'prompt' && !answers.length) prompts.push(current);
                else if (part === 'answer') answers.push(current);
                else break;
                current = current.nextElementSibling;
            }
            const section = document.createElement('section');
            section.className = 'lecture-self-check';
            section.setAttribute('aria-label', text.question);
            prompt.before(section);
            section.append(...prompts);
            // Ответ без вопроса никогда не скрываем. Если пара неполная, всё
            // оставшееся содержимое остаётся видимым и доступным редактору.
            if (answers.length) {
                const details = document.createElement('details');
                const summary = document.createElement('summary');
                summary.textContent = text.answer;
                details.append(summary, ...answers);
                section.append(details);
            }
        }

        for (const formula of root.querySelectorAll('.ql-formula')) {
            const value = (formula.dataset.value || '').trim();
            if (!value) continue;
            const parent = formula.parentElement;
            const standalone = parent?.tagName === 'P' && parent.children.length === 1 && parent.textContent.trim() === '';
            const display = formula.dataset.display === 'block'
                || (!formula.dataset.display && (parent?.classList.contains('lecture-formula-block') || standalone));
            if (display && parent && ['P', 'DIV'].includes(parent.tagName)) parent.classList.add('lecture-formula-block');
            if (!window.katex) { formula.textContent = value; continue; }
            try { window.katex.render(value, formula, {throwOnError: false, strict: 'warn', trust: false, displayMode: display}); }
            catch { formula.textContent = value; }
        }
    }
    window.DamulabLecture = Object.freeze({render, version: '2.0.1'});
}());
