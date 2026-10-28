import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {loadAIConfig,parseAIConfig,publicAISelection} from '../ai-config.mjs';

test('config reloads from its fixed location and missing file preserves Codex defaults',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'studio-config-')),configFile=path.join(dir,'ai.config.json');t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const env={LESSON_STUDIO_CODEX_EXE:'C:/tools/codex.exe'};
 assert.deepEqual(await loadAIConfig({configFile,env}),{runtime:'codex',model:null,configSource:'cli-default',executable:env.LESSON_STUDIO_CODEX_EXE});
 await fs.writeFile(configFile,'\uFEFF'+JSON.stringify({runtime:'codex',model:'gpt-5.6-sol',reasoningEffort:'high'}));
 const first=await loadAIConfig({configFile,env});assert.equal(first.reasoningEffort,'high');assert.equal(first.executable,path.resolve(env.LESSON_STUDIO_CODEX_EXE));
 await fs.writeFile(configFile,JSON.stringify({runtime:'opencode',model:'opencode/deepseek-v4-pro',executable:'./tools with spaces/opencode.exe'}));
 const next=await loadAIConfig({configFile,env});assert.equal(next.runtime,'opencode');assert.equal(next.executable,path.join(dir,'tools with spaces','opencode.exe'));
 assert.equal(first.runtime,'codex');assert.equal(publicAISelection(next).executable,undefined);
});

test('invalid config and unsupported combinations fail without echoing secrets',()=>{
 for(const input of [null,[],{}, {runtime:'chatgpt',model:'x'}, {runtime:'codex',model:''}, {runtime:'codex',model:'display name high'}, {runtime:'opencode',model:'deepseek-v4-pro'}, {runtime:'opencode',model:'PROVIDER_ID/MODEL_ID'}, {runtime:'opencode',model:'a/b',reasoningEffort:'high'}, {runtime:'codex',model:'x',reasoningEffort:'invented'}, {runtime:'codex',model:'x',apiKey:'SECRET'}, {runtime:'codex',model:'x',executable:'codex --model something'}, {runtime:'codex',model:'x',executable:null}, {runtime:'codex',model:'x',executable:'\0'}]) {
  assert.throws(()=>parseAIConfig(input),error=>error.code==='ai_config_invalid'&&!error.message.includes('SECRET'));
 }
 assert.equal(parseAIConfig({runtime:'opencode',model:'openai/gpt-5.6-sol#high'}).model,'openai/gpt-5.6-sol#high');
});

test('malformed JSON is not silently treated as absent config',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'studio-config-bad-')),configFile=path.join(dir,'ai.config.json');t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 await fs.writeFile(configFile,'{"apiKey":"SECRET",}');
 await assert.rejects(loadAIConfig({configFile}),error=>error.code==='ai_config_invalid'&&!error.message.includes('SECRET'));
});
