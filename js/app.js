const KEY="matsuriLightTeams";
const RACE_KEY="matsuriLightRace";
const DEFAULT_RACE_PATH="assets/race-preview.json";
const SKILL_DATA_PATH="assets/skills.json";
const SKILL_REMOTE_PATH="/api/skills";
const GAMETORA_SKILL_ICON="https://media.gametora.com/umamusume/skills/icon/";
const SKILL_ICON_API="/api/skill-icon?id=";
let skillNames={};
let skillMeta={};
const defaults=[
 {id:"ml-01",name:"Katsu Team",trainer:"Trainer Katsu",status:"Active",seed:1,members:[
   {name:"Tokai Teio",role:"Frontliner",style:"Pace Chaser",parent:""},
   {name:"Mejiro McQueen",role:"Backliner",style:"Late Surger",parent:""},
   {name:"Kitasan Black",role:"Frontliner",style:"Runner",parent:""}
 ]},
 {id:"ml-02",name:"Uma Rising",trainer:"Trainer Rei",status:"Registered",seed:2,members:[]},
 {id:"ml-03",name:"Tracen Stars",trainer:"Trainer Hikari",status:"Registered",seed:3,members:[]},
 {id:"ml-04",name:"Matsuri Force",trainer:"Trainer Miko",status:"Registered",seed:4,members:[]}
];
let raceData=null;
let registeredTeams=[];

function getTeams(){try{const raw=localStorage.getItem(KEY);if(raw){const data=JSON.parse(raw);if(Array.isArray(data))return data;}}catch(e){}return defaults}
function mergedTeams(){
 const local=getTeams();
 const paid=registeredTeams.map((r,i)=>({id:`paid-${r.orderId}`,name:r.teamName,trainer:r.captainName,status:"Registered",seed:900+i+1,members:r.members||[]}));
 const names=new Set(local.map(t=>String(t.name||"").toLowerCase()));
 return [...local,...paid.filter(t=>!names.has(String(t.name).toLowerCase()))];
}
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function getMembers(team){if(Array.isArray(team.members))return team.members;return String(team.roster||"").split(/\r?\n|,/).map(x=>x.trim()).filter(Boolean).map(name=>({name}))}
function render(){
 const teams=mergedTeams(),grid=document.getElementById("teamGrid");if(!grid)return;
 document.getElementById("statTeams").textContent=teams.length;
 document.getElementById("statActive").textContent=teams.filter(t=>t.status==="Active"||t.status==="Champion").length;
 document.getElementById("teamCountLabel").textContent=teams.length+" TEAMS";
 grid.innerHTML=teams.map(t=>`<article class="team-card" tabindex="0" role="button" data-team-id="${esc(t.id)}" aria-label="View ${esc(t.name)}"><span class="seed">SEED ${esc(t.seed)}</span><h3>${esc(t.name)}</h3><p>${esc(t.trainer||"Trainer TBD")}</p><span class="status ${esc(t.status)}">${esc(t.status).toUpperCase()}</span></article>`).join("")||'<div class="empty">NO TEAMS REGISTERED</div>';
}
function openTeam(id){
 const team=getTeams().find(t=>String(t.id)===String(id));if(!team)return;const members=getMembers(team);
 document.getElementById("modalSeed").textContent=`SEED ${team.seed}`;
 const status=document.getElementById("modalStatus");status.textContent=String(team.status||"Registered").toUpperCase();status.className=`status ${esc(team.status||"Registered")}`;
 document.getElementById("modalTeamName").textContent=team.name;document.getElementById("modalTrainer").textContent=team.trainer||"Trainer TBD";
 document.getElementById("modalRosterCount").textContent=`${members.length} MEMBER${members.length===1?"":"S"}`;
 document.getElementById("modalRoster").innerHTML=members.length?members.map((m,i)=>`<div class="roster-item"><span>${esc(m.name)}</span><small>${esc(m.role||"ROLE TBD")} · ${esc(m.style||"STYLE TBD")}${m.parent?` · Parent: ${esc(m.parent)}`:""}</small></div>`).join(""):'<div class="empty-roster">ROSTER BELUM DIISI</div>';
 const modal=document.getElementById("teamModal");modal.classList.add("open");modal.setAttribute("aria-hidden","false");document.body.style.overflow="hidden";
}
function closeTeam(){const modal=document.getElementById("teamModal");modal.classList.remove("open");modal.setAttribute("aria-hidden","true");document.body.style.overflow=""}

function profileUrl(h){return `https://media.gametora.com/umamusume/characters/portrait/trainee/256/${encodeURIComponent(h.cardId||h.charaId)}.png`}
function normalizeApt(v){const n=Number(v);return ["—","G","F","E","D","C","B","A","S"][Math.max(0,Math.min(8,n))]||"—"}
function styleName(v){return ({1:"FRONT",2:"PACE",3:"LATE",4:"END"})[Number(v)]||"STYLE"}
function statBar(value,max=1700){return Math.max(3,Math.min(100,Number(value||0)/max*100))}
function finishRank(h){return Number(h.finishOrder??0)+1}
function skillCandidates(id){
 const key=String(id);
 const out=[];
 const add=v=>{if(v!==undefined&&v!==null&&String(v)&&!out.includes(String(v)))out.push(String(v));};
 add(key);
 if(/^9\d{5}$/.test(key)) add("1"+key.slice(1));
 if(/^91\d{5}$/.test(key)) add("1"+key.slice(2));
 return out;
}
function skillLabel(id){
 const candidates=skillCandidates(id);
 for(const key of candidates){
   if(skillNames[key]) return skillNames[key];
   if(skillMeta[key]?.name_en_global) return skillMeta[key].name_en_global;
   if(skillMeta[key]?.name_en) return skillMeta[key].name_en;
 }
 return `Skill ${id}`;
}
function skillIconUrl(id){
 return `${SKILL_ICON_API}${encodeURIComponent(String(id))}`;
}
function loadSkillIconFallback(img){
 img.classList.add("skill-icon-missing");
}
async function loadSkillNames(){
 try{
   const local=await fetch(SKILL_DATA_PATH,{cache:"no-store"}).then(r=>r.json());
   skillMeta=local||{};
   Object.entries(skillMeta).forEach(([id,item])=>{
     if(item?.name_en_global) skillNames[id]=item.name_en_global;
     else if(item?.name_en) skillNames[id]=item.name_en;
     else if(item?.name) skillNames[id]=item.name;
   });
 }catch(e){console.warn("Local skill database unavailable",e)}
 try{
   const remote=await fetch(SKILL_REMOTE_PATH,{cache:"no-store"}).then(r=>{if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json();});
   const list=Array.isArray(remote)?remote:[];
   const normalized={};
   list.forEach(item=>{
     if(!item?.id) return;
     const name=item.name_en_global || item.name_en || item.name_ja;
     if(name) normalized[String(item.id)]=name;
   });
   skillMeta={...skillMeta};
   list.forEach(item=>{if(item?.id) skillMeta[String(item.id)]={...(skillMeta[String(item.id)]||{}),...item};});
   skillNames={...skillNames,...normalized};
   localStorage.setItem("matsuriLightSkillNames",JSON.stringify(skillNames));
   const selected=document.querySelector(".race-result-row.selected");
   if(selected) showHorse(Number(selected.dataset.horseIndex));
 }catch(e){console.warn("GameTora global skill database unavailable; using local fallback",e)}
}
function renderRaceCard(){
 const card=document.getElementById("racePreviewCard");if(!card||!raceData)return;
 const winner=raceData.horses.find(h=>finishRank(h)===1);
 card.innerHTML=`<div class="race-course-info"><div><span class="race-tag">AFTER MATCH</span><h3>${esc(raceData.trackName||"TRACK")} // ${raceData.courseDistance}M</h3><p>${esc(raceData.trackName||"Track")} · ${raceData.courseDistance}m · ${esc(raceData.ground||"Hard")} · ${esc(raceData.weather||"Clear")} · ${esc(raceData.season||"")}</p></div><div class="race-winner-mini"><small>WINNER</small><b>${esc(winner?.charaName||"—")}</b><span>${winner?formatTime(winner.finishTimeScaled):"—"}</span></div><button class="btn primary" type="button" id="openRaceBtn">VIEW AFTER MATCH</button></div>`;
 document.getElementById("openRaceBtn").addEventListener("click",openRace);
}
function formatTime(v){return Number(v||0).toFixed(3)+"s"}
function openRace(){
 if(!raceData)return;
 const sorted=[...raceData.horses].sort((a,b)=>finishRank(a)-finishRank(b));
 document.getElementById("raceModalTitle").textContent=`${String(raceData.trackName||"TRACK").toUpperCase()} // ${raceData.courseDistance}M`;
 document.getElementById("raceMeta").textContent=`RACE ${raceData.raceNo} · ${raceData.numRaceHorses} HORSES · ${raceData.rotation} TURN · HORSEACT ${raceData.horseACT_version||"—"}`;
 document.getElementById("raceWeather").textContent=`${String(raceData.weather||"").toUpperCase()} / ${String(raceData.time||"").toUpperCase()}`;
 document.getElementById("raceResultsList").innerHTML=sorted.map(h=>`<button type="button" class="race-result-row ${finishRank(h)===1?"winner":""}" data-horse-index="${h.horseIndex}"><span class="place">${String(finishRank(h)).padStart(2,"0")}</span><img src="${profileUrl(h)}" alt="" onerror="this.style.visibility='hidden'"><span class="result-name"><b>${esc(h.charaName)}</b><small>OWNER // ${esc(h.ownerName||h.trainerName||h.ownerTrainerName||"OWNER UNKNOWN")} · ${h.ownerTrainerId?`ID // ${esc(h.ownerTrainerId)} · `:""}POST ${esc(h.postNumber)} · ${styleName(h.runningStyle)}</small></span><span class="result-time">${formatTime(h.finishTimeScaled)}</span></button>`).join("");
 document.querySelectorAll(".race-result-row").forEach(btn=>btn.addEventListener("click",()=>{document.querySelectorAll(".race-result-row").forEach(x=>x.classList.remove("selected"));btn.classList.add("selected");showHorse(Number(btn.dataset.horseIndex),true)}));
 const first=sorted[0];document.querySelector(`.race-result-row[data-horse-index="${first?.horseIndex}"]`)?.classList.add("selected");showHorse(first?.horseIndex);
 const modal=document.getElementById("raceModal");modal.classList.add("open");modal.setAttribute("aria-hidden","false");document.body.style.overflow="hidden";
}
function showHorse(index,animate=false){
 const h=raceData.horses.find(x=>Number(x.horseIndex)===Number(index));if(!h)return;
 const stats=[["SPD",h.speed],["STA",h.stamina],["POW",h.power],["GUT",h.guts],["WIT",h.wit]];
 const apt=[["SPRINT",normalizeApt(h.properDistanceShort)],["MILE",normalizeApt(h.properDistanceMile)],["MEDIUM",normalizeApt(h.properDistanceMiddle)],["LONG",normalizeApt(h.properDistanceLong)]];
 const styles=[["FRONT",normalizeApt(h.properRunningStyleNige)],["PACE",normalizeApt(h.properRunningStyleSenko)],["LATE",normalizeApt(h.properRunningStyleSashi)],["END",normalizeApt(h.properRunningStyleOikomi)]];
 const profile=document.getElementById("horseProfile");
 if(animate){profile.classList.remove("horse-profile-switch");void profile.offsetWidth;profile.classList.add("horse-profile-switch");}
 profile.innerHTML=`<div class="horse-profile-head"><img src="${profileUrl(h)}" alt="${esc(h.charaName)}" onerror="this.style.display='none'"><div><span class="profile-class">${styleName(h.runningStyle)} // EVAL</span><h3>${esc(h.charaName)}</h3><p>OWNER // ${esc(h.ownerName||h.trainerName||h.ownerTrainerName||"OWNER UNKNOWN")}${h.ownerTrainerId?` · TRAINER ID // ${esc(h.ownerTrainerId)}`:""}<br><span class="owner-meta">POST ${esc(h.postNumber)} · RANK #${finishRank(h)} · ${esc(h.motivation||"—")}</span></p></div><strong>${formatTime(h.finishTimeScaled)}</strong></div>
 <div class="profile-section"><div class="profile-section-title"><span>RACE STATS</span><small>RAW</small></div>${stats.map(([n,v])=>`<div class="stat-line"><label>${n}</label><div class="stat-track"><i style="width:${statBar(v)}%"></i></div><b>${Number(v||0)}</b></div>`).join("")}</div>
 <div class="apt-grid"><div><span>GROUND / DIST</span>${apt.map(x=>`<em>${x[0]} <b>${x[1]}</b></em>`).join("")}</div><div><span>STYLE</span>${styles.map(x=>`<em>${x[0]} <b>${x[1]}</b></em>`).join("")}</div></div>
 <div class="profile-section skills"><div class="profile-section-title"><span>SKILLS ${h.skillIds?.length||0}</span><small>${h.talentLevel?`TALENT ★${h.talentLevel}`:""}</small></div><div class="skill-grid">${(h.skillIds||[]).map(id=>`<span class="skill-pill" title="Skill ID ${esc(id)}"><img src="${skillIconUrl(id)}" alt="" loading="lazy" data-icon-attempt="0" onerror="loadSkillIconFallback(this,${JSON.stringify(String(id))})"><span>${esc(skillLabel(id))}</span></span>`).join("")}</div></div>`;
}
function closeRace(){const modal=document.getElementById("raceModal");modal.classList.remove("open");modal.setAttribute("aria-hidden","true");document.body.style.overflow=""}
async function loadRace(){
 try{
   const saved=localStorage.getItem(RACE_KEY);
   raceData=saved?JSON.parse(saved):await fetch(DEFAULT_RACE_PATH).then(r=>r.json());
   renderRaceCard();
 }catch(e){console.warn("Race preview unavailable",e)}
}

document.getElementById("teamGrid")?.addEventListener("click",e=>{const card=e.target.closest("[data-team-id]");if(card)openTeam(card.dataset.teamId)});
document.getElementById("teamGrid")?.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){const card=e.target.closest("[data-team-id]");if(card){e.preventDefault();openTeam(card.dataset.teamId)}}});
document.querySelectorAll("[data-close-modal]").forEach(el=>el.addEventListener("click",closeTeam));
document.querySelectorAll("[data-close-race]").forEach(el=>el.addEventListener("click",closeRace));
document.addEventListener("keydown",e=>{if(e.key==="Escape"){closeTeam();closeRace()}});
async function openAdminAccess(){
 try{
   const status=await fetch("/api/auth/status",{credentials:"same-origin",cache:"no-store"}).then(r=>r.json());
   if(status.authenticated){window.location.href="admin.html";return;}
   const password=prompt("ADMIN ACCESS\nEnter admin password:");
   if(password===null)return;
   const response=await fetch("/api/auth/login",{
     method:"POST",credentials:"same-origin",
     headers:{"Content-Type":"application/json"},
     body:JSON.stringify({password})
   });
   const data=await response.json().catch(()=>({}));
   if(!response.ok || !data.authenticated){alert(data.error||"ACCESS DENIED");return;}
   window.location.href="admin.html";
 }catch(err){
   alert("Backend authentication belum aktif. Jalankan Matsuri Light melalui server Node.js.");
 }
}
const adminLogo=document.getElementById("adminLogo");
adminLogo?.addEventListener("click",e=>{e.preventDefault();openAdminAccess()});

// If the server redirects here after a direct /admin.html visit, open the hidden login prompt once.
if(new URLSearchParams(location.search).get("admin")==="login"){
  history.replaceState({},"",location.pathname+location.hash);
  setTimeout(openAdminAccess,120);
}
function renderRegistrationRoster(){
 const wrap=document.getElementById("registrationRoster"); if(!wrap)return;
 wrap.innerHTML=Array.from({length:5},(_,i)=>`<label class="registration-member"><span>${String(i+1).padStart(2,"0")}</span><input class="reg-member-input" data-slot="${i}" ${i<3?"required":""} maxlength="50" placeholder="Uma ${i+1}"></label>`).join("");
 const update=()=>{const n=[...document.querySelectorAll(".reg-member-input")].filter(x=>x.value.trim()).length;document.getElementById("regRosterCount").textContent=`${n}/5`;};
 wrap.addEventListener("input",update); update();
}
async function setupRegistration(){
 const form=document.getElementById("registrationForm"); if(!form)return;
 renderRegistrationRoster();
 try{
   const cfg=await fetch("/api/payment/config",{cache:"no-store"}).then(r=>r.json());
   const fee=document.getElementById("registrationFeeLabel");
   if(cfg.amount>0) fee.textContent=`RP ${Number(cfg.amount).toLocaleString("id-ID")} // GOPAY`;
   else fee.textContent="PAYMENT NOT CONFIGURED";
   if(cfg.enabled){
     await loadMidtransSnap(cfg);
   }
 }catch(e){document.getElementById("registrationStatus").textContent="Backend payment belum aktif.";}
 form.addEventListener("submit",async e=>{
   e.preventDefault(); const status=document.getElementById("registrationStatus"); status.textContent="CREATING ORDER…";
   const members=[...document.querySelectorAll(".reg-member-input")].map(x=>({name:x.value.trim()})).filter(x=>x.name);
   if(members.length<3||members.length>5){status.textContent="Roster wajib 3–5 Uma.";return;}
   const payload={teamName:document.getElementById("regTeamName").value.trim(),captainName:document.getElementById("regCaptain").value.trim(),whatsapp:document.getElementById("regWhatsapp").value.trim(),members};
   try{
     const res=await fetch("/api/registrations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}); const data=await res.json();
     if(!res.ok)throw new Error(data.error||"Registrasi gagal.");
     openPayment(data);
   }catch(err){status.textContent=err.message;}
 });
}

async function loadMidtransSnap(cfg){
 return new Promise((resolve,reject)=>{
  if(window.snap){resolve();return;}
  const script=document.createElement("script");
  const host=cfg.environment==="production"?"https://app.midtrans.com":"https://app.sandbox.midtrans.com";
  script.src=`${host}/snap/snap.js`; script.dataset.clientKey=cfg.clientKey; script.onload=resolve; script.onerror=()=>reject(new Error("Midtrans Snap gagal dimuat."));
  document.head.appendChild(script);
 });
}
let activePayment=null;
async function openPayment(data){
 activePayment=data; const modal=document.getElementById("paymentModal"); modal.classList.add("open");modal.setAttribute("aria-hidden","false");document.body.style.overflow="hidden";
 document.getElementById("paymentOrder").textContent=`ORDER ${data.orderId}`;document.getElementById("paymentAmount").textContent=`Rp ${Number(data.amount).toLocaleString("id-ID")}`;document.getElementById("paymentState").textContent="OPENING GOPAY CHECKOUT…";
 if(window.snap){ window.snap.pay(data.snapToken,{onSuccess:()=>paymentCallback("PAYMENT RECEIVED — VERIFYING…"),onPending:()=>paymentCallback("PAYMENT PENDING — COMPLETE PAYMENT IN GOPAY"),onError:()=>paymentCallback("PAYMENT FAILED"),onClose:()=>paymentCallback("CHECKOUT CLOSED — PAYMENT CAN STILL BE COMPLETED")}); }
 else {document.getElementById("paymentState").textContent="Snap belum termuat. Tekan tombol di bawah.";document.getElementById("openSnapAgain").hidden=false;document.getElementById("openSnapAgain").onclick=()=>window.snap?.pay(data.snapToken);}
 pollRegistration(data.orderId,data.accessToken);
}
async function paymentCallback(text){document.getElementById("paymentState").textContent=text;}
async function pollRegistration(orderId,accessToken){
 for(let i=0;i<36;i++){
  await new Promise(r=>setTimeout(r,5000));
  try{const r=await fetch(`/api/registrations/${encodeURIComponent(orderId)}?accessToken=${encodeURIComponent(accessToken)}`,{cache:"no-store"}).then(x=>x.json());
   if(r.paymentStatus==="PAID"){document.getElementById("paymentState").textContent="✓ PAYMENT CONFIRMED — TEAM REGISTERED";registeredTeams=[...registeredTeams.filter(x=>x.orderId!==r.orderId),r];render();return;}
   if(r.paymentStatus==="FAILED"){document.getElementById("paymentState").textContent="PAYMENT FAILED / EXPIRED";return;}
  }catch(e){}
 }
}
function closePayment(){const m=document.getElementById("paymentModal");m.classList.remove("open");m.setAttribute("aria-hidden","true");document.body.style.overflow=""}
document.querySelectorAll("[data-close-payment]").forEach(el=>el.addEventListener("click",closePayment));
async function loadPublicRegistrations(){try{const r=await fetch("/api/registrations/public",{cache:"no-store"});if(!r.ok)return;registeredTeams=await r.json();render();}catch(e){}}
render();loadRace();loadSkillNames();loadPublicRegistrations();setupRegistration();
window.addEventListener("storage",e=>{if(e.key===KEY)render();if(e.key===RACE_KEY){try{raceData=JSON.parse(e.newValue);renderRaceCard()}catch{}}});
if("BroadcastChannel" in window){const channel=new BroadcastChannel("matsuri-light-sync");channel.addEventListener("message",e=>{if(e.data==="teams-updated")render();if(e.data==="race-updated")loadRace()})}