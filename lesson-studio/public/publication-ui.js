// Пароль отправляется только локальному серверу и немедленно удаляется из формы.
// Загрузка и публикация разведены: перед каждой показан конкретный урок и адрес.
export async function mountPublication({container,lesson,dirty,api,toast,escape:e,confirmAction}){
 const route=`/api/lessons/${encodeURIComponent(lesson.doc.id)}/damulab`;
 let plan=null,catalog=null,info=await api(route);
 if(!container.isConnected)return;
 function draw(){
  container.innerHTML=`<section class="publication-card"><p class="eyebrow">ПОДГОТОВКА И ПУБЛИКАЦИЯ</p><h2>Загрузка в Damulab</h2><p>Сначала загружаем черновик и сравниваем сохранённый результат. Публикация выполняется отдельно.</p>${dirty?'<p class="inline-error">Сохраните локальные правки перед загрузкой.</p>':''}
  ${!info.connected?`<form id="damulab-connect"><label class="field">Адрес Damulab<input name="baseUrl" type="url" placeholder="https://damulab.kz" required></label><label class="field">Email администратора<input name="email" type="email" autocomplete="username" required></label><label class="field">Пароль<input name="password" type="password" autocomplete="off" required></label><button class="primary-button">Подключиться</button><p class="field-help">Сеанс хранится только до остановки Мастерской. Пароль и cookies не записываются в файлы.</p></form>`:`<p>Подключено: <strong>${e(info.origin)}</strong> · renderer ${e(info.capabilities.rendererVersion)}</p><button class="secondary-button" id="damulab-disconnect">Отключиться</button><form id="damulab-prepare"><label class="field">Предмет<select name="subjectId" required></select></label><label class="field">Класс<select name="gradeId" required></select></label><label class="field">Тема<select name="topicId" required></select></label><label class="field">Завершение урока<select name="controlMode"><option value="NONE">Только теория и самопроверки в тексте</option><option value="AUTO">Итоговый тест из опубликованных вопросов темы</option></select></label><label class="field">Вопросов итогового теста<input name="questionCount" type="number" min="1" max="10" value="3"></label><button class="primary-button" ${dirty?'disabled':''}>Проверить загрузку</button></form>`}
  <div id="damulab-result" role="status"></div></section>`;
  if(info.connected&&catalog)fillCatalog();
  container.querySelector('#damulab-disconnect')?.addEventListener('click',async()=>{await api('/api/damulab/disconnect',{method:'POST',body:'{}'});info={connected:false};plan=null;draw();});
  container.querySelector('#damulab-connect')?.addEventListener('submit',async event=>{
   event.preventDefault();const form=event.currentTarget,data=Object.fromEntries(new FormData(form));form.elements.password.value='';await run(async()=>{info=await api('/api/damulab/connect',{method:'POST',body:JSON.stringify(data)});data.password='';catalog=await api('/api/damulab/catalog');draw();showMapping();});data.password='';
  });
  container.querySelector('#damulab-prepare')?.addEventListener('submit',async event=>{event.preventDefault();if(dirty){toast('Сохраните локальные правки перед загрузкой.',true);return;}const selection=Object.fromEntries(new FormData(event.currentTarget));await run(async()=>{
   plan=await api(route+'/prepare',{method:'POST',body:JSON.stringify(selection)});
   result().innerHTML=`<h3>${plan.action==='create'?'Новый черновик':'Обновление черновика'}</h3><p>${e(plan.title.ru)} / ${e(plan.title.kk)}</p><p>${e(plan.origin)} → ${e(plan.subject)}, ${e(plan.grade)} класс → ${e(plan.topic)}</p><p>Картинок: ${plan.assetCount}. Независимое ревью: ${plan.reviewReady?'актуально':'ещё не принято; разрешена только загрузка черновика'}.</p><button class="primary-button" id="damulab-upload">Загрузить черновик</button>`;
   container.querySelector('#damulab-upload').addEventListener('click',()=>run(async()=>{const mapping=await api(route+'/upload',{method:'POST',body:JSON.stringify({planId:plan.planId})});info.mapping=mapping;plan=null;showMapping();toast(mapping.unchanged?'Эта редакция уже загружена и сверена.':'Черновик загружен. RU/KK сверены с сервером.');}));
  });});
 }
 const result=()=>container.querySelector('#damulab-result');
 async function run(action){
  const buttons=[...container.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
  try{await action();}catch(error){if(result())result().textContent=error.message;toast(error.message,true);}finally{buttons.filter(b=>b.isConnected).forEach(b=>b.disabled=false);}
 }
 function fillCatalog(){
  const form=container.querySelector('#damulab-prepare');
  form.elements.subjectId.innerHTML=catalog.subjects.map(s=>`<option value="${s.id}">${e(s.titleRu)}</option>`).join('');
  const subject=catalog.subjects.find(s=>s.titleRu.toLowerCase()===lesson.doc.subject.ru.toLowerCase());if(subject)form.elements.subjectId.value=subject.id;
  form.elements.gradeId.innerHTML=catalog.grades.filter(g=>g.gradeNo===lesson.doc.grade).map(g=>`<option value="${g.id}">${e(g.labelRu??`${g.gradeNo} класс`)}</option>`).join('');
  const topics=async()=>{
   const subjectId=form.elements.subjectId.value,gradeId=form.elements.gradeId.value;
   plan=null;result()?.replaceChildren();form.elements.topicId.innerHTML='<option value="">Загрузка тем…</option>';
   try{const data=await api(`/api/damulab/catalog?subjectId=${encodeURIComponent(subjectId)}&gradeId=${encodeURIComponent(gradeId)}`);
    if(!form.isConnected||subjectId!==form.elements.subjectId.value||gradeId!==form.elements.gradeId.value)return;
    form.elements.topicId.innerHTML='<option value="">Выберите тему</option>'+data.topics.map(t=>`<option value="${t.id}">${e(t.titleRu)}</option>`).join('');
    if(!data.topics.length)result().textContent='У выбранных предмета и класса пока нет тем. Создайте тему в админке Damulab и откройте эту вкладку заново.';
   }catch(error){toast(error.message,true);}
  };
  form.addEventListener('change',()=>{plan=null;result()?.replaceChildren();});
  form.elements.subjectId.addEventListener('change',topics);form.elements.gradeId.addEventListener('change',topics);topics();
 }
 function showMapping(){
  const mapping=info.mapping;if(!mapping||!result())return;
  result().innerHTML=`<h3>${mapping.status==='published'?'Опубликовано':'Серверный черновик'}</h3><p>Сравнение: ${mapping.verified?'RU/KK совпали':'есть расхождения; публикация заблокирована'}</p><p><a href="${e(mapping.previewUrl)}" target="_blank" rel="noopener noreferrer">Посмотреть в Damulab</a> · <a href="${e(mapping.editUrl)}" target="_blank" rel="noopener noreferrer">Открыть редактор</a></p>${mapping.status==='published'?'<p>Эта редакция опубликована. Изменения загружаются через новую проверку черновика.</p>':mapping.verified&&mapping.lessonSha256===lesson.hash&&lesson.review.ready&&!dirty?'<button class="primary-button" id="damulab-publish">Опубликовать эту редакцию</button>':'<p>Публикация доступна после актуального независимого ревью и загрузки этой редакции.</p>'}`;
  container.querySelector('#damulab-publish')?.addEventListener('click',async()=>{
   if(!await confirmAction(`Опубликовать «${lesson.doc.title.ru}» (${lesson.doc.grade} класс) на ${info.origin}? Урок станет доступен ученикам.`,{title:'Публикация проверенной редакции',confirmLabel:'Опубликовать',cancelLabel:'Оставить черновиком'}))return;
   await run(async()=>{info.mapping=await api(route+'/publish',{method:'POST',body:JSON.stringify({lessonSha256:lesson.hash})});showMapping();toast('Публикация подтверждена сервером.');});
  });
 }
 if(info.connected)catalog=await api('/api/damulab/catalog');
 if(!container.isConnected)return;draw();showMapping();
}
