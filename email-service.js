const config = window.FAB_CONFIG || {};
const emailConfig = config.emailjs || {};
let initialised = false;

function configured(value) {
  return Boolean(value && !String(value).startsWith('YOUR_'));
}

function ensureEmailJs() {
  if (!window.emailjs) throw new Error('EMAILJS_SDK_UNAVAILABLE');
  if (!configured(emailConfig.publicKey) || !configured(emailConfig.serviceId)) {
    throw new Error('EMAILJS_NOT_CONFIGURED');
  }
  if (!initialised) {
    window.emailjs.init({ publicKey: emailConfig.publicKey });
    initialised = true;
  }
}

function normalise(value) {
  if (Array.isArray(value)) return value.join(', ');
  if (value === null || value === undefined) return '';
  return String(value);
}

function readableDetails(data) {
  return Object.entries(data)
    .filter(([key]) => !['website', 'terms'].includes(key))
    .map(([key, value]) => `${key.replaceAll('_', ' ')}: ${normalise(value)}`)
    .join('\n');
}

export async function sendSubmissionEmails({ type, templateId, data, userName, userEmail, reference = '' }) {
  ensureEmailJs();
  if (!configured(templateId)) throw new Error('EMAILJS_TEMPLATE_NOT_CONFIGURED');
  if (!userEmail) throw new Error('EMAILJS_RECIPIENT_MISSING');

  const adminEmail = emailConfig.adminEmail || config.email;
  if (!adminEmail) throw new Error('EMAILJS_ADMIN_EMAIL_MISSING');

  const typeLabel = ({
    booking: 'Booking request',
    feedback: 'Feedback submission',
    enquiry: 'Contact enquiry',
    application: 'Job application'
  })[type] || 'Website submission';

  const details = readableDetails(data);
  const common = {
    ...data,
    submission_type: type,
    submission_label: typeLabel,
    reference,
    user_name: userName || data.name || data.first_name || 'Customer',
    user_email: userEmail,
    admin_email: adminEmail,
    reply_to: userEmail,
    details,
    message: data.message || data.feedback || data.notes || details,
    business_name: config.businessName || "FAUSTINA'S SPARKLY SERVICES"
  };

  const adminParams = {
    ...common,
    to_email: adminEmail,
    to_name: config.businessName || 'Admin',
    recipient_type: 'admin',
    email_subject: `New ${typeLabel}${reference ? ` — ${reference}` : ''}`
  };

  const userParams = {
    ...common,
    to_email: userEmail,
    to_name: userName || 'Customer',
    recipient_type: 'user',
    email_subject: `${typeLabel} received${reference ? ` — ${reference}` : ''}`
  };

  const sendWithRetry = async (params) => {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await window.emailjs.send(emailConfig.serviceId, templateId, params);
      } catch (error) {
        lastError = error;
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 450));
      }
    }
    throw lastError;
  };

  const results = await Promise.allSettled([
    sendWithRetry(adminParams),
    sendWithRetry(userParams)
  ]);

  const failed = results.filter((result) => result.status === 'rejected');
  if (failed.length) {
    console.error('EmailJS delivery failed:', failed.map((item) => item.reason));
    throw new Error(failed.length === 2 ? 'EMAILJS_BOTH_EMAILS_FAILED' : 'EMAILJS_ONE_EMAIL_FAILED');
  }
}

export function templateFor(type) {
  return ({
    booking: emailConfig.bookingTemplateId,
    feedback: emailConfig.feedbackTemplateId,
    enquiry: emailConfig.enquiryTemplateId,
    application: emailConfig.applicationTemplateId
  })[type] || emailConfig.adminMessageTemplateId;
}
