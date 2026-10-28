export function duration(ms) {
 const seconds=Math.max(0,Math.floor(ms/1000)),minutes=Math.floor(seconds/60);
 return minutes?`${minutes} мин ${seconds%60} с`:`${seconds} с`;
}

export function renderProgress(job,e,elapsed=0) {
 const running=job.status==='running';
 const stageMs=job.stageDurationMs==null?null:job.stageDurationMs+(running?elapsed:0);
 const idleMs=job.idleMs==null?null:job.idleMs+(running?elapsed:0);
 const date=job.lastActivityAt?new Date(job.lastActivityAt):null;
 const clock=date&&Number.isFinite(date.getTime())?date.toLocaleTimeString('ru-RU'):null;
 const quiet=running&&idleMs!=null&&idleMs>=120000;
 const state=running?(quiet?'Давно нет событий':job.processAlive?'Процесс запущен':'Переход между действиями'):job.status==='completed'?'Завершено':job.status==='needs_attention'?'Нужно внимание':'Остановлено';
 return `<p class="generation-state${quiet?' generation-quiet':''}">${e(state)}</p><dl class="generation-metrics"><div><dt>Действие</dt><dd>${e(job.currentAction??job.message)}</dd></div><div><dt>${running?'Этап выполняется':'Последний этап'}</dt><dd>${stageMs==null?'Нет данных для старого запуска':e(duration(stageMs))}</dd></div><div><dt>Последняя активность</dt><dd>${clock?`<time datetime="${e(job.lastActivityAt)}">${e(clock)}</time>${running&&idleMs!=null?` · ${e(duration(idleMs))} назад`:''}`:'Нет данных для старого запуска'}</dd></div></dl>${quiet?`<p class="generation-quiet-note">${job.processAlive?'Процесс ещё существует, но новых событий нет.':'Сервер не наблюдает активный процесс агента.'} Долгое действие или ожидание могут занимать время; зависание не подтверждено. Можно подождать или остановить запуск.</p>`:''}`;
}
