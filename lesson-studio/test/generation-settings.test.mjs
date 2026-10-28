import test from 'node:test';
import assert from 'node:assert/strict';
import {generationSettings,lessonBudget} from '../generation-settings.mjs';

test('default is compact with at most one external source; invalid settings are rejected',()=>{
 assert.deepEqual(generationSettings(),{length:'compact',externalSources:1,label:'Короткая',targetWords:450,maxWords:650});
 assert.equal(generationSettings({externalSources:'0'}).externalSources,0);
 for(const input of [{length:'unknown'},{externalSources:3},{externalSources:-1}])assert.throws(()=>generationSettings(input),e=>e.status===422);
});

test('word budgets are separate for RU and KK and count lists, tables and answers',()=>{
 const doc={blocks:[{content:{ru:'слово '.repeat(649),kk:'қысқа мәтін'}},{items:{ru:['ещё слово'],kk:['бір']}},{rows:{ru:[['ячейка']],kk:[['екі']]}},{answer:{ru:'ответ',kk:'жауап'}}],sources:[{type:'textbook'},{type:'authored'},{type:'web'}]};
 const result=lessonBudget(doc,generationSettings());
 assert.equal(result.words.ru,653);assert.equal(result.words.kk,5);
 assert.equal(result.externalSources,1);assert.deepEqual(result.errors.map(e=>e.code),['lesson_length']);
 doc.sources.push({type:'web'});assert.equal(lessonBudget(doc,generationSettings()).errors.at(-1).code,'external_sources');
});

test('visible title, summary and objectives count toward the budget, bibliography does not',()=>{
 const doc={title:{ru:'Название урока',kk:'Сабақ'},summary:{ru:'Краткое описание',kk:'Қысқа сипаттама'},objectives:{ru:['Первая цель','Вторая цель'],kk:['Бір мақсат']},blocks:[{content:{ru:'слово '.repeat(644),kk:'мәтін'}}],sources:[{type:'textbook',title:'Библиография '.repeat(100)}]};
 const result=lessonBudget(doc,generationSettings());
 assert.deepEqual(result.words,{ru:652,kk:6});
 assert.deepEqual(result.errors.map(e=>e.code),['lesson_length']);
});
