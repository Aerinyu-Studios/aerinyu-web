const $ = (selector) => document.querySelector(selector);
let accessToken = localStorage.getItem('friendship_run_tv_access') || sessionStorage.getItem('friendship_run_access') || '';
let refreshTimer = null;
let configTimer = null;
let sceneTimer = null;
let progressAnimation = null;
let hasStartedCycle = false;
let displayConfig = {
  settings: {
    display_mode: 'cycle',
    logo_duration_ms: 3200,
    leaderboard_duration_ms: 12000,
    map_duration_ms: 9000,
    announcement_duration_ms: 9000
  },
  announcements: []
};
let sceneSequence = ['logo', 'leaderboard', 'map'];
let sceneIndex = 0;
let currentSceneKey = '';
let ambientReplayTimer = null;

function initLogoFallback(){
  const logo = $('#tvEventLogo');
  const fallback = $('#tvLogoFallback');
  if(!logo || !fallback) return;
  const revealFallback = ()=>{
    logo.classList.add('is-unavailable');
    fallback.classList.add('is-visible');
    fallback.setAttribute('aria-hidden','false');
  };
  logo.addEventListener('error', revealFallback, {once:true});
  if(logo.complete && logo.naturalWidth === 0) revealFallback();
}

function escapeHtml(value=''){return String(value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function avatarMarkup(entry){return entry.photo_url?`<img class="avatar" src="${escapeHtml(entry.photo_url)}" alt="">`:`<div class="avatar">${escapeHtml((entry.name || '?').charAt(0).toUpperCase())}</div>`}
function rankedEntries(entries=[]){return [...entries].sort((a,b)=>Number(b.score||0)-Number(a.score||0)||String(a.name||'').localeCompare(String(b.name||'')))}

async function api(path, options={}){
  const response = await fetch(`/api/friendship-run/${path}`, {
    ...options,
    headers:{
      ...(options.body?{'Content-Type':'application/json'}:{}),
      ...(accessToken?{'Authorization':`Bearer ${accessToken}`}:{})
    }
  });
  const body=await response.json().catch(()=>({}));
  if(!response.ok) throw Object.assign(new Error(body.error||'Request failed.'),{status:response.status});
  return body;
}

function showBoard(){
  $('#tvGate').classList.remove('is-active');
  $('#tvBoard').hidden=false;
  if(!hasStartedCycle){
    hasStartedCycle=true;
    rebuildSceneSequence(true);
  }
}
function showGate(message=''){
  clearInterval(refreshTimer);
  clearInterval(configTimer);
  clearTimeout(sceneTimer);
  clearTimeout(ambientReplayTimer);
  progressAnimation?.cancel();
  hasStartedCycle=false;
  $('#tvBoard').hidden=true;
  $('#tvGate').classList.add('is-active');
  $('#tvAccessMessage').textContent=message;
}

$('#tvAccessForm').addEventListener('submit',async(event)=>{
  event.preventDefault();
  const form=event.currentTarget;
  const button=form.querySelector('button');
  $('#tvAccessMessage').textContent='Checking...';
  button.disabled=true;
  try{
    const data=await api('auth',{method:'POST',body:JSON.stringify({password:$('#tvAccessPassword').value})});
    accessToken=data.token;
    localStorage.setItem('friendship_run_tv_access',accessToken);
    form.reset();
    const loaded = await Promise.all([loadLeaderboard(), loadDisplayConfig()]);
    if (!loaded[0] || !loaded[1]) return;
    showBoard();
    startAutoRefresh();
  }catch(error){$('#tvAccessMessage').textContent=error.message}
  finally{button.disabled=false}
});

function podiumCard(entry,position,index){
  const labels=['first','second','third'];
  return `<article class="tv-podium-card ${labels[position-1]}" style="animation-delay:${index*80}ms"><div class="tv-rank-number">${position}</div>${avatarMarkup(entry)}<div class="tv-podium-copy"><h2>${escapeHtml(entry.name)}</h2><small>${escapeHtml(entry.programme || 'Programme not provided')}</small><strong>${entry.score}</strong>${entry.message?`<p class="player-card-message">“${escapeHtml(entry.message)}”</p>`:''}</div></article>`;
}

async function loadLeaderboard(){
  try{
    const data=await api('leaderboard');
    const entries=rankedEntries(data.entries||[]);
    const top=entries.slice(0,3);
    $('#tvPodium').innerHTML=[top[1]&&podiumCard(top[1],2,0),top[0]&&podiumCard(top[0],1,1),top[2]&&podiumCard(top[2],3,2)].filter(Boolean).join('');
    $('#tvLeaderboard').innerHTML=entries.slice(3,12).map((entry,index)=>`<div class="tv-ranking-row" style="animation-delay:${index*45}ms"><b>${index+4}</b><div class="tv-player">${avatarMarkup(entry)}<div><span>${escapeHtml(entry.name)}</span><small>${escapeHtml(entry.programme || 'Programme not provided')}</small>${entry.message?`<p class="ranking-message">“${escapeHtml(entry.message)}”</p>`:''}</div></div><strong>${entry.score}</strong></div>`).join('')||'<p class="empty-copy">Waiting for more players...</p>';
    $('#lastUpdated').textContent=`Updated ${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})}`;
    return true;
  }catch(error){
    if(error.status===401){
      localStorage.removeItem('friendship_run_tv_access');
      accessToken='';
      showGate('Session expired. Enter the event password again.');
    } else if ($('#lastUpdated')) {
      $('#lastUpdated').textContent = 'Connection interrupted · retrying';
    }
    return false;
  }
}

function createSequence(){
  const mode=displayConfig.settings?.display_mode||'cycle';
  const active=(displayConfig.announcements||[]).filter(item=>item.is_active!==false);
  if(mode==='logo') return ['logo'];
  if(mode==='leaderboard') return ['leaderboard'];
  if(mode==='map') return ['map'];
  if(mode==='announcement') return active.length?active.map(item=>`announcement:${item.id}`):['logo'];
  return ['logo','leaderboard',...active.map(item=>`announcement:${item.id}`),'map'];
}

function rebuildSceneSequence(force=false){
  const next=createSequence();
  const changed=JSON.stringify(next)!==JSON.stringify(sceneSequence);
  sceneSequence=next.length?next:['logo'];
  if(force||changed||!sceneSequence.includes(currentSceneKey)){
    sceneIndex=0;
    showScene(sceneSequence[0]);
  }
}

async function loadDisplayConfig(){
  try{
    const data=await api('leaderboard?display=1');
    displayConfig={settings:data.settings||displayConfig.settings,announcements:data.announcements||[]};
    if(hasStartedCycle) rebuildSceneSequence(false);
    return true;
  }catch(error){
    if(error.status===401){
      localStorage.removeItem('friendship_run_tv_access');
      accessToken='';
      showGate('Session expired. Enter the event password again.');
      return false;
    }
    return true;
  }
}

function renderAnnouncement(item){
  $('#tvAnnouncementEyebrow').textContent=item?.eyebrow||'EVENT UPDATE';
  $('#tvAnnouncementTitle').textContent=item?.title||'Friendship Run Update';
  $('#tvAnnouncementBody').textContent=item?.body||'Important event information will appear here.';
  const card=document.querySelector('.tv-announcement-card');
  card?.classList.remove('is-entering');
  requestAnimationFrame(()=>card?.classList.add('is-entering'));
}

function sceneDuration(key){
  const settings=displayConfig.settings||{};
  if(key==='logo') return Number(settings.logo_duration_ms)||3200;
  if(key==='leaderboard') return Number(settings.leaderboard_duration_ms)||12000;
  if(key==='map') return Number(settings.map_duration_ms)||9000;
  if(key.startsWith('announcement:')){
    const id=key.split(':')[1];
    const item=(displayConfig.announcements||[]).find(row=>row.id===id);
    return Number(item?.duration_ms)||Number(settings.announcement_duration_ms)||9000;
  }
  return 6000;
}


function restartAmbientMotion(baseName){
  const stage=$('#tvBoard');
  if(!stage) return;
  stage.dataset.holdScene=baseName;
  stage.classList.remove('is-single-scene','ambient-replay');
  clearTimeout(ambientReplayTimer);
  if(sceneSequence.length!==1) return;
  stage.classList.add('is-single-scene');

  const replay=()=>{
    stage.classList.remove('ambient-replay');
    void stage.offsetWidth;
    stage.classList.add('ambient-replay');
    ambientReplayTimer=setTimeout(replay,14000);
  };
  ambientReplayTimer=setTimeout(replay,11000);
}

function showScene(key){
  clearTimeout(sceneTimer);
  clearTimeout(ambientReplayTimer);
  progressAnimation?.cancel();
  currentSceneKey=key;
  const baseName=key.startsWith('announcement:')?'announcement':key;
  restartAmbientMotion(baseName);

  if(baseName==='announcement'){
    const id=key.split(':')[1];
    renderAnnouncement((displayConfig.announcements||[]).find(item=>item.id===id));
  }

  document.querySelectorAll('.tv-scene').forEach(scene=>{
    const active=scene.dataset.scene===baseName;
    scene.classList.toggle('is-visible',active);
    scene.setAttribute('aria-hidden',String(!active));
  });

  const duration=sceneDuration(key);
  const bar=$('#sceneProgress');
  const progressWrap=bar?.closest('.tv-scene-progress');
  progressWrap?.classList.toggle('is-hidden',sceneSequence.length===1);
  if(bar && sceneSequence.length>1){
    bar.style.transform='scaleX(0)';
    progressAnimation=bar.animate([{transform:'scaleX(0)'},{transform:'scaleX(1)'}],{duration,easing:'linear',fill:'forwards'});
  }

  if(sceneSequence.length===1) return;
  sceneTimer=setTimeout(()=>{
    sceneIndex=(sceneIndex+1)%sceneSequence.length;
    showScene(sceneSequence[sceneIndex]);
  },duration);
}

function startAutoRefresh(){
  clearInterval(refreshTimer);
  clearInterval(configTimer);
  refreshTimer=setInterval(loadLeaderboard,5000);
  configTimer=setInterval(loadDisplayConfig,5000);
}

async function init(){
  initLogoFallback();
  if(!accessToken) return showGate();
  const [leaderboardLoaded, configLoaded] = await Promise.all([loadLeaderboard(), loadDisplayConfig()]);
  if (!leaderboardLoaded || !configLoaded) return;
  showBoard();
  startAutoRefresh();
}

init();
