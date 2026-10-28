import {parseFragment} from 'parse5';

// Пробел между словами — часть содержания. Полное удаление пробелов скрывало
// потерю границы слов при сохранении; допускаем только нормализацию их ширины.
const compact=s=>s.replace(/[\uFEFF\u200B]/gu,'').replace(/\s+/gu,' ').trim();
const attr=(n,key)=>n.attrs?.find(a=>a.name===key)?.value??'';
const children=n=>n.childNodes??[];
const walk=n=>[n,...children(n).flatMap(walk)];
const nodes=(n,tag)=>walk(n).filter(v=>v.tagName===tag);
const formula=n=>n.tagName==='span'&&attr(n,'class').split(/\s+/).includes('ql-formula');
function text(n){return formula(n)?`⟦${attr(n,'data-value')}⟧`:n.nodeName==='#text'?n.value:children(n).map(text).join('');}

// Сравниваем смысл и порядок структур после серверной очистки, игнорируя только
// пробелы, служебные div/thead и DOM KaTeX. Потеря ячейки, режима, alt или ответа
// остаётся различием, даже если суммарный текст страницы выглядит похожим.
export function htmlSnapshot(html){
 const root=parseFragment(html),all=walk(root);
 const list=n=>({kind:n.tagName,items:children(n).filter(c=>c.tagName==='li').map(li=>({text:compact(children(li).filter(c=>!['ol','ul'].includes(c.tagName)).map(text).join('')),children:children(li).filter(c=>['ol','ul'].includes(c.tagName)).map(list)}))});
 const topLists=n=>children(n).flatMap(c=>['ol','ul'].includes(c.tagName)?[list(c)]:topLists(c));
 const markerKeys=['data-lecture-question','data-lecture-part','data-lecture-tone','data-lecture-section'];
 return {
  text:compact(text(root)),
  headings:all.filter(n=>/^h[1-6]$/.test(n.tagName??'')).map(n=>({level:n.tagName,text:compact(text(n))})),
  formatting:all.filter(n=>['strong','b','em','i','u','s','sub','sup','pre','code','blockquote'].includes(n.tagName)).map(n=>({kind:({b:'strong',i:'em'})[n.tagName]??n.tagName,text:compact(text(n))})),
  formulas:all.filter(formula).map(n=>({latex:attr(n,'data-value'),display:attr(n,'data-display')||'inline'})),
  tables:nodes(root,'table').map(t=>nodes(t,'tr').map(r=>children(r).filter(c=>['td','th'].includes(c.tagName)).map(c=>({tag:c.tagName,text:compact(text(c)),colspan:attr(c,'colspan')||'1',rowspan:attr(c,'rowspan')||'1',scope:attr(c,'scope')||(c.tagName==='th'?'col':'')})))),
  lists:topLists(root),
  images:nodes(root,'img').map(n=>Object.fromEntries(['src','alt','width','title'].map(k=>[k,attr(n,k)]))),
  videos:nodes(root,'iframe').map(n=>({src:attr(n,'src'),title:attr(n,'title')||'YouTube video player'})),
  links:nodes(root,'a').map(n=>({href:attr(n,'href'),text:compact(text(n))})),
  markers:all.filter(n=>markerKeys.some(k=>attr(n,k))).map(n=>({...Object.fromEntries(markerKeys.filter(k=>attr(n,k)).map(k=>[k,attr(n,k)])),text:compact(text(n))}))
 };
}
export function compareHtml(expected,actual){
 const before=htmlSnapshot(expected),after=htmlSnapshot(actual);
 const differences=Object.keys(before).filter(k=>JSON.stringify(before[k])!==JSON.stringify(after[k]));
 return {ok:!differences.length,differences};
}
