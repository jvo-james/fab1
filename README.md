# FAUSTINA'S SPARKLY SERVICES

Static website hosted on Netlify, with Firebase Authentication/Firestore, Stripe Checkout, Netlify Functions and EmailJS.

## Booking and payment flow

1. The customer chooses a service, property details, an admin-published date/time, and contact details.
2. Step 5 explains that the customer pays a fixed **£25 booking deposit**.
3. A Netlify Function validates the booking, places a 30-minute hold on the Firestore slot and creates a Stripe Checkout Session.
4. Stripe collects the £25 deposit in GBP.
5. The verified Stripe webhook marks the booking `deposit_paid` and changes the slot from `hold` to `requested`.
6. The admin reviews the booking and communicates the actual service price. The £25 deposit is taken into account when the final amount due is confirmed.

The indicative estimate shown by the website is guidance only and is never used as the Stripe charge amount.

## Required Netlify environment variables

Copy `.env.example` names into Netlify → Site configuration → Environment variables:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `SITE_URL`
- `EMAILJS_SERVICE_ID`
- `EMAILJS_BOOKING_TEMPLATE_ID`
- `EMAILJS_PUBLIC_KEY`
- `EMAILJS_ADMIN_EMAIL`

Do not commit secret values.

## Stripe webhook

Deploy once, then register this endpoint in Stripe:

`https://YOUR-DOMAIN/.netlify/functions/stripe-webhook`

Subscribe to:

- `checkout.session.completed`
- `checkout.session.expired`
- `checkout.session.async_payment_failed`

Copy the endpoint signing secret into `STRIPE_WEBHOOK_SECRET`, then redeploy.

## Firebase

Deploy `firestore.rules` and `firestore.indexes.json`. Public clients can read published availability but cannot create bookings or alter slot locks; Netlify Functions use Firebase Admin credentials for those operations.

## Admin availability

The Availability tab supports individual dates and a bulk option that opens every future day and every default time window in the displayed month. Existing holds, paid deposits, requests and bookings are not overwritten.

## Local development

Install dependencies and run with the Netlify CLI:

```bash
npm install
netlify dev
```
