import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
assert.equal(process.version, 'v22.23.3', 'Guard proof is pinned to Node 22.23.3')
const api=fileURLToPath(new URL('../../packages/parity/fixtures/oracle/api/',import.meta.url))
const repo=fileURLToPath(new URL('../../',import.meta.url))
const preload=fileURLToPath(new URL('../corpus-loopback.mjs',import.meta.url))
function fixture(run) {
  const scratch=mkdtempSync(join(tmpdir(),'opengym-corpus-guard-'))
  mkdirSync(join(scratch,'home'),{mode:0o700})
  const env={PATH:process.env.PATH,HOME:join(scratch,'home'),
    NODE_OPTIONS:`--import=${pathToFileURL(preload).href}`,OPENGYM_CORPUS_HARNESS:'synthetic-node-recording-v1'}
  for(const key of ['TMPDIR','TZ'])if(process.env[key])env[key]=process.env[key]
  const child=(code,overrides={})=>spawnSync(process.execPath,['--input-type=module','--eval',code],{cwd:api,env,...overrides,encoding:'utf8',timeout:8000})
  try { return run({scratch,env,child}) } finally {rmSync(scratch,{recursive:true,force:true})}
}
test('guard scope refuses missing marker and foreign cwd before application code',()=>fixture(({env,child})=>{
  const code='process.stdout.write("UNREACHABLE")'
  for(const overrides of [{env:{...env,OPENGYM_CORPUS_HARNESS:''}},{cwd:repo}]) {
    const result=child(code,overrides)
    assert.notEqual(result.status,0)
    assert.match(result.stderr,/owned synthetic oracle API context/)
    assert.equal(result.stdout,'')
  }
}))
test('unsupported and explicit non-loopback bind forms refuse synchronously',()=>fixture(({child})=>{
  const result=child(String.raw`
    import assert from 'node:assert/strict'; import {createServer} from 'node:net';
    const forms=[[0,'0.0.0.0'],[0,'::'],[0,'198.51.100.1'],[0,'localhost'],[0,''],
      [{port:0,host:'0.0.0.0'}],[{port:0,host:'::'}],[{fd:1}],[{path:'invented.sock'}],['invented.sock'],[-1]];
    for(const args of forms){const server=createServer();assert.throws(()=>server.listen(...args),/Corpus|corpus/);assert.equal(server.listening,false)}
    process.stdout.write(JSON.stringify({refused:forms.length}));
  `)
  assert.equal(result.status,0,result.stderr)
  assert.deepEqual(JSON.parse(result.stdout),{refused:11})
}))
test('numeric and options overloads bind actual loopback and preserve callbacks and HTTP bytes',()=>fixture(({child})=>{
  const result=child(String.raw`
    import assert from 'node:assert/strict';import {createServer} from 'node:http';
    const seen=[];
    for(const form of ['numeric','backlog','options','explicit']){
      const server=createServer((req,res)=>{res.setHeader('x-synthetic','unchanged');res.end('invented bytes\n')});
      let callbacks=0;
      try{
        await new Promise(resolve=>{const done=()=>{callbacks++;resolve()};
          if(form==='numeric')server.listen(0,done);else if(form==='backlog')server.listen(0,8,done);
          else if(form==='options')server.listen({port:0},done);else server.listen(0,'127.0.0.1',done)});
        assert.equal(server.address().address,'127.0.0.1');assert.equal(callbacks,1);
        const response=await fetch('http://127.0.0.1:'+server.address().port+'/invented');
        assert.equal(response.status,200);assert.equal(response.headers.get('x-synthetic'),'unchanged');
        assert.equal(response.headers.get('x-parity-oracle-nonce'),null);assert.equal(await response.text(),'invented bytes\n');
        seen.push(form);
      }finally{if(server.listening)await new Promise(resolve=>server.close(resolve))}
    }
    assert.equal(typeof process.send,'undefined');assert.equal(process.listenerCount('message'),0);
    process.stdout.write(JSON.stringify({seen}));
  `)
  assert.equal(result.status,0,result.stderr)
  assert.deepEqual(JSON.parse(result.stdout).seen,['numeric','backlog','options','explicit'])
}))
test('sanitized NODE_OPTIONS reaches Node test worker and its original-style server descendant',()=>fixture(({scratch,env})=>{
  const grandchild=`
    import assert from 'node:assert/strict';import{createServer}from'node:http';
    const server=createServer((req,res)=>res.end('invented descendant'));
    try{await new Promise(resolve=>server.listen(0,resolve));assert.equal(server.address().address,'127.0.0.1');
      const response=await fetch('http://127.0.0.1:'+server.address().port);
      assert.equal(await response.text(),'invented descendant');assert.equal(response.headers.get('x-parity-oracle-nonce'),null);
      assert.equal(typeof process.send,'undefined');assert.equal(process.listenerCount('message'),0);
      process.stdout.write(JSON.stringify({address:server.address().address,pid:process.pid}));
    }finally{if(server.listening)await new Promise(resolve=>server.close(resolve))}
  `
  const worker=join(scratch,'invented.test.mjs')
  writeFileSync(worker,`import test from 'node:test';import assert from 'node:assert/strict';import{createServer}from'node:net';import{spawnSync}from'node:child_process';
    test('invented worker and server',async()=>{const server=createServer();try{await new Promise(resolve=>server.listen(0,resolve));assert.equal(server.address().address,'127.0.0.1')}finally{if(server.listening)await new Promise(resolve=>server.close(resolve))}
      const child=spawnSync(process.execPath,['--input-type=module','--eval',${JSON.stringify(grandchild)}],{cwd:process.cwd(),env:{...process.env},encoding:'utf8',timeout:4000});
      assert.equal(child.status,0,child.stderr);assert.equal(JSON.parse(child.stdout).address,'127.0.0.1');console.log('owned-descendant-pid='+JSON.parse(child.stdout).pid);
    });`,{mode:0o600})
  const parent=spawnSync(process.execPath,['--test','--test-concurrency=1',worker],{cwd:api,env,encoding:'utf8',timeout:8000})
  assert.equal(parent.status,0,parent.stderr+parent.stdout)
  assert.match(parent.stdout,/owned-descendant-pid=\d+/)
  assert.match(parent.stdout,/# pass 1/)
}))
