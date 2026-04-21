const admin = require("firebase-admin");

const DEFAULT_PROJECT_ID = "blueskyreturns";
const BATCH_LIMIT = 300;

function getArgValue(flag, fallback) {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index === process.argv.length - 1) return fallback;
  return process.argv[index + 1];
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

function buildReviewDocs(member) {
  const contribution = member.organizationContribution || {};
  const sourceMeta = {
    sourceMemberUid: member.uid,
    sourceEmail: member.email || "",
    sourceName: member.name || "",
    sourceRegion: member.region || "",
    sourceChapter: member.chapter || "",
    permissionLevel: member.permissionLevel || 2,
  };

  const candidates = [
    {
      reviewId: `${member.uid}_hope`,
      mode: "hope",
      sourceType: "hope",
      payload: contribution.hope,
    },
    {
      reviewId: `${member.uid}_threat`,
      mode: "crisis",
      sourceType: "threat",
      payload: contribution.threat,
    },
  ];

  return candidates
    .filter((item) => item.payload && (item.payload.title || item.payload.description || item.payload.file))
    .map((item) => ({
      reviewId: item.reviewId,
      data: {
        ...sourceMeta,
        status: "pending",
        mode: item.mode,
        sourceType: item.sourceType,
        title: item.payload.title || "",
        description: item.payload.description || "",
        file: item.payload.file || null,
        coordinates: null,
        date: null,
        category: "organization_submission",
        stats: [],
        reviewNotes: "",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    }));
}

async function clearPendingReviews(db) {
  const snapshot = await db.collection("globeEventReviews").get();
  if (snapshot.empty) return 0;

  let deleted = 0;
  for (const docs of chunk(snapshot.docs, BATCH_LIMIT)) {
    const batch = db.batch();
    docs.forEach((reviewDoc) => batch.delete(reviewDoc.ref));
    await batch.commit();
    deleted += docs.length;
  }
  return deleted;
}

async function main() {
  const projectId = getArgValue("--project", process.env.GCLOUD_PROJECT || DEFAULT_PROJECT_ID);
  const shouldReset = hasFlag("--reset");

  admin.initializeApp({projectId});
  const db = admin.firestore();

  console.log(`Building review queue from organization submissions in project ${projectId}...`);

  if (shouldReset) {
    const deleted = await clearPendingReviews(db);
    console.log(`Deleted ${deleted} existing review documents.`);
  }

  const membersSnapshot = await db.collection("members")
    .where("partnerType", "==", "organization")
    .get();

  if (membersSnapshot.empty) {
    console.log("No organization members found.");
    return;
  }

  const reviewDocs = membersSnapshot.docs.flatMap((memberDoc) => {
    const member = memberDoc.data();
    return buildReviewDocs(member);
  });

  if (!reviewDocs.length) {
    console.log("No organization hope/threat submissions found.");
    return;
  }

  for (const docs of chunk(reviewDocs, BATCH_LIMIT)) {
    const batch = db.batch();
    docs.forEach((reviewDoc) => {
      batch.set(
        db.collection("globeEventReviews").doc(reviewDoc.reviewId),
        reviewDoc.data,
        {merge: true}
      );
    });
    await batch.commit();
  }

  console.log(`Queued ${reviewDocs.length} review documents.`);
  console.log("Collection: globeEventReviews");
  console.log("Access: permissionLevel == 3");
  console.log("");
  console.log("Examples:");
  console.log("npm --prefix functions run queue:organization-events");
  console.log("npm --prefix functions run queue:organization-events -- --reset");
}

main().catch((error) => {
  console.error("Queue build failed.");
  console.error(error);
  process.exitCode = 1;
});
