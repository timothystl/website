import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const script = resolve(new URL('../.github/scripts/prepare-release.sh', import.meta.url).pathname);
test('release uses a deterministic cache version without writing main and refuses superseded checkouts', () => {
  const directory=mkdtempSync(join(tmpdir(),'release-order-'));
  const remote=join(directory,'remote'), local=join(directory,'local'), output=join(directory,'output');
  const git=(...args)=>execFileSync('git',args,{cwd:local,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const prepare=()=>{writeFileSync(output,'');execFileSync('bash',[script],{cwd:local,env:{...process.env,GITHUB_OUTPUT:output},stdio:['ignore','pipe','pipe']});return readFileSync(output,'utf8');};
  try {
    mkdirSync(remote);mkdirSync(local);execFileSync('git',['init','--bare',remote],{stdio:'pipe'});
    git('init','-b','main');git('config','user.email','fixture@example.test');git('config','user.name','Fixture');git('remote','add','origin',remote);
    mkdirSync(join(local,'admin'));writeFileSync(join(local,'admin/helpers.js'),"export const VERSION = 'v1.2.3';\n");
    git('add','.');git('commit','-m','Initial');git('push','origin','main');
    const source=git('rev-parse','HEAD');
    const remoteBefore=git('ls-remote','origin','refs/heads/main');
    assert.match(prepare(),/deploy=true/);
    assert.equal(git('rev-parse','HEAD'),source);
    const rendered=readFileSync(join(local,'admin/helpers.js'),'utf8');
    assert.ok(rendered.includes('v1.2.3-g'+source.slice(0,12)));
    assert.equal(git('ls-remote','origin','refs/heads/main'),remoteBefore);
    assert.match(prepare(),/deploy=true/);
    assert.equal(readFileSync(join(local,'admin/helpers.js'),'utf8'),rendered);
    git('restore','admin/helpers.js');
    writeFileSync(join(local,'app.js'),'newer code');git('add','.');git('commit','-m','Newer reviewed application');git('push','origin','HEAD:main');
    const newer=git('rev-parse','HEAD');git('checkout','--detach',source);
    assert.match(prepare(),/deploy=false/);assert.equal(git('rev-parse','HEAD'),source);
    git('checkout','--detach',newer);
    assert.match(prepare(),/deploy=true/);
    assert.ok(readFileSync(join(local,'admin/helpers.js'),'utf8').includes('-g'+newer.slice(0,12)));
    assert.equal(git('rev-parse','HEAD'),newer);
  } finally {rmSync(directory,{recursive:true,force:true});}
});
