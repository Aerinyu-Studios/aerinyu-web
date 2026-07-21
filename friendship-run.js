const $ = (selector) => document.querySelector(selector);
const gateScreen = $('#gateScreen');
const app = $('#app');
const accessForm = $('#accessForm');
const accessMessage = $('#accessMessage');
const registrationForm = $('#registrationForm');
const registrationMessage = $('#registrationMessage');
const registrationPanel = $('#registrationPanel');
const gamePanel = $('#gamePanel');
const resultPanel = $('#resultPanel');
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
const grid = 20;
const cells = 24;

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
      app.hidden = true;
      gateScreen.hidden = false;
      accessMessage.textContent = 'Your session changed after the latest deployment. Enter the event password again.';
    }
    throw new Error(body.error || 'Request failed.');
  }
  return body;
}

async function unlock(password) {
  const data = await request('auth', {method: 'POST', body: JSON.stringify({password})});
  accessToken = data.token;
  sessionStorage.setItem('friendship_run_access', accessToken);
  gateScreen.hidden = true;
  app.hidden = false;
  loadLeaderboard();
}

accessForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  accessMessage.textContent = 'Checking...';
  try {
    await unlock($('#accessPassword').value);
    accessForm.reset();
  } catch (error) {
    accessMessage.textContent = error.message;
  }
});

async function validateExistingToken() {
  if (!accessToken) return;
  try {
    await request('auth');
    gateScreen.hidden = true;
    app.hidden = false;
    loadLeaderboard();
  } catch {
    sessionStorage.removeItem('friendship_run_access');
    accessToken = '';
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

registrationForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  registrationMessage.textContent = 'Confirming entry...';
  const button = registrationForm.querySelector('button');
  button.disabled = true;
  try {
    const file = $('#playerPhoto').files[0];
    if (file && (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 400 * 1024)) {
      throw new Error('Profile picture must be JPG, PNG, or WEBP and 400 KB or smaller.');
    }
    const photo_data = file ? await fileToDataUrl(file) : null;
    const data = await request('register', {
      method: 'POST',
      body: JSON.stringify({
        name: $('#playerName').value.trim(),
        student_id: $('#studentId').value.trim(),
        staff_pin: $('#staffPin').value,
        consent: $('#scoreConsent').checked,
        photo_data
      })
    });
    player = data.player;
    attemptToken = data.attempt_token;
    $('#currentPlayer').textContent = player.name;
    $('#bestValue').textContent = String(data.best_score || 0).padStart(3, '0');
    registrationPanel.hidden = true;
    gamePanel.hidden = false;
    setStep(2);
    resetGame();
    registrationMessage.textContent = '';
  } catch (error) {
    registrationMessage.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

function setStep(number) {
  document.querySelectorAll('.step').forEach((step, index) => step.classList.toggle('active', index + 1 === number));
}

function resetGame() {
  clearInterval(timer);
  running = false;
  score = 0;
  direction = {x: 1, y: 0};
  queuedDirection = {...direction};
  snake = [{x: 8,y:12},{x:7,y:12},{x:6,y:12},{x:5,y:12}];
  placeFood();
  $('#scoreValue').textContent = '000';
  $('#speedLabel').textContent = 'SPEED 1';
  $('#overlayTitle').textContent = 'READY?';
  $('#overlayText').textContent = 'Press start, then use Arrow Keys or WASD.';
  $('#startButton').hidden = false;
  $('#gameOverlay').hidden = false;
  draw();
}

function placeFood() {
  do {
    food = {x: Math.floor(Math.random() * cells), y: Math.floor(Math.random() * cells)};
  } while (snake.some(part => part.x === food.x && part.y === food.y));
}

function draw() {
  ctx.fillStyle = '#c9d69b';
  ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.strokeStyle = 'rgba(42,54,43,.08)';
  for(let i=0;i<=cells;i++){
    ctx.beginPath();ctx.moveTo(i*grid,0);ctx.lineTo(i*grid,canvas.height);ctx.stroke();
    ctx.beginPath();ctx.moveTo(0,i*grid);ctx.lineTo(canvas.width,i*grid);ctx.stroke();
  }
  ctx.fillStyle = '#222c23';
  ctx.fillRect(food.x*grid+4,food.y*grid+4,grid-8,grid-8);
  snake.forEach((part,index)=>{
    ctx.fillStyle = index===0 ? '#151d17' : '#344137';
    ctx.fillRect(part.x*grid+2,part.y*grid+2,grid-4,grid-4);
    if(index===0){ctx.fillStyle='#c9d69b';ctx.fillRect(part.x*grid+12,part.y*grid+5,3,3)}
  });
}

function gameSpeed() { return Math.max(62, 145 - Math.floor(score / 4) * 7); }
function speedLevel() { return Math.min(9, 1 + Math.floor(score / 4)); }

function scheduleTick() {
  clearInterval(timer);
  timer = setInterval(tick, gameSpeed());
}

function tick() {
  direction = queuedDirection;
  const head = {x: snake[0].x + direction.x, y: snake[0].y + direction.y};
  if (head.x < 0 || head.y < 0 || head.x >= cells || head.y >= cells || snake.some(part => part.x === head.x && part.y === head.y)) {
    endGame();
    return;
  }
  snake.unshift(head);
  if (head.x === food.x && head.y === food.y) {
    score += 1;
    $('#scoreValue').textContent = String(score).padStart(3,'0');
    $('#speedLabel').textContent = `SPEED ${speedLevel()}`;
    placeFood();
    scheduleTick();
  } else snake.pop();
  draw();
}

function changeDirection(next) {
  if (!running) return;
  if (next.x + direction.x === 0 && next.y + direction.y === 0) return;
  queuedDirection = next;
}

const directions = {up:{x:0,y:-1},down:{x:0,y:1},left:{x:-1,y:0},right:{x:1,y:0}};
document.addEventListener('keydown', (event) => {
  const keyMap = {ArrowUp:'up',w:'up',W:'up',ArrowDown:'down',s:'down',S:'down',ArrowLeft:'left',a:'left',A:'left',ArrowRight:'right',d:'right',D:'right'};
  if (keyMap[event.key]) { event.preventDefault(); changeDirection(directions[keyMap[event.key]]); }
});
document.querySelectorAll('[data-direction]').forEach(button => button.addEventListener('pointerdown', () => changeDirection(directions[button.dataset.direction])));

$('#startButton').addEventListener('click', async () => {
  $('#startButton').hidden = true;
  for (const value of ['3','2','1','GO!']) {
    $('#overlayTitle').textContent = value;
    $('#overlayText').textContent = value === 'GO!' ? 'Good luck!' : '';
    await new Promise(resolve => setTimeout(resolve, value === 'GO!' ? 450 : 700));
  }
  $('#gameOverlay').hidden = true;
  running = true;
  startedAt = Date.now();
  scheduleTick();
});

async function endGame() {
  if (!running) return;
  running = false;
  clearInterval(timer);
  $('#gameOverlay').hidden = false;
  $('#overlayTitle').textContent = 'GAME OVER';
  $('#overlayText').textContent = 'Submitting your score...';
  $('#startButton').hidden = true;
  try {
    const data = await request('score', {method:'POST',body:JSON.stringify({attempt_token:attemptToken,score,duration_ms:Date.now()-startedAt})});
    $('#finalScore').textContent = score;
    $('#resultHeadline').textContent = data.rank ? `You placed #${data.rank}!` : 'Score submitted!';
    $('#resultMessage').textContent = 'Your result has been added to the live scoreboard.';
  } catch (error) {
    $('#finalScore').textContent = score;
    $('#resultHeadline').textContent = 'Score could not be submitted';
    $('#resultMessage').textContent = error.message;
  }
  gamePanel.hidden = true;
  resultPanel.hidden = false;
  setStep(3);
  loadLeaderboard();
}

function avatarMarkup(entry) {
  return entry.photo_url ? `<img class="avatar" src="${escapeHtml(entry.photo_url)}" alt="">` : `<div class="avatar">${escapeHtml(entry.name.charAt(0).toUpperCase())}</div>`;
}
function escapeHtml(value=''){return String(value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}

async function loadLeaderboard() {
  try {
    const data = await request('leaderboard');
    const entries = data.entries || [];
    const top = entries.slice(0,3);
    $('#podium').innerHTML = top.map((entry,index)=>`<article class="podium-item">${avatarMarkup(entry)}<strong>${escapeHtml(entry.name)}</strong><span>${entry.score}</span></article>`).join('');
    $('#leaderboard').innerHTML = entries.length ? entries.map((entry,index)=>`<div class="score-row"><b>${index+1}</b>${avatarMarkup(entry)}<span>${escapeHtml(entry.name)}</span><strong>${entry.score}</strong></div>`).join('') : '<p class="loading-text">No scores yet. Be the first!</p>';
    $('#bestValue').textContent = String(entries[0]?.score || 0).padStart(3,'0');
  } catch (error) {
    $('#leaderboard').innerHTML = `<p class="loading-text">${escapeHtml(error.message)}</p>`;
  }
}

$('#refreshLeaderboard').addEventListener('click', loadLeaderboard);
$('#newPlayerButton').addEventListener('click', () => {
  registrationForm.reset();
  player = null; attemptToken = '';
  resultPanel.hidden = true; registrationPanel.hidden = false; setStep(1);
  window.scrollTo({top: document.querySelector('.play-shell').offsetTop - 20, behavior:'smooth'});
});

validateExistingToken();
