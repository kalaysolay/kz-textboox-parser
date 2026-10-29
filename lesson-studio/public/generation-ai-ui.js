export function aiOverrideControls(defaults,e){
 const runtime=defaults.runtime??'codex',effort=defaults.reasoningEffort??'';
 return `<fieldset><legend>CLI и модель</legend><label><input type="checkbox" name="aiOverrideEnabled"> Переопределить для этого урока</label><p class="field-help">Без переопределения используются настройки ai.config.json. Файл конфигурации не изменяется.</p><fieldset id="generation-ai-fields" disabled><label class="field">Исполнитель<select name="aiRuntime"><option value="codex" ${runtime==='codex'?'selected':''}>Codex / ChatGPT</option><option value="opencode" ${runtime==='opencode'?'selected':''}>OpenCode</option></select></label><label class="field">ID модели<input name="aiModel" value="${e(defaults.model??'')}" required maxlength="250" autocomplete="off"><span class="field-help" id="generation-model-help"></span></label><label class="field" id="generation-ai-effort">Уровень рассуждений<select name="aiReasoningEffort">${['','none','minimal','low','medium','high','xhigh','max','ultra'].map(v=>`<option value="${v}" ${effort===v?'selected':''}>${v||'Настройка CLI по умолчанию'}</option>`).join('')}</select></label><p class="field-help" id="generation-ai-status"></p></fieldset></fieldset>`;
}

export function generationRequest(values){
 const {aiOverrideEnabled,aiRuntime,aiModel,aiReasoningEffort,...order}=values;
 if(aiOverrideEnabled)order.aiOverride={runtime:aiRuntime,model:String(aiModel??'').trim(),...(aiRuntime==='codex'?{reasoningEffort:aiReasoningEffort||null}:{})};
 return order;
}

export function selectedAIAvailable(defaults,options,enabled,runtime){
 if(!enabled)return !!defaults.available;
 return options?.find(o=>o.runtime===runtime)?.available??(runtime===defaults.runtime?!!defaults.available:true);
}
