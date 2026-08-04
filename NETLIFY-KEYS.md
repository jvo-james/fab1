# Keys to add after importing into Netlify

Add these under **Netlify → Site configuration → Environment variables**.

## Before the first deploy

- `STRIPE_SECRET_KEY` — Stripe test secret key (`sk_test_...`) from Stripe Dashboard → Developers → API keys.
- `FIREBASE_SERVICE_ACCOUNT_JSON` — the complete one-line service-account JSON from Firebase Console → Project settings → Service accounts → Generate new private key.
- `SITE_URL` — the deployed Netlify URL, for example `https://your-site.netlify.app`.
- `EMAILJS_SERVICE_ID` — the existing EmailJS service ID.
- `EMAILJS_BOOKING_TEMPLATE_ID` — the existing booking template ID.
- `EMAILJS_PUBLIC_KEY` — the existing EmailJS public key.
- `EMAILJS_ADMIN_EMAIL` — the business email that receives booking notifications.

## After the first deploy

Create the Stripe webhook endpoint:

`https://YOUR-DOMAIN/.netlify/functions/stripe-webhook`

Select these events:

- `checkout.session.completed`
- `checkout.session.expired`
- `checkout.session.async_payment_failed`

Then add:

- `STRIPE_WEBHOOK_SECRET` — the webhook signing secret (`whsec_...`) shown by Stripe.

Redeploy after adding or changing environment variables. Use test keys first, then replace the Stripe test secret and test webhook secret with their live-mode equivalents. Never place secret values in `config.js` or GitHub.
