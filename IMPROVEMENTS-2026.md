# Requested improvements completed

- Refreshed customer and admin calendars to match the supplied reference while retaining the existing FAB colours and wording.
- Added matching availability, selected, booked/requested and unavailable calendar keys.
- Fixed the review star picker so hovering/selecting a star fills every star up to that rating.
- Strengthened feedback submission status handling and kept submitted feedback connected to the admin moderation list.
- Kept bookings, applications, reviews and availability on the same Firestore collections used by the admin dashboard.
- Booking requests atomically reserve their selected slot so it becomes unavailable immediately.
- Added dedicated booking and application confirmation pages.
- Added an admin “Confirmation pages” editor backed by `settings/confirmations` in Firestore.
- Added confirmation detail summaries using the completed submission.

## Deployment note

Deploy both the site and the included Firestore rules so the live Firebase project uses the matching permissions:

```bash
firebase deploy --only hosting,firestore:rules,firestore:indexes
```

The Firebase project must also contain an active admin document at `admins/{uid}` for the administrator account.
