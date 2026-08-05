const FRIENDSHIP_RUN_BUILD = 'v76';
window.friendshipRunBuild = FRIENDSHIP_RUN_BUILD;
const $ = (selector) => document.querySelector(selector);
const screens = { gate: $('#gateScreen'), registration: $('#registrationScreen'), game: $('#gameScreen'), result: $('#resultScreen') };
const canvas = $('#gameCanvas');
const ctx = canvas.getContext('2d');

let accessToken = sessionStorage.getItem('friendship_run_access') || '';
let attemptToken = '';
let player = null;
let currentAttemptType = 'official';
let capturedPhotoData = null;
let cameraStream = null;
let snake = [];
let food = {x: 0, y: 0};
let direction = {x: 1, y: 0};
let queuedDirection = {x: 1, y: 0};
let score = 0;
let timer = null;
let running = false;
let startedAt = 0;
const cells = 24;
const grid = canvas.width / cells;
let audioContext = null;
let boardFlashUntil = 0;
let liveDisplayRequested = false;
let liveBoothId = 1;
let liveSyncInFlight = false;
let lastLiveSyncAt = 0;
let lastRealtimeSentAt = 0;
let realtimeClient = null;
let realtimeChannel = null;
let realtimeSubscribed = false;
let realtimeInitPromise = null;
let realtimeTopic = '';
let realtimeFrameNumber = 0;
const realtimeSessionId = globalThis.crypto?.randomUUID?.() || `game-${Date.now()}-${Math.random().toString(36).slice(2)}`;

// Supabase Realtime Broadcast is the primary live transport.
// The database endpoint is retained only as a reconnect fallback.
let supabaseLoaderPromise = null;
let realtimeHealthToken = '';
let realtimeHealthTimer = null;
const realtimeDebug = {
  build:FRIENDSHIP_RUN_BUILD, role:'publisher', stage:'idle', status:'idle', error:'', config:null,
  subscribed_at:null, health_latency_ms:null
};
window.friendshipRunRealtimeDebug = realtimeDebug;
function updateRealtimeDebug(patch={}){
  Object.assign(realtimeDebug,patch,{updated_at:new Date().toISOString()});
  console.info('[Friendship Run Realtime]',{...realtimeDebug});
}
function readableRealtimeError(error,fallback='Realtime connection failed.'){
  if(!error) return fallback;
  if(typeof error==='string') return error;
  return error.message||error.error||error.reason||fallback;
}

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function ensureSupabaseBrowserClient() {
  if (window.supabase?.createClient) return Promise.resolve(window.supabase);
  if (supabaseLoaderPromise) return supabaseLoaderPromise;

  supabaseLoaderPromise = new Promise((resolve, reject) => {
    let script = document.querySelector('script[data-friendship-supabase]') ||
      [...document.scripts].find(item => item.src.includes('@supabase/supabase-js'));

    const finish = () => {
      if (window.supabase?.createClient) resolve(window.supabase);
      else reject(new Error('Supabase Realtime client did not load.'));
    };

    if (script) {
      if (window.supabase?.createClient) return finish();
      script.addEventListener('load', finish, {once:true});
      script.addEventListener('error', () => reject(new Error('Could not load Supabase Realtime.')), {once:true});
      return;
    }

    script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.7';
    script.async = true;
    script.dataset.friendshipSupabase = '1';
    script.addEventListener('load', finish, {once:true});
    script.addEventListener('error', () => reject(new Error('Could not load Supabase Realtime.')), {once:true});
    document.head.appendChild(script);
  });

  return supabaseLoaderPromise;
}

function tone(frequency, duration = 0.07, type = 'square', volume = 0.035) {
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(volume, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + duration);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + duration);
  } catch {}
}

function playEatSound() { tone(620, .055, 'square', .04); setTimeout(() => tone(820, .06, 'square', .03), 35); }
function playStartSound() { tone(420, .07); setTimeout(() => tone(560, .07), 90); setTimeout(() => tone(760, .1), 180); }
function playGameOverSound() { tone(320, .12, 'sawtooth', .035); setTimeout(() => tone(210, .18, 'sawtooth', .03), 100); }

function showScreen(name) {
  Object.entries(screens).forEach(([key, element]) => {
    const active = key === name;
    element.classList.toggle('is-active', active);
    element.setAttribute('aria-hidden', String(!active));
  });
  window.scrollTo(0, 0);
}

async function request(path, options = {}) {
  const response = await fetch(`/api/friendship-run/${path}`, {
    ...options,
    headers: {
      ...(options.body ? {'Content-Type': 'application/json'} : {}),
      ...(accessToken ? {'Authorization': `Bearer ${accessToken}`} : {}),
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
      sessionStorage.removeItem('friendship_run_access');
      accessToken = '';
      showScreen('gate');
      $('#accessMessage').textContent = 'Your session expired. Enter the event password again.';
    }
    throw new Error(body.error || 'Request failed.');
  }
  return body;
}

$('#accessForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = $('#accessMessage');
  const button = form.querySelector('button');
  message.textContent = 'Checking...';
  button.disabled = true;
  try {
    const data = await request('auth', {method:'POST', body:JSON.stringify({password:$('#accessPassword').value})});
    accessToken = data.token;
    sessionStorage.setItem('friendship_run_access', accessToken);
    form.reset();
    showScreen('registration');
    await loadLeaderboard();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

async function validateExistingToken() {
  if (!accessToken) return showScreen('gate');
  try {
    await request('leaderboard');
    showScreen('registration');
    await loadLeaderboard();
  } catch {
    if (!accessToken) showScreen('gate');
  }
}

async function openCamera() {
  const message = $('#cameraMessage');
  message.textContent = 'Opening camera...';
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {facingMode:'user', width:{ideal:1280}, height:{ideal:960}},
      audio: false
    });
    $('#cameraVideo').srcObject = cameraStream;
    $('#cameraDialog').showModal();
    message.textContent = '';
  } catch {
    message.textContent = 'Camera access was blocked or is unavailable.';
    if (!$('#cameraDialog').open) $('#cameraDialog').showModal();
  }
}

function stopCamera() {
  cameraStream?.getTracks().forEach(track => track.stop());
  cameraStream = null;
  $('#cameraVideo').srcObject = null;
}

function closeCamera() {
  stopCamera();
  $('#cameraDialog').close();
}

$('#openCameraButton').addEventListener('click', openCamera);
$('#closeCameraButton').addEventListener('click', closeCamera);
$('#cameraDialog').addEventListener('cancel', (event) => { event.preventDefault(); closeCamera(); });
$('#cameraDialog').addEventListener('click', (event) => {
  if (event.target === $('#cameraDialog')) closeCamera();
});

$('#capturePhotoButton').addEventListener('click', () => {
  const video = $('#cameraVideo');
  if (!video.videoWidth || !video.videoHeight) {
    $('#cameraMessage').textContent = 'Wait for the camera preview to load.';
    return;
  }
  const photoCanvas = $('#photoCanvas');
  const pctx = photoCanvas.getContext('2d');
  const sourceSize = Math.min(video.videoWidth, video.videoHeight);
  const sx = (video.videoWidth - sourceSize) / 2;
  const sy = (video.videoHeight - sourceSize) / 2;
  pctx.save();
  pctx.translate(photoCanvas.width, 0);
  pctx.scale(-1, 1);
  pctx.drawImage(video, sx, sy, sourceSize, sourceSize, 0, 0, photoCanvas.width, photoCanvas.height);
  pctx.restore();
  capturedPhotoData = photoCanvas.toDataURL('image/jpeg', .8);
  $('#capturedPhoto').src = capturedPhotoData;
  $('#capturedPhoto').hidden = false;
  $('#cameraPlaceholder').hidden = true;
  $('#removePhotoButton').hidden = false;
  $('#openCameraButton').textContent = 'Retake photo';
  closeCamera();
});

$('#removePhotoButton').addEventListener('click', () => {
  capturedPhotoData = null;
  $('#capturedPhoto').src = '';
  $('#capturedPhoto').hidden = true;
  $('#cameraPlaceholder').hidden = false;
  $('#removePhotoButton').hidden = true;
  $('#openCameraButton').textContent = 'Take player photo';
});

$('#registrationForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = $('#registrationMessage');
  const button = form.querySelector('button[type="submit"]');
  message.textContent = 'Confirming payment...';
  button.disabled = true;
  try {
    const data = await request('register', {
      method:'POST',
      body:JSON.stringify({
        name:$('#playerName').value.trim(),
        student_id:$('#studentId').value.trim(),
        programme:$('#playerProgramme').value.trim(),
        message:$('#playerMessage').value.trim(),
        play_code:$('#playCode').value.trim(),
        consent:$('#scoreConsent').checked,
        live_display:$('#liveDisplayConsent')?.checked === true,
        photo_data:capturedPhotoData
      })
    });
    player = data.player;
    attemptToken = data.attempt_token;
    currentAttemptType = data.attempt_type || 'official';
    liveDisplayRequested = data.live_display === true;
    liveBoothId = [1,2].includes(Number(data.booth_id)) ? Number(data.booth_id) : 1;
    if (liveDisplayRequested) {
      initRealtimeChannel().then(ready => {
        if (ready) broadcastLiveState(true, true);
      }).catch(() => {});
    }
    $('#currentPlayer').textContent = player.name;
    $('#bestValue').textContent = String(data.top_score || 0).padStart(3,'0');
    const noticeTitle = document.querySelector('#attemptNoticeTitle');
    const noticeText = document.querySelector('#attemptNoticeText');
    if (noticeTitle) noticeTitle.textContent = currentAttemptType === 'trial' ? 'Free trial' : 'Official attempt';
    if (noticeText) noticeText.textContent = currentAttemptType === 'trial' ? 'Practice round only. This score will not enter the leaderboard.' : 'Leaving or refreshing during play forfeits this attempt.';
    message.textContent = '';
    resetGame();
    showScreen('game');
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

function resetGame() {
  clearInterval(timer);
  running = false;
  score = 0;
  direction = {x:1,y:0};
  queuedDirection = {...direction};
  snake = [{x:8,y:12},{x:7,y:12},{x:6,y:12},{x:5,y:12}];
  placeFood();
  $('#scoreValue').textContent = '000';
  $('#speedLabel').textContent = 'SPEED 1';
  $('#overlayTitle').textContent = 'READY?';
  $('#overlayText').textContent = 'Use Arrow Keys or WASD.';
  $('#startButton').hidden = false;
  $('#startButton').disabled = false;
  $('#gameOverlay').hidden = false;
  draw();
}

function placeFood() {
  do food = {x:Math.floor(Math.random()*cells), y:Math.floor(Math.random()*cells)};
  while (snake.some(part => part.x === food.x && part.y === food.y));
}

function draw() {
  ctx.fillStyle = Date.now() < boardFlashUntil ? '#e9f4ff' : '#dcecff';
  ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.strokeStyle = 'rgba(23,33,107,.12)';
  ctx.lineWidth = 1;
  for(let i=0;i<=cells;i++){
    ctx.beginPath();ctx.moveTo(i*grid,0);ctx.lineTo(i*grid,canvas.height);ctx.stroke();
    ctx.beginPath();ctx.moveTo(0,i*grid);ctx.lineTo(canvas.width,i*grid);ctx.stroke();
  }
  ctx.fillStyle = '#d84f73';
  ctx.beginPath();
  ctx.arc(food.x*grid+grid/2, food.y*grid+grid/2, grid*.27, 0, Math.PI*2);
  ctx.fill();
  snake.forEach((part,index)=>{
    ctx.fillStyle = index === 0 ? '#090f23' : (index % 2 ? '#121a31' : '#1a243e');
    ctx.fillRect(part.x*grid+2,part.y*grid+2,grid-4,grid-4);
    if(index === 0){ctx.fillStyle='#ffffff';ctx.fillRect(part.x*grid+grid*.62,part.y*grid+grid*.22,Math.max(4,grid*.16),Math.max(4,grid*.16))}
  });
}

function realtimeState(active = true) {
  return {
    session_id: realtimeSessionId,
    frame: ++realtimeFrameNumber,
    booth_id: liveBoothId,
    active,
    player_name: player?.name || 'Player',
    programme: player?.programme || '',
    attempt_type: currentAttemptType === 'trial' ? 'trial' : 'official',
    score,
    cells,
    snake: snake.map(part => ({x: part.x, y: part.y})),
    food: {x: food.x, y: food.y},
    sent_at: Date.now()
  };
}

async function removeRealtimeChannel() {
  realtimeSubscribed = false;
  const channel = realtimeChannel;
  realtimeChannel = null;
  realtimeTopic = '';
  if (realtimeClient && channel) {
    try { await realtimeClient.removeChannel(channel); } catch {}
  }
  realtimeClient = null;
}

function handlePublisherRealtimeHealth(message){
  const data=message?.payload||message;
  if(!data||data.token!==realtimeHealthToken) return;
  clearTimeout(realtimeHealthTimer);
  const latency=Math.max(0,Date.now()-Number(data.sent_at||Date.now()));
  updateRealtimeDebug({stage:'healthy',status:'SUBSCRIBED',error:'',health_latency_ms:latency});
}

function runPublisherRealtimeHealthCheck(){
  if(!realtimeSubscribed||!realtimeChannel) return;
  realtimeHealthToken=`publisher-${liveBoothId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  clearTimeout(realtimeHealthTimer);
  realtimeHealthTimer=setTimeout(()=>{
    updateRealtimeDebug({stage:'health-timeout',error:'Subscribed, but Broadcast messages were not received. Check Supabase Realtime public-channel settings.'});
  },2500);
  realtimeChannel.send({type:'broadcast',event:'realtime-health',payload:{token:realtimeHealthToken,sent_at:Date.now(),booth_id:liveBoothId}})
    .then(result=>updateRealtimeDebug({send_result:String(result)}))
    .catch(error=>updateRealtimeDebug({stage:'send-error',error:readableRealtimeError(error)}));
}

async function initRealtimeChannel() {
  if (!liveDisplayRequested) {
    updateRealtimeDebug({stage:'skipped',status:'NOT_REQUESTED',error:'Live TV display was not selected.'});
    return false;
  }
  if (!attemptToken) {
    updateRealtimeDebug({stage:'prerequisite-error',status:'NO_ATTEMPT_TOKEN',error:'The game attempt token is missing. Return to registration and enter the play code again.'});
    return false;
  }
  updateRealtimeDebug({stage:'loading-client',booth_id:liveBoothId,error:''});
  let supabaseBrowser;
  try {
    supabaseBrowser = await ensureSupabaseBrowserClient();
  } catch (error) {
    updateRealtimeDebug({stage:'client-load-error',error:readableRealtimeError(error)});
    return false;
  }
  if (realtimeChannel && realtimeSubscribed && realtimeChannel.__boothId === liveBoothId) return true;
  if (realtimeInitPromise) return realtimeInitPromise;

  realtimeInitPromise = (async () => {
    await removeRealtimeChannel();
    updateRealtimeDebug({stage:'fetching-config'});
    let config;
    try {
      config = await request(`leaderboard?realtime=1&booth=${liveBoothId}`);
    } catch (error) {
      updateRealtimeDebug({stage:'config-error',error:readableRealtimeError(error)});
      return false;
    }

    updateRealtimeDebug({stage:'connecting',config:config.diagnostics||{}});
    realtimeClient = supabaseBrowser.createClient(config.supabase_url, config.supabase_publishable_key, {
      auth: {persistSession:false, autoRefreshToken:false, detectSessionInUrl:false},
      realtime: {params:{eventsPerSecond:100}}
    });
    realtimeTopic = config.topic;
    const channel = realtimeClient.channel(realtimeTopic, {
      config: {private:false, broadcast:{ack:false, self:true}}
    });
    channel.__boothId = liveBoothId;
    realtimeChannel = channel;
    channel.on('broadcast', {event:'realtime-health'}, handlePublisherRealtimeHealth);

    return await new Promise(resolve => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          updateRealtimeDebug({stage:'subscription-timeout',status:'TIMED_OUT',error:'Realtime subscription timed out.'});
          resolve(false);
        }
      }, 5000);

      channel.subscribe((status,error) => {
        updateRealtimeDebug({stage:'subscription',status,error:readableRealtimeError(error,'')});
        if (status === 'SUBSCRIBED') {
          realtimeSubscribed = true;
          clearTimeout(timeout);
          updateRealtimeDebug({stage:'subscribed',status,subscribed_at:new Date().toISOString(),error:''});
          runPublisherRealtimeHealthCheck();
          if (!settled) { settled = true; resolve(true); }
        } else if (['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status)) {
          realtimeSubscribed = false;
          const detail = readableRealtimeError(error, `Supabase channel status: ${status}`);
          updateRealtimeDebug({stage:'subscription-error',status,error:detail});
          if (!settled && status !== 'CLOSED') {
            clearTimeout(timeout);
            settled = true;
            resolve(false);
          }
        }
      });
    });
  })().finally(() => { realtimeInitPromise = null; });

  return realtimeInitPromise;
}

function broadcastLiveState(active = true, force = false) {
  if (!liveDisplayRequested || !attemptToken) return;
  const now = performance.now();
  // Snake ticks are already at most ~20 updates/second. This guard only blocks accidental duplicates.
  if (!force && now - lastRealtimeSentAt < 20) return;
  lastRealtimeSentAt = now;

  const state = realtimeState(active);
  if (!realtimeSubscribed || !realtimeChannel) {
    initRealtimeChannel().then(ready => {
      if (!ready || !realtimeChannel) return;
      realtimeChannel.send({type:'broadcast', event:'game-frame', payload:state}).catch(() => {});
    }).catch(() => {});
    return;
  }

  // Once SUBSCRIBED, channel.send uses the active Realtime WebSocket.
  realtimeChannel.send({type:'broadcast', event:'game-frame', payload:state}).catch(error => {
    updateRealtimeDebug({stage:'send-error',error:readableRealtimeError(error)});
    realtimeSubscribed = false;
    initRealtimeChannel().catch(() => {});
  });
}

async function publishLiveState(active = true, force = false) {
  if (!liveDisplayRequested || !attemptToken) return;
  broadcastLiveState(active, force);

  // Database state is only a slow reconnect/stale-session fallback. It never drives normal live motion.
  const now = Date.now();
  if (!force && (liveSyncInFlight || now - lastLiveSyncAt < 2500)) return;
  liveSyncInFlight = true;
  lastLiveSyncAt = now;
  try {
    await request('score', {
      method:'POST',
      body:JSON.stringify({
        action:'live-update', attempt_token:attemptToken, booth_id:liveBoothId,
        active, score, cells, snake, food
      })
    });
  } catch (error) {
    console.debug('Live TV fallback update skipped:', error.message);
  } finally {
    liveSyncInFlight = false;
  }
}

function gameSpeed(){return Math.max(52,142-Math.floor(score/4)*7)}
function speedLevel(){return Math.min(9,1+Math.floor(score/4))}
function scheduleTick(){clearInterval(timer);timer=setInterval(tick,gameSpeed())}
function tick(){
  direction=queuedDirection;
  const head={x:snake[0].x+direction.x,y:snake[0].y+direction.y};
  if(head.x<0||head.y<0||head.x>=cells||head.y>=cells||snake.some(part=>part.x===head.x&&part.y===head.y)) return endGame();
  snake.unshift(head);
  if(head.x===food.x&&head.y===food.y){
    score++;
    boardFlashUntil = Date.now() + 90;
    playEatSound();
    $('#scoreValue').classList.remove('score-pop');
    void $('#scoreValue').offsetWidth;
    $('#scoreValue').classList.add('score-pop');
    $('#scoreValue').textContent=String(score).padStart(3,'0');
    $('#speedLabel').textContent=`SPEED ${speedLevel()}`;
    placeFood();scheduleTick();
  } else snake.pop();
  draw();
  publishLiveState(true);
}
function changeDirection(next){if(!running)return;if(next.x+direction.x===0&&next.y+direction.y===0)return;queuedDirection=next}
const directions={up:{x:0,y:-1},down:{x:0,y:1},left:{x:-1,y:0},right:{x:1,y:0}};
window.addEventListener('keydown', (event) => {
  const active = document.activeElement;
  const isTyping = active && (
    ['INPUT','TEXTAREA','SELECT','BUTTON'].includes(active.tagName) ||
    active.isContentEditable
  );
  const gameVisible = screens.game.classList.contains('is-active');
  if (isTyping || !gameVisible || !running) return;

  const keyMap = {
    ArrowUp:'up', ArrowDown:'down', ArrowLeft:'left', ArrowRight:'right',
    w:'up', W:'up', s:'down', S:'down', a:'left', A:'left', d:'right', D:'right'
  };
  const codeMap = {KeyW:'up',KeyS:'down',KeyA:'left',KeyD:'right'};
  const mapped = codeMap[event.code] || keyMap[event.key];
  if (!mapped) return;
  event.preventDefault();
  event.stopPropagation();
  changeDirection(directions[mapped]);
}, {capture:true});
document.querySelectorAll('[data-direction]').forEach(button=>button.addEventListener('pointerdown',()=>changeDirection(directions[button.dataset.direction])));

$('#startButton').addEventListener('click',async()=>{
  const startButton = $('#startButton');
  startButton.hidden=true;
  startButton.disabled=true;
  audioContext?.resume?.();

  if (liveDisplayRequested) {
    $('#overlayTitle').textContent='CONNECTING TV';
    $('#overlayText').textContent='Opening the live booth display...';
    const ready = await initRealtimeChannel().catch(() => false);
    if (ready) {
      $('#overlayTitle').textContent='TV READY';
      $('#overlayText').textContent='Live sync connected.';
      broadcastLiveState(true, true);
      await wait(250);
    } else {
      $('#overlayTitle').textContent='TV BACKUP';
      const reason = realtimeDebug.error || realtimeDebug.status || realtimeDebug.stage || 'Unknown connection error';
      $('#overlayText').textContent=`Live sync could not connect (${reason}). The game will continue with the backup feed.`;
      await wait(700);
    }
  }

  for(const value of ['3','2','1','GO!']){
    $('#overlayTitle').textContent=value;
    tone(value === 'GO!' ? 760 : 420 + (3 - Number(value || 3)) * 90, value === 'GO!' ? .12 : .055);
    $('#overlayText').textContent=value==='GO!'?'Good luck!':'';
    await new Promise(resolve=>setTimeout(resolve,value==='GO!'?400:650));
  }
  $('#gameOverlay').hidden=true;
  running=true;
  startedAt=Date.now();
  publishLiveState(true, true);
  scheduleTick();
});

async function endGame(){
  if(!running)return;
  running=false;clearInterval(timer);playGameOverSound();
  publishLiveState(false, true);
  $('#gameOverlay').hidden=false;$('#overlayTitle').textContent='GAME OVER';$('#overlayText').textContent='Submitting score...';$('#startButton').hidden=true;
  try{
    const data=await request('score',{method:'POST',body:JSON.stringify({attempt_token:attemptToken,score,duration_ms:Date.now()-startedAt})});
    $('#finalScore').textContent=score;
    if (data.trial) {
      $('#resultHeadline').textContent='Free trial complete';
      $('#resultMessage').textContent='Nice run. This practice score is not on the leaderboard — return to the booth for your official-attempt code.';
    } else {
      $('#resultHeadline').textContent=data.rank?`You placed #${data.rank}`:'Score submitted';
      $('#resultMessage').textContent='Your score has been added to the live Friendship Run leaderboard.';
    }
  }catch(error){
    $('#finalScore').textContent=score;$('#resultHeadline').textContent='Score not submitted';$('#resultMessage').textContent=error.message;
  }
  showScreen('result');
}

$('#fullscreenButton').addEventListener('click',async()=>{
  try{
    if(!document.fullscreenElement) await screens.game.requestFullscreen();
    else await document.exitFullscreen();
  }catch{}
});
document.addEventListener('fullscreenchange',()=>{$('#fullscreenButton').textContent=document.fullscreenElement?'Exit fullscreen':'Enter fullscreen'});

function escapeHtml(value=''){return String(value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function avatarMarkup(entry){return entry.photo_url?`<img class="avatar" src="${escapeHtml(entry.photo_url)}" alt="">`:`<div class="avatar">${escapeHtml(entry.name.charAt(0).toUpperCase())}</div>`}
function rankedEntries(entries = []) {
  return [...entries].sort((a,b) => {
    const scoreDifference = Number(b.score || 0) - Number(a.score || 0);
    if (scoreDifference !== 0) return scoreDifference;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
}

async function loadLeaderboard(){
  try{
    const data=await request('leaderboard');
    const entries=rankedEntries(data.entries||[]);
    $('#podium').innerHTML=entries.slice(0,3).map((entry,index)=>`<article class="podium-item" style="animation-delay:${index*45}ms">${avatarMarkup(entry)}<strong>${escapeHtml(entry.name)}</strong><small>${escapeHtml(entry.programme || 'Programme not provided')}</small><span>${entry.score}</span>${entry.message?`<p class="podium-message">“${escapeHtml(entry.message)}”</p>`:''}</article>`).join('');
    $('#leaderboard').innerHTML=entries.length?entries.map((entry,index)=>`<div class="score-row" style="animation-delay:${Math.min(index,12)*25}ms"><b>${index+1}</b>${avatarMarkup(entry)}<div class="score-player-copy"><strong>${escapeHtml(entry.name)}</strong><small>${escapeHtml(entry.programme || 'Programme not provided')}</small>${entry.message?`<p class="score-message">“${escapeHtml(entry.message)}”</p>`:''}</div><strong class="row-score">${entry.score}</strong></div>`).join(''):'<p class="empty-copy">No scores yet.</p>';
    document.querySelectorAll('[data-message-index]').forEach(button=>{
      button.addEventListener('click',()=>openMessageDialog(entries[Number(button.dataset.messageIndex)]));
    });
    $('#bestValue').textContent=String(entries[0]?.score||0).padStart(3,'0');
  }catch(error){$('#leaderboard').innerHTML=`<p class="empty-copy">${escapeHtml(error.message)}</p>`}
}
function openMessageDialog(entry){
  if(!entry?.message)return;
  $('#messageDialogName').textContent=entry.name || 'Player message';
  $('#messageDialogProgramme').textContent=entry.programme || 'Programme not provided';
  $('#messageDialogText').textContent=entry.message;
  $('#messageDialog').showModal();
}
function closeMessageDialog(){if($('#messageDialog').open)$('#messageDialog').close()}
$('#closeMessageDialog').addEventListener('click',closeMessageDialog);
$('#messageDialog').addEventListener('cancel',(event)=>{event.preventDefault();closeMessageDialog()});
$('#messageDialog').addEventListener('click',(event)=>{if(event.target===$('#messageDialog'))closeMessageDialog()});

$('#refreshLeaderboard').addEventListener('click',loadLeaderboard);
$('#newPlayerButton').addEventListener('click',async()=>{
  $('#registrationForm').reset();
  $('#registrationMessage').textContent='';
  await removeRealtimeChannel();
  player=null;attemptToken='';currentAttemptType='official';liveDisplayRequested=false;liveBoothId=1;
  capturedPhotoData=null;
  $('#capturedPhoto').src='';
  $('#capturedPhoto').hidden=true;
  $('#cameraPlaceholder').hidden=false;
  $('#removePhotoButton').hidden=true;
  $('#openCameraButton').textContent='Take player photo';
  showScreen('registration');
  await loadLeaderboard();
});
window.addEventListener('beforeunload', () => {
  stopCamera();
  if (running && liveDisplayRequested && attemptToken && accessToken) {
    try { realtimeChannel?.send({type:'broadcast', event:'game-frame', payload:realtimeState(false)}); } catch {}
    fetch('/api/friendship-run/score', {
      method:'POST', keepalive:true,
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${accessToken}`},
      body:JSON.stringify({action:'live-update',attempt_token:attemptToken,active:false,score,cells,snake,food})
    }).catch(()=>{});
  }
});
validateExistingToken();

$('#playCode')?.addEventListener('input', event => { event.target.value = event.target.value.replace(/\D/g,'').slice(0,6); });
