/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

const {setGlobalOptions} = require("firebase-functions");
const {HttpsError, onCall} = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const recognitionSeed = require("./data/recognition-list-2026-07-18.json");

// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
// NOTE: setGlobalOptions does not apply to functions using the v1 API. V1
// functions should each use functions.runWith({ maxInstances: 10 }) instead.
// In the v1 API, each function can only serve one request per container, so
// this will be the maximum concurrent request count.
setGlobalOptions({maxInstances: 10});

admin.initializeApp();

const db = admin.firestore();
const EVENT_ID = "closing-ceremony-2026-07-18";
const RECOGNITION_COLLECTION = "closingCeremonyRecognitionPeople";
const HONORIFICS = [
  "太平紳士",
  "參議員",
  "議員",
  "博士",
  "教授",
  "校長",
  "主席",
  "會長",
  "先生",
  "女士",
  "小姐",
  "MH",
  "M.H.",
  "JP",
  "SBS",
  "BBS",
  "GBS",
];

const assertSignedIn = (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Sign in is required.");
  }
  return uid;
};

const getPermissionLevel = async (uid) => {
  const member = await db.collection("members").doc(uid).get();
  const memberData = member.data() || {};
  return Number(memberData.permissionLevel || 0);
};

const assertLevelThree = async (uid) => {
  const permissionLevel = await getPermissionLevel(uid);
  if (permissionLevel !== 3) {
    throw new HttpsError(
        "permission-denied",
        "Level 3 staff access is required.",
    );
  }
};

const normalizeRecognitionName = (value = "") => {
  let next = String(value || "").normalize("NFKC").trim().toLowerCase();
  next = next.replace(/\([^)]*\)|（[^）]*）/g, "");
  HONORIFICS.forEach((honorific) => {
    next = next.replaceAll(honorific.toLowerCase(), "");
  });
  return next.replace(/[\s\u3000·・,，、.。:：;；\-/\\]+/g, "");
};

exports.seedClosingCeremonyRecognition = onCall(async (request) => {
  const uid = assertSignedIn(request);
  await assertLevelThree(uid);

  const now = admin.firestore.Timestamp.now();
  let created = 0;
  let updated = 0;

  for (let index = 0; index < recognitionSeed.length; index += 400) {
    const batch = db.batch();
    const chunk = recognitionSeed.slice(index, index + 400);
    const snapshots = await Promise.all(
        chunk.map((person) =>
          db.collection(RECOGNITION_COLLECTION).doc(person.id).get(),
        ),
    );

    chunk.forEach((person, offset) => {
      const ref = db.collection(RECOGNITION_COLLECTION).doc(person.id);
      const exists = snapshots[offset].exists;
      const base = {
        eventId: EVENT_ID,
        sourceRow: Number(person.sourceRow || 0),
        sequence: Number(person.sequence || 0),
        displayName: String(person.displayName || "").slice(0, 240),
        matchName: String(person.matchName || "").slice(0, 60),
        matchKey: normalizeRecognitionName(person.matchName || ""),
        isActive: person.isActive !== false,
        updatedAt: now,
        updatedByUid: uid,
      };
      batch.set(ref, exists ? base : {
        ...base,
        arrivedAt: null,
        arrivedByUid: "",
        arrivalSource: "",
        introducedRound: 0,
        introducedAt: null,
        introducedByUid: "",
        createdAt: now,
        createdByUid: uid,
      }, {merge: true});
      if (exists) updated += 1;
      else created += 1;
    });

    await batch.commit();
  }

  logger.info("Seeded closing ceremony recognition list", {
    eventId: EVENT_ID,
    created,
    updated,
    total: recognitionSeed.length,
    uid,
  });

  return {eventId: EVENT_ID, created, updated, total: recognitionSeed.length};
});

exports.autoCheckInClosingCeremonyRecognition = onCall(async (request) => {
  const uid = assertSignedIn(request);
  const registration = await db.collection("closingCeremonyRegistrations")
      .doc(uid).get();
  const registrationData = registration.data() || {};
  if (!registration.exists || registrationData.eventId !== EVENT_ID) {
    throw new HttpsError(
        "failed-precondition",
        "Event registration is required.",
    );
  }

  const attendeeName = String(registrationData.attendeeName || "");
  const matchKey = normalizeRecognitionName(attendeeName);
  if (!matchKey || matchKey === normalizeRecognitionName("訪客 / Guest")) {
    return {status: "skipped", reason: "no-name"};
  }

  const snapshot = await db.collection(RECOGNITION_COLLECTION)
      .where("matchKey", "==", matchKey)
      .get();
  const matches = snapshot.docs
      .filter((docSnapshot) => {
        const person = docSnapshot.data() || {};
        return person.eventId === EVENT_ID && person.isActive !== false;
      })
      .slice(0, 2);

  if (!matches.length) {
    return {status: "no-match"};
  }

  if (matches.length > 1) {
    logger.warn(
        "Recognition auto check-in skipped because match is ambiguous",
        {eventId: EVENT_ID, uid, matchKey},
    );
    return {status: "ambiguous"};
  }

  const personRef = matches[0].ref;
  const checkedIn = await db.runTransaction(async (transaction) => {
    const person = await transaction.get(personRef);
    const personData = person.data() || {};
    if (!person.exists || personData.arrivedAt) return false;

    transaction.update(personRef, {
      arrivedAt: admin.firestore.FieldValue.serverTimestamp(),
      arrivedByUid: uid,
      arrivalSource: "event-name",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedByUid: uid,
    });
    return true;
  });

  return {status: checkedIn ? "checked-in" : "already-arrived"};
});

// exports.helloWorld = onRequest((request, response) => {
//   logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });
