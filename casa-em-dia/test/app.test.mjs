import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {localNow,award,offReason,nationalHolidays,validDate,defaultSettings} from '../rules.mjs';

test('datas, fuso brasileiro, feriados e pontuação',()=>{
 assert.deepEqual(localNow(new Date('2026-10-15T01:00:00Z')),{date:'2026-10-14',time:'22:00'});
 assert.equal(award({due_date:'2026-10-15',deadline:'20:00'},{date:'2026-10-15',time:'20:00'}),10);
 assert.equal(award({due_date:'2026-10-15',deadline:'20:00'},{date:'2026-10-15',time:'20:01'}),0);
 assert.equal(award({due_date:'2026-10-15',deadline:'20:00'},{date:'2026-10-16',time:'00:01'}),0);
 assert.equal(nationalHolidays(2026)['2026-04-03'],'Sexta-feira Santa');
 assert.equal(nationalHolidays(2027)['2027-03-26'],'Sexta-feira Santa');
 assert.equal(offReason('2026-10-17',defaultSettings),'Dia de folga');
 assert.equal(offReason('2026-11-20',defaultSettings),'Consciência Negra');
 assert.equal(validDate('2026-02-30'),false);
 assert.equal(validDate('2028-02-29'),true);
});

test('fluxos reais da casa, autorização, persistência e concorrência',async(t)=>{
 const dir=mkdtempSync(join(tmpdir(),'casa-test-'));
 let child,base,setup;
 async function start(expectSetup=true){child=spawn(process.execPath,['server.mjs','--api-only'],{cwd:resolve(import.meta.dirname,'..'),env:{...process.env,PORT:'0',HOST:'127.0.0.1',CASA_DATA_DIR:dir},stdio:['ignore','pipe','pipe']});let log='';await new Promise((yes,no)=>{const timeout=setTimeout(()=>no(new Error('Servidor não iniciou')),10000);child.stdout.on('data',c=>{log+=c;const port=log.match(/Casa em Dia · http:\/\/localhost:(\d+)/);if(port&&(!expectSetup||log.includes('configurar='))){base='http://127.0.0.1:'+port[1];setup=log.match(/configurar=([a-f0-9]+)/)?.[1];clearTimeout(timeout);yes();}});child.once('exit',code=>{clearTimeout(timeout);no(new Error('Servidor saiu: '+code));});});}
 async function stop(){if(child?.exitCode===null)await new Promise(yes=>{child.once('exit',yes);child.kill('SIGTERM');});}
 async function call(path,data,cookie='',headers={}){const r=await fetch(base+'/api/'+path,{method:data?'POST':'GET',headers:{...(data?{'Content-Type':'application/json',Origin:base}:{}),...(cookie?{Cookie:cookie}:{}),...headers},body:data?JSON.stringify(data):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 t.after(async()=>{await stop();rmSync(dir,{recursive:true,force:true});});
 await start();
 assert.ok(setup);
 assert.equal((await call('state')).status,401);
 assert.equal((await call('setup',{name:'Admin',email:'admin@example.test',password:'Uma senha segura!'})).status,403);
 const first=await call('setup',{houseName:'Casa de teste',name:'Ana Admin',email:'ana@example.test',phone:'',password:'Senha admin 2026!' },'',{'X-Setup-Token':setup});
 assert.equal(first.status,200);const cookie=first.cookie,adminId=first.data.user.id;assert.equal(first.data.tasks.length,0);
 assert.equal((await call('setup',{},'',{'X-Setup-Token':setup})).status,409);
 const bob=await call('save-user',{name:'Bruno',email:'bruno@example.test',phone:'11999999999',active:true},cookie);
 assert.equal(bob.status,200);const bobId=bob.data.users.find(u=>u.name==='Bruno').id;
 const bobAccepted=await call('accept-invite',{token:bob.data.inviteToken,password:'Senha Bruno 2026!'});assert.equal(bobAccepted.status,200);const bobCookie=bobAccepted.cookie;
 assert.equal((await call('accept-invite',{token:bob.data.inviteToken,password:'Senha Bruno 2026!'})).status,400);
 const clara=await call('save-user',{name:'Clara',email:'clara@example.test',phone:'',active:true},cookie);const claraId=clara.data.users.find(u=>u.name==='Clara').id;
 const renewed=await call('invite',{id:claraId},cookie);
 assert.equal((await call('accept-invite',{token:clara.data.inviteToken,password:'Senha Clara 2026!'})).status,400);
 const claraAccepted=await call('accept-invite',{token:renewed.data.inviteToken,password:'Senha Clara 2026!'});assert.equal(claraAccepted.status,200);const claraCookie=claraAccepted.cookie;
 assert.ok(!('email'in bobAccepted.data.users[0]));assert.ok(!JSON.stringify(bobAccepted.data).includes('password_hash'));
 assert.equal((await call('settings',{...first.data.settings,houseName:'Invasão'},bobCookie)).status,403);
 assert.equal((await call('save-user',{name:'Outro',email:'o@example.test'},bobCookie)).status,403);
 assert.equal((await call('draw',{date:localNow().date},cookie,{Origin:'https://outra-casa.test'})).status,403);
 let settings={...first.data.settings,disabledDays:[],skipHolidays:false,autoGenerate:false};
 assert.equal((await call('settings',settings,cookie)).status,200);
 // Icons are selected from the shared allowlist, and legacy clients can omit them.
 const kitchenTemplate=first.data.templates.find(template=>template.area==='Cozinha');
 assert.equal(kitchenTemplate.icon,'kitchen');
 const templatePayload={id:kitchenTemplate.id,title:kitchenTemplate.title,area:kitchenTemplate.area,duration:kitchenTemplate.duration,deadline:kitchenTemplate.deadline,active:true};
 const selectedTemplate=await call('save-template',{...templatePayload,icon:'garden'},cookie);
 assert.equal(selectedTemplate.status,200);assert.equal(selectedTemplate.data.templates.find(template=>template.id===kitchenTemplate.id).icon,'garden');
 for(const icon of ['unknown','',null,17,{}])assert.equal((await call('save-template',{...templatePayload,icon},cookie)).status,400);
 const omittedTemplate=await call('save-template',templatePayload,cookie);
 assert.equal(omittedTemplate.status,200);assert.equal(omittedTemplate.data.templates.find(template=>template.id===kitchenTemplate.id).icon,'garden');
 const inferredTemplate=await call('save-template',{title:'Organizar os pratos',area:'Cozinha',duration:12,deadline:'20:00',active:false},cookie);
 assert.equal(inferredTemplate.status,200);assert.equal(inferredTemplate.data.templates.find(template=>template.title==='Organizar os pratos').icon,'dishes');
 const now=localNow(),day=now.date;let next=new Date(day+'T12:00:00Z');next.setUTCDate(next.getUTCDate()+1);if(next.toISOString().slice(0,7)!==day.slice(0,7))next=new Date(day+'T12:00:00Z');const future=next.toISOString().slice(0,10);
 const own=await call('save-task',{title:'Cozinha',area:'Cozinha',duration:10,deadline:'23:59',due_date:day,assignee_id:bobId},cookie);assert.equal(own.status,200);const ownTask=own.data.tasks.find(x=>x.title==='Cozinha');
 assert.equal(ownTask.icon,'kitchen');
 assert.equal((await call('complete',{id:ownTask.id},cookie)).status,403);
 const completions=await Promise.all([call('complete',{id:ownTask.id},bobCookie),call('complete',{id:ownTask.id},bobCookie)]);
 assert.deepEqual(completions.map(r=>r.status).sort(),[200,409]);assert.equal(completions.find(r=>r.status===200).data.awarded,10);
 const customA=await call('save-task',{title:'Minha troca',area:'Sala',duration:10,deadline:'23:59',due_date:future,assignee_id:bobId},cookie);const a=customA.data.tasks.find(x=>x.title==='Minha troca');
 const customTaskPayload={id:a.id,title:a.title,area:a.area,duration:a.duration,deadline:a.deadline,due_date:a.due_date,assignee_id:a.assignee_id};
 const selectedTask=await call('save-task',{...customTaskPayload,icon:'tools'},cookie);
 assert.equal(selectedTask.status,200);assert.equal(selectedTask.data.tasks.find(task=>task.id===a.id).icon,'tools');
 for(const icon of ['unknown','',null,17,{}])assert.equal((await call('save-task',{...customTaskPayload,icon},cookie)).status,400);
 const omittedTask=await call('save-task',customTaskPayload,cookie);
 assert.equal(omittedTask.status,200);assert.equal(omittedTask.data.tasks.find(task=>task.id===a.id).icon,'tools');
 const customB=await call('save-task',{title:'Sua troca',area:'Sala',duration:10,deadline:'23:59',due_date:future,assignee_id:claraId},cookie);const b=customB.data.tasks.find(x=>x.title==='Sua troca');
 if(future>day)assert.equal((await call('complete',{id:a.id},bobCookie)).status,400);
 const swap=await call('swap',{taskA:a.id,taskB:b.id},bobCookie);assert.equal(swap.status,200);const swapId=swap.data.swaps[0].id;
 assert.equal((await call('swap',{taskA:a.id,taskB:b.id},bobCookie)).status,409);
 assert.equal((await call('resolve-swap',{id:swapId,action:'accepted'},bobCookie)).status,403);
 const accept=await Promise.all([call('resolve-swap',{id:swapId,action:'accepted'},claraCookie),call('resolve-swap',{id:swapId,action:'accepted'},claraCookie)]);assert.deepEqual(accept.map(r=>r.status).sort(),[200,409]);
 const afterSwap=(await call('state',undefined,cookie)).data;
 assert.equal(afterSwap.tasks.find(t=>t.id===a.id).assignee_id,claraId);assert.equal(afterSwap.tasks.find(t=>t.id===b.id).assignee_id,bobId);
 const draw=await call('draw',{date:future},cookie);assert.equal(draw.status,200);assert.equal(draw.data.created.length,4);
 assert.equal((await call('draw',{date:future},cookie)).data.created.length,0);
 const inheritedTask=draw.data.created.find(task=>task.template_id===kitchenTemplate.id);
 assert.equal(inheritedTask.icon,'garden');
 const changedTemplate=await call('save-template',{...templatePayload,icon:'dishes'},cookie);
 assert.equal(changedTemplate.status,200);assert.equal(changedTemplate.data.templates.find(template=>template.id===kitchenTemplate.id).icon,'dishes');
 assert.equal(changedTemplate.data.tasks.find(task=>task.id===inheritedTask.id).icon,'garden');
 settings={...settings,holidays:{[future]:'Folga combinada'},skipHolidays:true};
 const paused=await call('settings',settings,cookie);assert.equal(paused.status,200);assert.ok(paused.data.tasks.filter(x=>x.due_date===future&&x.status!=='done').every(x=>x.status==='paused'));
 const dayOff=await call('draw',{date:future},cookie);assert.equal(dayOff.data.created.length,0);assert.equal(dayOff.data.skipped[0].reason,'Folga combinada');
 assert.equal((await call('complete',{id:a.id},claraCookie)).status,409);
 assert.equal((await call('save-user',{id:bobId,name:'Bruno',email:'bruno@example.test',phone:'',active:false},cookie)).status,400);
 assert.equal((await call('save-user',{name:'Duplicado',email:'ana@example.test',phone:'',active:true},cookie)).status,400);
 assert.equal((await call('export',undefined,bobCookie)).status,403);
 const exported=await call('export',undefined,cookie);assert.equal(exported.status,200);assert.ok(!JSON.stringify(exported.data).includes('password_hash'));assert.ok(!JSON.stringify(exported.data).includes('invite_hash'));
 const change=await call('change-password',{currentPassword:'Senha Bruno 2026!',password:'Senha Bruno nova 2026!'},bobCookie);assert.equal(change.status,200);assert.equal((await call('state',undefined,bobCookie)).status,401);assert.equal((await call('state',undefined,change.cookie)).status,200);
 await stop();await start(false);
 const restored=await call('state',undefined,cookie);assert.equal(restored.status,200);assert.equal(restored.data.settings.houseName,'Casa de teste');assert.ok(restored.data.tasks.find(t=>t.id===ownTask.id&&t.status==='done'&&t.points===10));
 assert.equal(restored.data.templates.find(template=>template.id===kitchenTemplate.id).icon,'dishes');
 assert.equal(restored.data.tasks.find(task=>task.id===inheritedTask.id).icon,'garden');
 assert.equal(restored.data.tasks.find(task=>task.id===a.id).icon,'tools');
 const login=await call('login',{email:'bruno@example.test',password:'Senha Bruno nova 2026!'});assert.equal(login.status,200);
 assert.equal((await call('logout',{},login.cookie)).status,200);assert.equal((await call('state',undefined,login.cookie)).status,401);
 // Reset is destructive: authentication, admin role, origin and exact confirmation are required.
 const beforeReset=(await call('state',undefined,cookie)).data;
 assert.ok(beforeReset.tasks.some(task=>task.status==='done'&&task.points===10));
 assert.ok(beforeReset.swaps.length>0);
 assert.equal((await call('reset-calendar',{confirmation:'ZERAR CALENDÁRIO'})).status,401);
 assert.equal((await call('reset-calendar',{confirmation:'ZERAR CALENDÁRIO'},change.cookie)).status,403);
 assert.equal((await call('reset-calendar',{},cookie)).status,400);
 assert.equal((await call('reset-calendar',{confirmation:'zerar calendário'},cookie)).status,400);
 assert.equal((await call('reset-calendar',{confirmation:'ZERAR CALENDÁRIO'},cookie,{Origin:'https://outra-casa.test'})).status,403);
 const afterRejectedReset=(await call('state',undefined,cookie)).data;
 assert.deepEqual(afterRejectedReset.tasks,beforeReset.tasks);
 assert.deepEqual(afterRejectedReset.swaps,beforeReset.swaps);
 // Enabling automatic generation first proves reset disables it as part of the same action.
 const enabled=await call('settings',{...beforeReset.settings,autoGenerate:true},cookie);
 assert.equal(enabled.status,200);assert.equal(enabled.data.settings.autoGenerate,true);
 const reset=await call('reset-calendar',{confirmation:'ZERAR CALENDÁRIO'},cookie);
 assert.equal(reset.status,200);
 assert.deepEqual(reset.data.reset,{tasks:beforeReset.tasks.length,swaps:beforeReset.swaps.length});
 assert.deepEqual(reset.data.tasks,[]);assert.deepEqual(reset.data.swaps,[]);
 assert.equal(reset.data.tasks.reduce((points,task)=>points+task.points,0),0);
 assert.deepEqual(reset.data.users,beforeReset.users);assert.deepEqual(reset.data.templates,beforeReset.templates);
 assert.deepEqual(reset.data.settings,{...beforeReset.settings,autoGenerate:false});
 const archive=reset.data.archivedCalendars.find(item=>item.task_count===beforeReset.tasks.length&&item.swap_count===beforeReset.swaps.length);
 assert.ok(archive);assert.ok(archive.id);assert.equal(archive.archived_by,adminId);
 assert.ok(Number.isFinite(Date.parse(archive.archived_at)));
 assert.ok(!('data' in archive));
 const sortById=items=>[...items].sort((a,b)=>a.id.localeCompare(b.id));
 const archivedExport=await call('export',undefined,cookie);
 assert.equal(archivedExport.status,200);
 const archivedHistory=archivedExport.data.archivedCalendars.find(item=>item.id===archive.id);
 assert.ok(archivedHistory);
 assert.deepEqual(sortById(archivedHistory.data.tasks),sortById(beforeReset.tasks));
 assert.deepEqual(sortById(archivedHistory.data.swaps),sortById(beforeReset.swaps));
 assert.ok(archivedHistory.data.tasks.some(task=>task.id===ownTask.id&&task.status==='done'&&task.points===10));
 assert.ok(archivedHistory.data.swaps.some(swap=>swap.id===swapId&&swap.status==='accepted'));
 const emptyReset=await call('reset-calendar',{confirmation:'ZERAR CALENDÁRIO'},cookie);
 assert.equal(emptyReset.status,200);assert.deepEqual(emptyReset.data.reset,{tasks:0,swaps:0});
 assert.deepEqual(emptyReset.data.archivedCalendars,reset.data.archivedCalendars);
 assert.equal((await call('complete',{id:ownTask.id},change.cookie)).status,404);
 assert.equal((await call('resolve-swap',{id:swapId,action:'accepted'},claraCookie)).status,409);
 // Restart would automatically create today's schedule if autoGenerate had not been persisted as false.
 await stop();await start(false);
 const emptyRestored=(await call('state',undefined,cookie)).data;
 assert.deepEqual(emptyRestored.tasks,[]);assert.deepEqual(emptyRestored.swaps,[]);
 assert.equal(emptyRestored.settings.autoGenerate,false);
 assert.deepEqual(emptyRestored.archivedCalendars,reset.data.archivedCalendars);
 const restoredHistory=(await call('export',undefined,cookie)).data.archivedCalendars.find(item=>item.id===archive.id);
 assert.deepEqual(restoredHistory,archivedHistory);
 const availableSettings={...emptyRestored.settings,paused:false,disabledDays:[],skipHolidays:false,holidays:{}};
 assert.equal((await call('settings',availableSettings,cookie)).status,200);
 const redrawn=await call('draw',{date:future},cookie);
 assert.equal(redrawn.status,200);assert.equal(redrawn.data.created.length,4);
 assert.equal(redrawn.data.tasks.length,4);assert.equal(redrawn.data.swaps.length,0);
 assert.equal(redrawn.data.created.find(task=>task.template_id===kitchenTemplate.id).icon,'dishes');
 assert.ok(redrawn.data.tasks.every(task=>task.status==='pending'&&task.points===0));
 assert.ok(redrawn.data.tasks.every(task=>!beforeReset.tasks.some(previous=>previous.id===task.id)));
 assert.equal((await call('draw',{date:future},cookie)).data.created.length,0);
 await stop();await start(false);
 const redrawnRestored=(await call('state',undefined,cookie)).data;
 assert.deepEqual(redrawnRestored.tasks,redrawn.data.tasks);
 assert.equal(redrawnRestored.settings.autoGenerate,false);
});

test('migração aditiva de ícones preserva bancos antigos e pode ser repetida',async(t)=>{
 const dir=mkdtempSync(join(tmpdir(),'casa-icon-migration-'));
 const databasePath=join(dir,'casa.sqlite');
 const legacy=new DatabaseSync(databasePath);
 legacy.exec(`
 CREATE TABLE templates (id TEXT PRIMARY KEY,title TEXT NOT NULL,area TEXT NOT NULL,duration INTEGER NOT NULL,deadline TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE tasks (id TEXT PRIMARY KEY,template_id TEXT REFERENCES templates(id),title TEXT NOT NULL,area TEXT NOT NULL,duration INTEGER NOT NULL,deadline TEXT NOT NULL,due_date TEXT NOT NULL,assignee_id TEXT NOT NULL REFERENCES users(id),status TEXT NOT NULL DEFAULT 'pending',completed_at TEXT,points INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,UNIQUE(template_id,due_date));
 INSERT INTO templates(id,title,area,duration,deadline,active) VALUES('legacy-template','Cuidar da cozinha','Cozinha',20,'20:00',1);
 `);
 legacy.close();
 let child;
 t.after(async()=>{if(child?.exitCode===null&&!child.signalCode)await new Promise(yes=>{child.once('exit',yes);child.kill('SIGTERM');});rmSync(dir,{recursive:true,force:true});});
 for(let run=0;run<2;run++) {
  child=spawn(process.execPath,['server.mjs','--api-only'],{cwd:resolve(import.meta.dirname,'..'),env:{...process.env,PORT:'0',HOST:'127.0.0.1',CASA_DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
  await new Promise((yes,no)=>{
   let output='',errors='';const timeout=setTimeout(()=>no(new Error('Migração não iniciou: '+errors)),10000);
   child.stderr.on('data',chunk=>{errors+=chunk;});
   child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('Casa em Dia · http://localhost:')){clearTimeout(timeout);yes();}});
   child.once('exit',code=>{clearTimeout(timeout);no(new Error('Migração saiu: '+code+' '+errors));});
  });
  await new Promise(yes=>{child.once('exit',yes);child.kill('SIGTERM');});
  const migrated=new DatabaseSync(databasePath);
  try {
   for(const table of ['templates','tasks']) {
    const columns=migrated.prepare(`PRAGMA table_info(${table})`).all();
    assert.equal(columns.filter(column=>column.name==='icon').length,1);
    assert.equal(columns.find(column=>column.name==='icon').notnull,1);
   }
   assert.deepEqual({...migrated.prepare('SELECT * FROM templates WHERE id=?').get('legacy-template')},{id:'legacy-template',title:'Cuidar da cozinha',area:'Cozinha',duration:20,deadline:'20:00',active:1,icon:'',weekdays:'[0,1,2,3,4,5,6]'});
  } finally {migrated.close();}
 }
});