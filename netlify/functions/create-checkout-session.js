const Stripe = require('stripe');
const { getAdmin } = require('./lib/firebase-admin');
const { DEPOSIT_PENCE, validateBooking, json } = require('./lib/booking');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });
  try {
    if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY_MISSING');
    if (!process.env.SITE_URL) throw new Error('SITE_URL_MISSING');
    const booking = validateBooking(JSON.parse(event.body || '{}'));
    if (!booking.terms || !booking.depositTerms) return json(400, { error: 'TERMS_REQUIRED' });

    const admin = getAdmin();
    const db = admin.firestore();
    const bookingRef = db.collection('bookingRequests').doc();
    const lockRefs = booking.occupiedSlotIds.map(slotId => db.collection('slotLocks').doc(`${booking.region}_${booking.date}_${slotId}`));
    const holdUntil = admin.firestore.Timestamp.fromMillis(Date.now() + 35 * 60 * 1000);

    await db.runTransaction(async transaction => {
      const snapshots = await Promise.all(lockRefs.map(ref => transaction.get(ref)));
      snapshots.forEach(snapshot => {
        if (!snapshot.exists) throw new Error('SLOT_UNAVAILABLE');
        const data = snapshot.data() || {};
        const expiredHold = data.status === 'hold' && data.expiresAt?.toMillis?.() <= Date.now();
        if (data.status !== 'available' && !expiredHold) throw new Error('SLOT_UNAVAILABLE');
      });
      transaction.set(bookingRef, {
        ...booking,
        status: 'awaiting_deposit', paymentStatus: 'pending', depositStatus: 'pending', depositAmount: 25,
        balanceStatus: 'price_to_be_communicated', finalPrice: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(), holdUntil
      });
      lockRefs.forEach((ref, index) => transaction.set(ref, {
        ...snapshots[index].data(), status: 'hold', bookingId: bookingRef.id,
        bookingStart: booking.start, bookingEnd: booking.end, expiresAt: holdUntil,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true }));
    });

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    let session;
    try {
      session = await stripe.checkout.sessions.create({
        mode: 'payment', currency: 'gbp', customer_email: booking.email,
        line_items: [{ quantity: 1, price_data: { currency: 'gbp', unit_amount: DEPOSIT_PENCE, product_data: { name: 'Cleaning booking deposit', description: `£25 deposit for booking ${booking.reference}. The actual service price will be communicated after review.` } } }],
        payment_intent_data: { description: `Booking deposit ${booking.reference}`, metadata: { bookingId: bookingRef.id, reference: booking.reference } },
        metadata: { bookingId: bookingRef.id, reference: booking.reference },
        success_url: `${process.env.SITE_URL.replace(/\/$/, '')}/booking-success.html?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_URL.replace(/\/$/, '')}/booking.html?payment=cancelled`,
        expires_at: Math.floor(Date.now() / 1000) + (31 * 60)
      });
    } catch (error) {
      await db.runTransaction(async transaction => {
        const snapshots = await Promise.all(lockRefs.map(ref => transaction.get(ref)));
        snapshots.forEach((snap, index) => {
          if (snap.exists && snap.data()?.bookingId === bookingRef.id) transaction.set(lockRefs[index], {
            status: 'available', bookingId: admin.firestore.FieldValue.delete(), bookingStart: admin.firestore.FieldValue.delete(), bookingEnd: admin.firestore.FieldValue.delete(), expiresAt: admin.firestore.FieldValue.delete(), updatedAt: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        });
        transaction.update(bookingRef, { status: 'payment_setup_failed', paymentStatus: 'failed', updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      });
      throw error;
    }

    await bookingRef.update({ stripeSessionId: session.id, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    return json(200, { checkoutUrl: session.url });
  } catch (error) {
    console.error('create-checkout-session', error);
    const known = ['SLOT_UNAVAILABLE','TERMS_REQUIRED','MISSING_REQUIRED_DETAILS','INVALID_BOOKING_OPTION','INVALID_DATE','INVALID_EMAIL','DETAIL_TOO_LONG','INVALID_START_TIME','TIME_OUTSIDE_OPENING_HOURS'];
    return json(known.includes(error.message) ? 400 : 500, { error: known.includes(error.message) ? error.message : 'CHECKOUT_FAILED' });
  }
};
