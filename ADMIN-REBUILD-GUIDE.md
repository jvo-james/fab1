# Admin Dashboard Rebuild

## What changed

The admin page has been rebuilt into seven work areas containing all eighteen requested improvements:

1. **Overview:** KPIs, recent activity, notifications, upcoming jobs and revenue pulse.
2. **Operations:** booking workflows, schedule views, availability and manual bookings.
3. **People:** customer histories, notes, team profiles and cleaner assignment.
4. **Inbox:** enquiries, applications, reviews and a reusable email centre.
5. **Business:** service/pricing editor, website content, FAQs and announcement banner.
6. **Intelligence:** automations settings, reports, CSV/JSON exports and activity logs.
7. **Control:** archive/restore, administrator roles, inactivity logout and system health.

## Files replaced or added

- `admin.html` — complete dashboard markup.
- `admin.js` — all dashboard workflows and rendering.
- `admin.css` — isolated responsive admin styling.
- `firebase-service.js` — additional secure admin data helpers.
- `firestore.rules` — rules for the new admin-only collections and owner roles.
- `app.js` — applies admin-managed public website settings and announcements.
- `booking.js` — reads active services and prices saved in the admin dashboard.
- `styles.css` — announcement banner styling.
- `config.js` — retains the working EmailJS IDs supplied during setup.

## Firebase deployment required

The updated security rules must be deployed before the new Team, Email Templates, Activity, Archive and Settings features can save data.

From the project folder, run:

```bash
firebase login
firebase use fab-cleaning-new
firebase deploy --only firestore:rules
```

Then deploy the website:

```bash
firebase deploy --only hosting
```

## Admin owner role

For the account that should manage other admin role records, update its Firestore document:

```text
admins/{firebase-auth-user-uid}
```

Recommended fields:

```json
{
  "active": true,
  "email": "faustinaaffumdwamena@gmail.com",
  "role": "owner"
}
```

Existing admin accounts with `active: true` can still sign in. Only `role: "owner"` can create or modify other admin records after deploying the new rules.

## New Firestore data

The dashboard creates these collections/documents as they are used:

- `teamMembers`
- `customerProfiles`
- `emailTemplates`
- `emailHistory`
- `emailDrafts`
- `activityLogs`
- `archives`
- `settings/siteContent`
- `settings/serviceCatalog`
- `settings/automations`
- `settings/security`

No manual creation is required.

## Automation limitation

The Automations page stores the desired automation settings. Immediate emails can still be triggered by existing form/status actions. Timed reminders—such as 24 hours before an appointment—need scheduled Firebase Cloud Functions before they will send without the admin page being open.

## First-use checklist

1. Deploy `firestore.rules`.
2. Open `admin.html` and sign in.
3. Add team members.
4. Review Services & Pricing and click Save after editing.
5. Add saved email templates.
6. Set website details and announcement preferences.
7. Set inactivity and archive preferences in Settings & Security.
8. Run the System Check.
9. Test one booking update, enquiry reply and archive/restore operation.
