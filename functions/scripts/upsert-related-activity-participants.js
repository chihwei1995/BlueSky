#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const {execFileSync} = require("child_process");

const PROJECT_ID = "blueskyreturns";
const DATABASE_ID = "default";
const TOKEN_PATH = path.join(os.homedir(), ".config", "configstore", "firebase-tools.json");
const APPLY = process.argv.includes("--apply");

const ENTRIES = [
  {
    id: "2026-01-08-launch-exhibition-education",
    titleZh: "實體展覽與教育啟動",
    titleEn: "Exhibition & Education Kickoff",
    dateLabel: "2026-01-08",
    participantCount: 171,
    pointsPerParticipant: 10,
    active: true,
    category: "offline-activity",
    sortOrder: 1
  },
  {
    id: "2026-01-09-climate-museum-interactive",
    titleZh: "氣候變化博物館互動體驗",
    titleEn: "Climate Museum Interactive Experience",
    dateLabel: "2026-01-09",
    participantCount: 24,
    pointsPerParticipant: 10,
    active: true,
    category: "offline-activity",
    sortOrder: 2
  },
  {
    id: "2026-03-08-marine-debris-charity",
    titleZh: "海廢慈善體能挑戰賽",
    titleEn: "Marine Debris Charity Fitness Challenge",
    dateLabel: "2026-03-08",
    participantCount: 3,
    pointsPerParticipant: 10,
    active: true,
    category: "offline-activity",
    sortOrder: 3
  },
  {
    id: "2026-03-18-blue-sky-mileage",
    titleZh: "一同步，跑出藍天里程",
    titleEn: "Blue Sky Mileage Challenge",
    dateLabel: "2026-03-18",
    participantCount: 26,
    pointsPerParticipant: 10,
    active: true,
    category: "offline-activity",
    sortOrder: 4
  },
  {
    id: "2026-04-25-airside-tour",
    titleZh: "AIRSIDE 綠色建築導覽",
    titleEn: "AIRSIDE Green Architecture Tour",
    dateLabel: "2026-04-25",
    participantCount: 10,
    pointsPerParticipant: 10,
    active: true,
    category: "offline-activity",
    sortOrder: 5
  },
  {
    id: "2026-05-07-plant-based-workshop",
    titleZh: "素「食」減碳・包餃子體驗",
    titleEn: "Plant-based Dumpling Carbon Reduction Workshop",
    dateLabel: "2026-05-07",
    participantCount: 32,
    pointsPerParticipant: 10,
    active: true,
    category: "offline-activity",
    sortOrder: 6
  },
  {
    id: "2026-aspac-niigata-forum",
    titleZh: "ASPAC 新潟期間｜永續發展論壇分享",
    titleEn: "ASPAC Niigata Sustainability Forum Sharing",
    dateLabel: "2026 ASPAC",
    participantCount: 80,
    pointsPerParticipant: 10,
    active: true,
    category: "offline-activity",
    sortOrder: 7
  }
];

const readFirebaseConfig = () => JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));

const readFirebaseAccessToken = () => {
  const token = readFirebaseConfig()?.tokens?.access_token;
  if (!token) throw new Error(`Could not find Firebase access token in ${TOKEN_PATH}`);
  return token;
};

const refreshFirebaseAccessToken = () => {
  execFileSync("npx", ["-y", "firebase-tools@latest", "projects:list", "--json"], {stdio: "ignore"});
  return readFirebaseAccessToken();
};

let accessToken = readFirebaseAccessToken();

const encodeValue = (value) => {
  if (value === null || value === undefined) return {nullValue: null};
  if (typeof value === "boolean") return {booleanValue: value};
  if (typeof value === "number") {
    if (Number.isInteger(value)) return {integerValue: String(value)};
    return {doubleValue: value};
  }
  if (typeof value === "string") return {stringValue: value};
  if (Array.isArray(value)) return {arrayValue: {values: value.map((item) => encodeValue(item))}};
  if (typeof value === "object") {
    const fields = {};
    Object.entries(value).forEach(([key, child]) => {
      fields[key] = encodeValue(child);
    });
    return {mapValue: {fields}};
  }
  return {stringValue: String(value)};
};

const fetchJson = async (url, options = {}, allowRefresh = true) => {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  if (response.status === 401 && allowRefresh) {
    accessToken = refreshFirebaseAccessToken();
    return fetchJson(url, options, false);
  }
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }
  return json;
};

const upsertDocument = async (docPath, payload) => {
  const url = new URL(`https://firestore.googleapis.com/v1/${docPath}`);
  Object.keys(payload.fields).forEach((fieldPath) => {
    url.searchParams.append("updateMask.fieldPaths", fieldPath);
  });
  return fetchJson(url.toString(), {
    method: "PATCH",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(payload)
  });
};

const main = async () => {
  const totalParticipants = ENTRIES.reduce((sum, entry) => sum + entry.participantCount, 0);
  const totalPoints = ENTRIES.reduce((sum, entry) => sum + (entry.participantCount * entry.pointsPerParticipant), 0);

  console.log(`Preparing ${ENTRIES.length} related activity records...`);
  console.log(`Total offline participants: ${totalParticipants}`);
  console.log(`Total bonus points: ${totalPoints}`);
  console.log(`Mode: ${APPLY ? "apply" : "dry-run"}`);

  if (!APPLY) {
    ENTRIES.forEach((entry, index) => {
      console.log(`${index + 1}. ${entry.titleZh} -> ${entry.participantCount} people / ${entry.participantCount * entry.pointsPerParticipant} pts`);
    });
    return;
  }

  for (const entry of ENTRIES) {
    const now = new Date().toISOString();
    const docPath = `projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents/relatedActivityParticipants/${entry.id}`;
    await upsertDocument(docPath, {
      fields: {
        id: encodeValue(entry.id),
        titleZh: encodeValue(entry.titleZh),
        titleEn: encodeValue(entry.titleEn),
        dateLabel: encodeValue(entry.dateLabel),
        participantCount: encodeValue(entry.participantCount),
        pointsPerParticipant: encodeValue(entry.pointsPerParticipant),
        bonusPoints: encodeValue(entry.participantCount * entry.pointsPerParticipant),
        active: encodeValue(entry.active),
        category: encodeValue(entry.category),
        sortOrder: encodeValue(entry.sortOrder),
        updatedAt: encodeValue(now),
        createdFrom: encodeValue("manual-offline-activity-seed")
      }
    });
    console.log(`Upserted ${entry.titleZh}`);
  }

  console.log("Done.");
};

main().catch((error) => {
  console.error("Failed to upsert related activity participants.");
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
