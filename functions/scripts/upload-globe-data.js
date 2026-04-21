const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

const DEFAULT_PROJECT_ID = "blueskyreturns";
const BATCH_LIMIT = 400;

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

async function deleteCollection(db, collectionName) {
  const snapshot = await db.collection(collectionName).get();
  if (snapshot.empty) return 0;

  let deleted = 0;
  for (const docs of chunk(snapshot.docs, BATCH_LIMIT)) {
    const batch = db.batch();
    docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    deleted += docs.length;
  }
  return deleted;
}

async function writeEvents(db, events) {
  for (const docs of chunk(events, BATCH_LIMIT)) {
    const batch = db.batch();
    docs.forEach((event, index) => {
      const eventId =
        event.id ||
        `${event.mode || "event"}-${event.year || "unknown"}-${index}-${Date.now()}`;
      batch.set(db.collection("globeEvents").doc(eventId), {
        ...event,
        id: eventId,
      }, {merge: true});
    });
    await batch.commit();
  }
}

async function main() {
  const fileArg = getArgValue("--file", path.join("..", "data.json"));
  const projectId = getArgValue("--project", process.env.GCLOUD_PROJECT || DEFAULT_PROJECT_ID);
  const absolutePath = path.resolve(__dirname, fileArg);
  const shouldReset = hasFlag("--reset");

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Data file not found: ${absolutePath}`);
  }

  const raw = fs.readFileSync(absolutePath, "utf8");
  const parsed = JSON.parse(raw);
  const events = Array.isArray(parsed.events) ? parsed.events : [];

  if (!events.length) {
    throw new Error("No events found in data file.");
  }

  admin.initializeApp({projectId});
  const db = admin.firestore();

  console.log(`Uploading ${events.length} globe events to project ${projectId}...`);
  console.log(`Source file: ${absolutePath}`);

  if (shouldReset) {
    const deleted = await deleteCollection(db, "globeEvents");
    console.log(`Deleted ${deleted} existing globeEvents documents.`);
  }

  await writeEvents(db, events);

  const siteConfig = {
    ...(parsed.config || {}),
    meta: parsed.meta || null,
    sourceFile: path.basename(absolutePath),
    eventCount: events.length,
    uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await db.collection("siteConfig").doc("globe").set(siteConfig, {merge: true});

  console.log("Upload complete.");
  console.log("Updated documents:");
  console.log("- collection: globeEvents");
  console.log("- doc: siteConfig/globe");
  console.log("");
  console.log("Examples:");
  console.log("npm --prefix functions run upload:globe-data");
  console.log("npm --prefix functions run upload:globe-data -- --reset");
  console.log("npm --prefix functions run upload:globe-data -- --file ../data.json");
}

main().catch((error) => {
  console.error("Upload failed.");
  console.error(error);
  process.exitCode = 1;
});
