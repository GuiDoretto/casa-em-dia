import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {localNow} from '../rules.mjs';
import {addDays,startOfWeek} from '../scheduling.mjs';

async function house(t) {
 const dir=mkdtempSync(join(tmpdir(),'casa-config-test-'));let child,base,setup;
 async function start(expectSetup=false) {
  child=spawn(process.execPath,['server.mjs','--api-only'],{cwd:resolve(import.meta.dirname,'..'),env:{...process.env,PORT:'0',HOST:'127.0.0.1',CASA_DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
  await new Promise((yes,no)=>{
   let output='',errors='';const timeout=setTimeout(()=>no(new Error('Servidor não iniciou: '+errors)),10000);
   child.stderr.on('data',chunk=>{errors+=chunk;});child.once('error',no);
   child.stdout.on('data',chunk=>{output+=chunk;const port=output.match(/Casa em Dia · http:\/\/localhost:(\d+)/);if(port&&(!expectSetup||output.includes('configurar='))){base='http://127.0.0.1:'+port[1];setup=output.match(/configurar=([a-f0-9]+)/)?.[1];clearTimeout(timeout);yes();}});
   child.once('exit',code=>{clearTimeout(timeout);no(new Error('Servidor saiu: '+code+' '+errors));});
  });
 }
 async function stop(){if(child?.exitCode===null&&!child.signalCode)await new Promise(yes=>{child.once('exit',yes);child.kill('SIGTERM');});}
 async function call(path,data,cookie='',headers={}) {
  const response=await fetch(base+'/api/'+path,{method:data===undefined?'GET':'POST',headers:{...(data===undefined?{}:{'Content-Type':'application/json',Origin:base}),...(cookie?{Cookie:cookie}:{}),...headers},body:data===undefined?undefined:JSON.stringify(data)});
  return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
 }
 function plan(week){const db=new DatabaseSync(join(dir,'casa.sqlite'));try{return JSON.parse(db.prepare('SELECT data FROM weekly_draw_plans WHERE week_start=?').get(week)?.data||'[]');}finally{db.close();}}
 t.after(async()=>{await stop();rmSync(dir,{recursive:true,force:true});});
 await start(true);
 const initial=await call('setup',{houseName:'Casa configurável',name:'Ana',email:'ana@quota.test',password:'Senha segura 2026!'},'',{'X-Setup-Token':setup});
 assert.equal(initial.status,200);
 return {call,start,stop,plan,initial,get base(){return base;}};
}

test('cotas, dias definidos, semanas entre meses e planos persistidos',async(t)=>{
 const h=await house(t),cookie=h.initial.cookie,admin=h.initial.data.user.id;
 let settings={...h.initial.data.settings,disabledDays:[],skipHolidays:false,autoGenerate:false,drawPeriod:'daily',drawCount:2};
 assert.equal((await h.call('settings',settings,cookie)).status,200);
 for(const invalid of [{drawPeriod:'monthly'},{drawCount:0},{drawCount:101},{drawCount:1.5}])assert.equal((await h.call('settings',{...settings,...invalid},cookie)).status,400);
 let cursor=addDays(localNow().date,14);
 while(startOfWeek(cursor).slice(0,7)===addDays(startOfWeek(cursor),6).slice(0,7))cursor=addDays(cursor,1);
 const week=startOfWeek(cursor),sunday=addDays(week,6),weekdays=[[1,3,5],[2,4],[0,6],[0,1,2,3,4,5,6]];
 const templates=h.initial.data.templates;
 for(let index=0;index<templates.length;index++) {
  const template=templates[index],payload={...template,active:true,weekdays:weekdays[index]};
  const saved=await h.call('save-template',payload,cookie);assert.equal(saved.status,200);
  assert.deepEqual(saved.data.templates.find(item=>item.id===template.id).weekdays,weekdays[index]);
 }
 const firstTemplate={...templates[0],active:true};delete firstTemplate.weekdays;
 for(const invalid of [[],[7],[-1],[1.5],null])assert.equal((await h.call('save-template',{...firstTemplate,weekdays:invalid},cookie)).status,400);
 const omitted=await h.call('save-template',firstTemplate,cookie);assert.equal(omitted.status,200);
 assert.deepEqual(omitted.data.templates.find(item=>item.id===firstTemplate.id).weekdays,weekdays[0]);
 assert.equal((await h.call('save-task',{title:'Manual',area:'Sala',duration:10,deadline:'23:59',due_date:week,assignee_id:admin},cookie)).status,200);
 const daily=await h.call('draw',{date:week},cookie);assert.equal(daily.status,200);assert.equal(daily.data.created.length,1);
 assert.equal(daily.data.tasks.filter(task=>task.due_date===week).length,2);
 assert.equal((await h.call('draw',{date:week},cookie)).data.created.length,0);
 settings={...settings,drawCount:1};assert.equal((await h.call('settings',settings,cookie)).status,200);
 const reduced=await h.call('draw',{date:week},cookie);assert.equal(reduced.data.created.length,0);assert.equal(reduced.data.tasks.length,2);
 // Paused tasks still reserve quota, so reopening the day cannot overfill the week.
 settings={...settings,drawPeriod:'weekly',drawCount:3,skipHolidays:true,holidays:{[week]:'Folga'}};
 const paused=await h.call('settings',settings,cookie);assert.equal(paused.status,200);assert.equal(paused.data.tasks.filter(task=>task.status==='paused').length,2);
 const partlyPaused=await h.call('draw',{date:week,week:true},cookie);assert.equal(partlyPaused.status,200);
 assert.equal(partlyPaused.data.created.length,1);assert.equal(partlyPaused.data.tasks.length,3);
 settings={...settings,skipHolidays:false};assert.equal((await h.call('settings',settings,cookie)).status,200);
 const resumed=await h.call('draw',{date:week,week:true},cookie);assert.equal(resumed.data.created.length,0);assert.equal(resumed.data.tasks.length,3);
 assert.ok(resumed.data.tasks.every(task=>task.status==='pending'));
 assert.equal((await h.call('reset-calendar',{confirmation:'ZERAR CALENDÁRIO'},cookie)).status,200);
 assert.deepEqual(h.plan(week),[]);
 assert.equal((await h.call('settings',settings,cookie)).status,200);
 const firstDay=await h.call('draw',{date:week},cookie);assert.equal(firstDay.status,200);
 const reserved=h.plan(week);assert.equal(reserved.length,3);assert.equal(new Set(reserved.map(slot=>slot.date)).size,3);
 const firstIds=firstDay.data.tasks.map(task=>task.id);
 await h.stop();await h.start();assert.deepEqual(h.plan(week),reserved);
 const repeated=await h.call('draw',{date:week},cookie);assert.equal(repeated.data.created.length,0);
 assert.deepEqual(repeated.data.tasks.map(task=>task.id),firstIds);
 const retained=h.plan(week);
 // Cosmetic updates must not move future slots to different days or templates.
 settings={...settings,houseName:'Casa com outro nome'};assert.equal((await h.call('settings',settings,cookie)).status,200);
 const cosmetic=await h.call('save-template',{...firstTemplate,title:'Outro título',icon:'garden'},cookie);assert.equal(cosmetic.status,200);
 assert.equal((await h.call('draw',{date:week},cookie)).data.created.length,0);
 assert.deepEqual(h.plan(week),retained);
 const firstMonth=await h.call('draw',{date:week,month:true},cookie);assert.equal(firstMonth.status,200);
 const secondMonth=sunday.slice(0,7)+'-01';
 const secondDraw=await h.call('draw',{date:secondMonth,month:true},cookie);assert.equal(secondDraw.status,200);
 const crossing=secondDraw.data.tasks.filter(task=>startOfWeek(task.due_date)===week);
 assert.equal(crossing.length,3);
 const counts=new Map();for(const task of secondDraw.data.tasks){const key=startOfWeek(task.due_date);counts.set(key,(counts.get(key)||0)+1);const template=secondDraw.data.templates.find(item=>item.id===task.template_id);assert.ok(template.weekdays.includes(new Date(task.due_date+'T12:00:00Z').getUTCDay()));}
 assert.ok([...counts.values()].every(count=>count<=3));
 assert.equal((await h.call('draw',{date:week,month:true},cookie)).data.created.length,0);
 assert.equal((await h.call('draw',{date:secondMonth,month:true},cookie)).data.created.length,0);
 const beforeRestart=(await h.call('state',undefined,cookie)).data;
 await h.stop();await h.start();const restored=(await h.call('state',undefined,cookie)).data;
 assert.deepEqual(restored.tasks,beforeRestart.tasks);assert.deepEqual(restored.templates,beforeRestart.templates);
 assert.equal(restored.settings.drawPeriod,'weekly');assert.equal(restored.settings.drawCount,3);
});

test('fotos têm autorização, limite separado, cache privado e persistência',async(t)=>{
 const h=await house(t),cookie=h.initial.cookie,admin=h.initial.data.user.id;
 const settings={...h.initial.data.settings,autoGenerate:false};assert.equal((await h.call('settings',settings,cookie)).status,200);
 const invited=await h.call('save-user',{name:'Bruno',email:'bruno@photo.test',phone:'',active:true},cookie);assert.equal(invited.status,200);
 const accepted=await h.call('accept-invite',{token:invited.data.inviteToken,password:'Senha Bruno 2026!'});assert.equal(accepted.status,200);
 const member=accepted.data.user.id,memberCookie=accepted.cookie;
 const image='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=';
 const photo='data:image/png;base64,'+image;
 assert.equal((await h.call('profile-photo',{userId:member,photo})).status,401);
 assert.equal((await h.call('profile-photo',{userId:admin,photo},memberCookie)).status,403);
 assert.equal((await h.call('profile-photo',{userId:'missing',photo},cookie)).status,404);
 for(const invalid of ['https://photo.test/a.png','data:image/svg+xml;base64,PHN2Zy8+','data:image/jpeg;base64,'+image,'data:image/png;base64,AAAA'])assert.equal((await h.call('profile-photo',{photo:invalid},memberCookie)).status,400);
 assert.equal((await h.call('profile-photo',{photo:'data:image/png;base64,'+Buffer.alloc(193*1024).toString('base64')},memberCookie)).status,413);
 assert.equal((await h.call('profile-photo',{photo:'x'.repeat(301*1024)},memberCookie)).status,413);
 assert.equal((await h.call('save-user',{name:'Outro',email:'outro@photo.test',padding:'x'.repeat(20*1024)},cookie)).status,413);
 const own=await h.call('profile-photo',{userId:member,photo,padding:'x'.repeat(20*1024)},memberCookie);assert.equal(own.status,200);
 const url=own.data.user.photo_url;assert.ok(url.startsWith('/api/profile-photo?id='+member+'&v='));
 assert.equal(own.data.users.find(user=>user.id===member).photo_url,url);
 assert.ok(!JSON.stringify(own.data).includes(image));
 assert.equal((await fetch(h.base+url)).status,401);
 const downloaded=await fetch(h.base+url,{headers:{Cookie:cookie}});assert.equal(downloaded.status,200);
 assert.equal(downloaded.headers.get('content-type'),'image/png');assert.equal(downloaded.headers.get('x-content-type-options'),'nosniff');
 assert.match(downloaded.headers.get('cache-control'),/private.*max-age=86400/);
 assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),Buffer.from(image,'base64'));
 const unversioned=await fetch(h.base+'/api/profile-photo?id='+member,{headers:{Cookie:memberCookie}});assert.equal(unversioned.status,200);assert.match(unversioned.headers.get('cache-control'),/private.*no-store/);
 const replaced=await h.call('profile-photo',{userId:member,photo},cookie);assert.equal(replaced.status,200);
 const updatedUrl=replaced.data.users.find(user=>user.id===member).photo_url;assert.notEqual(updatedUrl,url);
 const exported=await h.call('export',undefined,cookie);assert.equal(exported.status,200);assert.ok(!JSON.stringify(exported.data).includes(image));
 await h.stop();await h.start();const restored=(await h.call('state',undefined,memberCookie)).data;
 assert.equal(restored.user.photo_url,updatedUrl);
 const persisted=await fetch(h.base+updatedUrl,{headers:{Cookie:memberCookie}});assert.equal(persisted.status,200);assert.deepEqual(Buffer.from(await persisted.arrayBuffer()),Buffer.from(image,'base64'));
 const removed=await h.call('profile-photo',{userId:member,photo:null},cookie);assert.equal(removed.status,200);assert.equal(removed.data.users.find(user=>user.id===member).photo_url,null);
 assert.equal((await fetch(h.base+updatedUrl,{headers:{Cookie:cookie}})).status,404);
});