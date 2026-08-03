const $ = (selector) => document.querySelector(selector);
let accessToken = localStorage.getItem('friendship_run_tv_access') || sessionStorage.getItem('friendship_run_access') || '';
let refreshTimer = null;
let sceneTimer = null;
let progressAnimation = null;
let hasStartedCycle = false;

const SCENE_DURATIONS = {
  logo: 3200,
  leaderboard: 12000,
  map: 9000
};

// Initial logo, then leaderboard, map, logo, and repeat.
const SCENE_SEQUENCE = ['logo', 'leaderboard', 'map', 'logo', 'leaderboard', 'map'];
let sceneIndex = 0;


function initLogoFallback(){
  const logo = document.querySelector('#tvEventLogo');
  const fallback = document.querySelector('#tvLogoFallback');
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
    sceneIndex=0;
    showScene(SCENE_SEQUENCE[sceneIndex]);
  }
}
function showGate(message=''){
  clearInterval(refreshTimer);
  clearTimeout(sceneTimer);
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
    const loaded = await loadLeaderboard();
    if (!loaded) return;
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

function showScene(name){
  clearTimeout(sceneTimer);
  progressAnimation?.cancel();

  document.querySelectorAll('.tv-scene').forEach(scene=>{
    const active=scene.dataset.scene===name;
    scene.classList.toggle('is-visible',active);
    scene.setAttribute('aria-hidden',String(!active));
  });

  const duration=SCENE_DURATIONS[name] || 6000;
  const bar=$('#sceneProgress');
  if(bar){
    bar.style.transform='scaleX(0)';
    progressAnimation=bar.animate(
      [{transform:'scaleX(0)'},{transform:'scaleX(1)'}],
      {duration,easing:'linear',fill:'forwards'}
    );
  }

  sceneTimer=setTimeout(()=>{
    sceneIndex=(sceneIndex+1)%SCENE_SEQUENCE.length;
    showScene(SCENE_SEQUENCE[sceneIndex]);
  },duration);
}

function startAutoRefresh(){
  clearInterval(refreshTimer);
  refreshTimer=setInterval(loadLeaderboard,5000);
}

async function init(){
  initLogoFallback();
  if(!accessToken) return showGate();
  const loaded = await loadLeaderboard();
  if (!loaded) return;
  showBoard();
  startAutoRefresh();
}

init();
