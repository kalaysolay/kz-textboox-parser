export const LENGTHS = {
 compact: {label:'Короткая', targetWords:450, maxWords:650},
 standard: {label:'Обычная', targetWords:700, maxWords:950},
 detailed: {label:'Подробная', targetWords:1000, maxWords:1300},
};

export function generationSettings(input={}) {
 const length=input.length??'compact', externalSources=Number(input.externalSources??1);
 if(!Object.hasOwn(LENGTHS,length)||![0,1].includes(externalSources)) {
  throw Object.assign(new Error('Выберите объём лекции и 0 или 1 дополнительный источник.'),{status:422,code:'generation_settings'});
 }
 return {length,externalSources,...LENGTHS[length]};
}

export function settingsPrompt(settings) {
 return `${settings.externalSources===0?'Researcher: не выполняй веб-поиск, не открывай внешние источники; сохрани пустой массив. ':''}Настройки заказа обязательны для всех ролей и имеют приоритет над общими рекомендациями скиллов об объёме: ${settings.label} лекция, ориентир ${settings.targetWords} слов, максимум ${settings.maxWords} слов на КАЖДОМ языке отдельно. Считай название урока, описание, цели, заголовки, текст, списки, таблицы, подписи, вопросы и ответы; не считай библиографию и служебные поля. Это потолок, а не минимум: простую тему объясняй короче. Учебник — основа; максимум ${settings.externalSources} дополнительный внешний источник во всём уроке, включая видео. Источник не обязателен, если не помогает понять тему; не добирай количество. Авторские примеры не считаются внешними источниками. Researcher пишет массив источников в Дополнительные источники.json (пустой массив при отсутствии дополнений), не более ${settings.externalSources} записей. Planner выбирает главное в рамках бюджета, не расширяет тему ради полноты главы. Generator пишет короткими абзацами, без общих вступлений, повторов, пересказа уже сказанного и необязательных отступлений; оставляет необходимые объяснения и один показательный пример, если он помогает. Reviewer проверяет бюджет, число источников и каждый абзац на пользу ученику; воду и повторы отмечает как major и требует сокращения. Не обрезай текст механически и не теряй ключевые определения и причинные связи; слишком широкую тему обозначь в плане как требующую разделения.`;
}

export function lessonBudget(doc,settings) {
 const strings=value=>typeof value==='string'?[value]:Array.isArray(value)?value.flatMap(strings):[];
 const words={};
 for(const lang of ['ru','kk']) {
  const text=[...['title','summary','objectives'].flatMap(key=>strings(doc[key]?.[lang])),...(doc.blocks??[]).flatMap(block=>['content','answer','items','headers','rows','caption','title','alt'].flatMap(key=>strings(block[key]?.[lang])))].join(' ');
  words[lang]=(text.match(/[\p{L}\p{N}]+(?:[-’'][\p{L}\p{N}]+)*/gu)??[]).length;
 }
 const external=(doc.sources??[]).filter(s=>!['textbook','authored'].includes(s.type)).length;
 const errors=[];
 for(const lang of ['ru','kk']) if(words[lang]>settings.maxWords) errors.push({code:'lesson_length',message:`${lang}: ${words[lang]} слов при максимуме ${settings.maxWords}. Сократите повторы и второстепенные детали.`});
 if(external>settings.externalSources) errors.push({code:'external_sources',message:`Внешних источников: ${external}, разрешено: ${settings.externalSources}.`});
 return {words,externalSources:external,errors};
}
