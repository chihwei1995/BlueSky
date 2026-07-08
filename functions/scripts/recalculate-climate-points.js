#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");

const PROJECT_ID = "blueskyreturns";
const DATABASE_ID = "default";
const PAGE_SIZE = 300;
const APPLY = process.argv.includes("--apply");
const DRY_RUN = !APPLY;

const TOKEN_PATH = path.join(os.homedir(), ".config", "configstore", "firebase-tools.json");

const readFirebaseAccessToken = () => {
  const raw = fs.readFileSync(TOKEN_PATH, "utf8");
  const parsed = JSON.parse(raw);
  const token = parsed?.tokens?.access_token;
  if (!token) {
    throw new Error(`Could not find Firebase access token in ${TOKEN_PATH}`);
  }
  return token;
};

const accessToken = readFirebaseAccessToken();

const baseUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents`;

const authHeaders = {
  Authorization: `Bearer ${accessToken}`
};

const encodeValue = (value) => {
  if (value === null || value === undefined) return { nullValue: null };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map((item) => encodeValue(item)) } };
  }
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    if (Number.isInteger(value)) return { integerValue: String(value) };
    return { doubleValue: value };
  }
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "object") {
    const fields = {};
    Object.entries(value).forEach(([key, child]) => {
      fields[key] = encodeValue(child);
    });
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
};

const decodeValue = (value) => {
  if (!value || typeof value !== "object") return null;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("booleanValue" in value) return Boolean(value.booleanValue);
  if ("nullValue" in value) return null;
  if ("timestampValue" in value) return value.timestampValue;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map((item) => decodeValue(item));
  if ("mapValue" in value) {
    const result = {};
    Object.entries(value.mapValue.fields || {}).forEach(([key, child]) => {
      result[key] = decodeValue(child);
    });
    return result;
  }
  return null;
};

const decodeDocument = (doc) => {
  const fields = {};
  Object.entries(doc.fields || {}).forEach(([key, value]) => {
    fields[key] = decodeValue(value);
  });
  return {
    name: doc.name,
    id: String(doc.name || "").split("/").pop(),
    fields
  };
};

const fetchJson = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...authHeaders,
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }
  return json;
};

const listCollection = async (collectionId) => {
  const documents = [];
  let pageToken = "";
  do {
    const url = new URL(`${baseUrl}/${collectionId}`);
    url.searchParams.set("pageSize", String(PAGE_SIZE));
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const json = await fetchJson(url.toString());
    (json.documents || []).forEach((doc) => documents.push(decodeDocument(doc)));
    pageToken = json.nextPageToken || "";
  } while (pageToken);
  return documents;
};

const normalizeCreditedDates = (dates = []) => Array.from(new Set(
  dates.map((value) => String(value || "").trim()).filter(Boolean)
)).sort();

const hasSevenDayStreak = (dates = []) => {
  const uniqueDates = normalizeCreditedDates(dates);
  if (uniqueDates.length < 7) return false;
  let streak = 1;
  for (let index = 1; index < uniqueDates.length; index += 1) {
    const prev = new Date(`${uniqueDates[index - 1]}T00:00:00Z`);
    const current = new Date(`${uniqueDates[index]}T00:00:00Z`);
    const diffDays = Math.round((current - prev) / 86400000);
    if (diffDays === 1) {
      streak += 1;
      if (streak >= 7) return true;
    } else {
      streak = 1;
    }
  }
  return false;
};

const calculateClimatePoints = ({ member = {}, completedDays = 0, impactCount = 0, hasWeeklyStreak = false } = {}) => {
  let total = 0;
  const ecoMbtiBonus = member?.ecoMbti?.type ? 1 : 0;
  const completedDaysPoints = Math.max(0, Number(completedDays || 0)) * 10;
  const streakBonus = hasWeeklyStreak ? 5 : 0;
  const impactPoints = Math.max(0, Number(impactCount || 0));
  total += ecoMbtiBonus;
  total += completedDaysPoints;
  total += streakBonus;
  total += impactPoints;
  return {
    total,
    breakdown: {
      ecoMbtiBonus,
      completedDays,
      completedDaysPoints,
      streakBonus,
      impactCount,
      impactPoints
    }
  };
};

const normalizeBreakdown = (breakdown = {}) => ({
  ecoMbtiBonus: Number(breakdown.ecoMbtiBonus || 0),
  completedDays: Number(breakdown.completedDays || 0),
  completedDaysPoints: Number(breakdown.completedDaysPoints || 0),
  streakBonus: Number(breakdown.streakBonus || 0),
  impactCount: Number(breakdown.impactCount || 0),
  impactPoints: Number(breakdown.impactPoints || 0)
});

const updateMember = async (docName, payload) => {
  const url = new URL(`https://firestore.googleapis.com/v1/${docName}`);
  Object.keys(payload.fields).forEach((fieldPath) => {
    url.searchParams.append("updateMask.fieldPaths", fieldPath);
  });
  return fetchJson(url.toString(), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
};

const main = async () => {
  console.log(`Loading Firestore data from ${PROJECT_ID}/${DATABASE_ID}...`);
  const [members, submissions, referrals] = await Promise.all([
    listCollection("members"),
    listCollection("greenProposalSubmissions"),
    listCollection("memberReferrals")
  ]);

  const submissionDays = new Map();
  submissions.forEach((doc) => {
    const uid = String(doc.fields.uid || "").trim();
    const taskDate = String(doc.fields.taskDate || "").trim();
    if (!uid || !taskDate) return;
    if (!submissionDays.has(uid)) submissionDays.set(uid, []);
    submissionDays.get(uid).push(taskDate);
  });

  const referralCounts = new Map();
  referrals.forEach((doc) => {
    const referredBy = String(doc.fields.referredBy || "").trim();
    if (!referredBy) return;
    referralCounts.set(referredBy, (referralCounts.get(referredBy) || 0) + 1);
  });

  let changedCount = 0;
  let unchangedCount = 0;
  let appliedCount = 0;

  const preview = [];

  for (const member of members) {
    const uid = member.id;
    const completedDates = normalizeCreditedDates(submissionDays.get(uid) || []);
    const completedDays = completedDates.length;
    const weeklyStreak = hasSevenDayStreak(completedDates);
    const impactCount = referralCounts.get(uid) || 0;
    const { total, breakdown } = calculateClimatePoints({
      member: member.fields,
      completedDays,
      impactCount,
      hasWeeklyStreak: weeklyStreak
    });

    const nextState = {
      climatePoints: total,
      climatePointsUpdatedAt: new Date().toISOString(),
      dailyGreenActionsCompletedDays: completedDays,
      dailyGreenActionsWeeklyStreak: weeklyStreak,
      climateImpactCount: impactCount,
      climatePointsBreakdown: breakdown
    };

    const currentComparable = {
      climatePoints: Number(member.fields.climatePoints || 0),
      dailyGreenActionsCompletedDays: Number(member.fields.dailyGreenActionsCompletedDays || 0),
      dailyGreenActionsWeeklyStreak: Boolean(member.fields.dailyGreenActionsWeeklyStreak || false),
      climateImpactCount: Number(member.fields.climateImpactCount || 0),
      climatePointsBreakdown: normalizeBreakdown(member.fields.climatePointsBreakdown || {})
    };

    const nextComparable = {
      climatePoints: nextState.climatePoints,
      dailyGreenActionsCompletedDays: nextState.dailyGreenActionsCompletedDays,
      dailyGreenActionsWeeklyStreak: nextState.dailyGreenActionsWeeklyStreak,
      climateImpactCount: nextState.climateImpactCount,
      climatePointsBreakdown: normalizeBreakdown(nextState.climatePointsBreakdown || {})
    };

    const changed = JSON.stringify(currentComparable) !== JSON.stringify(nextComparable);

    if (preview.length < 12) {
      preview.push({
        uid,
        name: member.fields.name || member.fields.email || uid,
        climatePoints: total,
        completedDays,
        weeklyStreak,
        impactCount,
        ecoMbti: Boolean(member.fields?.ecoMbti?.type)
      });
    }

    if (!changed) {
      unchangedCount += 1;
      continue;
    }

    changedCount += 1;

    if (!APPLY) continue;

    await updateMember(member.name, {
      fields: {
        climatePoints: encodeValue(nextState.climatePoints),
        climatePointsUpdatedAt: encodeValue(nextState.climatePointsUpdatedAt),
        dailyGreenActionsCompletedDays: encodeValue(nextState.dailyGreenActionsCompletedDays),
        dailyGreenActionsWeeklyStreak: encodeValue(nextState.dailyGreenActionsWeeklyStreak),
        climateImpactCount: encodeValue(nextState.climateImpactCount),
        climatePointsBreakdown: encodeValue(nextState.climatePointsBreakdown)
      }
    });
    appliedCount += 1;
    if (appliedCount % 25 === 0) {
      console.log(`Updated ${appliedCount} members...`);
    }
  }

  preview.sort((a, b) => b.climatePoints - a.climatePoints || String(a.uid).localeCompare(String(b.uid)));

  console.log("");
  console.log(`Members: ${members.length}`);
  console.log(`Submissions: ${submissions.length}`);
  console.log(`Referrals: ${referrals.length}`);
  console.log(`Changed members: ${changedCount}`);
  console.log(`Unchanged members: ${unchangedCount}`);
  if (APPLY) console.log(`Applied updates: ${appliedCount}`);
  console.log(`Mode: ${DRY_RUN ? "dry-run" : "apply"}`);
  console.log("");
  console.log("Preview:");
  preview.slice(0, 10).forEach((item, index) => {
    console.log(
      `${index + 1}. ${item.name} (${item.uid}) -> ${item.climatePoints} pts | days=${item.completedDays} | streak=${item.weeklyStreak} | impact=${item.impactCount} | ecoMbti=${item.ecoMbti}`
    );
  });
};

main().catch((error) => {
  console.error("Failed to recalculate climate points.");
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
