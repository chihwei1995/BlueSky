#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const {execFileSync} = require("child_process");

const PROJECT_ID = "blueskyreturns";
const DATABASE_ID = "default";
const PAGE_SIZE = 300;
const MAX_SLOTS = 321;
const FALLBACK_RELATED_ACTIVITY_POINTS = 3460;
const APPLY = process.argv.includes("--apply");
const TOKEN_PATH = path.join(
    os.homedir(),
    ".config",
    "configstore",
    "firebase-tools.json",
);
const BASE_URL = "https://firestore.googleapis.com/v1/projects/" +
  `${PROJECT_ID}/databases/${DATABASE_ID}/documents`;

const readAccessToken = () => {
  const config = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
  const token = config && config.tokens && config.tokens.access_token;
  if (!token) {
    throw new Error(`Could not find Firebase access token in ${TOKEN_PATH}`);
  }
  return token;
};

const refreshAccessToken = () => {
  execFileSync(
      "npx",
      ["-y", "firebase-tools@latest", "projects:list", "--json"],
      {stdio: "ignore"},
  );
  return readAccessToken();
};

let accessToken = readAccessToken();

const decodeValue = (value) => {
  if (!value || typeof value !== "object") return null;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("booleanValue" in value) return Boolean(value.booleanValue);
  if ("nullValue" in value) return null;
  if ("timestampValue" in value) return value.timestampValue;
  if ("arrayValue" in value) {
    return (value.arrayValue.values || []).map((item) => decodeValue(item));
  }
  if ("mapValue" in value) {
    const result = {};
    Object.entries(value.mapValue.fields || {}).forEach(([key, child]) => {
      result[key] = decodeValue(child);
    });
    return result;
  }
  return null;
};

const encodeValue = (value) => {
  if (value === null || value === undefined) return {nullValue: null};
  if (typeof value === "boolean") return {booleanValue: value};
  if (typeof value === "number") {
    return Number.isInteger(value) ?
      {integerValue: String(value)} :
      {doubleValue: value};
  }
  if (typeof value === "string") return {stringValue: value};
  if (Array.isArray(value)) {
    return {arrayValue: {values: value.map((item) => encodeValue(item))}};
  }
  if (typeof value === "object") {
    const fields = {};
    Object.entries(value).forEach(([key, child]) => {
      fields[key] = encodeValue(child);
    });
    return {mapValue: {fields}};
  }
  return {stringValue: String(value)};
};

const decodeDocument = (document) => {
  const fields = {};
  Object.entries(document.fields || {}).forEach(([key, value]) => {
    fields[key] = decodeValue(value);
  });
  return {
    id: String(document.name || "").split("/").pop(),
    fields,
  };
};

const fetchJson = async (url, options = {}, allowRefresh = true) => {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  if (response.status === 401 && allowRefresh) {
    accessToken = refreshAccessToken();
    return fetchJson(url, options, false);
  }
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
};

const listCollection = async (collectionId) => {
  const documents = [];
  let pageToken = "";
  do {
    const url = new URL(`${BASE_URL}/${collectionId}`);
    url.searchParams.set("pageSize", String(PAGE_SIZE));
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await fetchJson(url.toString());
    (response.documents || []).forEach((document) => {
      documents.push(decodeDocument(document));
    });
    pageToken = response.nextPageToken || "";
  } while (pageToken);
  return documents;
};

const normalizeCreditedDates = (dates = []) => Array.from(new Set(
    dates
        .map((value) => String(value || "").trim())
        .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)),
)).sort();

const hasSevenDayStreak = (dates = []) => {
  const uniqueDates = normalizeCreditedDates(dates);
  if (uniqueDates.length < 7) return false;
  let streak = 1;
  for (let index = 1; index < uniqueDates.length; index += 1) {
    const previous = new Date(`${uniqueDates[index - 1]}T00:00:00Z`);
    const current = new Date(`${uniqueDates[index]}T00:00:00Z`);
    if (Math.round((current - previous) / 86400000) === 1) {
      streak += 1;
      if (streak >= 7) return true;
    } else {
      streak = 1;
    }
  }
  return false;
};

const calculateMemberPoints = ({member, submissionDates, impactCount}) => {
  let total = member && member.ecoMbti && member.ecoMbti.type ? 1 : 0;
  total += submissionDates.length * 10;
  if (hasSevenDayStreak(submissionDates)) total += 5;
  total += Math.max(0, Number(impactCount || 0));
  return total;
};

const upsertPublicStats = async (stats) => {
  const documentName = `projects/${PROJECT_ID}/databases/${DATABASE_ID}/` +
    "documents/publicStats/treePlantingForest";
  const url = new URL(`https://firestore.googleapis.com/v1/${documentName}`);
  Object.keys(stats).forEach((fieldPath) => {
    url.searchParams.append("updateMask.fieldPaths", fieldPath);
  });
  const fields = {};
  Object.entries(stats).forEach(([key, value]) => {
    fields[key] = encodeValue(value);
  });
  return fetchJson(url.toString(), {
    method: "PATCH",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({fields}),
  });
};

const main = async () => {
  console.log(
      `Loading forest statistics from ${PROJECT_ID}/${DATABASE_ID}...`,
  );
  const [members, submissions, referrals, relatedActivities] =
    await Promise.all([
      listCollection("members"),
      listCollection("greenProposalSubmissions"),
      listCollection("memberReferrals"),
      listCollection("relatedActivityParticipants"),
    ]);

  const submissionDatesByUid = new Map();
  submissions.forEach((submission) => {
    const uid = String(submission.fields.uid || "").trim();
    if (!uid) return;
    const dates = submissionDatesByUid.get(uid) || [];
    dates.push(String(submission.fields.taskDate || "").trim());
    submissionDatesByUid.set(uid, dates);
  });

  const referralCounts = new Map();
  referrals.forEach((referral) => {
    const referredBy = String(referral.fields.referredBy || "").trim();
    if (!referredBy) return;
    referralCounts.set(
        referredBy,
        (referralCounts.get(referredBy) || 0) + 1,
    );
  });

  const relatedActivityPoints = relatedActivities.length ?
    relatedActivities.reduce((total, activity) => {
      if (activity.fields.active === false) return total;
      const participantCount = Math.max(
          0,
          Number(activity.fields.participantCount || 0),
      );
      const pointsPerParticipant = Math.max(
          0,
          Number(activity.fields.pointsPerParticipant || 10),
      );
      return total + participantCount * pointsPerParticipant;
    }, 0) :
    FALLBACK_RELATED_ACTIVITY_POINTS;

  const memberPoints = members.reduce((total, member) => {
    const submissionDates = submissionDatesByUid.get(member.id) || [];
    return total + calculateMemberPoints({
      member: member.fields,
      submissionDates,
      impactCount: referralCounts.get(member.id) || 0,
    });
  }, 0);

  const participants = members.length;
  const points = memberPoints + relatedActivityPoints;
  const partnerTrees = Math.floor(participants / 100);
  const pointTrees = Math.floor(points / 10);
  const totalTrees = Math.min(MAX_SLOTS, partnerTrees + pointTrees);
  const remaining = Math.max(0, MAX_SLOTS - totalTrees);
  const stats = {
    participants,
    points,
    partnerTrees,
    pointTrees,
    totalTrees,
    remaining,
    memberPoints,
    relatedActivityPoints,
    memberDocumentCount: members.length,
    submissionDocumentCount: submissions.length,
    referralDocumentCount: referrals.length,
    updatedAt: new Date().toISOString(),
  };

  console.log(JSON.stringify(stats, null, 2));
  console.log(`Mode: ${APPLY ? "apply" : "dry-run"}`);
  if (!APPLY) return;
  await upsertPublicStats(stats);
  console.log("Updated publicStats/treePlantingForest.");
};

main().catch((error) => {
  console.error("Failed to sync public tree planting forest stats.");
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
