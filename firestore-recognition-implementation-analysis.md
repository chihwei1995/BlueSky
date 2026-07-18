# Firestore Recognition Implementation Analysis

Date: 2026-07-18

## Existing Firestore usage found

- `closingCeremonyRegistrations/{uid}` is created by the closing ceremony page after generated email/password auth. Attendees can read/write only their own registration. Level 3 staff can read all registrations.
- `closingCeremonyWorkshopStates/{workshopId}`, `closingCeremonyWorkshopCounters/{workshopId}`, and `closingCeremonyWorkshopTickets/{workshopId}__{uid}` power the workshop queue. Attendees can claim their own tickets after registration. Level 3 staff manages state and ticket status.
- `members/{uid}` stores member profile and `permissionLevel`; level 3 is the staff/admin gate used by existing ceremony control pages.
- Other existing collections include `globeEvents`, `siteConfig`, `globeEventReviews`, `greenProposalSubmissions`, `greenProposalDailySlots`, `memberGlobeSubmissions`, and `memberReferrals`.

## New collections and operations

- `closingCeremonyRecognitionPeople/{personId}`
  - Stores the recognition list for `closing-ceremony-2026-07-18`.
  - Level 3 staff can create, read, edit, mark arrived, and mark introduced.
  - Non-staff users cannot read or write this collection. Auto check-in is handled by a callable Cloud Function so the public event page never receives the full recognition list.

## Query shapes to support

- Staff list pages:
  - List all recognition people ordered client-side by `sequence`.
  - Filter client-side by arrived/introduced/search state.
- Auto check-in callable:
  - Query `closingCeremonyRecognitionPeople` where `matchKey == normalizedRegistrationName`, then filter the 2026-07-18 event and active state server-side.
- Firestore Enterprise native note:
  - Added `firestore.indexes.json` with a single-field `matchKey` index for `closingCeremonyRecognitionPeople`, because Enterprise native does not create indexes by default.

## Rule design notes

- Recognition list documents contain personal names, so reads are limited to level 3 staff.
- Staff write validation requires fixed `eventId`, bounded string sizes, typed integers/booleans/timestamps, and timestamp fields equal to `request.time`.
- Visitor auto check-in is intentionally not allowed by rules. It is performed by Functions Admin SDK after checking the caller is authenticated and has an event registration.
- Deletes are denied for recognition people to preserve audit history; staff can archive by setting `isActive` to false.

## Red-team checks before editing rules

- A normal attendee cannot list the recognition collection because reads require level 3.
- A normal attendee cannot set `arrivedAt` on a recognition record because all client writes require level 3.
- A staff edit cannot inflate unbounded fields because all strings have maximum lengths and the schema is closed with `hasOnly`.
- A staff create/update cannot move the person into another event because `eventId` must equal the fixed 2026-07-18 event id.
- A staff update cannot spoof update time because `updatedAt` must equal `request.time`.

## Firestore rules auditor result

```json
{
  "score": 5,
  "summary": "The new recognition rules keep the recognition list staff-only, use a closed schema, validate types and sizes, keep create/update timestamps tied to request.time, preserve immutable creator fields on update, and deny deletes. Visitor auto check-in is intentionally not exposed through client rules.",
  "findings": []
}
```

Validation command:

`npx -y firebase-tools@latest deploy --only firestore:rules --project blueskyreturns --dry-run`

Result: rules compiled successfully; dry run completed without deploying.

Index validation command:

`npx -y firebase-tools@latest deploy --only firestore:indexes --project blueskyreturns --dry-run`

Result: index config was read and the dry run completed without deploying.

Functions dry-run command:

`npx -y firebase-tools@latest deploy --only functions --project blueskyreturns --dry-run`

Result: source discovery found both callable functions and predeploy lint passed. Firebase CLI still enabled several Functions-related APIs during this dry run and warned that Compute Engine API is not enabled, so a real Functions deployment may need Compute Engine API/service-account setup.
