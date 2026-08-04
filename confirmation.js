import { subscribeConfirmationSettings } from './firebase-service.js';
const type=document.body.dataset.confirmationType;
const defaults={
 booking:{eyebrow:'Deposit received',title:'Thank you. Your £25 deposit has been paid.',message:"Your selected slot is reserved. FAUSTINA'S SPARKLY SERVICES will review the booking information and communicate the actual service price before the clean. The £25 deposit will be taken into account when the final amount due is confirmed.",next:'We normally respond within one working day. Please keep your booking reference and Stripe receipt handy.'},
 application:{eyebrow:'Application received',title:'Thank you for applying to join our team.',message:'Your application has been sent securely to the recruitment team for review.',next:'Shortlisted applicants will be contacted using the email address or phone number supplied.'}
};
let detail=type==='booking'?JSON.parse(sessionStorage.getItem('fab-booking-confirmation')||'{}'):JSON.parse(sessionStorage.getItem('fab-application-confirmation')||'{}');
let currentSettings=null;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function apply(settings=currentSettings){
 currentSettings=settings||currentSettings;
 const copy={...defaults[type],...(currentSettings?.[type]||{})};
 document.querySelector('[data-confirm-eyebrow]').textContent=copy.eyebrow;
 document.querySelector('[data-confirm-title]').textContent=copy.title;
 document.querySelector('[data-confirm-message]').textContent=copy.message;
 document.querySelector('[data-confirm-next]').textContent=copy.next;
 const grid=document.querySelector('[data-confirm-details]');
 const rows=type==='booking'?
 [['Reference',detail.reference],['Name',detail.name],['Service',detail.service],['Date',detail.date],['Preferred time',detail.time],['Deposit paid',detail.depositPaid?'£25':detail.deposit],['Payment status',detail.paymentStatus],['Confirmation email',detail.email]]:
 [['Applicant',detail.name],['Role',detail.role],['Email',detail.email]];
 grid.innerHTML=rows.filter(([,v])=>v).map(([k,v])=>`<div><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('');
 if(!grid.innerHTML)grid.innerHTML='<p>Your submission was received successfully.</p>';
}
async function loadPaidBooking(){
 if(type!=='booking')return;
 const sessionId=new URLSearchParams(location.search).get('session_id');
 if(!sessionId)return;
 const next=document.querySelector('[data-confirm-next]');
 next.textContent='Confirming your payment securely…';
 for(let attempt=0;attempt<5;attempt+=1){
  try{
   const response=await fetch(`/.netlify/functions/get-checkout-status?session_id=${encodeURIComponent(sessionId)}`,{headers:{Accept:'application/json'}});
   const result=await response.json();
   if(response.ok&&result.booking){
    detail=result.booking;
    sessionStorage.setItem('fab-booking-confirmation',JSON.stringify(detail));
    apply();
    return;
   }
  }catch(error){console.warn('Payment status check failed.',error);}
  await new Promise(resolve=>setTimeout(resolve,900));
 }
 next.textContent='Your Stripe payment was received. If the booking details do not appear yet, use the reference in your Stripe receipt when contacting the team.';
}
apply(null);
subscribeConfirmationSettings(settings=>apply(settings)).catch(()=>{});
loadPaidBooking();
