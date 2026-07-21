const $ = (selector) => document.querySelector(selector);
let accessToken = localStorage.getItem('friendship_run_tv_access') || sessionStorage.getItem('friendship_run_access') || '';
let refreshTimer = null;

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
}
function showGate(message=''){
  clearInterval(refreshTimer);
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

function podiumCard(entry,position){
  const labels=['first','second','third'];
  return `<article class="tv-podium-card ${labels[position-1]}"><div class="tv-rank-number">${position}</div>${avatarMarkup(entry)}<div><h2>${escapeHtml(entry.name)}</h2><strong>${entry.score}</strong></div></article>`;
}

async function loadLeaderboard(){
  try{
    const data=await api('leaderboard');
    const entries=rankedEntries(data.entries||[]);
    const top=entries.slice(0,3);
    $('#tvPodium').innerHTML=[top[1]&&podiumCard(top[1],2),top[0]&&podiumCard(top[0],1),top[2]&&podiumCard(top[2],3)].filter(Boolean).join('');
    $('#tvLeaderboard').innerHTML=entries.slice(3,12).map((entry,index)=>`<div class="tv-ranking-row"><b>${index+4}</b><div class="tv-player">${avatarMarkup(entry)}<span>${escapeHtml(entry.name)}</span></div><strong>${entry.score}</strong></div>`).join('')||'<p class="empty-copy">Waiting for more players...</p>';
    $('#lastUpdated').textContent=`Updated ${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})}`;
    return true;
  }catch(error){
    if(error.status===401){
      localStorage.removeItem('friendship_run_tv_access');
      accessToken='';
      showGate('Session expired. Enter the event password again.');
    } else {
      $('#lastUpdated').textContent = 'Connection interrupted · retrying';
    }
    return false;
  }
}

function startAutoRefresh(){
  clearInterval(refreshTimer);
  refreshTimer=setInterval(loadLeaderboard,5000);
}

async function init(){
  if(!accessToken) return showGate();
  try{
    const loaded = await loadLeaderboard();
    if (!loaded) return;
    showBoard();
    startAutoRefresh();
  }catch{showGate('Could not open the live display. Please try again.')}
}

init();
