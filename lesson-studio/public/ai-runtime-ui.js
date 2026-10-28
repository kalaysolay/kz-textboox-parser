export function aiSelectionLabel(selection) {
 const name=selection?.runtime==='opencode'?'OpenCode':'Codex';
 const model=selection?.model??'модель из настроек CLI';
 const effort=selection?.reasoningEffort?` · ${selection.reasoningEffort}`:'';
 const legacy=selection?.configSource==='legacy'?' · старый запуск, точная модель не зафиксирована':'';
 return `${name} · ${model}${effort}${legacy}`;
}

export function aiRuntimeStatus(runtime) {
 if(runtime?.error)return runtime.error.message;
 const label=aiSelectionLabel(runtime);
 return runtime?.available?`${label} · ${runtime.version}`:`${label} · CLI недоступен. Проверьте путь к программе и настройку входа.`;
}
