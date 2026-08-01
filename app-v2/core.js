'use strict';
const VERSION='1.0.0';
const DB_NAME='strongnew-v1';
const DB_VERSION=1;
const STORE='kv';
const STATE_KEY='app-state';
const ACTIVE_SESSION='strongnew-v1-active';
let appState=null;
let currentView='competitions';
let installPrompt=null;
let db=null;
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=p=>`${p}-${Date.now()}-${Math.random().toString(16).slice(2,8)}`;
const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
const clone=o=>structuredClone(o);
const DEFAULT_EVENTS=[
  ['Kule','low'],['Martwy ciąg (powtórzenia)','high'],['Przerzucanie opony 360 kg - 6 obrotów','low'],['Schody','low'],['Spacer Buszmena 380 kg - 20 m','low'],['Spacer Farmera 140 kg - 2 × 20 m','low'],['Spacer Farmera na dystans','high'],['Uchwyt Herkulesa','high'],['Waga płaczu przodem','high'],['Worki - załadunek 3 × 100 kg','low'],['Wyciskanie belki 140 kg - 60 sek.','high'],['Zegar','high']
];
const freshEvents=()=>DEFAULT_EVENTS.map(([name,type])=>({id:uid('event'),name,type}));

function openDb(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>r.result.createObjectStore(STORE);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function dbGet(key){return new Promise((resolve,reject)=>{const r=db.transaction(STORE).objectStore(STORE).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function dbSet(key,val){return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(val,key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}

function defaultState(){const c={id:uid('competition'),name:'Nowe zawody Strong Man',division:'Strong Man',archived:false,createdAt:new Date().toISOString(),selectedAthleteIds:[],events:freshEvents(),startOrderIds:[],initialStartOrderIds:[],currentEventIndex:0,eventHistory:[],drafts:{},finalistsLimit:5,stage:'setup'};return{schema:2,version:VERSION,athletes:[],competitions:[c]};}
function activeId(){const id=sessionStorage.getItem(ACTIVE_SESSION);if(appState?.competitions.some(c=>c.id===id))return id;const c=appState?.competitions.find(x=>!x.archived)||appState?.competitions[0];if(c)sessionStorage.setItem(ACTIVE_SESSION,c.id);return c?.id||'';}
function activeCompetition(){return appState.competitions.find(c=>c.id===activeId())||appState.competitions[0];}
function setActive(id){sessionStorage.setItem(ACTIVE_SESSION,id);render();}
async function save(){appState.version=VERSION;await dbSet(STATE_KEY,appState);updateSubtitle();}

function migrateLegacy(){
  const athletesRaw=localStorage.getItem('strongman-next.shared-competitors.v1');
  const registryRaw=localStorage.getItem('strongman-next.competitions.v2');
  if(!athletesRaw&&!registryRaw)return null;
  const state=defaultState();
  try{const a=JSON.parse(athletesRaw||'[]');if(Array.isArray(a))state.athletes=a.map(normalizeAthlete).filter(Boolean);}catch{}
  try{const reg=JSON.parse(registryRaw||'null');if(reg?.competitions?.length){state.competitions=reg.competitions.map(item=>{let old={};try{old=JSON.parse(localStorage.getItem(`strongman-next.competition.${item.id}.state.v1`)||'{}')}catch{};return{id:String(item.id),name:item.name||old.eventName||'Zawody',division:/women|kobiet/i.test(item.name||'')?'Strong Women':'Strong Man',archived:!!item.archived,createdAt:item.createdAt||new Date().toISOString(),selectedAthleteIds:(old.selectedCompetitorIds||[]).map(String),events:(old.selectedEventIds||[]).map((id,i)=>({id:String(id),name:(old.events||[]).find(e=>String(e.id)===String(id))?.name||`Konkurencja ${i+1}`,type:(old.events||[]).find(e=>String(e.id)===String(id))?.type||'high'})),startOrderIds:(old.startOrderIds||[]).map(String),initialStartOrderIds:(old.initialStartOrderIds||old.startOrderIds||[]).map(String),currentEventIndex:Number(old.currentEventIndex)||0,eventHistory:old.eventHistory||[],drafts:old.drafts||{},finalistsLimit:Number(old.finalistsLimit)||5,stage:old.stage||'setup'};});}}
  catch{}
  return state;
}

function normalizeAthlete(item,index=0){if(typeof item==='string')item={name:item};if(!item||typeof item!=='object')return null;const name=String(item.name||item.fullName||item.athleteName||'').trim();if(!name)return null;const cats=item.categories??item.category??item.division??[];return{id:String(item.id??`athlete-${norm(name).replace(/[^a-z0-9]+/g,'-')}-${index}`),name,birthDate:String(item.birthDate||item.dateOfBirth||item.birthday||item.dob||''),residence:String(item.residence||item.city||item.place||item.location||''),height:String(item.height||item.heightCm||''),weight:String(item.weight||item.weightKg||''),notes:String(item.notes||item.achievements||item.description||item.bio||''),photo:String(item.photo||item.icon||item.image||item.avatar||''),categories:[...new Set((Array.isArray(cats)?cats:[cats]).map(x=>String(x||'').trim()).filter(Boolean))]};}
function mergeAthletes(source){const byName=new Map(appState.athletes.map(a=>[norm(a.name),a]));let added=0,updated=0;source.map(normalizeAthlete).filter(Boolean).forEach(a=>{const key=norm(a.name),old=byName.get(key);if(!old){byName.set(key,a);added++;return;}const next={...old};for(const k of ['birthDate','residence','height','weight','notes','photo'])if(a[k])next[k]=a[k];if(a.categories.length)next.categories=a.categories;byName.set(key,next);if(JSON.stringify(old)!==JSON.stringify(next))updated++;});appState.athletes=[...byName.values()].sort((a,b)=>a.name.localeCompare(b.name,'pl'));return{added,updated};}

function updateSubtitle(){const c=activeCompetition();$('#subtitle').textContent=c?`${c.name} · ${navigator.onLine?'online':'offline'}`:`StrongNew ${VERSION}`;}
function notice(text,type=''){const n=$('#notice');n.textContent=text;n.className=`notice ${type}`.trim();}
function initials(n){return n.split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase()||'?';}
function avatar(a){return `<span class="avatar">${a.photo?`<img src="${esc(a.photo)}" alt="">`:esc(initials(a.name))}</span>`;}
function selectedAthletes(c){return c.selectedAthleteIds.map(id=>appState.athletes.find(a=>a.id===id)).filter(Boolean);}
function currentEvent(c){return c.events[c.currentEventIndex];}
function eventKey(c,index=c.currentEventIndex){return c.events[index]?.id||`event-${index}`;}
function draft(c){const k=eventKey(c);c.drafts[k]??={};return c.drafts[k];}
function overall(c,history=c.eventHistory){const map=new Map(c.selectedAthleteIds.map(id=>[id,0]));history.forEach(e=>(e.results||[]).forEach(r=>map.set(String(r.id),(map.get(String(r.id))||0)+Number(r.points||0))));return map;}
function standings(c){const points=overall(c);const initial=c.initialStartOrderIds.length?c.initialStartOrderIds:c.startOrderIds;const sorted=selectedAthletes(c).map(a=>({a,points:points.get(a.id)||0,tie:0})).sort((x,y)=>y.points-x.points||(initial.indexOf(x.a.id)-initial.indexOf(y.a.id)));const ranked=[];for(let i=0;i<sorted.length;i++){const x=sorted[i];const rank=i>0&&x.points===ranked[i-1].points?ranked[i-1].rank:i+1;ranked.push({...x,rank});}return ranked;}
function nextOrder(c){const prev=c.eventHistory[c.currentEventIndex];const ids=[...c.selectedAthleteIds];if(!prev)return reconcile(c.startOrderIds,ids);const prevIndex=new Map((prev.orderIds||ids).map((id,i)=>[String(id),i]));const res=new Map((prev.results||[]).map(r=>[String(r.id),r]));return ids.sort((a,b)=>(Number(res.get(a)?.points)||0)-(Number(res.get(b)?.points)||0)||(prevIndex.get(a)??9999)-(prevIndex.get(b)??9999));}
function finalOrder(c){const top=standings(c).slice(0,Math.min(c.finalistsLimit,c.selectedAthleteIds.length));return top.reverse().map(x=>x.a.id);}
function reconcile(order,ids){const set=new Set(ids);return [...order.filter(id=>set.has(id)),...ids.filter(id=>!order.includes(id))];}
function pointsFor(rows,type){const valid=rows.map((r,i)=>({...r,value:Number(String(r.raw).replace(',','.')),i}));if(valid.some(r=>!Number.isFinite(r.value)))throw new Error('Wszystkie wyniki muszą być liczbami. DNF wpisz jako 0.');const sorted=[...valid].sort((a,b)=>type==='low'?a.value-b.value:b.value-a.value);const n=rows.length;let pos=0;while(pos<sorted.length){let end=pos+1;while(end<sorted.length&&sorted[end].value===sorted[pos].value)end++;const places=[];for(let p=pos;p<end;p++)places.push(n-p);const pts=places.reduce((a,b)=>a+b,0)/places.length;for(let p=pos;p<end;p++){sorted[p].place=pos+1;sorted[p].points=pts;}pos=end;}return sorted.sort((a,b)=>a.i-b.i);}

function render(){const c=activeCompetition();$('#competitionSelect').innerHTML=appState.competitions.filter(x=>!x.archived).map(x=>`<option value="${esc(x.id)}" ${x.id===c?.id?'selected':''}>${esc(x.name)}</option>`).join('');document.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('active',b.dataset.view===currentView));updateSubtitle();if(!c){$('#view').innerHTML='<div class="empty">Brak zawodów.</div>';return;}if(currentView==='competitions')renderCompetitions();else if(currentView==='setup')renderSetup(c);else if(currentView==='scoring')renderScoring(c);else renderStandings(c);}
