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
const boothId = [1,2].includes(Number(document.body?.dataset?.booth)) ? Number(document.body.dataset.booth) : (/leaderboard2(?:\.html)?$/.test(location.pathname) ? 2 : 1);
let livePollTimer = null; // database fallback only; Realtime is the primary live feed
let liveGameActive = false;
let currentLiveGame = null;
let lastRealtimeReceivedAt = 0;
let lastRealtimeFrameNumber = -1;
let currentRealtimeSession = '';
let realtimeClient = null;
let realtimeChannel = null;
let realtimeSubscribed = false;
let realtimeInitPromise = null;
let realtimeWatchdogTimer = null;
let supabaseLoaderPromise = null;

// WebRTC provides the lowest-latency peer-to-peer game feed.
// Supabase Realtime remains the signalling path and fallback.
const rtcViewerId = sessionStorage.getItem(`friendship_run_rtc_viewer_${boothId}`) ||
  (globalThis.crypto?.randomUUID?.() || `viewer-${Date.now()}-${Math.random().toString(36).slice(2)}`);
sessionStorage.setItem(`friendship_run_rtc_viewer_${boothId}`, rtcViewerId);
let rtcPeer = null;
let rtcDataChannel = null;
let rtcPendingIce = [];
let rtcReadyTimer = null;
let rtcLastMessageAt = 0;
let rtcConfig = {
  iceServers: [
    {urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302']}
  ],
  iceCandidatePoolSize: 4,
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require'
};

function wait(ms){ return new Promise(resolve=>setTimeout(resolve,ms)); }

function ensureSupabaseBrowserClient(){
  if(window.supabase?.createClient) return Promise.resolve(window.supabase);
  if(supabaseLoaderPromise) return supabaseLoaderPromise;
  supabaseLoaderPromise=new Promise((resolve,reject)=>{
    let script=document.querySelector('script[data-friendship-supabase]')||[...document.scripts].find(item=>item.src.includes('@supabase/supabase-js'));
    const finish=()=>window.supabase?.createClient?resolve(window.supabase):reject(new Error('Supabase Realtime client did not load.'));
    if(script){
      if(window.supabase?.createClient) return finish();
      script.addEventListener('load',finish,{once:true});
      script.addEventListener('error',()=>reject(new Error('Could not load Supabase Realtime.')),{once:true});
      return;
    }
    script=document.createElement('script');
    script.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
    script.async=true;
    script.dataset.friendshipSupabase='1';
    script.addEventListener('load',finish,{once:true});
    script.addEventListener('error',()=>reject(new Error('Could not load Supabase Realtime.')),{once:true});
    document.head.appendChild(script);
  });
  return supabaseLoaderPromise;
}
const liveCanvas = document.querySelector('#liveGameCanvas');
const liveCtx = liveCanvas?.getContext('2d');

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

function liveAttemptAllowed(game){
  const settings=displayConfig.settings||{};
  const isTrial=game?.attempt_type==='trial';
  if(boothId===1) return isTrial?settings.live_trial_booth_1_enabled!==false:settings.live_game_booth_1_enabled!==false;
  return isTrial?settings.live_trial_booth_2_enabled!==false:settings.live_game_booth_2_enabled!==false;
}

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
  clearInterval(livePollTimer);
  clearInterval(realtimeWatchdogTimer);
  removeRealtimeChannel().catch(() => {});
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
    $('#tvLeaderboard').innerHTML=entries.slice(3).map((entry,index)=>`<div class="tv-ranking-row" style="animation-delay:${index*45}ms"><b>${index+4}</b><div class="tv-player">${avatarMarkup(entry)}<div><span>${escapeHtml(entry.name)}</span><small>${escapeHtml(entry.programme || 'Programme not provided')}</small>${entry.message?`<p class="ranking-message">“${escapeHtml(entry.message)}”</p>`:''}</div></div><strong>${entry.score}</strong></div>`).join('')||'<p class="empty-copy">Waiting for more players...</p>';
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
    if(liveGameActive && currentLiveGame && !liveAttemptAllowed(currentLiveGame)) stopLiveGame();
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
  const media=$('#tvAnnouncementMedia');
  const image=$('#tvAnnouncementImage');
  const card=$('#tvAnnouncementCard');
  if(item?.image_url){
    image.src=item.image_url;
    image.alt=item.image_alt||item.title||'Announcement image';
    media.hidden=false;
    card?.classList.add('has-image');
  }else{
    image.removeAttribute('src');
    media.hidden=true;
    card?.classList.remove('has-image');
  }
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
  if(liveGameActive && key!=='live-game') return;
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


function signalRealtime(event, payload){
  if(!realtimeSubscribed || !realtimeChannel) return;
  realtimeChannel.send({type:'broadcast', event, payload}).catch(()=>{});
}

function closeViewerPeer(){
  clearInterval(rtcReadyTimer);
  rtcReadyTimer = null;
  try{rtcDataChannel?.close();}catch{}
  try{rtcPeer?.close();}catch{}
  rtcDataChannel = null;
  rtcPeer = null;
  rtcPendingIce = [];
}

function sendViewerReady(){
  if(!realtimeSubscribed || rtcDataChannel?.readyState === 'open') return;
  signalRealtime('viewer-ready',{
    booth_id: boothId,
    viewer_id: rtcViewerId,
    requested_at: Date.now()
  });
}

function startViewerReadyLoop(){
  clearInterval(rtcReadyTimer);
  sendViewerReady();
  rtcReadyTimer = setInterval(sendViewerReady, 400);
}

async function addViewerIce(candidate){
  if(!candidate) return;
  if(rtcPeer?.remoteDescription){
    try{await rtcPeer.addIceCandidate(candidate);}catch{}
  }else{
    rtcPendingIce.push(candidate);
  }
}

async function flushViewerIce(){
  const queued = rtcPendingIce.splice(0);
  for(const candidate of queued){
    try{await rtcPeer?.addIceCandidate(candidate);}catch{}
  }
}

function attachDataChannel(channel){
  rtcDataChannel = channel;
  channel.binaryType = 'arraybuffer';
  channel.addEventListener('open',()=>{
    clearInterval(rtcReadyTimer);
    rtcReadyTimer = null;
  });
  channel.addEventListener('message',event=>{
    try{
      const game = JSON.parse(typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data));
      rtcLastMessageAt = Date.now();
      handleRealtimeGame(game);
    }catch{}
  });
  channel.addEventListener('close',()=>{
    if(rtcDataChannel === channel){
      rtcDataChannel = null;
      startViewerReadyLoop();
    }
  });
  channel.addEventListener('error',()=>{});
}

async function handleWebRtcOffer(message){
  const data = message?.payload || message;
  if(!data || Number(data.booth_id)!==boothId) return;
  if(String(data.viewer_id||'')!==rtcViewerId || !data.sdp) return;

  const queuedBeforeOffer = rtcPendingIce;
  closeViewerPeer();
  rtcPendingIce = queuedBeforeOffer;

  const pc = new RTCPeerConnection(rtcConfig);
  rtcPeer = pc;

  pc.addEventListener('datachannel',event=>attachDataChannel(event.channel));
  pc.addEventListener('icecandidate',event=>{
    if(!event.candidate) return;
    signalRealtime('webrtc-ice',{
      booth_id: boothId,
      session_id: data.session_id,
      viewer_id: rtcViewerId,
      role: 'viewer',
      candidate: event.candidate.toJSON?.() || event.candidate
    });
  });
  pc.addEventListener('connectionstatechange',()=>{
    if(['failed','closed'].includes(pc.connectionState)){
      if(rtcPeer===pc){
        closeViewerPeer();
        startViewerReadyLoop();
      }
    }
    if(pc.connectionState==='disconnected'){
      setTimeout(()=>{
        if(pc.connectionState==='disconnected' && rtcPeer===pc){
          closeViewerPeer();
          startViewerReadyLoop();
        }
      },2500);
    }
  });

  try{
    await pc.setRemoteDescription(data.sdp);
    await flushViewerIce();
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    signalRealtime('webrtc-answer',{
      booth_id: boothId,
      session_id: data.session_id,
      viewer_id: rtcViewerId,
      sdp: pc.localDescription
    });
  }catch{
    if(rtcPeer===pc){
      closeViewerPeer();
      startViewerReadyLoop();
    }
  }
}

function handleWebRtcIce(message){
  const data = message?.payload || message;
  if(!data || Number(data.booth_id)!==boothId) return;
  if(String(data.viewer_id||'')!==rtcViewerId || data.role!=='publisher') return;
  addViewerIce(data.candidate).catch(()=>{});
}

function handlePublisherReady(message){
  const data = message?.payload || message;
  if(!data || Number(data.booth_id)!==boothId) return;
  if(rtcDataChannel?.readyState!=='open') sendViewerReady();
}

async function removeRealtimeChannel(){
  closeViewerPeer();
  realtimeSubscribed=false;
  const channel=realtimeChannel;
  realtimeChannel=null;
  if(realtimeClient&&channel){try{await realtimeClient.removeChannel(channel);}catch{}}
  realtimeClient=null;
}

function stopLiveGame(){
  if(!liveGameActive) return;
  liveGameActive=false;
  currentLiveGame=null;
  rebuildSceneSequence(true);
}

function handleRealtimeGame(message){
  const game=message?.payload||message;
  if(!game||Number(game.booth_id)!==boothId) return;
  const sessionId=String(game.session_id||'');
  const frameNumber=Number(game.frame);
  if(sessionId&&sessionId!==currentRealtimeSession){
    currentRealtimeSession=sessionId;
    lastRealtimeFrameNumber=-1;
  }
  if(Number.isFinite(frameNumber)&&frameNumber<=lastRealtimeFrameNumber) return;
  if(Number.isFinite(frameNumber)) lastRealtimeFrameNumber=frameNumber;
  lastRealtimeReceivedAt=Date.now();

  if(game.active===false){
    if(!currentLiveGame?.session_id||!game.session_id||currentLiveGame.session_id===game.session_id) stopLiveGame();
    return;
  }
  if(!liveAttemptAllowed(game)) return stopLiveGame();
  currentLiveGame=game;
  showLiveGame(game);
}

async function initRealtimeChannel(){
  let supabaseBrowser;
  try{supabaseBrowser=await ensureSupabaseBrowserClient();}catch{return false;}
  if(realtimeChannel&&realtimeSubscribed) return true;
  if(realtimeInitPromise) return realtimeInitPromise;

  realtimeInitPromise=(async()=>{
    await removeRealtimeChannel();
    const config=await api(`leaderboard?realtime=1&booth=${boothId}`);
    if(Array.isArray(config.ice_servers)&&config.ice_servers.length){
      rtcConfig={...rtcConfig,iceServers:config.ice_servers};
    }
    realtimeClient=supabaseBrowser.createClient(config.supabase_url,config.supabase_publishable_key,{
      auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
      realtime:{params:{eventsPerSecond:30}}
    });
    const channel=realtimeClient.channel(config.topic,{config:{broadcast:{ack:false,self:false}}});
    realtimeChannel=channel;
    channel
      .on('broadcast',{event:'game-state'},handleRealtimeGame)
      .on('broadcast',{event:'publisher-ready'},handlePublisherReady)
      .on('broadcast',{event:'webrtc-offer'},message=>{handleWebRtcOffer(message).catch(()=>{});})
      .on('broadcast',{event:'webrtc-ice'},handleWebRtcIce);

    return await new Promise(resolve=>{
      let settled=false;
      const timeout=setTimeout(()=>{if(!settled){settled=true;resolve(false);}},5000);
      channel.subscribe(status=>{
        if(status==='SUBSCRIBED'){
          realtimeSubscribed=true;
          clearTimeout(timeout);
          startViewerReadyLoop();
          if(!settled){settled=true;resolve(true);}
        }else if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status)){
          realtimeSubscribed=false;
          if(!settled&&status!=='CLOSED'){
            clearTimeout(timeout);
            settled=true;
            resolve(false);
          }
        }
      });
    });
  })().finally(()=>{realtimeInitPromise=null;});
  return realtimeInitPromise;
}

function drawLiveGame(game){
  if(!liveCtx||!liveCanvas) return;
  const cells=Number(game.cells)||24;
  const size=liveCanvas.width;
  const cell=size/cells;
  liveCtx.fillStyle='#dcecff';
  liveCtx.fillRect(0,0,size,size);
  liveCtx.strokeStyle='rgba(23,33,107,.13)';
  liveCtx.lineWidth=1;
  for(let i=0;i<=cells;i+=1){
    liveCtx.beginPath();liveCtx.moveTo(i*cell,0);liveCtx.lineTo(i*cell,size);liveCtx.stroke();
    liveCtx.beginPath();liveCtx.moveTo(0,i*cell);liveCtx.lineTo(size,i*cell);liveCtx.stroke();
  }
  const food=game.food||{};
  if(Number.isInteger(food.x)&&Number.isInteger(food.y)){
    liveCtx.fillStyle='#d84f73';liveCtx.beginPath();liveCtx.arc(food.x*cell+cell/2,food.y*cell+cell/2,cell*.28,0,Math.PI*2);liveCtx.fill();
  }
  (Array.isArray(game.snake)?game.snake:[]).forEach((part,index)=>{
    liveCtx.fillStyle=index===0?'#090f23':(index%2?'#121a31':'#1a243e');
    liveCtx.fillRect(part.x*cell+2,part.y*cell+2,cell-4,cell-4);
    if(index===0){liveCtx.fillStyle='#fff';liveCtx.fillRect(part.x*cell+cell*.62,part.y*cell+cell*.22,Math.max(4,cell*.16),Math.max(4,cell*.16));}
  });
}

function showLiveGame(game){
  liveGameActive=true;
  currentLiveGame=game;
  clearTimeout(sceneTimer);
  progressAnimation?.cancel();
  document.querySelectorAll('.tv-scene').forEach(scene=>{
    const active=scene.dataset.scene==='live-game';
    scene.classList.toggle('is-visible',active);
    scene.setAttribute('aria-hidden',String(!active));
  });
  $('#liveGamePlayer').textContent=game.player_name||'Player';
  $('#liveGameProgramme').textContent=`${game.programme||'Snake Challenge'}${game.attempt_type==='trial'?' · FREE TRIAL':' · OFFICIAL ATTEMPT'}`;
  $('#liveGameScore').textContent=String(game.score||0);
  $('#liveGameBoothLabel').textContent=`BOOTH ${boothId}`;
  drawLiveGame(game);
}

function scheduleLivePoll(delay){
  clearTimeout(livePollTimer);
  livePollTimer=setTimeout(loadLiveGame,delay);
}

async function loadLiveGame(){
  const peerLive = rtcDataChannel?.readyState==='open' && Date.now()-rtcLastMessageAt<1500;
  let nextDelay=peerLive?5000:(realtimeSubscribed?1800:700);
  try{
    const data=await api(`leaderboard?live=1&booth=${boothId}`);
    const recentRealtime=Math.max(lastRealtimeReceivedAt,rtcLastMessageAt) && Date.now()-Math.max(lastRealtimeReceivedAt,rtcLastMessageAt)<2500;
    if(data.live_game){
      if(!recentRealtime) showLiveGame(data.live_game);
    }else if(liveGameActive&&!recentRealtime){
      stopLiveGame();
    }
  }catch(error){
    if(error.status===401){localStorage.removeItem('friendship_run_tv_access');accessToken='';showGate('Session expired. Enter the event password again.');return;}
    nextDelay=2500;
  }
  if(accessToken) scheduleLivePoll(nextDelay);
}

function startAutoRefresh(){
  clearInterval(refreshTimer);
  clearInterval(configTimer);
  clearTimeout(livePollTimer);
  clearInterval(realtimeWatchdogTimer);
  refreshTimer=setInterval(loadLeaderboard,5000);
  configTimer=setInterval(loadDisplayConfig,5000);
  initRealtimeChannel().catch(()=>{});
  scheduleLivePoll(0);
  realtimeWatchdogTimer=setInterval(()=>{
    const freshest=Math.max(lastRealtimeReceivedAt,rtcLastMessageAt);
    if(liveGameActive&&Date.now()-freshest>4500) loadLiveGame();
    if(!realtimeSubscribed) initRealtimeChannel().catch(()=>{});
    if(realtimeSubscribed&&rtcDataChannel?.readyState!=='open'&&!rtcReadyTimer) startViewerReadyLoop();
  },1000);
}

async function init(){
  initLogoFallback();
  if($('#tvStationLabel')) $('#tvStationLabel').textContent=`Booth ${boothId}`;
  if($('#liveGameBoothLabel')) $('#liveGameBoothLabel').textContent=`BOOTH ${boothId}`;
  if(!accessToken) return showGate();
  const [leaderboardLoaded, configLoaded] = await Promise.all([loadLeaderboard(), loadDisplayConfig()]);
  if (!leaderboardLoaded || !configLoaded) return;
  await Promise.race([initRealtimeChannel(), wait(1800)]).catch(()=>false);
  showBoard();
  startAutoRefresh();
}

init();
