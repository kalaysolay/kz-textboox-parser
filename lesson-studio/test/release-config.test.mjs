import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

test('release includes the example but never packages the local AI config or runtime state',async t=>{
 const repo=await fs.mkdtemp(path.join(os.tmpdir(),'studio-release-'));
 t.after(()=>fs.rm(repo,{recursive:true,force:true}));
 for(const relative of ['lesson-studio/.local','lessons','.agents/skills/damulab-lecture-pipeline',...['pipeline','parser','planner','generator','reviewer'].map(role=>`.cursor/skills/damulab-lecture-${role}`)])await fs.mkdir(path.join(repo,relative),{recursive:true});
 for(const relative of ['.gitignore','README.md','LECTURE_PIPELINE.md','lesson-studio/ai.config.example.json'])await fs.writeFile(path.join(repo,relative),'{}');
 await fs.writeFile(path.join(repo,'lesson-studio/ai.config.json'),'LOCAL_MACHINE_CONFIG');
 await fs.writeFile(path.join(repo,'lesson-studio/.local/private.json'),'LOCAL_STATE');
 await fs.copyFile(new URL('../prepare-release.mjs',import.meta.url),path.join(repo,'lesson-studio/prepare-release.mjs'));
 execFileSync('git',['init','--quiet'],{cwd:repo,windowsHide:true});
 execFileSync('git',['-c','user.name=Studio fixture','-c','user.email=studio-fixture@example.invalid','-c','commit.gpgsign=false','commit','--allow-empty','--quiet','-m','Fixture'],{cwd:repo,windowsHide:true});
 const output=path.join(repo,'lesson-studio/.local/release-test');
 execFileSync(process.execPath,[path.join(repo,'lesson-studio/prepare-release.mjs'),output],{cwd:repo,windowsHide:true});
 const manifest=JSON.parse(await fs.readFile(path.join(output,'manifest.json'),'utf8'));
 assert.ok(manifest.entries.some(entry=>entry.path==='lesson-studio/ai.config.example.json'));
 assert.ok(!manifest.entries.some(entry=>entry.path.endsWith('/ai.config.json')||entry.path.includes('/.local/')));
 await assert.rejects(fs.access(path.join(output,'source/lesson-studio/ai.config.json')));
});
