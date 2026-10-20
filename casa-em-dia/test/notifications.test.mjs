import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import webpush from 'web-push';
import { createNotifications, normalizePhone } from '../notifications.mjs';
import { localNow } from '../rules.mjs';

const keys={p256dh:webpush.generateVAPIDKeys().publicKey,auth:randomBytes(16).toString('base64url')};
const subscription=(name='one')=>({endpoint:'https://fcm.googleapis.com/fcm/send/test-'+name,keys});
function fixture(t,{fetchImpl,pushClient,environment={}}={}) {
 const db=new DatabaseSync(':memory:');
 db.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,email TEXT,phone TEXT,active INTEGER,password_hash TEXT);
 CREATE TABLE tasks(id TEXT PRIMARY KEY,title TEXT,due_date TEXT,deadline TEXT,assignee_id TEXT,status TEXT);
 INSERT INTO users VALUES('ana','Ana','ana@example.test','(11) 99999-1234',1,'registered');
 INSERT INTO users VALUES('bia','Bia','bia@example.test','',1,'registered');
 INSERT INTO users VALUES('inactive','Inactive','inactive@example.test','',0,'registered');
 INSERT INTO users VALUES('invite','Invite','invite@example.test','',1,NULL);
 INSERT INTO tasks VALUES('today','Limpar cozinha','2026-10-19','20:00','ana','pending');
 INSERT INTO tasks VALUES('overdue','Cuidar sala','2026-10-18','20:00','ana','pending');
 INSERT INTO tasks VALUES('future','Futuro','2026-10-20','20:00','ana','pending');
 INSERT INTO tasks VALUES('completed','Concluida','2026-10-19','20:00','ana','done');
 INSERT INTO tasks VALUES('paused','Pausada','2026-10-19','20:00','ana','paused');`);
 let current={date:'2026-10-19',time:'09:00',stamp:Date.parse('2026-10-19T09:00:00-03:00')};
 const settings={paused:false,reminderMinutes:30},calls=[],pushes=[];
 const env={BREVO_API_KEY:'test-secret',BREVO_FROM_EMAIL:'sender@example.test',BREVO_SMS_SENDER:'CasaEmDia',CASA_SMS_ENABLED:'1',CASA_PUBLIC_URL:'https://casa.example.test',...environment};
 const options={db,settings:()=>settings,now:()=>current,env,fetchImpl:fetchImpl||(async(url,options)=>{calls.push({url,...options,body:JSON.parse(options.body)});return {ok:true,status:201};}),pushClient:pushClient||{sendNotification:async(value,payload,options)=>{pushes.push({subscription:value,payload:JSON.parse(payload),options});}}};
 let notifications=createNotifications(options);
 t.after(async()=>{await notifications.stop();db.close();});
 return {db,settings,calls,pushes,env,get api(){return notifications;},at(time,date=current.date){current={date,time,stamp:Date.parse(date+'T'+time+':00-03:00')};},advance(ms){current.stamp+=ms;},async restart(){await notifications.stop();notifications=createNotifications(options);return notifications;}};
}
const prefs=(emailEnabled=true,smsEnabled=false,reminderTime='09:00')=>({emailEnabled,smsEnabled,reminderTime});

test('consent is off by default, validated, and revoked when contacts change',t=>{
 const f=fixture(t);assert.deepEqual(f.api.status('ana').preferences,prefs(false,false));
 for(const value of [{...prefs(),emailEnabled:'yes'},{...prefs(),smsEnabled:1},prefs(true,false,'07:59'),prefs(true,false,'21:00')])assert.throws(()=>f.api.savePreferences('ana',value),{status:400});
 f.api.savePreferences('ana',prefs(true,true));
 f.api.contactChanged('ana',{emailChanged:true});assert.deepEqual(f.api.status('ana').preferences,prefs(false,true));
 f.api.contactChanged('ana',{phoneChanged:true});assert.deepEqual(f.api.status('ana').preferences,prefs(false,false));
 assert.throws(()=>f.api.savePreferences('bia',prefs(false,true)),{status:400});
 f.api.subscribe('ana',subscription());f.api.contactChanged('ana',{deactivated:true});assert.equal(f.api.status('ana').subscriptionCount,0);
});

test('Brazilian numbers and explicit E.164 are normalized without guessing foreign codes',()=>{
 assert.equal(normalizePhone('(11) 99999-1234'),'+5511999991234');assert.equal(normalizePhone('55 11 99999-1234'),'+5511999991234');
 assert.equal(normalizePhone('+1 415 555 2671'),'+14155552671');assert.equal(normalizePhone('0044 207 123 4567'),null);
 assert.equal(normalizePhone('invalid'),null);assert.equal(normalizePhone('9999-1234'),null);
});

test('subscriptions isolate ownership, reject SSRF and invalid keys, and keep secrets out of status',t=>{
 const f=fixture(t),sub=subscription();f.api.subscribe('ana',sub);
 assert.equal(f.api.hasSubscription('ana',sub.endpoint),true);assert.equal(f.api.hasSubscription('bia',sub.endpoint),false);
 assert.throws(()=>f.api.subscribe('bia',sub),{status:409});f.api.unsubscribe('bia',sub.endpoint);assert.equal(f.api.status('ana').subscriptionCount,1);
 for(const endpoint of ['https://127.0.0.1/push','http://fcm.googleapis.com/push','https://fcm.googleapis.com.evil.test/push','https://fcm.googleapis.com:8443/push','https://fcm.googleapis.com@evil.test/push'])assert.throws(()=>f.api.subscribe('ana',{...sub,endpoint}),{status:400});
 assert.throws(()=>f.api.subscribe('ana',{...sub,keys:{...keys,auth:'bad'}}),{status:400});
 for(let i=1;i<10;i++)f.api.subscribe('ana',subscription(String(i)));assert.throws(()=>f.api.subscribe('ana',subscription('eleven')),{status:400});
 const status=JSON.stringify(f.api.status('ana'));assert.ok(!status.includes(keys.auth));assert.ok(!status.includes('privateKey'));assert.ok(!status.includes('test-secret'));assert.ok(!status.includes(sub.endpoint));
});

test('scheduler respects preferences, quiet hours and São Paulo timezone, and includes only pending tasks due through today',async t=>{
 const f=fixture(t);assert.deepEqual(localNow(new Date('2026-10-19T11:00:00Z')),{date:'2026-10-19',time:'08:00'});
 f.at('09:00');await f.api.tick();assert.equal(f.calls.length,0);
 f.api.savePreferences('ana',prefs());f.at('07:59');await f.api.tick();assert.equal(f.calls.length,0);
 f.at('08:59');await f.api.tick();assert.equal(f.calls.length,0);
 f.at('09:00');await f.api.tick();assert.equal(f.calls.length,1);
 const mail=f.calls[0];assert.equal(mail.url,'https://api.brevo.com/v3/smtp/email');assert.equal(mail.redirect,'error');assert.equal(mail.headers['api-key'],'test-secret');assert.equal(mail.body.to[0].email,'ana@example.test');
 assert.match(mail.body.textContent,/2 atividades/);assert.match(mail.body.textContent,/Limpar cozinha/);assert.match(mail.body.textContent,/Cuidar sala/);assert.doesNotMatch(mail.body.textContent,/Futuro|Concluida|Pausada/);assert.match(mail.body.textContent,/https:\/\/casa.example.test/);
 assert.equal(f.api.status('ana').recent[0].status,'accepted');
 f.at('21:00','2026-10-20');await f.api.tick();assert.equal(f.calls.length,1);
});

test('concurrent ticks and process restart preserve daily deduplication and VAPID keys',async t=>{
 const f=fixture(t);f.api.savePreferences('ana',prefs());const publicKey=f.api.status('ana').push.publicKey;
 await Promise.all([f.api.tick(),f.api.tick(),f.api.tick()]);assert.equal(f.calls.length,1);
 await f.restart();assert.equal(f.api.status('ana').push.publicKey,publicKey);await f.api.tick();assert.equal(f.calls.length,1);
 f.at('09:00','2026-10-20');await f.api.tick();assert.equal(f.calls.length,2);
});

test('paused house, inactive accounts and unaccepted invitations do not receive reminders',async t=>{
 const f=fixture(t);f.api.savePreferences('ana',prefs());f.settings.paused=true;await f.api.tick();assert.equal(f.calls.length,0);
 f.settings.paused=false;f.db.exec("UPDATE users SET active=0 WHERE id='ana'; INSERT INTO notification_preferences VALUES('invite',1,0,'09:00'); INSERT INTO notification_preferences VALUES('inactive',1,0,'09:00'); INSERT INTO tasks VALUES('invite-task','Convite','2026-10-19','20:00','invite','pending'); INSERT INTO tasks VALUES('inactive-task','Inativo','2026-10-19','20:00','inactive','pending');");
 await f.api.tick();assert.equal(f.calls.length,0);
});

test('push repeats once per interval, uses generic text and removes expired subscriptions',async t=>{
 const f=fixture(t);f.api.subscribe('ana',subscription());await f.api.tick();await f.api.tick();assert.equal(f.pushes.length,1);
 assert.doesNotMatch(f.pushes[0].payload.body,/Limpar|cozinha|Ana|example/);assert.equal(f.pushes[0].payload.url,'https://casa.example.test/');
 f.at('09:29');await f.api.tick();assert.equal(f.pushes.length,1);f.at('09:30');await f.api.tick();assert.equal(f.pushes.length,2);
 f.db.exec("UPDATE tasks SET status='done'");f.at('10:00');await f.api.tick();assert.equal(f.pushes.length,2);
 const expired=fixture(t,{pushClient:{sendNotification:async()=>{throw Object.assign(new Error('sensitive provider body'),{statusCode:410});}}});
 expired.api.subscribe('ana',subscription());await expired.api.tick();assert.equal(expired.api.status('ana').subscriptionCount,0);assert.equal(expired.api.status('ana').recent[0].status,'rejected');
});

test('explicit provider rate rejection retries with durable backoff and stops after three attempts',async t=>{
 let calls=0;const f=fixture(t,{fetchImpl:async()=>{calls++;return {ok:false,status:429};}});f.api.savePreferences('ana',prefs());
 await f.api.tick();assert.equal(calls,1);await f.api.tick();assert.equal(calls,1);
 await f.restart();f.at('09:01');await f.api.tick();assert.equal(calls,2);f.at('09:05');await f.api.tick();assert.equal(calls,2);f.at('09:06');await f.api.tick();assert.equal(calls,3);
 f.at('10:00');await f.api.tick();assert.equal(calls,3);assert.equal(f.api.status('ana').recent[0].status,'failed');
});

test('uncertain email/SMS outcomes never resend automatically and provider errors are sanitized',async t=>{
 let calls=0;const f=fixture(t,{fetchImpl:async()=>{calls++;throw new Error('secret-key recipient@example.test 5511999991234');}});f.api.savePreferences('ana',prefs(true,true));
 await f.api.tick();assert.equal(calls,2);f.at('10:00');await f.api.tick();await f.restart();await f.api.tick();assert.equal(calls,2);
 const recent=JSON.stringify(f.api.status('ana').recent);assert.match(recent,/uncertain/);assert.doesNotMatch(recent,/secret-key|recipient@example|5511999991234/);
});

test('test dispatch stays on own contact, returns provider acceptance, and persists one-minute cooldown',async t=>{
 const f=fixture(t);const outcome=await f.api.sendTest('ana','email');assert.equal(outcome.status,'accepted');assert.equal(f.calls[0].body.to[0].email,'ana@example.test');
 await assert.rejects(f.api.sendTest('ana','email'),{status:429});await f.restart();await assert.rejects(f.api.sendTest('ana','email'),{status:429});
 f.at('09:01');await f.api.sendTest('ana','email');assert.equal(f.calls.length,2);
 const disabled=fixture(t,{environment:{BREVO_API_KEY:''}});await assert.rejects(disabled.api.sendTest('ana','email'),{status:503});assert.equal(disabled.api.status('ana').email.configured,false);assert.equal(disabled.api.status('ana').sms.configured,false);
 const rejected=fixture(t,{fetchImpl:async()=>({ok:false,status:401})});await assert.rejects(rejected.api.sendTest('ana','email'),{status:502});assert.equal(rejected.api.status('ana').recent[0].status,'failed');
});

test('SMS is separate from email consent and disabled configuration, with short generic content',async t=>{
 const f=fixture(t,{environment:{BREVO_FROM_EMAIL:''}});f.api.savePreferences('ana',prefs(false,true));await f.api.tick();assert.equal(f.calls.length,1);
 const sms=f.calls[0];assert.equal(sms.url,'https://api.brevo.com/v3/transactionalSMS/send');assert.equal(sms.body.recipient,'+5511999991234');assert.ok(sms.body.content.length<=150);assert.match(sms.body.content,/^[\x00-\x7F]+$/);assert.doesNotMatch(sms.body.content,/cozinha|Ana/);
});

test('consent is checked again for queued channels after asynchronous work',async t=>{
 let f,calls=0;f=fixture(t,{fetchImpl:async()=>{calls++;f.api.savePreferences('ana',prefs(false,false));return {ok:true,status:201};}});f.api.savePreferences('ana',prefs(true,true));
 await f.api.tick();assert.equal(calls,1);assert.equal(f.api.status('ana').recent.filter(row=>row.status==='cancelled').length,1);
});

test('shutdown waits for in-flight work and prevents subsequent dispatch',async t=>{
 let resolveSend;const f=fixture(t,{fetchImpl:()=>new Promise(resolve=>{resolveSend=resolve;})});f.api.savePreferences('ana',prefs());
 const work=f.api.tick();let stopped=false;const shutdown=f.api.stop().then(()=>{stopped=true;});await Promise.resolve();assert.equal(stopped,false);
 resolveSend({ok:true,status:201});await work;await shutdown;assert.equal(stopped,true);await assert.rejects(f.api.sendTest('ana','email'),{status:503});
});



test('test cooldown measures a full sixty seconds across the minute boundary',async t=>{
 const f=fixture(t);f.advance(59000);await f.api.sendTest('ana','email');
 f.at('09:01');await assert.rejects(f.api.sendTest('ana','email'),{status:429});
 f.advance(59000);await f.api.sendTest('ana','email');assert.equal(f.calls.length,2);
});

test('Safari receives a valid mailto VAPID contact when no public domain is configured',async t=>{
 for(const url of ['', 'https://localhost', 'http://localhost:3000']) {
  const f=fixture(t,{environment:{CASA_PUBLIC_URL:url,BREVO_FROM_EMAIL:''}});f.api.subscribe('ana',subscription());await f.api.tick();
  assert.equal(f.pushes[0].options.vapidDetails.subject,'mailto:ana@example.test');
 }
});

test('a stale push retry is cancelled when its interval has passed',async t=>{
 let calls=0;const f=fixture(t,{pushClient:{sendNotification:async()=>{calls++;if(calls===1)throw Object.assign(new Error('rate limit'),{statusCode:429});}}});
 f.api.subscribe('ana',subscription());await f.api.tick();assert.equal(calls,1);
 f.at('09:30');await f.api.tick();assert.equal(calls,2);
 assert.equal(f.api.status('ana').recent.filter(row=>row.status==='cancelled').length,1);
});
