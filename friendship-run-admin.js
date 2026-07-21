const $ = selector => document.querySelector(selector);
let adminKey = sessionStorage.getItem('friendship_run_admin_key') || '';
let entries = [], payments = [];
const esc = (value='') => String(value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

async function api(path='',options={}){
  const response=await fetch(`/api/friendship-run/admin${path}`,{...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),'x-admin-key':adminKey,...(options.headers||{})}});
  const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error||'Request failed.');return body;
}

function renderPlayers(){
  const query=$('#adminSearch').value.trim().toLowerCase();
  const filtered=entries.filter(e=>`${e.name} ${e.student_id}`.toLowerCase().includes(query));
  $('#adminEntries').innerHTML=filtered.length?filtered.map(entry=>`<article class="panel fr-admin-entry" data-id="${entry.id}">
    <div class="fr-admin-entry-main">${entry.photo_url?`<img class="admin-avatar" src="${esc(entry.photo_url)}" alt="">`:`<div class="admin-avatar fallback">${esc(entry.name?.[0]||'?')}</div>`}<div><strong>${esc(entry.name)}</strong><span>${esc(entry.student_id)}</span></div></div>
    <div class="fr-admin-meta"><span>Score <b>${entry.best_score??0}</b></span><span>${entry.attempt_used?'Submitted':'Open attempt'}</span></div>
    <div class="fr-admin-actions"><button class="button secondary" data-edit-player>Edit</button><button class="button secondary" data-reset-player>Reset attempt</button><button class="button danger" data-delete-player>Delete</button></div>
  </article>`).join(''):'<p class="empty-copy">No matching player entries.</p>';
  document.querySelectorAll('[data-edit-player]').forEach(b=>b.onclick=editPlayer);
  document.querySelectorAll('[data-reset-player]').forEach(b=>b.onclick=resetPlayer);
  document.querySelectorAll('[data-delete-player]').forEach(b=>b.onclick=deletePlayer);
}

function renderPayments(){
  const query=$('#adminSearch').value.trim().toLowerCase();
  const filtered=payments.filter(p=>`${p.student_id} ${p.play_code} ${p.status}`.toLowerCase().includes(query));
  $('#adminPayments').innerHTML=filtered.length?filtered.map(p=>`<article class="panel payment-entry" data-payment-id="${p.id}">
    <a class="payment-proof" href="${esc(p.proof_url||'#')}" target="_blank" rel="noopener">${p.proof_url?`<img src="${esc(p.proof_url)}" alt="Payment proof">`:'Proof unavailable'}</a>
    <div class="payment-info"><strong>${esc(p.student_id)}</strong><span>Code <b>${esc(p.play_code)}</b></span><small>${new Date(p.created_at).toLocaleString()}</small></div>
    <div class="fr-admin-meta"><span>${esc(p.status)}</span><span>Score <b>${p.score??'-'}</b></span></div>
    <div class="fr-admin-actions"><button class="button secondary" data-regenerate>New code</button><button class="button secondary" data-revoke>${p.status==='revoked'?'Restore':'Revoke'}</button><button class="button danger" data-delete-payment>Delete</button></div>
  </article>`).join(''):'<p class="empty-copy">No matching payment records.</p>';
  document.querySelectorAll('[data-regenerate]').forEach(b=>b.onclick=regeneratePayment);
  document.querySelectorAll('[data-revoke]').forEach(b=>b.onclick=togglePayment);
  document.querySelectorAll('[data-delete-payment]').forEach(b=>b.onclick=deletePayment);
}
function render(){renderPlayers();renderPayments()}
async function load(){const data=await api();entries=data.entries||[];payments=data.payments||[];render()}
async function editPlayer(e){const id=e.target.closest('[data-id]').dataset.id,entry=entries.find(x=>x.id===id);const name=prompt('Player name',entry.name);if(name===null)return;const student_id=prompt('Student ID',entry.student_id);if(student_id===null)return;const score=prompt('Score',String(entry.best_score??0));if(score===null)return;await api(`?id=${id}`,{method:'PATCH',body:JSON.stringify({name,student_id,best_score:Number(score),attempt_used:true})});await load()}
async function resetPlayer(e){const id=e.target.closest('[data-id]').dataset.id;if(!confirm('Reset this attempt and score?'))return;await api(`?id=${id}`,{method:'PATCH',body:JSON.stringify({reset_attempt:true})});await load()}
async function deletePlayer(e){const id=e.target.closest('[data-id]').dataset.id;if(!confirm('Delete this player entry? Payment records will remain.'))return;await api(`?id=${id}`,{method:'DELETE'});await load()}
async function regeneratePayment(e){const id=e.target.closest('[data-payment-id]').dataset.paymentId;if(!confirm('Generate a new six-digit code and extend validity by 30 minutes?'))return;await api(`?type=payment&id=${id}`,{method:'PATCH',body:JSON.stringify({regenerate_code:true})});await load()}
async function togglePayment(e){const card=e.target.closest('[data-payment-id]'),p=payments.find(x=>x.id===card.dataset.paymentId);const status=p.status==='revoked'?'unused':'revoked';await api(`?type=payment&id=${p.id}`,{method:'PATCH',body:JSON.stringify({status})});await load()}
async function deletePayment(e){const id=e.target.closest('[data-payment-id]').dataset.paymentId;if(!confirm('Permanently delete this payment record and proof image?'))return;await api(`?type=payment&id=${id}`,{method:'DELETE'});await load()}
$('#adminAuthForm').addEventListener('submit',async e=>{e.preventDefault();adminKey=$('#adminKey').value;$('#adminAuthMessage').textContent='Checking...';try{await load();sessionStorage.setItem('friendship_run_admin_key',adminKey);$('#adminAuth').hidden=true;$('#adminPanel').hidden=false}catch(error){$('#adminAuthMessage').textContent=error.message}});
$('#adminSearch').addEventListener('input',render);$('#adminRefresh').addEventListener('click',load);
if(adminKey)load().then(()=>{$('#adminAuth').hidden=true;$('#adminPanel').hidden=false}).catch(()=>sessionStorage.removeItem('friendship_run_admin_key'));
