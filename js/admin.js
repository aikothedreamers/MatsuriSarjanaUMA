// Defense-in-depth check. The Node backend also protects /admin.html before this file is served.
(async function adminGate(){
  try{
    const response=await fetch("/api/auth/status",{credentials:"same-origin",cache:"no-store"});
    const data=await response.json();
    if(!response.ok || !data.authenticated){
      window.location.replace("/?admin=login");
      return;
    }
  }catch(err){
    alert("Backend authentication tidak tersedia. Pastikan Vercel API dan environment variables sudah dikonfigurasi.");
    window.location.replace("index.html");
  }
})();

const KEY="matsuriLightTeams";
const MIN_MEMBERS=3;
const MAX_MEMBERS=5;
const defaults=[
 {id:"ml-01",name:"Katsu Team",trainer:"Trainer Katsu",status:"Active",seed:1,members:[
   {id:"m-101",name:"Tokai Teio",role:"Frontliner",style:"Pace Chaser",parent:""},
   {id:"m-102",name:"Mejiro McQueen",role:"Backliner",style:"Late Surger",parent:""},
   {id:"m-103",name:"Kitasan Black",role:"Frontliner",style:"Runner",parent:""}
 ]},
 {id:"ml-02",name:"Uma Rising",trainer:"Trainer Rei",status:"Registered",seed:2,members:[]},
 {id:"ml-03",name:"Tracen Stars",trainer:"Trainer Hikari",status:"Registered",seed:3,members:[]},
 {id:"ml-04",name:"Matsuri Force",trainer:"Trainer Miko",status:"Registered",seed:4,members:[]}
];

const RACE_KEY="matsuriLightRace"; const DEFAULT_RACE_PATH="assets/race-preview.json";
let teams=load(), editing=null, memberTeamId=null, editingMember=null;
let registrations=[]; let registrationFilter="ALL";

const $=id=>document.getElementById(id);

function normalizeTeam(t,i){
  let members=Array.isArray(t.members)?t.members:[];
  // Migrate the old textarea roster into members automatically.
  if(!members.length && t.roster){
    members=String(t.roster).split(/\r?\n|,/).map(x=>x.trim()).filter(Boolean)
      .map((name,n)=>({id:`migrated-${Date.now()}-${n}`,name,role:"",style:"",parent:""}));
  }
  return {...t,id:t.id||`ml-${Date.now()}-${i}`,members};
}
function load(){
  try{
    const x=JSON.parse(localStorage.getItem(KEY));
    if(Array.isArray(x)) return x.map(normalizeTeam);
  }catch(e){}
  return structuredClone(defaults);
}
function save(){
  teams.forEach(t=>delete t.roster);
  localStorage.setItem(KEY,JSON.stringify(teams));
  if("BroadcastChannel" in window){
    if(!window.matsuriChannel) window.matsuriChannel=new BroadcastChannel("matsuri-light-sync");
    window.matsuriChannel.postMessage("teams-updated");
  }
  render();
}
function esc(v){
  return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function clearTeamForm(){
  editing=null;$("teamId").value="";$("name").value="";$("trainer").value="";
  $("status").value="Registered";$("seed").value=Math.max(1,teams.length+1);
  if($("roster"))$("roster").value="";
  $("formTitle").textContent="ADD TEAM";$("editingBadge").textContent="NEW";
}

function firstNonBlank(...values){
  for(const value of values){ if(value!==null && value!==undefined && String(value).trim()!=="") return value; }
  return "";
}

function normalizeRace(raw){
  const horses=Array.isArray(raw.horses)?raw.horses:(Array.isArray(raw.raceHorse)?raw.raceHorse:[]);
  return {
    source:"HorseACT", horseACT_version:raw.horseACT_version||"—", raceNo:raw.raceNo||1,
    trackName:raw.trackName||raw.raceTrackName||"TOKYO",
    courseDistance:raw.courseDistance||raw.raceCourseSet?.distance||0,
    raceTrackId:raw.raceTrackId||raw.raceCourseSet?.raceTrackId||0,
    ground:raw.ground||raw.groundCondition||"Hard",weather:raw.weather||"Clear",
    season:raw.season||"",time:raw.time||"",numRaceHorses:raw.numRaceHorses||horses.length,
    rotation:raw.rotation||raw.rotationCategory||"Left",
    horses:horses.map((h,i)=>({
      postNumber:h.postNumber,horseIndex:h.horseIndex??i,charaId:h.charaId,charaName:h.charaName,
      ownerName:firstNonBlank(h.ownerName,h.trainerName,h.responseHorseData?.trainer_name,h.responseHorseData?.owner_trainer_name),
      ownerTrainerId:firstNonBlank(h.ownerTrainerId,h.owner_trainer_id,h.trainerId,h.responseHorseData?.trainer_id,h.responseHorseData?.trainerId,h.responseHorseData?.owner_trainer_id,h.responseHorseData?.ownerTrainerId)||null,
      ownerTrainedCharaId:h.ownerTrainedCharaId??h.trainedCharaData?.ownerTrainedCharaId??null,
      finishOrder:h.finishOrder??i,finishTimeRaw:h.finishTimeRaw,finishTimeScaled:h.finishTimeScaled,
      finishDiffTimeFromPrev:h.finishDiffTimeFromPrev,
      speed:h.speed??h.raceParam?.rawSpeed,stamina:h.stamina??h.raceParam?.rawStamina,
      power:h.power??h.raceParam?.rawPow,guts:h.guts??h.raceParam?.rawGuts,wit:h.wit??h.raceParam?.rawWiz,
      motivation:h.motivation??h.raceParam?.motivation,rarity:h.rarity??h.responseHorseData?.rarity,
      talentLevel:h.talentLevel??h.responseHorseData?.talent_level,
      cardId:h.cardId??h.responseHorseData?.card_id,runningStyle:h.runningStyle??h.responseHorseData?.running_style,
      properDistanceShort:h.properDistanceShort??h.responseHorseData?.proper_distance_short,
      properDistanceMile:h.properDistanceMile??h.responseHorseData?.proper_distance_mile,
      properDistanceMiddle:h.properDistanceMiddle??h.responseHorseData?.proper_distance_middle,
      properDistanceLong:h.properDistanceLong??h.responseHorseData?.proper_distance_long,
      properRunningStyleNige:h.properRunningStyleNige??h.responseHorseData?.proper_running_style_nige,
      properRunningStyleSenko:h.properRunningStyleSenko??h.responseHorseData?.proper_running_style_senko,
      properRunningStyleSashi:h.properRunningStyleSashi??h.responseHorseData?.proper_running_style_sashi,
      properRunningStyleOikomi:h.properRunningStyleOikomi??h.responseHorseData?.proper_running_style_oikomi,
      properGroundTurf:h.properGroundTurf??h.responseHorseData?.proper_ground_turf,
      properGroundDirt:h.properGroundDirt??h.responseHorseData?.proper_ground_dirt,
      skillIds:h.skillIds??(h.responseHorseData?.skill_array||[]).map(x=>x.skill_id)
    }))
  };
}
function saveRace(race){
  localStorage.setItem(RACE_KEY,JSON.stringify(race));
  if("BroadcastChannel" in window){
    if(!window.matsuriChannel)window.matsuriChannel=new BroadcastChannel("matsuri-light-sync");
    window.matsuriChannel.postMessage("race-updated");
  }
  updateRaceStatus(race);
}
function updateRaceStatus(race){
  if(!race)return;
  $("raceImportStatus").textContent=`${race.numRaceHorses} HORSES`;
  $("raceImportInfo").textContent=`${race.trackName||"TRACK"} · Race ${race.raceNo} · ${race.courseDistance}m · ${race.weather} · HorseACT ${race.horseACT_version}`;
  if($("trackNameInput")) $("trackNameInput").value=race.trackName||"TOKYO";
  if($("raceJsonEditor")) $("raceJsonEditor").value=JSON.stringify(race,null,2);
}
async function loadRaceStatus(){
  try{
    const saved=localStorage.getItem(RACE_KEY);
    const race=saved?JSON.parse(saved):await fetch(DEFAULT_RACE_PATH).then(r=>r.json());
    updateRaceStatus(race);
  }catch(e){}
}
function setRaceEditor(race){
  if(!race)return;
  $("trackNameInput").value=race.trackName||"TOKYO";
  $("raceJsonEditor").value=JSON.stringify(race,null,2);
}
async function getCurrentRace(){
  try{
    const saved=localStorage.getItem(RACE_KEY);
    return saved?JSON.parse(saved):await fetch(DEFAULT_RACE_PATH).then(r=>r.json());
  }catch(e){return null}
}
async function loadRaceEditor(){
  const race=await getCurrentRace();
  if(race)setRaceEditor(race);
}
function saveEditedRace(){
  try{
    const race=JSON.parse($("raceJsonEditor").value);
    if(!race||!Array.isArray(race.horses)||!race.horses.length) throw new Error("JSON harus memiliki array horses yang berisi data race.");
    race.source=race.source||"HorseACT";
    race.trackName=$("trackNameInput").value.trim()||"TOKYO";
    race.numRaceHorses=race.horses.length;
    saveRace(race);
    setRaceEditor(race);
    $("raceEditorStatus").textContent="SAVED / SYNCED";
    setTimeout(()=>$("raceEditorStatus").textContent="READY",1800);
  }catch(err){
    $("raceEditorStatus").textContent="INVALID JSON";
    alert("Gagal menyimpan JSON: "+err.message);
  }
}
function formatRaceEditor(){
  try{$("raceJsonEditor").value=JSON.stringify(JSON.parse($("raceJsonEditor").value),null,2);$("raceEditorStatus").textContent="FORMATTED";}
  catch(err){$("raceEditorStatus").textContent="INVALID JSON";alert("JSON belum valid: "+err.message)}
}
function downloadRaceJson(){
  try{
    const data=JSON.stringify(JSON.parse($("raceJsonEditor").value),null,2);
    const blob=new Blob([data],{type:"application/json"});
    const url=URL.createObjectURL(blob);const a=document.createElement("a");
    a.href=url;a.download=`matsuri-light-race-${Date.now()}.json`;a.click();URL.revokeObjectURL(url);
  }catch(err){alert("JSON belum valid: "+err.message)}
}

$("raceJsonInput").addEventListener("change",async e=>{
  const file=e.target.files?.[0];if(!file)return;
  try{
    const raw=JSON.parse(await file.text());
    if(!raw.raceHorse&&!raw.horses){throw new Error("JSON ini bukan format HorseACT race result.");}
    const race=normalizeRace(raw);saveRace(race);
    alert(`Race berhasil diimport: ${race.numRaceHorses} horses.`);
  }catch(err){alert("Gagal import JSON: "+err.message)}
  e.target.value="";
});
$("clearRaceBtn").addEventListener("click",async()=>{
  localStorage.removeItem(RACE_KEY);
  try{const race=await fetch(DEFAULT_RACE_PATH).then(r=>r.json());updateRaceStatus(race)}catch(e){$("raceImportStatus").textContent="DEFAULT"}
  if("BroadcastChannel" in window){if(!window.matsuriChannel)window.matsuriChannel=new BroadcastChannel("matsuri-light-sync");window.matsuriChannel.postMessage("race-updated")}
});

$("saveRaceEditorBtn").addEventListener("click",saveEditedRace);
$("formatRaceJsonBtn").addEventListener("click",formatRaceEditor);
$("downloadRaceJsonBtn").addEventListener("click",downloadRaceJson);
$("loadRaceEditorBtn").addEventListener("click",loadRaceEditor);

function render(){
  $("adminCount").textContent=teams.length;
  $("adminTeams").innerHTML=teams.map(t=>`
    <article class="admin-team">
      <div><h3>${esc(t.name)}</h3><p>SEED ${esc(t.seed)} · ${esc(t.trainer||"Trainer TBD")} · ${esc(t.status)} · ${t.members.length}/${MAX_MEMBERS} MEMBERS · <span class="roster-validity ${t.members.length>=MIN_MEMBERS&&t.members.length<=MAX_MEMBERS?"valid":"invalid"}">${t.members.length>=MIN_MEMBERS&&t.members.length<=MAX_MEMBERS?"ROSTER VALID":"NEEDS 3–5"}</span></p></div>
      <div class="admin-actions">
        <button class="btn mini primary" type="button" data-members="${esc(t.id)}">MEMBERS</button>
        <button class="btn mini" type="button" data-edit="${esc(t.id)}">EDIT</button>
        <button class="btn mini danger" type="button" data-delete="${esc(t.id)}">DELETE</button>
      </div>
    </article>
  `).join("")||'<div class="empty">BELUM ADA TEAM</div>';
}

function openMembers(teamId){
  const team=teams.find(t=>String(t.id)===String(teamId)); if(!team)return;
  memberTeamId=team.id; editingMember=null;
  $("memberTeamLabel").textContent=`${team.name} // SEED ${team.seed}`;
  $("memberModalTitle").textContent=team.name;
  $("memberModalTrainer").textContent=team.trainer||"Trainer TBD";
  $("memberFormTitle").textContent="ADD MEMBER";
  clearMemberForm();
  renderMembers();
  const modal=$("memberModal");modal.classList.add("open");modal.setAttribute("aria-hidden","false");document.body.style.overflow="hidden";
}
function closeMembers(){
  const modal=$("memberModal");modal.classList.remove("open");modal.setAttribute("aria-hidden","true");document.body.style.overflow="";
  memberTeamId=null;editingMember=null;
}
function clearMemberForm(){
  editingMember=null;$("memberId").value="";$("memberName").value="";$("memberRole").value="";
  $("memberStyle").value="";$("memberParent").value="";$("memberFormTitle").textContent="ADD MEMBER";
}
function renderMembers(){
  const team=teams.find(t=>t.id===memberTeamId);if(!team)return;
  const members=team.members||[];
  $("memberCountLabel").textContent=`${members.length}/${MAX_MEMBERS} MEMBERS`;
  $("rosterAdminCount").textContent=`${members.length}/${MAX_MEMBERS}`;
  const addButton=$("memberForm").querySelector('button[type="submit"]');
  if(addButton){
    const canAdd=Boolean(editingMember)||members.length<MAX_MEMBERS;
    addButton.disabled=!canAdd;
    addButton.title=canAdd?"":"Maximum 5 members per team";
  }
  $("memberList").innerHTML=members.map((m,i)=>`
    <article class="member-admin-item">
      <div><span class="member-number">${String(i+1).padStart(2,"0")}</span><div class="member-info"><h4>${esc(m.name)}</h4><p>${esc(m.role||"ROLE TBD")} · ${esc(m.style||"STYLE TBD")}</p>${m.parent?`<small>Parent: ${esc(m.parent)}</small>`:""}</div></div>
      <div class="admin-actions"><button class="btn mini" type="button" data-edit-member="${esc(m.id)}">EDIT</button><button class="btn mini danger" type="button" data-delete-member="${esc(m.id)}" ${members.length<=MIN_MEMBERS?'disabled title="Minimum 3 members per team"':''}>DELETE</button></div>
    </article>
  `).join("")||'<div class="empty">BELUM ADA MEMBER. TAMBAHKAN MEMBER DI FORM.</div>';
}

$("teamForm").addEventListener("submit",e=>{
  e.preventDefault();
  const name=$("name").value.trim();if(!name){$("name").focus();return}
  const item={id:editing||`ml-${Date.now()}`,name,trainer:$("trainer").value.trim(),status:$("status").value,seed:Math.max(1,Number($("seed").value)||1),members:editing?(teams.find(t=>t.id===editing)?.members||[]):[]};
  if(editing)teams=teams.map(t=>t.id===editing?item:t);else teams.push(item);
  save();clearTeamForm();
});

$("adminTeams").addEventListener("click",e=>{
  const member=e.target.closest("[data-members]")?.dataset.members;
  const edit=e.target.closest("[data-edit]")?.dataset.edit;
  const del=e.target.closest("[data-delete]")?.dataset.delete;
  if(member){openMembers(member);return}
  if(edit){
    const t=teams.find(x=>x.id===edit);if(!t)return;
    editing=t.id;$("teamId").value=t.id;$("name").value=t.name;$("trainer").value=t.trainer||"";
    $("status").value=t.status;$("seed").value=t.seed;$("formTitle").textContent="EDIT TEAM";$("editingBadge").textContent="EDITING";
    window.scrollTo({top:0,behavior:"smooth"});
  }
  if(del&&confirm("Hapus team ini?")){
    teams=teams.filter(t=>t.id!==del);save();if(editing===del)clearTeamForm();
  }
});

$("memberForm").addEventListener("submit",e=>{
  e.preventDefault();
  const team=teams.find(t=>t.id===memberTeamId);if(!team)return;
  const name=$("memberName").value.trim();if(!name){$("memberName").focus();return}
  team.members=team.members||[];
  if(!editingMember && team.members.length>=MAX_MEMBERS){
    alert(`Satu team maksimal ${MAX_MEMBERS} member.`);
    return;
  }
  const item={id:editingMember||`member-${Date.now()}`,name,role:$("memberRole").value.trim(),style:$("memberStyle").value.trim(),parent:$("memberParent").value.trim()};
  if(editingMember)team.members=team.members.map(m=>m.id===editingMember?item:m);
  else team.members.push(item);
  save();renderMembers();clearMemberForm();
});

$("memberList").addEventListener("click",e=>{
  const team=teams.find(t=>t.id===memberTeamId);if(!team)return;
  const edit=e.target.closest("[data-edit-member]")?.dataset.editMember;
  const del=e.target.closest("[data-delete-member]")?.dataset.deleteMember;
  if(edit){
    const m=team.members.find(x=>x.id===edit);if(!m)return;
    editingMember=m.id;$("memberId").value=m.id;$("memberName").value=m.name;$("memberRole").value=m.role||"";
    $("memberStyle").value=m.style||"";$("memberParent").value=m.parent||"";$("memberFormTitle").textContent="EDIT MEMBER";
  }
  if(del){
    if((team.members||[]).length<=MIN_MEMBERS){
      alert(`Satu team harus memiliki minimal ${MIN_MEMBERS} member.`);
      return;
    }
    if(confirm("Hapus member ini dari team?")){
      team.members=team.members.filter(m=>m.id!==del);save();renderMembers();
      if(editingMember===del)clearMemberForm();
    }
  }
});

$("cancelBtn").addEventListener("click",clearTeamForm);
$("cancelMemberBtn").addEventListener("click",clearMemberForm);
document.querySelectorAll("[data-close-member]").forEach(el=>el.addEventListener("click",closeMembers));
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&$("memberModal").classList.contains("open"))closeMembers()});
$("resetBtn").addEventListener("click",()=>{
  if(confirm("Reset semua data ke data contoh?")){teams=structuredClone(defaults);save();clearTeamForm();if($("memberModal").classList.contains("open"))closeMembers()}
});
render(); loadRaceStatus(); loadRaceEditor();


$("logoutBtn")?.addEventListener("click",async()=>{
  try{await fetch("/api/auth/logout",{method:"POST",credentials:"same-origin"})}catch(e){}
  window.location.replace("index.html");
});


async function loadRegistrations(){
  try{const r=await fetch('/api/registrations/admin',{credentials:'same-origin',cache:'no-store'}); if(!r.ok)return; registrations=await r.json(); renderRegistrations();}
  catch(e){console.warn('Registration list unavailable',e)}
}
function renderRegistrations(){
 const list=$('registrationAdminList'); if(!list)return;
 const data=registrationFilter==='ALL'?registrations:registrations.filter(r=>r.paymentStatus===registrationFilter);
 $('registrationAdminCount').textContent=registrations.length;
 list.innerHTML=data.length?data.slice().reverse().map(r=>`<article class="registration-admin-item"><div><div class="registration-admin-title"><h3>${esc(r.teamName)}</h3><span class="reg-status ${esc(r.paymentStatus)}">${esc(r.paymentStatus)}</span></div><p>${esc(r.captainName)} · ${esc(r.whatsapp)} · ORDER ${esc(r.orderId)}</p><small>${esc((r.members||[]).map(m=>m.name).join(' · '))}</small></div><div class="registration-admin-meta"><b>Rp ${Number(r.amount||0).toLocaleString('id-ID')}</b><small>${r.paidAt?new Date(r.paidAt).toLocaleString('id-ID'):'Created '+new Date(r.createdAt).toLocaleString('id-ID')}</small></div></article>`).join(''):'<div class="empty">NO REGISTRATIONS</div>';
}
document.querySelectorAll('[data-reg-filter]').forEach(btn=>btn.addEventListener('click',()=>{registrationFilter=btn.dataset.regFilter;document.querySelectorAll('[data-reg-filter]').forEach(x=>x.classList.toggle('primary',x===btn));renderRegistrations()}));
loadRegistrations();
setInterval(loadRegistrations,15000);
