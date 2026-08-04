# Deposit and Netlify update

- Added booking step 5 for a fixed £25 Stripe deposit.
- Added Netlify Functions for Checkout creation, webhook verification and payment-status retrieval.
- Added 30-minute slot holds before payment and verified `deposit_paid` status after payment.
- Updated booking confirmation, legal copy, admin booking fields, revenue handling and EmailJS payment messages.
- Added month-wide availability controls that preserve occupied slots.
- Removed the previous Firebase Cloud Functions folder; Firebase remains the database and admin-auth provider.
