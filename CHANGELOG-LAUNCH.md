# Launch rebuild changes

- Removed browser-controlled Stripe checkout and all payment-success claims.
- Previously changed booking language to a request-first workflow; superseded by CHANGELOG-DEPOSIT-NETLIFY.md, which introduces the fixed £25 Stripe deposit.
- Removed customer PII from publicly readable availability documents.
- Added explicit Firestore field allowlists, length checks and option validation.
- Split private review submissions from public display reviews.
- Added admin review publishing/unpublishing and removed insecure local-owner editing.
- Removed sample testimonials.
- Replaced public email endpoint with a trusted Firestore trigger.
- Added regional slot identifiers to reduce impossible cross-city scheduling.
- Added honeypot fields, client validation utilities and App Check deployment guidance.
- Added reduced-motion support, stronger focus visibility, status announcements and modal keyboard handling.
- Reconciled README, setup instructions, privacy wording and booking confirmation copy.
