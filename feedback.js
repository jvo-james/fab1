import { subscribeFeedback, saveFeedback } from './firebase-service.js';
import { sendSubmissionEmails, templateFor } from './email-service.js';
const track=document.querySelector('[data-feedback-track]'),modal=document.querySelector('#feedback-modal'),form=document.querySelector('#feedback-form');
if(track&&modal&&form){
 const esc=(v='')=>String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
 const render=rows=>{track.innerHTML=rows.length?rows.map(r=>`<article class="feedback-card"><div class="feedback-stars" aria-label="${Number(r.rating)} out of 5 stars">${'<i class="fa-solid fa-star" aria-hidden="true"></i>'.repeat(Number(r.rating)||0)}</div><blockquote>“${esc(r.feedback)}”</blockquote><div class="feedback-author"><span>${esc(r.name)}</span></div></article>`).join(''):'<article class="feedback-card feedback-empty"><h3>Reviews coming soon</h3><p>Verified customer feedback will appear here after moderation.</p></article>';};
 subscribeFeedback(render).catch(()=>render([]));
 const labels=[...form.querySelectorAll('[data-star-picker] label')];
 const paint=(count,preview=false)=>labels.forEach((label,index)=>{label.classList.toggle('is-filled',index<count&&!preview);label.classList.toggle('is-preview',index<count&&preview);label.classList.toggle('is-active',!preview&&label.querySelector('input')?.checked);});
 labels.forEach((label,index)=>{label.addEventListener('mouseenter',()=>paint(index+1,true));label.addEventListener('focusin',()=>paint(index+1,true));label.addEventListener('click',()=>{label.querySelector('input').checked=true;paint(index+1);});});
 form.querySelector('[data-star-picker]')?.addEventListener('mouseleave',()=>paint(Number(form.elements.rating?.value)||0));
 form.querySelector('[data-star-picker]')?.addEventListener('focusout',e=>{if(!e.currentTarget.contains(e.relatedTarget))paint(Number(form.elements.rating?.value)||0)});
 const open=()=>{form.reset();paint(0);form.querySelector('[data-feedback-status]').textContent='';form.querySelector('[data-feedback-status]').className='form-status';modal.classList.add('open');document.body.classList.add('modal-open');form.querySelector('input:not([type=hidden])')?.focus();};
 const close=()=>{modal.classList.remove('open');document.body.classList.remove('modal-open');document.querySelector('[data-open-feedback]')?.focus();};
 document.querySelector('[data-open-feedback]')?.addEventListener('click',open);document.querySelector('[data-close-feedback]')?.addEventListener('click',close);modal.addEventListener('click',e=>{if(e.target===modal)close();});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&modal.classList.contains('open'))close();});
form.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!form.reportValidity()) {
    return;
  }

  const button = form.querySelector(
    'button[type="submit"]'
  );

  const status = form.querySelector(
    '[data-feedback-status]'
  );

  button.disabled = true;
  status.className = 'form-status';
  status.textContent = 'Sending for review…';

  try {
    const formData = new FormData(form);

    const data = {
      name: formData.get('name'),
      email: formData.get('email'),
      phone: formData.get('phone') || '',
      rating: Number(formData.get('rating')),
      feedback: formData.get('feedback'),
      website: formData.get('website') || ''
    };

    const reference = await saveFeedback(data);
    let emailDelivered = true;
    try {
      await sendSubmissionEmails({
        type: 'feedback',
        templateId: templateFor('feedback'),
        data,
        userName: data.name,
        userEmail: data.email,
        reference
      });
    } catch (emailError) {
      emailDelivered = false;
      console.error('Feedback confirmation email failed:', emailError);
    }

    status.textContent = emailDelivered
      ? 'Thank you. Your feedback was submitted and confirmation emails were sent.'
      : 'Thank you. Your feedback was submitted. Your email confirmation may be delayed.';

    form.reset();
    paint(0);

    setTimeout(() => {
      close();
    }, 1400);
  } catch (error) {
    console.error('Could not submit feedback:', error);

    status.classList.add('error');

    if (error?.message?.startsWith('EMAILJS_')) {
      status.textContent =
        'Your feedback was saved, but the confirmation emails could not be delivered. Please contact the team if you do not receive one.';
    } else if (error?.message === 'FIREBASE_NOT_CONFIGURED') {
      status.textContent =
        'Online feedback is not configured yet.';
    } else if (
      error?.message === 'FEEDBACK_PERMISSION_DENIED'
    ) {
      status.textContent =
        'Feedback submissions are currently blocked by the database permissions. Please try again after the site is updated.';
    } else if (
      error?.message === 'FEEDBACK_SERVICE_UNAVAILABLE'
    ) {
      status.textContent =
        'The feedback service is temporarily unavailable. Please try again shortly.';
    } else if (
      error?.message?.startsWith('VALIDATION_')
    ) {
      status.textContent =
        'Please check the information you entered and try again.';
    } else {
      status.textContent =
        'Could not submit feedback. Please try again.';
    }
  } finally {
    button.disabled = false;
  }
});
 
  document.querySelector('[data-feedback-prev]')?.addEventListener('click',()=>track.scrollBy({left:-Math.min(track.clientWidth,360),behavior:'smooth'}));document.querySelector('[data-feedback-next]')?.addEventListener('click',()=>track.scrollBy({left:Math.min(track.clientWidth,360),behavior:'smooth'}));
}
