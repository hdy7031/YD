import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AvatarRuntime, type AvatarRuntimeResource } from '../src/avatar-runtime.ts';
import { companionGeometry } from '../src/companion-layout.ts';
import { epoch, initial } from '../src/core.ts';
import { snapshot } from '../src/live.ts';

interface Fixture { canvas: { width: number; height: number }; asset: string }
const packs = new Map([
  ['test-pack-a', { id: 'test-pack-a', version: '1.0.0' }],
  ['test-pack-b', { id: 'test-pack-b', version: '1.0.0' }],
  ['test-pack-c', { id: 'test-pack-c', version: '1.0.0' }],
]);
const fixtures:Record<string,Fixture> = {
  'test-pack-a': { canvas: { width: 412, height: 411 }, asset: 'a-idle' },
  'test-pack-b': { canvas: { width: 800, height: 1200 }, asset: 'b-idle' },
  'test-pack-c': { canvas: { width: 900, height: 500 }, asset: 'c-idle' },
};

function deferred<T>(){
  let resolve!:(value:T)=>void,reject!:(reason?:unknown)=>void;
  const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}

function resource(packId:string,version='1.0.0'):AvatarRuntimeResource<Fixture>{
  return {resolvedPackId:packId,version,value:structuredClone(fixtures[packId])};
}

test('Avatar runtime lazily caches by pack id and manifest version', async()=>{
  const versions=new Map(packs);
  const calls:string[]=[];
  const runtime=new AvatarRuntime<Fixture>({
    resolve:id=>versions.get(id)!,
    load:async id=>{calls.push(id);return resource(id,versions.get(id)!.version);},
    decode:async value=>value,
  });
  assert.equal(runtime.cacheSize,0,'startup must not preload packs');
  await runtime.loadAvatarPack('test-pack-a');
  await runtime.loadAvatarPack('test-pack-a');
  assert.deepEqual(calls,['test-pack-a'],'same version reuses decoded resources');
  versions.set('test-pack-a',{id:'test-pack-a',version:'1.1.0'});
  await runtime.loadAvatarPack('test-pack-a');
  await runtime.loadAvatarPack('test-pack-b');
  assert.deepEqual(calls,['test-pack-a','test-pack-a','test-pack-b']);
  assert.equal(runtime.cacheSize,3,'A@1.0.0, A@1.1.0 and B are independent');
});

test('Avatar runtime switch is atomic and geometry belongs to the committed visual',async()=>{
  const pendingB=deferred<AvatarRuntimeResource<Fixture>>();
  const gate=deferred<boolean>();
  const runtime=new AvatarRuntime<Fixture>({
    resolve:id=>packs.get(id)!,
    load:async id=>id==='test-pack-b'?pendingB.promise:resource(id),
    decode:async value=>value,
  });
  await runtime.request('test-pack-a');
  const switching=runtime.request('test-pack-b',()=>gate.promise);
  assert.equal(runtime.activeVisual?.requestedPackId,'test-pack-a');
  pendingB.resolve(resource('test-pack-b'));
  await Promise.resolve();await Promise.resolve();
  assert.equal(runtime.activeVisual?.requestedPackId,'test-pack-a','decode/geometry preparation does not clear A');
  gate.resolve(true);
  const result=await switching;
  assert.equal(result.kind,'committed');
  assert.equal(runtime.activeVisual?.requestedPackId,'test-pack-b');
  const a=companionGeometry('custom','medium',fixtures['test-pack-a'].canvas.width/fixtures['test-pack-a'].canvas.height);
  const b=companionGeometry('custom','medium',fixtures['test-pack-b'].canvas.width/fixtures['test-pack-b'].canvas.height);
  assert.notDeepEqual(a,b,'different Pack canvases produce independent window geometry');
});

test('Avatar runtime generation prevents stale A to B to C completion',async()=>{
  const b=deferred<AvatarRuntimeResource<Fixture>>(),c=deferred<AvatarRuntimeResource<Fixture>>();
  const runtime=new AvatarRuntime<Fixture>({
    resolve:id=>packs.get(id)!,
    load:id=>id==='test-pack-b'?b.promise:c.promise,
    decode:async value=>value,
  });
  const requestB=runtime.request('test-pack-b'),requestC=runtime.request('test-pack-c');
  c.resolve(resource('test-pack-c'));
  assert.equal((await requestC).kind,'committed');
  b.resolve(resource('test-pack-b'));
  assert.equal((await requestB).kind,'stale');
  assert.equal(runtime.activeVisual?.requestedPackId,'test-pack-c');
});

test('latest failure and decode failure preserve last-known-good visual',async()=>{
  const failing=new Set<string>();
  const runtime=new AvatarRuntime<Fixture>({
    resolve:id=>packs.get(id)!,
    load:async id=>{if(failing.has(id))throw new Error('missing asset');return resource(id);},
    decode:async value=>{if(value.asset==='b-idle')throw new Error('invalid image');return value;},
  });
  await runtime.request('test-pack-a');
  assert.equal((await runtime.request('test-pack-b')).kind,'failed');
  assert.equal(runtime.activeVisual?.requestedPackId,'test-pack-a');
  failing.add('test-pack-c');
  assert.equal((await runtime.request('test-pack-c')).kind,'failed');
  assert.equal(runtime.activeVisual?.requestedPackId,'test-pack-a');
});

test('older success cannot commit after a newer request fails',async()=>{
  const b=deferred<AvatarRuntimeResource<Fixture>>();
  const runtime=new AvatarRuntime<Fixture>({
    resolve:id=>packs.get(id)!,
    load:id=>id==='test-pack-a'?Promise.resolve(resource(id)):id==='test-pack-b'?b.promise:Promise.reject(new Error('C failed')),
    decode:async value=>value,
  });
  await runtime.request('test-pack-a');
  const slowB=runtime.request('test-pack-b');
  const failC=runtime.request('test-pack-c');
  assert.equal((await failC).kind,'failed');
  b.resolve(resource('test-pack-b'));
  assert.equal((await slowB).kind,'stale');
  assert.equal(runtime.activeVisual?.requestedPackId,'test-pack-a');
});

test('PetInstance subject changes drive Pack requests without touching CurrentState',async()=>{
  const now=epoch('2027-03-01T10:00');
  const state=initial(now);
  const self=state.profiles.find(profile=>profile.role==='self')!;
  const companion=state.profiles.find(profile=>profile.role==='companion')!;
  self.avatar={packId:'test-pack-a',source:'user'};
  companion.avatar={packId:'test-pack-b',source:'user'};
  const runtime=new AvatarRuntime<Fixture>({resolve:id=>packs.get(id)!,load:async id=>resource(id),decode:async value=>value});

  const together=snapshot(state,now);
  const currentBefore=structuredClone(together.people.map(person=>person.current));
  await runtime.request(together.petInstance.avatarPackId);
  assert.equal(runtime.activeVisual?.requestedPackId,'test-pack-b','Together uses companion Pack');
  self.avatar={packId:'test-pack-c',source:'user'};
  const nonSubject=snapshot(state,now);
  assert.equal(nonSubject.petInstance.avatarPackId,'test-pack-b','changing non-subject self does not switch Together pet');

  state.profiles=[self];
  const solo=snapshot(state,now);
  await runtime.request(solo.petInstance.avatarPackId);
  assert.equal(runtime.activeVisual?.requestedPackId,'test-pack-c','Together to Solo switches to self Pack');
  assert.deepEqual(together.people.map(person=>person.current),currentBefore,'Avatar runtime never changes CurrentState');
});

test('Solo and Together hot-switch only the active subject Pack',async()=>{
  const now=epoch('2027-03-01T10:00');
  const together=initial(now);
  const self=together.profiles.find(profile=>profile.role==='self')!;
  const companion=together.profiles.find(profile=>profile.role==='companion')!;
  self.avatar={packId:'test-pack-a',source:'user'};
  companion.avatar={packId:'test-pack-a',source:'user'};
  const runtime=new AvatarRuntime<Fixture>({resolve:id=>packs.get(id)!,load:async id=>resource(id),decode:async value=>value});
  await runtime.request(snapshot(together,now).petInstance.avatarPackId);
  companion.avatar={packId:'test-pack-b',source:'user'};
  await runtime.request(snapshot(together,now).petInstance.avatarPackId);
  assert.equal(runtime.activeVisual?.requestedPackId,'test-pack-b','Together companion A to B hot-switches');
  self.avatar={packId:'test-pack-c',source:'user'};
  assert.equal(snapshot(together,now).petInstance.avatarPackId,'test-pack-b','Together self change is ignored by current Pet');

  const solo=structuredClone(together);solo.profiles=[solo.profiles.find(profile=>profile.role==='self')!];
  await runtime.request(snapshot(solo,now).petInstance.avatarPackId);
  assert.equal(runtime.activeVisual?.requestedPackId,'test-pack-c','mode switch uses final Solo subject');
  solo.profiles[0].avatar={packId:'test-pack-a',source:'user'};
  await runtime.request(snapshot(solo,now).petInstance.avatarPackId);
  assert.equal(runtime.activeVisual?.requestedPackId,'test-pack-a','Solo self C to A hot-switches');
});
