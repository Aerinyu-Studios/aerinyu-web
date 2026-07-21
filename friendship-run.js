const $ = (selector) => document.querySelector(selector);
const screens = {
  gate: $('#gateScreen'),
  registration: $('#registrationScreen'),
  game: $('#gameScreen'),
  result: $('#resultScreen')
};
const canvas = $('#gameCanvas');
const ctx = canvas.getContext('2d');

let accessToken = sessionStorage.getItem('friendship_run_access') || '';
let attemptToken = '';
let player = null;
let snake = [];
let food = {x: 0, y: 0};
let direction = {x: 1, y: 0};
let queuedDirection = {x: 1, y: 0};
let score = 0;
let timer = null;
let running = false;
let startedAt = 0;
const cells = 30;
const grid = canvas.width / cells;

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
  const message = $('#accessMessage');
  const button = event.currentTarget.querySelector('button');
  message.textContent = 'Checking...';
  button.disabled = true;
  try {
    const data = await request('auth', {method:'POST', body:JSON.stringify({password:$('#accessPassword').value})});
    accessToken = data.token;
    sessionStorage.setItem('friendship_run_access', accessToken);
    event.currentTarget.reset();
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

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the selected image.'));
    reader.readAsDataURL(file);
  });
}

$('#registrationForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = $('#registrationMessage');
  const button = form.querySelector('button');
  message.textContent = 'Confirming payment...';
  button.disabled = true;
  try {
    const file = $('#playerPhoto').files[0];
    if (file && (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 400 * 1024)) {
      throw new Error('Profile picture must be JPG, PNG, or WEBP and 400 KB or smaller.');
    }
    const data = await request('register', {
      method:'POST',
      body:JSON.stringify({
        name:$('#playerName').value.trim(),
        student_id:$('#studentId').value.trim(),
        staff_pin:$('#staffPin').value,
        consent:$('#scoreConsent').checked,
        photo_data:file ? await fileToDataUrl(file) : null
      })
    });
    player = data.player;
    attemptToken = data.attempt_token;
    $('#currentPlayer').textContent = player.name;
    $('#bestValue').textContent = String(data.top_score || 0).padStart(3,'0');
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
  snake = [{x:9,y:15},{x:8,y:15},{x:7,y:15},{x:6,y:15}];
  placeFood();
  $('#scoreValue').textContent = '000';
  $('#speedLabel').textContent = 'SPEED 1';
  $('#overlayTitle').textContent = 'READY?';
  $('#overlayText').textContent = 'Use Arrow Keys or WASD.';
  $('#startButton').hidden = false;
  $('#gameOverlay').hidden = false;
  draw();
}

function placeFood() {
  do {
    food = {x:Math.floor(Math.random()*cells), y:Math.floor(Math.random()*cells)};
  } while (snake.some(part => part.x === food.x && part.y === food.y));
}

function draw() {
  ctx.fillStyle = '#c9d69b';
  ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.strokeStyle = 'rgba(42,54,43,.07)';
  for(let i=0;i<=cells;i++){
    ctx.beginPath();ctx.moveTo(i*grid,0);ctx.lineTo(i*grid,canvas.height);ctx.stroke();
    ctx.beginPath();ctx.moveTo(0,i*grid);ctx.lineTo(canvas.width,i*grid);ctx.stroke();
  }
  ctx.fillStyle = '#202a22';
  ctx.fillRect(food.x*grid+5,food.y*grid+5,grid-10,grid-10);
  snake.forEach((part,index)=>{
    ctx.fillStyle = index === 0 ? '#131b15' : '#344137';
    ctx.fillRect(part.x*grid+2,part.y*grid+2,grid-4,grid-4);
    if(index === 0){ctx.fillStyle='#c9d69b';ctx.fillRect(part.x*grid+grid*.64,part.y*grid+grid*.22,4,4)}
  });
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
    $('#scoreValue').textContent=String(score).padStart(3,'0');
    $('#speedLabel').textContent=`SPEED ${speedLevel()}`;
    placeFood();scheduleTick();
  } else snake.pop();
  draw();
}
function changeDirection(next){if(!running)return;if(next.x+direction.x===0&&next.y+direction.y===0)return;queuedDirection=next}
const directions={up:{x:0,y:-1},down:{x:0,y:1},left:{x:-1,y:0},right:{x:1,y:0}};
document.addEventListener('keydown',(event)=>{
  const map={ArrowUp:'up',w:'up',W:'up',ArrowDown:'down',s:'down',S:'down',ArrowLeft:'left',a:'left',A:'left',ArrowRight:'right',d:'right',D:'right'};
  if(map[event.key]){event.preventDefault();changeDirection(directions[map[event.key]])}
});
document.querySelectorAll('[data-direction]').forEach(button=>button.addEventListener('pointerdown',()=>changeDirection(directions[button.dataset.direction])));

$('#startButton').addEventListener('click',async()=>{
  $('#startButton').hidden=true;
  for(const value of ['3','2','1','GO!']){
    $('#overlayTitle').textContent=value;
    $('#overlayText').textContent=value==='GO!'?'Good luck!':'';
    await new Promise(resolve=>setTimeout(resolve,value==='GO!'?400:650));
  }
  $('#gameOverlay').hidden=true;
  running=true;
  startedAt=Date.now();
  scheduleTick();
});

async function endGame(){
  if(!running)return;
  running=false;clearInterval(timer);
  $('#gameOverlay').hidden=false;$('#overlayTitle').textContent='GAME OVER';$('#overlayText').textContent='Submitting score...';$('#startButton').hidden=true;
  try{
    const data=await request('score',{method:'POST',body:JSON.stringify({attempt_token:attemptToken,score,duration_ms:Date.now()-startedAt})});
    $('#finalScore').textContent=score;
    $('#resultHeadline').textContent=data.rank?`You placed #${data.rank}`:'Score submitted';
    $('#resultMessage').textContent='Your latest score replaced any previous score for this student ID.';
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
document.addEventListener('fullscreenchange',()=>{$('#fullscreenButton').textContent=document.fullscreenElement?'Exit fullscreen':'Fullscreen'});

function escapeHtml(value=''){return String(value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function avatarMarkup(entry){return entry.photo_url?`<img class="avatar" src="${escapeHtml(entry.photo_url)}" alt="">`:`<div class="avatar">${escapeHtml(entry.name.charAt(0).toUpperCase())}</div>`}
async function loadLeaderboard(){
  try{
    const data=await request('leaderboard');
    const entries=data.entries||[];
    $('#podium').innerHTML=entries.slice(0,3).map(entry=>`<article class="podium-item">${avatarMarkup(entry)}<strong>${escapeHtml(entry.name)}</strong><span>${entry.score}</span></article>`).join('');
    $('#leaderboard').innerHTML=entries.length?entries.map((entry,index)=>`<div class="score-row"><b>${index+1}</b>${avatarMarkup(entry)}<span>${escapeHtml(entry.name)}</span><strong>${entry.score}</strong></div>`).join(''):'<p class="muted">No scores yet.</p>';
    $('#bestValue').textContent=String(entries[0]?.score||0).padStart(3,'0');
  }catch(error){$('#leaderboard').innerHTML=`<p class="muted">${escapeHtml(error.message)}</p>`}
}
$('#refreshLeaderboard').addEventListener('click',loadLeaderboard);
$('#newPlayerButton').addEventListener('click',async()=>{
  $('#registrationForm').reset();
  $('#registrationMessage').textContent='';
  player=null;attemptToken='';
  showScreen('registration');
  await loadLeaderboard();
});
validateExistingToken();
