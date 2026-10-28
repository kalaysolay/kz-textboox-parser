import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateExact,validateLesson,renderLesson,buildExport} from '../core.mjs';
const pair = s => ({ru:s,kk:s});
const fixture = () => ({schemaVersion:2,id:'test-lesson',revision:1,status:'draft',grade:5,title:pair('Тест'),subject:pair('Математика'),summary:pair('Описание'),estimatedMinutes:5,objectives:{ru:['Цель'],kk:['Мақсат']},sources:[{id:'author',type:'authored',title:'Автор',usage:pair('Примеры')}],assets:[],blocks:[{id:'b1',type:'paragraph',origin:'authored',sourceRefs:['author'],content:pair('Доли $\\frac{1}{2}$ <script>alert(1)</script>')}]});
test('арифметика десятичных дробей точная, поддерживает приоритет и отклоняет код',()=>{
 assert.equal(evaluateExact('0.1 + 0.2'),evaluateExact('0.3'));
 assert.equal(evaluateExact('(2.5-0.1)/0.6'),evaluateExact('4'));
 assert.equal(evaluateExact('-2*3+8'),evaluateExact('2'));
 assert.throws(()=>evaluateExact('1/0'));
 assert.throws(()=>evaluateExact('process.exit()'));
 assert.throws(()=>evaluateExact('2(3)'));
});
test('проверка обнаруживает неизвестные источники, потерю языка, ошибку KaTeX и арифметики',()=>{
 const doc=fixture(); doc.blocks.push({id:'b2',type:'formula',origin:'textbook',sourceRefs:['missing'],latex:'\\notARealCommand{x}',display:true,machineChecks:[{expression:'1.2*3',expected:'36'}]});
 doc.title.kk='';
 const r=validateLesson(doc);
 for(const code of ['source_ref','bilingual','formula','arithmetic']) assert.ok(r.errors.some(e=>e.code===code),code);
});
test('рендер экранирует текст, а экспорт сохраняет исходник формулы без DOM KaTeX',()=>{
 const doc=fixture(); assert.equal(validateLesson(doc).ok,true);
 const html=renderLesson(doc,'ru'); assert.ok(html.includes('class="katex"')); assert.ok(!html.includes('<script>'));
 const exported=buildExport(doc,'kk'); assert.ok(exported.includes('class="ql-formula"')); assert.ok(!exported.includes('class="katex"'));
 assert.ok(exported.includes('data-value="\\frac{1}{2}"'));
});
test('проверка принимает поврежденные структуры без падения и отвергает расхождение таблиц',()=>{
 for(const doc of [null,[],{}, {schemaVersion:2,blocks:[null],sources:[null],assets:[null]}]) assert.equal(validateLesson(doc).ok,false);
 const doc=fixture();doc.blocks.push({id:'t1',type:'table',origin:'authored',sourceRefs:['author'],headers:{ru:['A'],kk:['A']},rows:{ru:[['1','2']],kk:[['1']]}});
 assert.ok(validateLesson(doc).errors.some(e=>e.code==='table'));
});
test('экспорт отличает блочную формулу от строчной независимо от класса абзаца',()=>{
 const doc=fixture();
 doc.blocks.push({id:'block-formula',type:'formula',origin:'authored',sourceRefs:['author'],latex:'\\frac{3}{4}',display:true});
 doc.blocks.push({id:'inline-formula',type:'formula',origin:'authored',sourceRefs:['author'],latex:'x+1',display:false});
 const html=buildExport(doc,'ru');
 assert.match(html,/data-value="\\frac\{3\}\{4\}" data-display="block"/);
 assert.match(html,/data-value="x\+1" data-display="inline"/);
});
test('экспорт сохраняет цели, тип выделения и редактируемые пары вопрос/ответ без лишних заголовков',()=>{
 const doc=fixture();
 doc.blocks.push({id:'warning',type:'callout',tone:'warning',origin:'authored',sourceRefs:['author'],content:pair('Не дели на нуль')});
 doc.blocks.push({id:'self-check',type:'question',origin:'authored',sourceRefs:['author'],content:pair('Вычисли $1+1$'),answer:pair('Ответ $2$')});
 for(const lang of ['ru','kk']) {
  const html=buildExport(doc,lang);
  assert.doesNotMatch(html,/<h1|<h3/);
  assert.match(html,/data-lecture-section="goals"/);
  assert.ok(html.includes(doc.objectives[lang][0]));
  assert.match(html,/data-lecture-tone="warning"/);
  assert.match(html,/data-lecture-question="self-check" data-lecture-part="prompt"/);
  assert.match(html,/data-lecture-question="self-check" data-lecture-part="answer"/);
  assert.match(html,/data-display="inline"/);
  assert.doesNotMatch(html,/<details/); // Сворачивание строит общий reader после Quill.
 }
});
test('ошибочная формула в учебной цели останавливает проверку до экспорта',()=>{
 const doc=fixture();doc.objectives=pair(['Понимать $\\frac{1}{2}$']);
 assert.equal(validateLesson(doc).ok,true);
 doc.objectives.ru=['Понимать $\\notARealCommand{x}$'];
 assert.ok(validateLesson(doc).errors.some(e=>e.code==='formula'));
 doc.objectives.ru=['Понимать $без пары'];
 assert.ok(validateLesson(doc).errors.some(e=>e.code==='math_delimiter'));
});
