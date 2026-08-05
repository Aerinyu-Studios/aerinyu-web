const $=selector=>document.querySelector(selector);
const esc=(value='')=>String(value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
let adminKey=sessionStorage.getItem('friendship_run_admin_key')||'';
let records=[],auditEvents=[],totals={};

async function api(){
  const response=await fetch('/api/friendship-run/admin',{headers:{'x-admin-key':adminKey}});
  const body=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(body.error||'Could not load audit records.');
  return body;
}
const money=value=>`MYR ${Number(value||0).toFixed(2)}`;
const typeLabel=row=>row.attempt_type==='trial'?'Free trial':row.eligibility_source==='run_signup'?'Run signup entitlement':'Booth payment';
const methodLabel=row=>row.payment_method==='cash'?'Cash':row.payment_method==='digital'?'Digital':row.payment_method==='run_signup'?'Run signup':'None';

function renderStats(){
  const items=[
    ['Funds collected',money(totals.booth_funds),'Cash + digital booth payments'],
    ['Cash',money(totals.cash_funds),'Recorded cash collections'],
    ['Digital',money(totals.digital_funds),'Recorded digital receipts'],
    ['Run signups',totals.run_signup_attempts||0,'Official attempts with no booth fee'],
    ['Free trials',totals.free_trials||0,'Practice codes issued'],
    ['Redeemed',totals.redeemed_codes||0,'Codes used by players'],
    ['Unused',totals.unused_codes||0,'Codes still available'],
    ['All records',totals.total_records||0,'Retained audit entries']
  ];
  $('#auditStats').innerHTML=items.map(([label,value,help],i)=>`<article class="audit-stat ${i===0?'primary':''}"><span>${label}</span><strong>${value}</strong><small>${help}</small></article>`).join('');
}

function filteredRecords(){
  const q=$('#auditSearch').value.trim().toLowerCase(),booth=$('#auditBooth').value,type=$('#auditType').value,method=$('#auditMethod').value,status=$('#auditStatus').value;
  return records.filter(row=>{
    const hay=`${row.student_id} ${row.play_code} ${row.operator_name||''} ${row.operator_username||''} ${row.audit_note||''}`.toLowerCase();
    const recordType=row.attempt_type==='trial'?'trial':row.eligibility_source;
    return (!q||hay.includes(q))&&(!booth||String(row.booth_id||1)===booth)&&(!type||recordType===type)&&(!method||row.payment_method===method)&&(!status||row.status===status);
  });
}

function renderRecords(){
  const rows=filteredRecords();
  $('#auditRecordCount').textContent=`${rows.length} record${rows.length===1?'':'s'}`;
  $('#auditRecords').innerHTML=rows.length?rows.map(row=>`<article class="audit-record" data-proof-id="${row.id}">
    <button class="audit-proof-thumb" type="button" ${row.proof_url?'':'disabled'}>${row.proof_url?`<img src="${esc(row.proof_url)}" alt="Evidence for ${esc(row.student_id)}">`:'<span>No image required</span>'}</button>
    <div class="audit-record-main"><div class="audit-record-title"><strong>${esc(row.student_id)}</strong><span class="audit-status ${esc(row.status)}">${esc(row.status)}</span></div><p>${typeLabel(row)} · ${methodLabel(row)} · Booth ${Number(row.booth_id||1)}</p><small>${new Date(row.created_at).toLocaleString()}</small>${row.audit_note?`<blockquote>${esc(row.audit_note)}</blockquote>`:''}</div>
    <div class="audit-record-code"><span>PLAY CODE</span><strong>${esc(row.play_code)}</strong><small>${row.score==null?'No score yet':`Score ${row.score}`}</small></div>
    <div class="audit-record-money"><span>AMOUNT</span><strong>${money(row.amount_collected)}</strong><small>${esc(row.operator_name||'Unknown staff')} · ${esc(row.operator_username||'—')}</small></div>
  </article>`).join(''):'<div class="audit-empty">No records match these filters.</div>';
  document.querySelectorAll('.audit-proof-thumb:not(:disabled)').forEach(button=>button.addEventListener('click',()=>openProof(button.closest('[data-proof-id]').dataset.proofId)));
}

function renderBreakdowns(){
  $('#auditBoothBreakdown').innerHTML=[1,2].map(id=>{const row=totals.by_booth?.[id]||totals.by_booth?.[String(id)]||{};return `<article><div><strong>Booth ${id}</strong><span>${row.records||0} records</span></div><b>${money(row.funds)}</b><small>${row.free_trials||0} trials · ${row.run_signups||0} run signups · ${row.redeemed||0} redeemed</small></article>`}).join('');
  const operators=totals.by_operator||[];
  $('#auditOperatorBreakdown').innerHTML=operators.length?operators.map(row=>`<article><div><strong>${esc(row.name)}</strong><span>${esc(row.username)}</span></div><b>${row.records} records</b><small>${money(row.funds)} · ${row.free_trials} trials · ${row.run_signups} signups</small></article>`).join(''):'<p>No staff activity yet.</p>';
  $('#auditEvents').innerHTML=auditEvents.slice(0,30).map(event=>`<article><strong>${esc(String(event.event_type||'').replaceAll('_',' '))}</strong><span>${new Date(event.created_at).toLocaleString()}</span><small>${esc(event.operator_name||event.student_id_normalized||'System')}</small></article>`).join('')||'<p>No audit events yet.</p>';
}

function openProof(id){
  const row=records.find(item=>item.id===id);if(!row?.proof_url)return;
  $('#auditProofImage').src=row.proof_url;$('#auditProofTitle').textContent=`${row.student_id} · ${typeLabel(row)}`;
  $('#auditProofMeta').innerHTML=`<span>Booth ${Number(row.booth_id||1)}</span><span>${methodLabel(row)}</span><span>${money(row.amount_collected)}</span><span>${esc(row.operator_name||'Unknown staff')}</span><span>${new Date(row.created_at).toLocaleString()}</span>`;
  $('#auditProofDialog').showModal();
}
function closeProof(){if($('#auditProofDialog').open)$('#auditProofDialog').close()}

async function load(){
  const data=await api();records=data.payments||[];auditEvents=data.audit||[];totals=data.totals||{};
  renderStats();renderRecords();renderBreakdowns();$('#auditExport').hidden=false;
}
function csvCell(value){return `"${String(value??'').replaceAll('"','""')}"`}
function exportCsv(){
  const header=['Created','Booth','Student ID','Play code','Attempt type','Eligibility','Payment method','Amount','Status','Staff username','Staff name','Score','Evidence kind','Proof path','Audit note'];
  const lines=[header,...filteredRecords().map(row=>[row.created_at,row.booth_id||1,row.student_id,row.play_code,row.attempt_type,row.eligibility_source,row.payment_method,row.amount_collected,row.status,row.operator_username,row.operator_name,row.score,row.evidence_kind,row.proof_path,row.audit_note])].map(row=>row.map(csvCell).join(','));
  const blob=new Blob([lines.join('\n')],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`friendship-run-booth-audit-${new Date().toISOString().slice(0,10)}.csv`;a.click();URL.revokeObjectURL(url);
}

$('#auditAuthForm').addEventListener('submit',async event=>{event.preventDefault();adminKey=$('#auditKey').value;$('#auditAuthMessage').textContent='Loading records…';try{await load();sessionStorage.setItem('friendship_run_admin_key',adminKey);$('#auditAuth').hidden=true;$('#auditPanel').hidden=false}catch(error){$('#auditAuthMessage').textContent=error.message}});
['auditSearch','auditBooth','auditType','auditMethod','auditStatus'].forEach(id=>$('#'+id).addEventListener(id==='auditSearch'?'input':'change',renderRecords));
$('#auditRefresh').addEventListener('click',load);$('#auditExport').addEventListener('click',exportCsv);$('#auditProofClose').addEventListener('click',closeProof);$('#auditProofDialog').addEventListener('click',event=>{if(event.target===$('#auditProofDialog'))closeProof()});
if(adminKey)load().then(()=>{$('#auditAuth').hidden=true;$('#auditPanel').hidden=false}).catch(()=>sessionStorage.removeItem('friendship_run_admin_key'));
