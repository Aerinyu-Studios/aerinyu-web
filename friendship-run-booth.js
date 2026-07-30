const $ = (selector) => document.querySelector(selector);
let boothToken = sessionStorage.getItem('friendship_run_booth_token') || '';
let operator = JSON.parse(sessionStorage.getItem('friendship_run_booth_operator') || 'null');
let proofData = null;
let stream = null;

async function call(path, options = {}) {
  const response = await fetch(`/api/friendship-run/${path}`, {
    ...options,
    headers: {
      ...(options.body ? {'Content-Type':'application/json'} : {}),
      ...(boothToken ? {Authorization:`Bearer ${boothToken}`} : {}),
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) logout(false);
    throw new Error(body.error || 'Request failed.');
  }
  return body;
}

function logout(reload = true) {
  sessionStorage.removeItem('friendship_run_booth_token');
  sessionStorage.removeItem('friendship_run_booth_operator');
  boothToken = ''; operator = null;
  if (reload) location.reload();
}

function showWorkspace() {
  $('#boothAuth').hidden = true;
  $('#boothWorkspace').hidden = false;
  $('#operatorName').textContent = operator?.name || 'Staff member';
  refreshSummary();
}

$('#boothAuthForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = $('#boothAuthMessage');
  const button = event.submitter;
  button.disabled = true; message.textContent = 'Signing in…';
  try {
    const response = await fetch('/api/friendship-run/booth-auth', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({username:$('#boothUsername').value.trim(),password:$('#boothPassword').value})
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Could not sign in.');
    boothToken = body.token; operator = body.operator;
    sessionStorage.setItem('friendship_run_booth_token', boothToken);
    sessionStorage.setItem('friendship_run_booth_operator', JSON.stringify(operator));
    showWorkspace();
  } catch (error) { message.textContent = error.message; }
  finally { button.disabled = false; }
});
$('#boothLogout').addEventListener('click', () => logout());

function selected(name) { return document.querySelector(`input[name="${name}"]:checked`)?.value || ''; }
function updateFormState() {
  const attempt = selected('attemptType');
  const source = selected('eligibilitySource');
  const method = selected('paymentMethod');
  const official = attempt === 'official';
  $('#officialSourceGroup').hidden = !official;
  $('#paymentMethodGroup').hidden = !(official && source === 'booth_payment');
  $('#proofSection').hidden = !official;
  $('#generateCodeButton').textContent = official ? 'Generate official-attempt code' : 'Generate free-trial code';

  if (!official) return;
  if (source === 'run_signup') {
    $('#proofLabel').textContent = 'RUN REGISTRATION PROOF';
    $('#proofTitle').textContent = 'Photograph their Friendship Run registration receipt';
    $('#proofHelp').textContent = 'This verifies the player does not need to pay MYR 3 at the booth.';
    $('#openProofCamera').textContent = proofData ? 'Retake registration proof' : 'Take registration proof photo';
    $('#cameraDialogTitle').textContent = 'Capture registration proof';
  } else if (method === 'cash') {
    $('#proofLabel').textContent = 'CASH PAYMENT EVIDENCE';
    $('#proofTitle').textContent = 'Photograph the cash handover';
    $('#proofHelp').textContent = 'Keep the player and cash visible enough for the transaction to be auditable.';
    $('#openProofCamera').textContent = proofData ? 'Retake cash evidence' : 'Take cash evidence photo';
    $('#cameraDialogTitle').textContent = 'Capture cash payment evidence';
  } else {
    $('#proofLabel').textContent = 'DIGITAL PAYMENT RECEIPT';
    $('#proofTitle').textContent = 'Photograph the successful payment receipt';
    $('#proofHelp').textContent = 'Make sure the transaction confirmation is readable.';
    $('#openProofCamera').textContent = proofData ? 'Retake payment receipt' : 'Take payment receipt photo';
    $('#cameraDialogTitle').textContent = 'Capture payment receipt';
  }
}

document.querySelectorAll('input[name="attemptType"],input[name="eligibilitySource"],input[name="paymentMethod"]').forEach((input) => input.addEventListener('change', () => {
  proofData = null;
  $('#proofImage').hidden = true; $('#proofImage').removeAttribute('src'); $('#proofPlaceholder').hidden = false; $('#removeProof').hidden = true;
  updateFormState();
}));
updateFormState();

async function openCamera() {
  $('#proofCameraMessage').textContent = '';
  try {
    stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
    $('#proofVideo').srcObject = stream;
    $('#proofCameraDialog').showModal();
  } catch { $('#paymentMessage').textContent = 'Camera access is required for the evidence photo.'; }
}
function closeCamera() {
  stream?.getTracks().forEach((track) => track.stop()); stream = null;
  $('#proofVideo').srcObject = null;
  if ($('#proofCameraDialog').open) $('#proofCameraDialog').close();
}
$('#openProofCamera').addEventListener('click', openCamera);
$('#closeProofCamera').addEventListener('click', closeCamera);
$('#proofCameraDialog').addEventListener('cancel', (event) => { event.preventDefault(); closeCamera(); });
$('#captureProof').addEventListener('click', () => {
  const video=$('#proofVideo'), canvas=$('#proofCanvas'), ctx=canvas.getContext('2d');
  if (!video.videoWidth || !video.videoHeight) return;
  const ratio=Math.min(canvas.width/video.videoWidth,canvas.height/video.videoHeight);
  const w=video.videoWidth*ratio,h=video.videoHeight*ratio,x=(canvas.width-w)/2,y=(canvas.height-h)/2;
  ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(video,x,y,w,h);
  proofData=canvas.toDataURL('image/jpeg',.78);
  $('#proofImage').src=proofData;$('#proofImage').hidden=false;$('#proofPlaceholder').hidden=true;$('#removeProof').hidden=false;
  updateFormState(); closeCamera();
});
$('#removeProof').addEventListener('click', () => {
  proofData=null;$('#proofImage').hidden=true;$('#proofImage').removeAttribute('src');$('#proofPlaceholder').hidden=false;$('#removeProof').hidden=true;updateFormState();
});

$('#paymentForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button=event.submitter,message=$('#paymentMessage');
  button.disabled=true;message.textContent='Creating code…';
  try {
    const attemptType=selected('attemptType');
    const eligibilitySource=attemptType==='trial'?'free_trial':selected('eligibilitySource');
    const paymentMethod=eligibilitySource==='booth_payment'?selected('paymentMethod'):eligibilitySource==='run_signup'?'run_signup':'none';
    const data=await call('payment-create',{method:'POST',body:JSON.stringify({
      student_id:$('#paymentStudentId').value.trim(),attempt_type:attemptType,eligibility_source:eligibilitySource,
      payment_method:paymentMethod,proof_data:proofData,note:$('#auditNote').value.trim()
    })});
    const payment=data.payment;
    $('#generatedCode').textContent=payment.play_code;
    $('#codeStudent').textContent=`Student ID: ${payment.student_id}`;
    $('#codeType').textContent=payment.attempt_type==='trial'?'FREE TRIAL':payment.eligibility_source==='run_signup'?'OFFICIAL · RUN SIGNUP':'OFFICIAL · BOOTH PAYMENT';
    $('#codeDescription').textContent=payment.attempt_type==='trial'?'Practice only — this score will not enter the leaderboard.':'Valid for 30 minutes and usable once.';
    $('#codeEmpty').hidden=true;$('#codeResult').hidden=false;message.textContent='';
    await refreshSummary();
  } catch(error) { message.textContent=error.message; }
  finally { button.disabled=false; }
});

$('#copyCode').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('#generatedCode').textContent);
  $('#copyCode').textContent='Copied'; setTimeout(()=>$('#copyCode').textContent='Copy code',1200);
});
$('#nextPayment').addEventListener('click', () => {
  $('#paymentForm').reset();
  document.querySelector('input[name="attemptType"][value="trial"]').checked=true;
  document.querySelector('input[name="eligibilitySource"][value="booth_payment"]').checked=true;
  document.querySelector('input[name="paymentMethod"][value="cash"]').checked=true;
  proofData=null;$('#proofImage').hidden=true;$('#proofImage').removeAttribute('src');$('#proofPlaceholder').hidden=false;$('#removeProof').hidden=true;
  $('#codeResult').hidden=true;$('#codeEmpty').hidden=false;$('#paymentMessage').textContent='';updateFormState();$('#paymentStudentId').focus();
});

function money(value){return `MYR ${Number(value||0).toFixed(0)}`}
function escapeHtml(value=''){return String(value).replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
async function refreshSummary(){
  try{
    const data=await call('booth-summary');
    const t=data.totals||{};
    $('#fundsTotal').textContent=money(t.funds_collected);$('#cashTotal').textContent=money(t.cash_collected);$('#digitalTotal').textContent=money(t.digital_collected);
    $('#cashCount').textContent=`${(data.recent||[]).filter(r=>r.payment_method==='cash').length} recent cash records`;
    $('#digitalCount').textContent=`${(data.recent||[]).filter(r=>r.payment_method==='digital').length} recent digital records`;
    $('#runSignupCount').textContent=t.run_signup_attempts||0;$('#trialCount').textContent=t.free_trials||0;
    $('#auditRows').innerHTML=(data.recent||[]).length?(data.recent||[]).map((row)=>{
      const type=row.attempt_type==='trial'?'Free trial':row.eligibility_source==='run_signup'?'Run signup':'Booth payment';
      const method=row.payment_method==='cash'?'Cash':row.payment_method==='digital'?'Digital':row.payment_method==='run_signup'?'Run signup':'—';
      return `<tr><td>${new Date(row.created_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</td><td>${escapeHtml(row.student_id)}</td><td>${type}</td><td>${method}</td><td>${money(row.amount_collected)}</td><td>${escapeHtml(row.operator_name||'—')}</td><td><span class="audit-status ${escapeHtml(row.status)}">${escapeHtml(row.status)}</span></td></tr>`;
    }).join(''):'<tr><td colspan="7">No booth activity yet.</td></tr>';
  }catch(error){$('#auditRows').innerHTML=`<tr><td colspan="7">${escapeHtml(error.message)}</td></tr>`}
}
$('#refreshAudit').addEventListener('click',refreshSummary);

if (boothToken && operator) showWorkspace();
