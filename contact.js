import { isFirebaseConfigured, submitEnquiry } from './firebase-service.js';
import { sendSubmissionEmails, templateFor } from './email-service.js';

const form = document.querySelector('#contact-form');
if (form) {
  const status = form.querySelector('[data-contact-status]');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const button = form.querySelector('button[type="submit"]');
    const data = Object.fromEntries(new FormData(form).entries());
    button.disabled = true;
    status.textContent = 'Sending…';
    status.className = 'form-status';

    try {
      if (!isFirebaseConfigured) throw new Error('FIREBASE_NOT_CONFIGURED');
      const reference = await submitEnquiry(data);
      let emailDelivered = true;
      try {
        await sendSubmissionEmails({
          type: 'enquiry',
          templateId: templateFor('enquiry'),
          data,
          userName: data.name,
          userEmail: data.email,
          reference
        });
      } catch (emailError) {
        emailDelivered = false;
        console.error('Contact confirmation email failed:', emailError);
      }

      form.reset();
      status.textContent = emailDelivered
        ? "Thanks — your message has been sent to FAUSTINA'S SPARKLY SERVICES. A confirmation email has also been sent to you."
        : "Thanks — your message has been sent to FAUSTINA'S SPARKLY SERVICES. The team has received it; your email confirmation may be delayed.";
      status.className = 'form-status success';
      window.FAB_showToast?.('Message sent', 'The team will review your message during opening hours.');
    } catch (error) {
      console.error('Contact submission failed:', error);
      status.className = 'form-status error';
      status.textContent = error?.message?.startsWith('EMAILJS_')
        ? 'Your message was saved, but the confirmation emails could not be delivered. Please contact us if you do not receive one.'
        : 'The form could not send. Please try again or use WhatsApp, phone or email.';
    } finally {
      button.disabled = false;
    }
  });
}
