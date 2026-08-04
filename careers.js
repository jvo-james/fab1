import { isFirebaseConfigured, submitApplication } from './firebase-service.js';
import { sendSubmissionEmails, templateFor } from './email-service.js';

const form = document.querySelector('#career-form');
if (form) {
  const status = form.querySelector('[data-career-status]');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const button = form.querySelector('button[type="submit"]');
    const formData = new FormData(form);
    const areaSelect = form.querySelector('#career-areas');
    const data = Object.fromEntries(formData.entries());
    data.areas = areaSelect ? [...areaSelect.selectedOptions].map((option) => option.value) : [];

    button.disabled = true;
    status.textContent = 'Sending application…';
    status.className = 'form-status';

    try {
      if (!isFirebaseConfigured) throw new Error('FIREBASE_NOT_CONFIGURED');
      const reference = await submitApplication(data);
      let emailDelivered = true;
      try {
        await sendSubmissionEmails({
          type: 'application',
          templateId: templateFor('application'),
          data,
          userName: data.name,
          userEmail: data.email,
          reference
        });
      } catch (emailError) {
        emailDelivered = false;
        console.error('Application confirmation email failed:', emailError);
      }

      sessionStorage.setItem('fab-application-confirmation', JSON.stringify({ name: data.name, role: data.role, email: data.email, reference, emailDelivered }));
      form.reset();
      window.location.href = 'application-success.html';
    } catch (error) {
      console.error('Application submission failed:', error);
      status.className = 'form-status error';
      status.textContent = error?.message?.startsWith('EMAILJS_')
        ? 'Your application was saved, but the confirmation emails could not be delivered. Please contact the team if you do not receive one.'
        : 'The application could not be sent. Please check your connection and try again.';
    } finally {
      button.disabled = false;
    }
  });
}
