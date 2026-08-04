const Stripe = require('stripe');
const { getAdmin } = require('./lib/firebase-admin');
const { json } = require('./lib/booking');
exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'METHOD_NOT_ALLOWED' });
  try {
    const sessionId = event.queryStringParameters?.session_id;
    if (!sessionId || !sessionId.startsWith('cs_')) return json(400, { error: 'INVALID_SESSION' });
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const bookingId = session.metadata?.bookingId;
    if (!bookingId) return json(404, { error: 'BOOKING_NOT_FOUND' });
    const admin = getAdmin();
    const snap = await admin.firestore().collection('bookingRequests').doc(bookingId).get();
    if (!snap.exists) return json(404, { error: 'BOOKING_NOT_FOUND' });
    const b = snap.data();
    const serviceNames = { regular:'Regular clean', kitchen:'Kitchen & bathroom clean', deep:'Deep clean', holiday:'Holiday rental', oneoff:'One-off clean', tenancy:'End of tenancy', oven:'Oven & hob clean', carpet:'Carpet & upholstery' };
    return json(200, { paid: session.payment_status === 'paid', booking: { reference: b.reference, name: `${b.first_name || ''} ${b.last_name || ''}`.trim(), date: b.date, time: b.start || String(b.time_slot || '').replace('-', ':'), service: serviceNames[b.service] || b.service, email: b.email, depositPaid: session.payment_status === 'paid', deposit: '£25', paymentStatus: session.payment_status === 'paid' ? 'Deposit paid' : 'Payment processing' } });
  } catch (error) { console.error('get-checkout-status', error); return json(500, { error: 'STATUS_LOOKUP_FAILED' }); }
};
