import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const script = resolve(new URL('../.github/scripts/prepare-release.sh', import.meta.url).pathname);
test('release pins one tree, resumes its own version bump, and refuses superseded checkouts', () => {
  const dir=mkdtempSync(join(tmpdir(),'release-order-'));
  const remote=join(dir,'remote'), local=join(dir,'local'), output=join(dir,'output');
  const git=(...args)=>execFileSync('git',args,{cwd:local,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const prepare=()=>{writeFileSync(output,'');execFileSync('bash',[script],{cwd:local,env:{...process.env,GITHUB_OUTPUT:output},stdio:['ignore','pipe','pipe']});return readFileSync(output,'utf8');};
  try {
    mkdirSync(remote);mkdirSync(local);execFileSync('git',['init','--bare',remote],{stdio:'pipe'});
    git('init','-b','main');git('config','user.email','fixture@example.test');git('config','user.name','Fixture');git('remote','add','origin',remote);
    mkdirSync(join(local,'admin'));writeFileSync(join(local,'admin/helpers.js'),"export const VERSION = 'v1.2.3';\n");
    git('add','.');git('commit','-m','Initial');
    writeFileSync(join(local,'app.js'),'initial code');git('add','.');git('commit','-m','Application fix');git('push','origin','main');
    const source=git('rev-parse','HEAD');
    assert.match(prepare(),/deploy=true/);const release=git('rev-parse','HEAD');assert.notEqual(source,release);
    assert.match(readFileSync(join(local,'admin/helpers.js'),'utf8'),/v1.2.4/);
    git('checkout','--detach',source);assert.match(prepare(),/deploy=true/);assert.equal(git('rev-parse','HEAD'),release);
    writeFileSync(join(local,'app.js'),'newer code');git('add','.');git('commit','-m','Newer application');git('push','origin','HEAD:main');
    const newer=git('rev-parse','HEAD');git('checkout','--detach',source);
    assert.match(prepare(),/deploy=false/);assert.equal(git('rev-parse','HEAD'),source);
    git('checkout','--detach',newer);writeFileSync(join(local,'admin/helpers.js'),"export const VERSION = 'v0.1.0-alpha.1';\n");git('add','.');git('commit','-m','Chosen version');git('push','origin','HEAD:main');
    const chosen=git('rev-parse','HEAD');assert.match(prepare(),/deploy=true/);assert.equal(git('rev-parse','HEAD'),chosen);
    writeFileSync(join(local,'app.js'),'post-reset release');git('add','.');git('commit','-m','Next alpha change');git('push','origin','HEAD:main');
    assert.match(prepare(),/deploy=true/);
    assert.match(readFileSync(join(local,'admin/helpers.js'),'utf8'),/v0.1.0-alpha.2/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
