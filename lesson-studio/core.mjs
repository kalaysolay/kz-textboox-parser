import katex from 'katex';

export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const langs = ['ru', 'kk'];
const types = new Set(['heading','paragraph','callout','list','formula','table','question','video','image']);
const formulaOptions = { throwOnError: true, trust: false, strict: 'warn', maxExpand: 500, maxSize: 20 };
const safeUrl = value => { try { const u = new URL(value); return ['https:','http:'].includes(u.protocol) && !u.username && !u.password ? u.href : null; } catch { return null; } };
const validPair = v => v && langs.every(l => typeof v[l] === 'string' && v[l].trim());
const validLists = v => v && langs.every(l => Array.isArray(v[l]) && v[l].length && v[l].every(s => typeof s === 'string' && s.trim()));

// Не используем eval и float: числовая проверка выполняется точными рациональными числами.
function rational(n, d = 1n) {
  if (!d) throw new Error('Деление на ноль');
  if (d < 0) { n = -n; d = -d; }
  let a = n < 0 ? -n : n, b = d;
  while (b) [a, b] = [b, a % b];
  return { n: n / (a || 1n), d: d / (a || 1n) };
}
export function evaluateExact(expression) {
  if (typeof expression !== 'string' || expression.length > 500) throw new Error('Некорректная длина выражения');
  const tokens = expression.match(/(?:\d+(?:\.\d+)?|[()+*/-])/g) || [];
  if (tokens.join('') !== expression.replace(/\s/g, '')) throw new Error('Неподдерживаемое выражение');
  let pos = 0;
  function atom() {
    if (tokens[pos] === '+' || tokens[pos] === '-') {
      const sign = tokens[pos++], a = atom(); return sign === '-' ? rational(-a.n, a.d) : a;
    }
    if (tokens[pos] === '(') { pos++; const a = sum(); if (tokens[pos++] !== ')') throw new Error('Нет закрывающей скобки'); return a; }
    const value = tokens[pos++];
    if (!/^\d+(?:\.\d+)?$/.test(value || '')) throw new Error('Ожидалось число');
    const [whole, fraction = ''] = value.split('.');
    return rational(BigInt(whole + fraction), 10n ** BigInt(fraction.length));
  }
  function product() {
    let a = atom();
    while (tokens[pos] === '*' || tokens[pos] === '/') {
      const op = tokens[pos++], b = atom();
      a = op === '*' ? rational(a.n * b.n, a.d * b.d) : rational(a.n * b.d, a.d * b.n);
    }
    return a;
  }
  function sum() {
    let a = product();
    while (tokens[pos] === '+' || tokens[pos] === '-') {
      const op = tokens[pos++], b = product();
      a = rational(a.n * b.d + (op === '+' ? b.n : -b.n) * a.d, a.d * b.d);
    }
    return a;
  }
  const result = sum();
  if (pos !== tokens.length) throw new Error('Лишние символы в выражении');
  return `${result.n}/${result.d}`;
}

function textFormulas(text) {
  const matches = [...String(text).matchAll(/(?<!\\)\$([^$\n]+)\$/g)];
  const without = String(text).replace(/(?<!\\)\$([^$\n]+)\$/g, '').replace(/\\\$/g, '');
  return { matches, unpaired: without.includes('$') };
}

export function validateLesson(doc) {
  const errors = [], warnings = [];
  const add = (code, message, blockId) => errors.push({code,message,...(blockId ? {blockId} : {})});
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return {ok:false,errors:[{code:'document',message:'Ожидается объект урока'}],warnings};
  if (doc.schemaVersion !== 2) add('schema','Поддерживается schemaVersion 2');
  if (!/^[a-z0-9][a-z0-9-]{1,127}$/.test(doc.id || '')) add('id','Нужен стабильный id латиницей');
  if (!Number.isInteger(doc.revision) || doc.revision < 1) add('revision','Номер редакции должен быть положительным целым');
  if (!['draft','reviewed'].includes(doc.status)) add('status','Допустим статус draft или reviewed');
  if (!Number.isInteger(doc.grade) || doc.grade < 1 || doc.grade > 12) add('grade','Класс должен быть от 1 до 12');
  for (const key of ['title','subject','summary']) if (!validPair(doc[key])) add('bilingual',`Поле ${key}: заполните ru и kk`);
  if (!validLists(doc.objectives)) add('objectives','Заполните учебные цели обоих языков');
  else if (doc.objectives.ru.length !== doc.objectives.kk.length) add('parity','Количество учебных целей RU/KK различается');
  if (!Number.isFinite(doc.estimatedMinutes) || doc.estimatedMinutes < 1 || doc.estimatedMinutes > 180) add('duration','Укажите длительность 1–180 минут');
  if (!Array.isArray(doc.sources) || !doc.sources.length) add('sources','Нужен список источников');
  if (!Array.isArray(doc.assets)) add('assets','assets должен быть массивом');
  const sources = new Set(), assetIds = new Set();
  for (const source of Array.isArray(doc.sources) ? doc.sources : []) {
    if (!source || typeof source !== 'object') { add('source','Некорректный источник'); continue; }
    if (!source.id || sources.has(source.id)) add('source_id','Идентификаторы источников должны быть уникальны');
    sources.add(source.id);
    if (!['textbook','web','authored'].includes(source.type) || !source.title || !validPair(source.usage)) add('source','Источник должен содержать тип, название и usage RU/KK');
    if (source.type === 'web' && (!safeUrl(source.url) || !source.accessedAt || !source.evidenceNote)) add('web_source','У веб-источника нужны URL, дата обращения и свидетельство проверки');
    if (source.type === 'textbook' && (!source.path || !/^[a-f0-9]{64}$/.test(source.sha256 || '') || !Array.isArray(source.pages) || !source.pages.length)) add('textbook_source','У учебника нужны путь, SHA-256 и страницы');
  }
  for (const asset of Array.isArray(doc.assets) ? doc.assets : []) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(asset?.id||'') || assetIds.has(asset.id)) add('asset_id','Некорректный или повторяющийся asset id');
    assetIds.add(asset?.id);
    if (!/^assets\/[a-zA-Z0-9А-Яа-яӘәҒғҚқҢңӨөҰұҮүҺһІі _.-]+\.(png|jpg|jpeg|gif|webp)$/u.test(asset?.path || '') || asset.path.includes('..')) add('asset_path','Asset должен быть файлом внутри assets/');
  }
  const checkFormula = (latex, id) => {
    if (typeof latex !== 'string' || !latex.trim() || latex.length > 1000 || latex.includes('$') || /\\(?:href|url|includegraphics|htmlClass|htmlId|htmlStyle|htmlData)\b/i.test(latex)) { add('formula','Недопустимое выражение KaTeX',id); return; }
    try { katex.renderToString(latex, formulaOptions); } catch (e) { add('formula',`Ошибка KaTeX: ${e.message}`,id); }
  };
  if (!Array.isArray(doc.blocks) || !doc.blocks.length) add('blocks','Урок не содержит блоков');
  const ids = new Set(); let formulasChecked = 0, arithmeticChecked = 0;
  // Цели теперь входят в HTML Damulab и также могут содержать строчную математику.
  // Ошибка в них должна останавливать сохранение так же, как ошибка в абзаце.
  for (const lang of langs) for (const goal of Array.isArray(doc.objectives?.[lang]) ? doc.objectives[lang] : []) {
    if (typeof goal !== 'string') continue;
    const {matches,unpaired} = textFormulas(goal);
    if (unpaired) add('math_delimiter',`Непарный разделитель $ в учебной цели ${lang}`);
    for (const match of matches) {checkFormula(match[1]);formulasChecked++;}
  }
  for (const block of Array.isArray(doc.blocks) ? doc.blocks : []) {
    if (!block || typeof block !== 'object') { add('block','Некорректный блок'); continue; }
    const id = block.id;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id || '') || ids.has(id)) add('block_id','Некорректный или повторяющийся id блока',id);
    ids.add(id);
    if (!types.has(block.type)) add('block_type',`Неизвестный тип ${block.type}`,id);
    if (!['textbook','adaptation','authored','external'].includes(block.origin)) add('origin','Укажите происхождение блока',id);
    if (!Array.isArray(block.sourceRefs) || !block.sourceRefs.length || block.sourceRefs.some(ref => !sources.has(ref))) add('source_ref','У блока нет корректной ссылки на источник',id);
    if (['heading','paragraph','callout','question','video'].includes(block.type) && !validPair(block.content)) add('bilingual','Содержимое блока должно быть заполнено на RU и KK',id);
    if (block.type === 'heading' && ![2,3].includes(block.level)) add('heading','Уровень заголовка должен быть 2 или 3',id);
    if (block.type === 'callout' && !['definition','example','warning','summary'].includes(block.tone)) add('callout','Неизвестный вид выделенного блока',id);
    if (block.type === 'question' && !validPair(block.answer)) add('answer','Добавьте ответы RU и KK',id);
    if (block.type === 'question' && typeof id==='string' && id.length>128) add('question_id','ID вопроса не должен превышать 128 символов',id);
    if (block.type === 'list' && (!validLists(block.items) || block.items.ru.length !== block.items.kk.length || typeof block.ordered !== 'boolean')) add('list','Проверьте обе версии списка и ordered',id);
    if (block.type === 'formula') { checkFormula(block.latex,id); formulasChecked++; if (typeof block.display !== 'boolean') add('display','Укажите режим формулы display',id); }
    if (block.type === 'video' && (block.provider !== 'youtube' || !/^[\w-]{11}$/.test(block.videoId || '') || !validPair(block.title))) add('video','Нужны YouTube ID и двуязычное название',id);
    if (block.type === 'image' && (!assetIds.has(block.assetId) || !validPair(block.alt) || !validPair(block.caption))) add('image','Проверьте assetId, alt и подписи обоих языков',id);
    if (block.type === 'table') {
      const h = block.headers, rows = block.rows;
      if (!validLists(h) || h.ru.length !== h.kk.length || !rows || !langs.every(l => Array.isArray(rows[l]) && rows[l].length && rows[l].every(row => Array.isArray(row) && row.length === h[l].length && row.every(c => typeof c === 'string'))) || rows.ru.length !== rows.kk.length) add('table','Размеры и содержимое таблицы RU/KK должны совпадать',id);
    }
    // Числа в переводе не должны незаметно меняться; это не проверка смысла перевода.
    const localized = [block.content,block.answer,block.items,block.headers,block.rows,block.caption].filter(Boolean);
    const numbers = value => (JSON.stringify(value).match(/\d+(?:[.,]\d+)?/g)||[]).map(v=>evaluateExact(v.replace(',','.'))).sort().join('|');
    for (const field of localized) if (field.ru !== undefined && field.kk !== undefined && numbers(field.ru) !== numbers(field.kk)) add('parity_numbers','Числа в RU и KK различаются',id);
    // Проверяем формулы во всех строках блока, включая таблицы и скрытые ответы.
    const collect = v => typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(collect) : v && typeof v === 'object' ? Object.values(v).flatMap(collect) : [];
    for (const value of collect({content:block.content,answer:block.answer,items:block.items,headers:block.headers,rows:block.rows,caption:block.caption})) {
      const {matches,unpaired} = textFormulas(value);
      if (unpaired) add('math_delimiter','Непарный разделитель $ в тексте',id);
      for (const match of matches) { checkFormula(match[1],id); formulasChecked++; }
      const prose = value.replace(/\$[^$]+\$/g, '');
      if (/[А-Яа-яӘәҒғҚқҢңӨөҰұҮүҺһІі]+[a-zA-Z]+|[a-zA-Z]+[А-Яа-яӘәҒғҚқҢңӨөҰұҮүҺһІі]+/u.test(prose)) warnings.push({code:'mixed_script',message:'Проверьте смешение алфавитов',blockId:id});
    }
    if (block.machineChecks !== undefined && !Array.isArray(block.machineChecks)) add('machine_checks','machineChecks должен быть массивом',id);
    for (const check of Array.isArray(block.machineChecks) ? block.machineChecks : []) {
      try { arithmeticChecked++; if (evaluateExact(check.expression) !== evaluateExact(check.expected)) add('arithmetic',`Неверное равенство: ${check.expression} = ${check.expected}`,id); }
      catch (e) { add('arithmetic',e.message,id); }
    }
  }
  warnings.push({code:'semantic_review',message:'Автоматическая проверка не подтверждает факты, педагогическое качество и естественность казахского языка.'});
  return {ok:errors.length === 0,errors,warnings,stats:{blocks:ids.size,formulasChecked,arithmeticChecked}};
}

function inline(text, forExport = false) {
  let result = '', cursor = 0;
  for (const match of textFormulas(text).matches) {
    result += escapeHtml(text.slice(cursor,match.index)).replace(/\n/g,'<br>');
    result += forExport ? `<span class="ql-formula" data-value="${escapeHtml(match[1])}" data-display="inline" contenteditable="false"></span>` : katex.renderToString(match[1],{...formulaOptions,displayMode:false});
    cursor = match.index + match[0].length;
  }
  return result + escapeHtml(String(text).slice(cursor)).replace(/\n/g,'<br>');
}

function render(doc, lang, forExport, options = {}) {
  if (!langs.includes(lang)) throw new Error('Язык должен быть ru или kk');
  const validation = validateLesson(doc);
  if (!validation.ok) throw new Error(validation.errors.map(e => e.message).join('; '));
  return doc.blocks.map(block => {
    const text = v => inline(v,forExport), body = block.content?.[lang];
    const attrs = forExport ? '' : ` id="${escapeHtml(block.id)}" data-block-id="${escapeHtml(block.id)}"`;
    const refs = forExport || !options.showSources ? '' : `<div class="block-sources">${block.sourceRefs.map(ref => { const s=doc.sources.find(s => s.id===ref);return `<span title="${escapeHtml(s.title)}">${escapeHtml(s.type==='textbook' ? (lang==='kk'?'Оқулық':'Учебник') : s.type==='authored' ? (lang==='kk'?'Авторлық':'Авторское') : s.title)}</span>`; }).join('')}</div>`;
    let html;
    switch (block.type) {
      case 'heading': html=`<h${block.level}${attrs}>${text(body)}</h${block.level}>`; break;
      case 'paragraph': html=`<p${attrs}>${text(body)}</p>`; break;
      case 'callout': html=forExport ? `<blockquote data-lecture-tone="${block.tone}"><p>${text(body)}</p></blockquote>` : `<aside${attrs} class="callout ${block.tone}"><p>${text(body)}</p></aside>`;break;
      case 'list': {const tag=block.ordered?'ol':'ul';html=`<${tag}${attrs}>${block.items[lang].map(i=>`<li>${text(i)}</li>`).join('')}</${tag}>`;break;}
      case 'formula': html=forExport ? `<p class="${block.display?'lecture-formula-block':'lecture-formula'}"><span class="ql-formula" data-value="${escapeHtml(block.latex)}" data-display="${block.display?'block':'inline'}" contenteditable="false"></span></p>` : `<div${attrs} class="math-block${block.display?' display':''}" tabindex="0">${katex.renderToString(block.latex,{...formulaOptions,displayMode:block.display})}</div>`;break;
      case 'table': html=`<${forExport?'div':'div'}${attrs} class="table-scroll"><table><thead><tr>${block.headers[lang].map(h=>`<th>${text(h)}</th>`).join('')}</tr></thead><tbody>${block.rows[lang].map(row=>`<tr>${row.map(c=>`<td>${text(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;break;
      case 'question': html=forExport ? `<p data-lecture-question="${escapeHtml(block.id)}" data-lecture-part="prompt">${text(body)}</p><p data-lecture-question="${escapeHtml(block.id)}" data-lecture-part="answer">${text(block.answer[lang])}</p>` : `<section${attrs} class="self-check"><p>${text(body)}</p><details><summary>${lang==='kk'?'Жауапты көрсету':'Показать ответ'}</summary><p>${text(block.answer[lang])}</p></details></section>`;break;
      case 'video': html=`<section${attrs}><h3>${text(block.title[lang])}</h3><iframe class="ql-video" src="https://www.youtube.com/embed/${block.videoId}" title="${escapeHtml(block.title[lang])}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="encrypted-media; picture-in-picture; fullscreen; camera 'none'; microphone 'none'; display-capture 'none'" allowfullscreen></iframe><p>${text(body)}</p><a href="https://www.youtube.com/watch?v=${block.videoId}" target="_blank" rel="noopener noreferrer">${lang==='kk'?'YouTube сайтында ашу':'Открыть на YouTube'}</a></section>`;break;
      case 'image': {const asset=doc.assets.find(a=>a.id===block.assetId); const url=forExport?`asset://${asset.id}`:`/api/lessons/${encodeURIComponent(doc.id)}/assets/${encodeURIComponent(asset.id)}`;html=forExport?`<p><img src="${escapeHtml(url)}" alt="${escapeHtml(block.alt[lang])}"></p><p>${text(block.caption[lang])}</p>`:`<figure${attrs}><img src="${escapeHtml(url)}" alt="${escapeHtml(block.alt[lang])}" loading="lazy"><figcaption>${text(block.caption[lang])}</figcaption></figure>`;break;}
      default: throw new Error('Неподдерживаемый блок');
    }
    return html+refs;
  }).join('\n');
}
export function renderLesson(doc,lang,options={}) { return render(doc,lang,false,options); }
export function buildExport(doc,lang) {
  // Заголовок приходит из метаданных Damulab. В содержимом он не повторяется;
  // aria-label сохраняет название у скачанного фрагмента, не создавая второй H1.
  const body=render(doc,lang,true);
  const goals=`<h2 data-lecture-section="goals">${lang==='kk'?'Сабақтың мақсаттары':'Цели урока'}</h2><ul>${doc.objectives[lang].map(goal=>`<li>${inline(goal,true)}</li>`).join('')}</ul>`;
  const sources=`<h2 data-lecture-section="sources">${lang==='kk'?'Дереккөздер':'Источники'}</h2><ul>`+doc.sources.filter(s=>s.type!=='authored').map(s=>`<li>${s.url&&safeUrl(s.url)?`<a href="${escapeHtml(safeUrl(s.url))}">${escapeHtml(s.title)}</a>`:escapeHtml(s.title)}${s.pages?` — ${escapeHtml(s.pages.join(', '))}`:''}</li>`).join('')+'</ul>';
  return `<div class="damulab-lesson" aria-label="${escapeHtml(doc.title[lang])}">${goals}\n${body}\n${sources}</div>`;
}
