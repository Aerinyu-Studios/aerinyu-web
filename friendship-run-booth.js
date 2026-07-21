const $ = selector => document.querySelector(selector);
let boothToken = sessionStorage.getItem('friendship_run_booth_token') || '';
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
  if (!response.ok) throw new Error(body.error || 'Request failed.');
  return body;
}

function showWorkspace() {
  $('#boothAuth').hidden = true;
  $('#boothWorkspace').hidden = false;
}

$('#boothAuthForm').addEventListener('submit', async event => {
  event.preventDefault();
  const message = $('#boothAuthMessage');
  message.textContent = 'Checking...';
  try {
    const response = await fetch('/api/friendship-run/booth-auth', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({key:$('#boothKey').value})
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Could not unlock booth controls.');
    boothToken = body.token;
    sessionStorage.setItem('friendship_run_booth_token', boothToken);
    showWorkspace();
  } catch (error) { message.textContent = error.message; }
});

async function openCamera() {
  $('#proofCameraMessage').textContent = '';
  try {
    stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
    $('#proofVideo').srcObject = stream;
    $('#proofCameraDialog').showModal();
  } catch { $('#paymentMessage').textContent = 'Camera access is required to record payment proof.'; }
}
function closeCamera() {
  stream?.getTracks().forEach(track => track.stop()); stream = null;
  if ($('#proofCameraDialog').open) $('#proofCameraDialog').close();
}
$('#openProofCamera').addEventListener('click', openCamera);
$('#closeProofCamera').addEventListener('click', closeCamera);
$('#proofCameraDialog').addEventListener('cancel', closeCamera);
$('#captureProof').addEventListener('click', () => {
  const video=$('#proofVideo'), canvas=$('#proofCanvas'), ctx=canvas.getContext('2d');
  const ratio=Math.min(canvas.width/video.videoWidth,canvas.height/video.videoHeight);
  const w=video.videoWidth*ratio,h=video.videoHeight*ratio,x=(canvas.width-w)/2,y=(canvas.height-h)/2;
  ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(video,x,y,w,h);
  proofData=canvas.toDataURL('image/jpeg',.78);
  $('#proofImage').src=proofData;$('#proofImage').hidden=false;$('#proofPlaceholder').hidden=true;
  $('#removeProof').hidden=false;$('#openProofCamera').textContent='Retake payment proof';
  closeCamera();
});
$('#removeProof').addEventListener('click', () => {
  proofData=null;$('#proofImage').hidden=true;$('#proofImage').removeAttribute('src');$('#proofPlaceholder').hidden=false;
  $('#removeProof').hidden=true;$('#openProofCamera').textContent='Take payment proof photo';
});

$('#paymentForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button=event.submitter,message=$('#paymentMessage');button.disabled=true;message.textContent='Saving payment proof...';
  try {
    const data=await call('payment-create',{method:'POST',body:JSON.stringify({student_id:$('#paymentStudentId').value.trim(),proof_data:proofData})});
    $('#generatedCode').textContent=data.payment.play_code;
    $('#codeStudent').textContent=`Student ID: ${data.payment.student_id}`;
    $('#codeEmpty').hidden=true;$('#codeResult').hidden=false;message.textContent='';
  } catch(error) {
    message.textContent=error.message;
    if (/session expired/i.test(error.message)) { sessionStorage.removeItem('friendship_run_booth_token'); boothToken=''; $('#boothWorkspace').hidden=true; $('#boothAuth').hidden=false; }
  } finally { button.disabled=false; }
});

$('#copyCode').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('#generatedCode').textContent);
  $('#copyCode').textContent='Copied'; setTimeout(()=>$('#copyCode').textContent='Copy code',1200);
});
$('#nextPayment').addEventListener('click', () => {
  $('#paymentForm').reset(); proofData=null; $('#proofImage').hidden=true; $('#proofImage').removeAttribute('src');
  $('#proofPlaceholder').hidden=false;$('#removeProof').hidden=true;$('#openProofCamera').textContent='Take payment proof photo';
  $('#codeResult').hidden=true;$('#codeEmpty').hidden=false;$('#paymentMessage').textContent='';$('#paymentStudentId').focus();
});

if (boothToken) showWorkspace();
