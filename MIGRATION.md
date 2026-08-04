# Migration notes

This rebuild changes availability document IDs from `YYYY-MM-DD_slot` to `region_YYYY-MM-DD_slot` and replaces `feedback` with `feedbackSubmissions` plus `publicFeedback`.

Before production deployment:
1. Export Firestore as a backup.
2. Recreate future availability through the admin dashboard for each region.
3. Review old feedback manually and copy only approved display fields (`name`, `rating`, `feedback`) into `publicFeedback`.
4. Do not copy customer email, phone, owner IDs or booking references into public collections.
5. Deploy rules before opening the rebuilt site to visitors.
