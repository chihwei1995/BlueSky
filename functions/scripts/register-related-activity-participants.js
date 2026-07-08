#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const {execFileSync} = require("child_process");

const PROJECT_ID = "blueskyreturns";
const DATABASE_ID = "default";
const PASSWORD = "20260718";
const APPLY = process.argv.includes("--apply");
const TOKEN_PATH = path.join(os.homedir(), ".config", "configstore", "firebase-tools.json");
const OUTPUT_PATH = path.join(__dirname, "..", "generated-related-activity-accounts.local.csv");
const WEB_API_KEY = "AIzaSyALbVjIlBlbfXDnvY8QEkl9PTBd1nj9v2o";
const PAGE_SIZE = 300;
const BATCH_SIZE = 50;

const ENTRIES = [
  {
    key: "launch",
    titleZh: "實體展覽與教育啟動",
    titleEn: "Exhibition & Education Kickoff",
    participantCount: 171,
    sortOrder: 1
  },
  {
    key: "museum",
    titleZh: "氣候變化博物館互動體驗",
    titleEn: "Climate Museum Interactive Experience",
    participantCount: 24,
    sortOrder: 2
  },
  {
    key: "marine",
    titleZh: "海廢慈善體能挑戰賽",
    titleEn: "Marine Debris Charity Fitness Challenge",
    participantCount: 3,
    sortOrder: 3
  },
  {
    key: "mileage",
    titleZh: "一同步，跑出藍天里程",
    titleEn: "Blue Sky Mileage Challenge",
    participantCount: 26,
    sortOrder: 4
  },
  {
    key: "airside",
    titleZh: "AIRSIDE 綠色建築導覽",
    titleEn: "AIRSIDE Green Architecture Tour",
    participantCount: 10,
    sortOrder: 5
  },
  {
    key: "diet",
    titleZh: "素「食」減碳・包餃子體驗",
    titleEn: "Plant-based Dumpling Carbon Reduction Workshop",
    participantCount: 32,
    sortOrder: 6
  },
  {
    key: "aspac",
    titleZh: "ASPAC 新潟期間｜永續發展論壇分享",
    titleEn: "ASPAC Niigata Sustainability Forum Sharing",
    participantCount: 80,
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
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  if (response.status === 401 && allowRefresh && options.headers?.Authorization) {
    accessToken = refreshFirebaseAccessToken();
    return fetchJson(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        Authorization: `Bearer ${accessToken}`
      }
    }, false);
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
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isRateLimitError = (error) => /TOO_MANY_ATTEMPTS_TRY_LATER|429|RESOURCE_EXHAUSTED/i.test(String(error && error.message || ""));

const createAccountsBatch = async (accounts) => {
  return fetchJson(`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:batchCreate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      users: accounts.map((account) => ({
        localId: account.localId,
        email: account.email,
        displayName: account.displayName,
        emailVerified: true,
        passwordHash: Buffer.from(account.password, "utf8").toString("base64"),
        salt: Buffer.from("blueskyreturns-seed", "utf8").toString("base64"),
        hashAlgorithm: "HMAC_SHA256"
      })),
      allowOverwrite: false
    })
  });
};

const decodeValue = (value) => {
  if (!value || typeof value !== "object") return null;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("booleanValue" in value) return Boolean(value.booleanValue);
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map((item) => decodeValue(item));
  if ("mapValue" in value) {
    const fields = {};
    Object.entries(value.mapValue.fields || {}).forEach(([key, child]) => {
      fields[key] = decodeValue(child);
    });
    return fields;
  }
  return null;
};

const signUpEmailPassword = async ({email, password}) => {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${WEB_API_KEY}`;
  return fetchJson(url, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      email,
      password,
      returnSecureToken: true
    })
  });
};

const signInEmailPassword = async ({email, password}) => {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${WEB_API_KEY}`;
  return fetchJson(url, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      email,
      password,
      returnSecureToken: true
    })
  });
};

const listMembers = async () => {
  const documents = [];
  let pageToken = "";
  do {
    const url = new URL(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents/members`);
    url.searchParams.set("pageSize", String(PAGE_SIZE));
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const json = await fetchJson(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });
    (json.documents || []).forEach((doc) => {
      const fields = {};
      Object.entries(doc.fields || {}).forEach(([key, value]) => {
        fields[key] = decodeValue(value);
      });
      documents.push({
        id: String(doc.name || "").split("/").pop(),
        fields
      });
    });
    pageToken = json.nextPageToken || "";
  } while (pageToken);
  return documents;
};

const createOrResolveAccount = async ({email, password, displayName}) => {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const created = await signUpEmailPassword({email, password});
      return {
        uid: created.localId,
        email: created.email || email,
        created: true
      };
    } catch (error) {
      if (String(error.message || "").includes("EMAIL_EXISTS")) {
        const existing = await signInEmailPassword({email, password});
        return {
          uid: existing.localId,
          email: existing.email || email,
          created: false
        };
      }
      if (!isRateLimitError(error) || attempt === 5) throw error;
      const waitMs = 15000 + (attempt * 10000);
      console.warn(`Rate limited while creating ${email}. Waiting ${waitMs}ms before retry...`);
      await sleep(waitMs);
    }
  }
  throw new Error(`Unable to create or resolve account for ${email}`);
};

const buildAccounts = () => ENTRIES.flatMap((entry) => {
  const records = [];
  for (let index = 1; index <= entry.participantCount; index += 1) {
    const suffix = String(index).padStart(3, "0");
    const email = `participant.${entry.key}.${suffix}@blueskyreturns.local`;
    const displayName = `${entry.titleZh} 參加者 ${suffix}`;
    records.push({
      activityKey: entry.key,
      activityTitleZh: entry.titleZh,
      activityTitleEn: entry.titleEn,
      sortOrder: entry.sortOrder,
      index,
      localId: `related_${entry.key}_${suffix}`,
      email,
      password: PASSWORD,
      displayName
    });
  }
  return records;
});

const writeCsv = (records) => {
  const lines = [
    ["email", "password", "displayName", "activityKey", "activityTitleZh", "sortOrder"].join(","),
    ...records.map((record) => [
      record.email,
      PASSWORD,
      `"${record.displayName.replaceAll("\"", "\"\"")}"`,
      record.activityKey,
      `"${record.activityTitleZh.replaceAll("\"", "\"\"")}"`,
      record.sortOrder
    ].join(","))
  ];
  fs.writeFileSync(OUTPUT_PATH, `${lines.join("\n")}\n`, "utf8");
};

const main = async () => {
  const accounts = buildAccounts();
  console.log(`Prepared ${accounts.length} participant accounts.`);
  console.log(`Unified password: ${PASSWORD}`);
  console.log(`Email pattern: participant.{activityKey}.{NNN}@blueskyreturns.local`);
  console.log(`Output list: ${OUTPUT_PATH}`);
  writeCsv(accounts);

  if (!APPLY) {
    console.log("Dry run only. Re-run with --apply to create accounts and member documents.");
    return;
  }

  const existingMembers = await listMembers();
  const existingSeedEmails = new Set(
    existingMembers
      .filter((member) => member.fields.createdFrom === "related-activity-batch-seed")
      .map((member) => String(member.fields.email || "").trim())
      .filter(Boolean)
  );

  const pendingAccounts = accounts.filter((record) => !existingSeedEmails.has(record.email));
  console.log(`Already seeded: ${existingSeedEmails.size}`);
  console.log(`Pending create/sync: ${pendingAccounts.length}`);

  let createdCount = 0;
  let existingCount = 0;
  for (let offset = 0; offset < pendingAccounts.length; offset += BATCH_SIZE) {
    const chunk = pendingAccounts.slice(offset, offset + BATCH_SIZE);
    console.log(`Processing batch ${Math.floor(offset / BATCH_SIZE) + 1} / ${Math.ceil(pendingAccounts.length / BATCH_SIZE)} (${chunk.length} accounts)`);

    let batchResponse;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        batchResponse = await createAccountsBatch(chunk);
        break;
      } catch (error) {
        if (!isRateLimitError(error) || attempt === 4) throw error;
        const waitMs = 20000 + (attempt * 15000);
        console.warn(`Rate limited during batch create. Waiting ${waitMs}ms before retry...`);
        await sleep(waitMs);
      }
    }

    const errorMap = new Map((batchResponse?.error || []).map((entry) => [entry.index, entry.message || "UNKNOWN_ERROR"]));

    for (let index = 0; index < chunk.length; index += 1) {
      const record = chunk[index];
      let uid = record.localId;
      let wasCreated = !errorMap.has(index);
      const batchError = errorMap.get(index);

      if (batchError) {
        if (/EMAIL_EXISTS|DUPLICATE_EMAIL|DUPLICATE_LOCAL_ID/i.test(batchError)) {
          const existing = await signInEmailPassword({email: record.email, password: PASSWORD});
          uid = existing.localId;
          wasCreated = false;
        } else {
          throw new Error(`Batch create failed for ${record.email}: ${batchError}`);
        }
      }

      if (wasCreated) {
        createdCount += 1;
      } else {
        existingCount += 1;
      }

      const now = new Date().toISOString();
      const memberDocPath = `projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents/members/${uid}`;
      await upsertDocument(memberDocPath, {
        fields: {
          uid: encodeValue(uid),
          email: encodeValue(record.email),
          name: encodeValue(record.displayName),
          partnerType: encodeValue("individual"),
          partnerMultiplier: encodeValue(1),
          permissionLevel: encodeValue(1),
          createdFrom: encodeValue("related-activity-batch-seed"),
          createdAt: encodeValue(now),
          updatedAt: encodeValue(now),
          offlineActivityParticipant: encodeValue(true),
          relatedActivity: encodeValue({
            key: record.activityKey,
            titleZh: record.activityTitleZh,
            titleEn: record.activityTitleEn,
            participantIndex: record.index,
            seededAt: now
          }),
          termsConsent: encodeValue({
            acceptedAt: now,
            acceptedVersion: "batch-seed-v1",
            source: "related-activity-batch-seed"
          })
        }
      });

      console.log(`${wasCreated ? "Created" : "Synced"} ${record.email} -> ${uid}`);
    }

    await sleep(2000);
  }

  console.log(`Done. Created: ${createdCount}, existing: ${existingCount}, newly synced: ${pendingAccounts.length}, total planned: ${accounts.length}`);
};

main().catch((error) => {
  console.error("Failed to register related activity participants.");
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
