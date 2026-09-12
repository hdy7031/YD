import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import initSqlJs from 'sql.js';
import {validateState} from '../src/core.ts';
test('实际0.2.12空库SQLite迁移保留每个集合与设置',async()=>{
  const SQL=await initSqlJs({wasmBinary:Uint8Array.from(fs.readFileSync('node_modules/sql.js/dist/sql-wasm.wasm')).buffer});
  const db=new SQL.Database(fs.readFileSync('tests/fixtures/v0212-empty.sqlite'));
  try{
    const old=JSON.parse(String(db.exec('SELECT body FROM app_state WHERE id=1')[0].values[0][0]));
    const next=validateState(structuredClone(old));
    for(const key of ['profiles','courses','exceptions','tasks','events','notices','reminders'] as const){
      assert.equal(next[key].length,old[key].length,key);
      for(let i=0;i<old[key].length;i++)for(const field of Object.keys(old[key][i]))assert.deepEqual((next[key][i] as any)[field],old[key][i][field],key+'.'+field);
    }
    assert.deepEqual(next.settings,old.settings);assert.equal(next.inboxVersion,1);
  }finally{db.close();}
});
