const Stripe = require('stripe');
const { getAdmin } = require('./lib/firebase-admin');

async function sendEmailJS(booking) {
  const { EMAILJS_SERVICE_ID, EMAILJS_BOOKING_TEMPLATE_ID, EMAILJS_PUBLIC_KEY, EMAILJS_ADMIN_EMAIL } = process.env;
  if (!EMAILJS_SERVICE_ID || !EMAILJS_BOOKING_TEMPLATE_ID || !EMAILJS_PUBLIC_KEY) return;
  const details = `Reference: ${booking.reference}\nService: ${booking.service}\nDate: ${booking.date}\nTime: ${booking.time_slot}\nDeposit paid: £25\nActual service price: to be communicated after review`;
  const common = { ...booking, submission_type: 'booking', submission_label: 'Paid booking deposit', reference: booking.reference, user_name: `${booking.first_name} ${booking.last_name}`.trim(), user_email: booking.email, admin_email: EMAILJS_ADMIN_EMAIL || '', reply_to: booking.email, details, message: details, deposit_amount: '£25', payment_status: 'Deposit paid', actual_price_note: 'The actual service price will be communicated after the booking details are reviewed.' };
  const recipients = [
    { ...common, to_email: EMAILJS_ADMIN_EMAIL, to_name: "FAUSTINA'S SPARKLY SERVICES", recipient_type: 'admin', email_subject: `£25 deposit paid — ${booking.reference}` },
    { ...common, to_email: booking.email, to_name: common.user_name, recipient_type: 'user', email_subject: `Deposit received — ${booking.reference}` }
  ].filter(x => x.to_email);
  await Promise.allSettled(recipients.map(template_params => fetch('https://api.emailjs.com/api/v1.0/email/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service_id: EMAILJS_SERVICE_ID, template_id: EMAILJS_BOOKING_TEMPLATE_ID, user_id: EMAILJS_PUBLIC_KEY, template_params }) })));
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const signature = event.headers['stripe-signature'];
    const rawBody = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : event.body;
    const stripeEvent = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
    const admin = getAdmin();
    const db = admin.firestore();
    const session = stripeEvent.data.object;
    const bookingId = session?.metadata?.bookingId;
    if (!bookingId) return { statusCode: 200, body: 'No booking metadata' };
    const bookingRef = db.collection('bookingRequests').doc(bookingId);

    if (stripeEvent.type === 'checkout.session.completed' && session.payment_status === 'paid') {
      let bookingData;
      await db.runTransaction(async transaction => {
        const bookingSnap = await transaction.get(bookingRef);
        if (!bookingSnap.exists) throw new Error('BOOKING_NOT_FOUND');
        bookingData = bookingSnap.data();
        const lockRef = db.collection('slotLocks').doc(`${bookingData.region}_${bookingData.date}_${bookingData.time_slot}`);
        transaction.update(bookingRef, { status: 'deposit_paid', paymentStatus: 'deposit_paid', depositStatus: 'paid', depositAmount: 25, amountPaid: 25, stripePaymentIntentId: session.payment_intent || '', paidAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
        transaction.set(lockRef, { date: bookingData.date, slotId: bookingData.time_slot, region: bookingData.region, status: 'requested', bookingId, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      });
      if (!bookingData.depositEmailSent) {
        await sendEmailJS(bookingData).catch(error => console.error('EmailJS webhook email failed', error));
        await bookingRef.update({ depositEmailSent: true, updatedAt: admin.firestore.FieldValue.serverTimestamp() }).catch(() => {});
      }
    }

    if (['checkout.session.expired','checkout.session.async_payment_failed'].includes(stripeEvent.type)) {
      await db.runTransaction(async transaction => {
        const bookingSnap = await transaction.get(bookingRef);
        if (!bookingSnap.exists) return;
        const booking = bookingSnap.data();
        if (booking.depositStatus === 'paid') return;
        const lockRef = db.collection('slotLocks').doc(`${booking.region}_${booking.date}_${booking.time_slot}`);
        const lockSnap = await transaction.get(lockRef);
        transaction.update(bookingRef, { status: 'deposit_not_paid', paymentStatus: 'failed', depositStatus: 'failed', updatedAt: admin.firestore.FieldValue.serverTimestamp() });
        if (lockSnap.exists && lockSnap.data()?.bookingId === bookingId) transaction.set(lockRef, { ...lockSnap.data(), status: 'available', bookingId: admin.firestore.FieldValue.delete(), expiresAt: admin.firestore.FieldValue.delete(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      });
    }
    return { statusCode: 200, body: 'ok' };
  } catch (error) {
    console.error('stripe-webhook', error);
    return { statusCode: 400, body: `Webhook error: ${error.message}` };
  }
};
