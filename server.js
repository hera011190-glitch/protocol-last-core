const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const compression = require("compression");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const defaultDesign = require("./defaultDesign");

const app = express();
const REQUEST_BODY_LIMIT = process.env.REQUEST_BODY_LIMIT || "150mb";
const CLIENT_URL = process.env.CLIENT_URL || "";
const PORT = Number(process.env.PORT || 3001);
const LEGACY_DATA_DIR = __dirname;
const IS_ASSET_COMPACT_CHILD = process.env.PLC_ASSET_COMPACT_CHILD === "1";

let appBootReady = false;
const server = http.createServer(app);

if (!IS_ASSET_COMPACT_CHILD) {
  app.get(["/health", "/healthz", "/ping"], (req, res) => {
    res.status(200).type("text/plain").send("ok");
  });

  app.head(["/health", "/healthz", "/ping", "/"], (req, res) => {
    res.status(200).end();
  });

  app.get("/", (req, res, next) => {
    if (appBootReady) return next();
    return res.status(200).type("text/plain").send("ok");
  });

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`서버 실행됨: ${PORT}`);
  });
}

const { startMastodonBot } = require('./mastodon-bot/mastodonBot');
startMastodonBot().catch((error) => {
  console.error('[마스토돈 봇 실행 실패]', error);
});

function pickRuntimeDataDir() {
  const candidates = [
    process.env.DATA_DIR,
    process.env.RENDER ? "/var/data/protocol-last-core-data" : "",
    path.join(__dirname, "..", "protocol-last-core-data"),
    path.join(__dirname, "data"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const resolved = path.resolve(candidate);
      fs.mkdirSync(resolved, { recursive: true });
      fs.accessSync(resolved, fs.constants.R_OK | fs.constants.W_OK);
      return resolved;
    } catch (error) {
      console.error(`[data-dir] 사용할 수 없는 저장 경로: ${candidate}`, error.message);
    }
  }

  return __dirname;
}

const DATA_DIR = pickRuntimeDataDir();
const BUNDLED_ASSET_DIR = path.join(__dirname, "public_assets");
const RUNTIME_ASSET_DIR = path.join(DATA_DIR, "public_assets");
const DATA_IMAGE_COMPACT_MIN_BYTES = Number(process.env.DATA_IMAGE_COMPACT_MIN_BYTES || 48 * 1024);
const MAX_STARTUP_JSON_PARSE_BYTES = Number(process.env.MAX_STARTUP_JSON_PARSE_BYTES || 8 * 1024 * 1024);

function getAssetExtensionFromMime(mime = "") {
  const normalized = String(mime || "").toLowerCase();
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return "jpg";
  if (normalized.includes("png")) return "png";
  if (normalized.includes("webp")) return "webp";
  if (normalized.includes("gif")) return "gif";
  if (normalized.includes("svg")) return "svg";
  if (normalized.includes("mpeg") || normalized.includes("mp3")) return "mp3";
  if (normalized.includes("wav")) return "wav";
  if (normalized.includes("ogg")) return "ogg";
  if (normalized.includes("mp4")) return "mp4";
  if (normalized.includes("woff2")) return "woff2";
  if (normalized.includes("woff")) return "woff";
  if (normalized.includes("truetype") || normalized.includes("ttf")) return "ttf";
  if (normalized.includes("json")) return "json";
  if (normalized.includes("pdf")) return "pdf";
  return "bin";
}

function compactBase64DataUrlsInText(raw, namespace) {
  const source = String(raw || "");
  if (!source.includes("data:") || !source.includes(";base64,")) return { text: source, changed: false };

  const targetNamespace = String(namespace || "assets").replace(/[^a-zA-Z0-9_-]/g, "_");
  const targetDir = path.join(RUNTIME_ASSET_DIR, targetNamespace);
  fs.mkdirSync(targetDir, { recursive: true });

  let changed = false;
  const dataUrlPattern = /data:([a-zA-Z0-9.+-]+)(?:\\?\/)([a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+\/_=-]+)/g;
  const text = source.replace(dataUrlPattern, (full, major, minor, base64Text) => {
    try {
      const mime = `${major}/${minor}`;
      const ext = getAssetExtensionFromMime(mime);
      const normalizedBase64 = String(base64Text || "").replace(/-/g, "+").replace(/_/g, "/");
      const hash = crypto
        .createHash("sha256")
        .update(String(mime || ""))
        .update(":")
        .update(normalizedBase64.slice(0, 8192))
        .update(":")
        .update(String(normalizedBase64.length))
        .digest("hex")
        .slice(0, 24);
      const assetName = `${hash}.${ext}`;
      const assetPath = path.join(targetDir, assetName);
      if (!fs.existsSync(assetPath)) {
        fs.writeFileSync(assetPath, Buffer.from(normalizedBase64, "base64"));
      }
      changed = true;
      return `/asset-file/${targetNamespace}/${assetName}`;
    } catch (error) {
      console.error(`[asset-compact] data URL 분리 실패: ${targetNamespace}`, error.message);
      return full;
    }
  });

  return { text, changed };
}

function compactDataImagesInJsonFile(filePath, namespace) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return false;
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size < DATA_IMAGE_COMPACT_MIN_BYTES) return false;

    const raw = fs.readFileSync(filePath, "utf-8");
    const { text: replaced, changed } = compactBase64DataUrlsInText(raw, namespace || path.basename(filePath, ".json"));
    if (!changed || replaced === raw) return false;

    const backupDir = path.join(DATA_DIR, "_backups");
    fs.mkdirSync(backupDir, { recursive: true });
    const backupPath = path.join(
      backupDir,
      `${path.basename(filePath)}.before-asset-compact.${Date.now()}.bak.json`
    );
    try { fs.copyFileSync(filePath, backupPath); } catch {}

    const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.compact.tmp`);
    fs.writeFileSync(tempPath, replaced, "utf-8");
    fs.renameSync(tempPath, filePath);
    console.log(`[asset-compact] ${path.basename(filePath)} 안의 base64 data URL을 파일로 분리했습니다.`);
    return true;
  } catch (error) {
    console.error(`[asset-compact] ${filePath} 처리 실패`, error.message);
    return false;
  }
}

function compactRuntimeJsonImagesIfNeeded(filename) {
  try {
    const runtimePath = path.join(DATA_DIR, filename);
    if (!fs.existsSync(runtimePath)) return false;
    return compactDataImagesInJsonFile(runtimePath, path.basename(filename, ".json"));
  } catch (error) {
    console.error(`[asset-compact] ${filename} 확인 실패`, error.message);
    return false;
  }
}

function listTopLevelJsonFilesForImageCompact(dirPath) {
  try {
    if (!dirPath || !fs.existsSync(dirPath)) return [];
    return fs.readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
      .filter((entry) => !["package.json", "package-lock.json"].includes(entry.name.toLowerCase()))
      .map((entry) => path.join(dirPath, entry.name));
  } catch (error) {
    console.error("[asset-compact] JSON 파일 목록 확인 실패", dirPath, error.message);
    return [];
  }
}

function compactAllTopLevelJsonImages() {
  const seen = new Set();
  let changedCount = 0;
  for (const dirPath of [DATA_DIR, LEGACY_DATA_DIR]) {
    for (const filePath of listTopLevelJsonFilesForImageCompact(dirPath)) {
      const resolved = path.resolve(filePath);
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      const namespacePrefix = path.resolve(dirPath) === path.resolve(DATA_DIR) ? "" : "legacy_";
      const namespace = `${namespacePrefix}${path.basename(filePath, ".json")}`;
      if (compactDataImagesInJsonFile(filePath, namespace)) changedCount += 1;
    }
  }
  return changedCount;
}

function runAssetCompactChildProcess() {
  if (process.env.PLC_ASSET_COMPACT_CHILD === "1") return;
  try {
    const child = spawn(process.execPath, [__filename], {
      env: { ...process.env, PLC_ASSET_COMPACT_CHILD: "1" },
      stdio: "inherit",
      detached: false,
    });
    child.on("error", (error) => {
      console.error("[asset-compact] 별도 프로세스 실행 실패", error.message);
    });
    child.on("exit", (code) => {
      if (typeof code === "number" && code !== 0) {
        console.error(`[asset-compact] 별도 프로세스가 비정상 종료되었습니다: ${code}`);
      }
    });
  } catch (error) {
    console.error("[asset-compact] 별도 프로세스 준비 실패", error.message);
  }
}

function resolveDataPath(filename) {
  const nextPath = path.join(DATA_DIR, filename);
  const legacyPath = path.join(LEGACY_DATA_DIR, filename);
  if (!fs.existsSync(nextPath) && fs.existsSync(legacyPath)) {
    try {
      fs.copyFileSync(legacyPath, nextPath);
    } catch (error) {
      console.error(`[data-migrate] ${filename} 복사 실패`, error.message);
    }
  }
  return nextPath;
}

function resolveBundledPath(filename) {
  return path.join(__dirname, filename);
}

function safeReadJsonFileStrict(filePath, fallback = null, label = "json") {
  try {
    if (!filePath || !fs.existsSync(filePath)) return fallback;
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return fallback;

    if (stat.size > MAX_STARTUP_JSON_PARSE_BYTES) {
      console.error(`[json-safe] ${label} 파일이 너무 커서 서버 시작 중 파싱하지 않았습니다: ${filePath} (${stat.size} bytes)`);
      return fallback;
    }

    if (stat.size > 1024 * 1024) {
      console.log(`[json-safe] ${label} 읽는 중: ${path.basename(filePath)} (${stat.size} bytes)`);
    }

    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (error) {
    console.error(`[json-safe] ${label} 읽기 실패: ${filePath}`, error.message);
    return fallback;
  }
}

function readJsonFromPath(filePath, fallback = null) {
  return safeReadJsonFileStrict(filePath, fallback, path.basename(String(filePath || "json")));
}

function ensureRuntimeFile(filename, fallbackValue) {
  const runtimePath = resolveDataPath(filename);
  if (fs.existsSync(runtimePath)) return runtimePath;

  const bundledPath = resolveBundledPath(filename);
  try {
    if (fs.existsSync(bundledPath)) {
      fs.copyFileSync(bundledPath, runtimePath);
    } else if (fallbackValue !== undefined) {
      fs.writeFileSync(runtimePath, JSON.stringify(fallbackValue, null, 2), "utf-8");
    }
  } catch (error) {
    console.error("ensureRuntimeFile failed", filename, error);
  }

  return runtimePath;
}

["users.json", "registeredUsers.json", "adminUserIndex.json", "characters.json", "relationRequests.json", "relations.json", "mails.json", "investigations.json"].forEach((filename) => ensureRuntimeFile(filename, []));
["designConfig.json", "customInvestigations.json", "shopItems.json", "shopConfig.json"].forEach((filename) => ensureRuntimeFile(filename));

if (IS_ASSET_COMPACT_CHILD) {
  const changedCount = compactAllTopLevelJsonImages();
  console.log(`[asset-compact] 별도 프로세스 완료: ${changedCount}개 JSON 파일 정리`);
  process.exit(0);
}

const allowedOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  CLIENT_URL,
].filter(Boolean);

const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(null, true);
  },
  credentials: true,
};

app.use(cors(corsOptions));
app.use(compression({ threshold: 1024 }));
app.use(express.json({ limit: REQUEST_BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: REQUEST_BODY_LIMIT }));
app.use((err, req, res, next) => {
  if (!err) return next();
  if (err.type === "entity.too.large" || err.status === 413) {
    return res.status(413).json({ success: false, message: `업로드 용량이 너무 큽니다. 이미지 용량을 줄이거나 더 작은 파일로 다시 저장해주세요. 현재 서버 제한: ${REQUEST_BODY_LIMIT}` });
  }
  if (err instanceof SyntaxError && "body" in err) {
    return res.status(400).json({ success: false, message: "요청 내용을 읽지 못했습니다. JSON 형식 또는 업로드된 이미지 데이터를 확인해주세요." });
  }
  return next(err);
});

app.use("/asset-file", express.static(RUNTIME_ASSET_DIR, { maxAge: "30d", immutable: true }));
app.use("/asset-file", express.static(BUNDLED_ASSET_DIR, { maxAge: "30d", immutable: true }));

app.use((req, res, next) => {
  const lowerPath = String(req.path || "").toLowerCase();
  const isStaticAsset = lowerPath.startsWith("/static/") || lowerPath.startsWith("/asset/") || /\.(js|css|map|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot|json)$/.test(lowerPath);
  if (!isStaticAsset) {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
  }
  next();
});

const io = new Server(server, { cors: corsOptions });

const pendingJsonWrites = new Map();

function stringifyRuntimeJsonPayload(filePath, value) {
  const rawPayload = JSON.stringify(value === undefined ? null : value, null, 2);
  const namespace = path.basename(String(filePath || "assets"), ".json");
  const compacted = compactBase64DataUrlsInText(rawPayload, namespace);
  return compacted.text;
}

function writeJsonAtomicSync(filePath, value) {
  const payload = stringifyRuntimeJsonPayload(filePath, value);
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tempPath, payload, "utf-8");
  fs.renameSync(tempPath, filePath);
}

function scheduleJsonWrite(filePath, value, { delay = 12 } = {}) {
  const payload = stringifyRuntimeJsonPayload(filePath, value);
  const existing = pendingJsonWrites.get(filePath);
  if (existing?.timer) clearTimeout(existing.timer);
  const timer = setTimeout(async () => {
    try {
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
      await fs.promises.writeFile(tempPath, payload, "utf-8");
      await fs.promises.rename(tempPath, filePath);
    } catch (error) {
      console.error("scheduleJsonWrite failed", filePath, error);
    } finally {
      pendingJsonWrites.delete(filePath);
    }
  }, delay);
  pendingJsonWrites.set(filePath, { timer, payload });
}

function readRuntimeArray(filename) {
  try {
    const filePath = resolveDataPath(filename);
    const parsed = safeReadJsonFileStrict(filePath, [], filename);
    if (filename === "users.json") return extractRuntimeUserRows(parsed);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error(`readRuntimeArray failed: ${filename}`, error.message);
    return [];
  }
}

const PROTECTED_RUNTIME_ARRAYS = new Set(["users.json", "characters.json"]);
const RUNTIME_BACKUP_DIR = path.join(DATA_DIR, "_backups");

function ensureRuntimeBackupDir() {
  try {
    fs.mkdirSync(RUNTIME_BACKUP_DIR, { recursive: true });
  } catch (error) {
    console.error("backup dir create failed", error);
  }
}

function makeRuntimeBackup(filename, currentValue) {
  try {
    ensureRuntimeBackupDir();
    const safeName = String(filename || "runtime").replace(/[^a-zA-Z0-9_.-]/g, "_");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(RUNTIME_BACKUP_DIR, `${safeName}.${stamp}.bak.json`);
    fs.writeFileSync(backupPath, JSON.stringify(Array.isArray(currentValue) ? currentValue : [], null, 2), "utf-8");

    const backups = fs.readdirSync(RUNTIME_BACKUP_DIR)
      .filter((name) => name.startsWith(`${safeName}.`) && name.endsWith(".bak.json"))
      .sort();
    while (backups.length > 20) {
      const removeName = backups.shift();
      try { fs.unlinkSync(path.join(RUNTIME_BACKUP_DIR, removeName)); } catch {}
    }
  } catch (error) {
    console.error(`makeRuntimeBackup failed: ${filename}`, error);
  }
}

const LAST_RUNTIME_BACKUP_AT = new Map();

function shouldMakeRuntimeBackupNow(filename) {
  const now = Date.now();
  const key = String(filename || "runtime");
  const minInterval = key === "characters.json" ? 10 * 60 * 1000 : 60 * 1000;
  const lastAt = Number(LAST_RUNTIME_BACKUP_AT.get(key) || 0);
  if (now - lastAt < minInterval) return false;
  LAST_RUNTIME_BACKUP_AT.set(key, now);
  return true;
}

function getRowsForBackup(filename, fallbackRows) {
  if (filename === "characters.json") {
    return Array.isArray(fallbackRows) && fallbackRows.length > 0 ? fallbackRows : (Array.isArray(charactersDB) ? charactersDB : []);
  }
  return getRuntimeArrayFromDisk(filename);
}

function getRuntimeArrayFromDisk(filename) {
  try {
    const filePath = resolveDataPath(filename);
    const parsed = safeReadJsonFileStrict(filePath, [], filename);
    if (filename === "users.json") return extractRuntimeUserRows(parsed);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeUserIdText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim();
}

const RUNTIME_USER_SOURCE_NAMES = new Set([
  "users.json",
  "accounts.json",
  "members.json",
  "owners.json",
  "userlist.json",
  "usersdb.json",
  "registeredusers.json",
  "adminuserindex.json",
  "alluserids.json",
  "publicuserindex.json",
  "auth.json",
  "login.json",
]);

const RUNTIME_USER_INDEX_SOURCE_NAMES = new Set([
  "registeredusers.json",
  "adminuserindex.json",
  "alluserids.json",
  "publicuserindex.json",
]);

const RUNTIME_GENERIC_USER_SCAN_NAMES = new Set(["database.json", "db.json", "data.json", "backup.json", "index.json"]);
const RUNTIME_USER_CONTAINER_KEYS = new Set([
  "user", "users", "account", "accounts", "member", "members", "owner", "owners",
  "login", "logins", "auth", "auths", "registered", "registeredusers",
  "registeredUsers", "userdb", "usersdb", "userDB", "usersDB", "userlist", "userList"
].map((key) => String(key).toLowerCase()));

function isRuntimeUserContainerKey(key = "") {
  const normalized = normalizeUserIdText(key).replace(/[\s_-]/g, "").toLowerCase();
  return RUNTIME_USER_CONTAINER_KEYS.has(normalized);
}

function getRuntimeUserSourceKind(filePath = "") {
  const name = path.basename(String(filePath || "")).toLowerCase();
  if (RUNTIME_USER_INDEX_SOURCE_NAMES.has(name)) return "index";
  if (RUNTIME_USER_SOURCE_NAMES.has(name)) return "account";
  if (/(user|account|member|owner|login|auth|registered)/i.test(name)) return "account";
  if (RUNTIME_GENERIC_USER_SCAN_NAMES.has(name)) return "generic";
  return "generic";
}

function getRuntimeAccountId(user, { allowNameFallback = false } = {}) {
  if (!user || typeof user !== "object") return "";
  const primary = normalizeUserIdText(
    user.id ??
    user.userId ??
    user.userID ??
    user.user_id ??
    user.accountId ??
    user.accountID ??
    user.account_id ??
    user.loginId ??
    user.loginID ??
    user.login_id ??
    user.username ??
    user.userName ??
    user.user_name ??
    user.uid ??
    user.memberId ??
    user.memberID ??
    user.member_id ??
    user.email ??
    ""
  );
  if (primary) return primary;
  if (!allowNameFallback) return "";
  return normalizeUserIdText(user.displayName ?? user.display_name ?? user.nickname ?? user.nick ?? user.handle ?? user.name ?? "");
}

function hasRuntimeUserAuthEvidence(user) {
  if (!user || typeof user !== "object") return false;
  return ["pw", "password", "pass", "passwd", "passwordHash", "password_hash", "hashedPassword", "hash"].some((key) =>
    Object.prototype.hasOwnProperty.call(user, key) && String(user[key] ?? "") !== ""
  );
}

function hasRuntimeUserIndexEvidence(user) {
  if (!user || typeof user !== "object") return false;
  return user.indexedByServer === true || user.registeredByServer === true || user.createdByRegister === true;
}

let knownNonUserRuntimeTokensCache = { signature: "", tokens: new Set() };

function getRuntimeResourceFileSignature(filename) {
  try {
    const filePath = resolveDataPath(filename);
    const stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
    return stat ? `${filename}:${stat.size}:${Math.round(stat.mtimeMs)}` : `${filename}:missing`;
  } catch {
    return `${filename}:missing`;
  }
}

function collectNonUserRuntimeTokensFromValue(value, tokens, depth = 0) {
  if (depth > 5 || !value) return;
  if (Array.isArray(value)) {
    value.forEach((entry) => collectNonUserRuntimeTokensFromValue(entry, tokens, depth + 1));
    return;
  }
  if (typeof value !== "object") return;
  ["id", "name", "title", "key", "nodeId", "target", "slug"].forEach((field) => {
    const token = normalizeUserIdText(value?.[field]);
    if (token) tokens.add(token.toLowerCase());
  });
  Object.values(value).forEach((entry) => collectNonUserRuntimeTokensFromValue(entry, tokens, depth + 1));
}

function readKnownNonUserRuntimeTokens() {
  try {
    const filenames = [
      "shopItems.json",
      "investigations.json",
      "customInvestigations.json",
      "designConfig.json",
      "designMaps.json",
      "economy.json",
    ];
    const signature = filenames.map(getRuntimeResourceFileSignature).join("|");
    if (knownNonUserRuntimeTokensCache.signature === signature) return knownNonUserRuntimeTokensCache.tokens;

    const tokens = new Set();
    filenames.forEach((filename) => {
      try {
        collectNonUserRuntimeTokensFromValue(readJsonFromPath(resolveDataPath(filename), []), tokens);
      } catch {}
    });
    knownNonUserRuntimeTokensCache = { signature, tokens };
    return tokens;
  } catch {
    return knownNonUserRuntimeTokensCache.tokens || new Set();
  }
}

function isKnownNonUserRuntimeId(id) {
  const nextId = normalizeUserIdText(id);
  if (!nextId) return true;
  const lower = nextId.toLowerCase();
  if (lower === "plc") return true;
  if (/^item-\d{8,}$/.test(lower)) return true;
  if (/^(?:custom|investigation|shop|item|node|map|design|theme|npc|battle|reward)[-_:.]/i.test(nextId)) return true;
  if (/(?:custom|investigation|shop|item|node|design|theme|npc|battle)/i.test(nextId) && !/@/.test(nextId)) return true;
  if (/(?:조사|커스텀|상점|아이템|노드|디자인|테마|전투|보상)/.test(nextId)) return true;
  if (readKnownNonUserRuntimeTokens().has(lower)) return true;
  return false;
}

function getRuntimeUserId(user) {
  if (!user || typeof user !== "object") return "";
  return normalizeUserIdText(
    user.id ??
    user.userId ??
    user.accountId ??
    user.loginId ??
    user.loginID ??
    user.username ??
    user.userName ??
    user.user_name ??
    user.uid ??
    user.user_id ??
    user.account_id ??
    user.login_id ??
    user.memberId ??
    user.memberID ??
    user.member_id ??
    user.email ??
    user.ownerId ??
    user.owner_id ??
    user.displayName ??
    user.display_name ??
    user.nickname ??
    user.nick ??
    user.handle ??
    user.name ??
    ""
  );
}

function extractRuntimeUserRows(parsed, depth = 0, fallbackKey = "", options = {}) {
  if (depth > 7) return [];
  const sourceKind = options.sourceKind || "account";
  const sourceAllowsPlainIds = sourceKind === "account" || sourceKind === "index";
  const inRuntimeUserContainer = options.inUserContainer === true;
  const blockedFallbacks = new Set([
    "user", "users", "account", "accounts", "member", "members", "owner", "owners", "userList", "data", "rows", "items",
    "id", "name", "type", "role", "pw", "password", "pass", "passwd", "createdAt", "updatedAt", "registeredAt",
    "count", "total", "length", "version", "theme", "design", "characters", "shop", "shopItems", "investigations"
  ]);

  if (Array.isArray(parsed)) {
    return parsed.flatMap((user, index) => extractRuntimeUserRows(user, depth + 1, String(index), options));
  }

  if (!parsed || typeof parsed !== "object") {
    const fallbackId = normalizeUserIdText(fallbackKey);
    const valueId = normalizeUserIdText(parsed);
    const fallbackIsIndex = /^\d+$/.test(fallbackId);
    const primitiveLooksLikeStoredPassword = typeof parsed === "string" || typeof parsed === "number";

    if ((sourceAllowsPlainIds || inRuntimeUserContainer) && fallbackIsIndex && valueId && !isKnownNonUserRuntimeId(valueId)) {
      return [{ id: valueId, type: "owner", indexedByServer: inRuntimeUserContainer || sourceKind === "index" }];
    }

    if ((!sourceAllowsPlainIds && !inRuntimeUserContainer) || (depth > 1 && !inRuntimeUserContainer) || !fallbackId || blockedFallbacks.has(fallbackId) || isKnownNonUserRuntimeId(fallbackId)) return [];
    if (inRuntimeUserContainer && !primitiveLooksLikeStoredPassword) return [];
    return [{ id: fallbackId, pw: primitiveLooksLikeStoredPassword ? parsed : undefined, type: "owner", indexedByServer: inRuntimeUserContainer || sourceKind === "index" }];
  }

  const rows = [];
  const hasAuthEvidence = hasRuntimeUserAuthEvidence(parsed);
  const directId = getRuntimeAccountId(parsed, { allowNameFallback: hasAuthEvidence });
  const fallbackId = normalizeUserIdText(fallbackKey);
  const hasIndexEvidence = hasRuntimeUserIndexEvidence(parsed);
  const hasAccountLikeDate = Object.prototype.hasOwnProperty.call(parsed, "createdAt") || Object.prototype.hasOwnProperty.call(parsed, "updatedAt") || Object.prototype.hasOwnProperty.call(parsed, "registeredAt");
  const hasTypeEvidence = Object.prototype.hasOwnProperty.call(parsed, "type") || Object.prototype.hasOwnProperty.call(parsed, "role");
  const fallbackLooksLikeUser = !!fallbackId && !blockedFallbacks.has(fallbackId) && !isKnownNonUserRuntimeId(fallbackId) && (
    hasAuthEvidence ||
    (sourceAllowsPlainIds && (hasTypeEvidence || hasAccountLikeDate || hasIndexEvidence)) ||
    (inRuntimeUserContainer && (hasAuthEvidence || hasTypeEvidence || hasAccountLikeDate || hasIndexEvidence || Object.keys(parsed).length <= 12))
  );
  const directLooksLikeUser = !!directId && !isKnownNonUserRuntimeId(directId) && (
    sourceAllowsPlainIds ||
    inRuntimeUserContainer ||
    hasAuthEvidence ||
    hasIndexEvidence ||
    hasAccountLikeDate
  );

  if (directLooksLikeUser || fallbackLooksLikeUser) {
    rows.push({
      ...parsed,
      id: directLooksLikeUser ? directId : fallbackId,
      type: parsed.type || parsed.role || "owner",
      indexedByServer: parsed.indexedByServer === true || inRuntimeUserContainer || sourceKind === "index",
    });
  }

  Object.entries(parsed).forEach(([key, value]) => {
    const nextInRuntimeUserContainer = inRuntimeUserContainer || isRuntimeUserContainerKey(key);
    if (value && typeof value === "object") {
      rows.push(...extractRuntimeUserRows(value, depth + 1, key, { ...options, inUserContainer: nextInRuntimeUserContainer }));
      return;
    }
    if (directLooksLikeUser || fallbackLooksLikeUser) return;
    const keyId = normalizeUserIdText(key);
    if ((sourceAllowsPlainIds || nextInRuntimeUserContainer) && keyId && !blockedFallbacks.has(keyId) && !isKnownNonUserRuntimeId(keyId)) {
      rows.push(...extractRuntimeUserRows(value, depth + 1, key, { ...options, inUserContainer: nextInRuntimeUserContainer }));
    }
  });

  return mergeRuntimeUsers(rows);
}

function isBlockedRuntimeUserToken(value) {
  const id = normalizeUserIdText(value);
  if (!id) return true;
  const lower = id.toLowerCase();
  return new Set([
    "id", "userid", "user_id", "accountid", "account_id", "loginid", "login_id", "username", "name", "ownerid", "owner_id",
    "displayname", "display_name", "nickname", "nick", "handle", "pw", "password", "pass", "passwd", "type", "role",
    "users", "accounts", "members", "owners", "data", "rows", "items", "characters", "design", "theme", "admin", "plc"
  ]).has(lower);
}

function pushLooseRuntimeUser(rows, id, source = "loose") {
  const nextId = normalizeUserIdText(id);
  if (isBlockedRuntimeUserToken(nextId) || isKnownNonUserRuntimeId(nextId)) return;
  if (nextId.length > 80) return;
  if (/^https?:\/\//i.test(nextId) || nextId.includes("/static/") || nextId.includes("data:image/")) return;
  rows.push({ id: nextId, type: "owner", source });
}

function extractRuntimeUserRowsFromLooseText(rawText, options = {}) {
  const raw = String(rawText || "");
  const sourceKind = options.sourceKind || "account";
  const allowLooseIdFields = sourceKind !== "generic";
  if (!raw.trim()) return [];
  const rows = [];

  const fieldPatterns = [
    /["'](?:id|userId|userID|user_id|accountId|accountID|account_id|loginId|loginID|login_id|username|userName|user_name|uid|memberId|memberID|member_id|ownerId|ownerID|owner_id|displayName|display_name|nickname|nick|handle)["']\s*:\s*["']([^"'\n\r]{1,80})["']/gi,
    /(?:^|[,\{\s])(?:id|userId|userID|user_id|accountId|accountID|account_id|loginId|loginID|login_id|username|userName|user_name|uid|memberId|memberID|member_id|ownerId|ownerID|owner_id|displayName|display_name|nickname|nick|handle)\s*[:=]\s*["']([^"'\n\r]{1,80})["']/gi,
  ];

  if (allowLooseIdFields) {
    fieldPatterns.forEach((pattern) => {
      let match;
      while ((match = pattern.exec(raw))) pushLooseRuntimeUser(rows, match[1], "field");
    });
  }

  // { "someId": { "pw": "..." } } / { "someId": { "password": "..." } } 형태를 깊은 중첩이 있어도 놓치지 않습니다.
  const objectKeyPattern = /["']([^"'\n\r]{1,80})["']\s*:\s*\{[\s\S]{0,3600}?["'](?:pw|password|pass|passwd)["']\s*:/gi;
  let keyMatch;
  while ((keyMatch = objectKeyPattern.exec(raw))) pushLooseRuntimeUser(rows, keyMatch[1], "object-key");

  // 로그/임시 파일에 id=abc, userId: abc 식으로 남은 경우까지 회수합니다.
  if (allowLooseIdFields) {
    const linePattern = /(?:^|[\n\r\s,;])(?:id|userId|user_id|accountId|account_id|loginId|login_id|username|nickname|nick|handle)\s*[:=]\s*([A-Za-z0-9가-힣_.@+-]{2,80})/gi;
    let lineMatch;
    while ((lineMatch = linePattern.exec(raw))) pushLooseRuntimeUser(rows, lineMatch[1], "line");
  }

  return mergeRuntimeUsers(rows);
}

const MAX_USER_SOURCE_BYTES = 3 * 1024 * 1024;
const MAX_LOOSE_TEXT_SCAN_BYTES = 768 * 1024;
const RUNTIME_USER_PATH_CACHE_TTL_MS = Number(process.env.RUNTIME_USER_PATH_CACHE_TTL_MS || 5000);
const RUNTIME_USER_SCAN_CACHE_TTL_MS = Number(process.env.RUNTIME_USER_SCAN_CACHE_TTL_MS || 1500);
const runtimeJsonPathCache = new Map();
const runtimeUserRowsCache = new Map();

function clearRuntimeUserCaches() {
  runtimeJsonPathCache.clear();
  runtimeUserRowsCache.clear();
}

function cloneRuntimeUserRows(rows) {
  return Array.isArray(rows) ? rows.map((row) => ({ ...row })) : [];
}

function getRuntimePathsSignature(paths) {
  return (Array.isArray(paths) ? paths : [])
    .filter(Boolean)
    .map((targetPath) => {
      try {
        const resolved = path.resolve(targetPath);
        if (!fs.existsSync(resolved)) return `${resolved}:missing`;
        const stat = fs.statSync(resolved);
        return `${resolved}:${stat.size}:${Math.round(stat.mtimeMs)}`;
      } catch {
        return `${targetPath}:error`;
      }
    })
    .join("|");
}

function isGenericRuntimeUserSource(filePath) {
  const name = path.basename(String(filePath || "")).toLowerCase();
  return ["data.json", "db.json", "database.json", "backup.json", "index.json"].includes(name);
}

function readRuntimeArrayFromExactPath(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return [];
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size <= 0) return [];

    // Render 시작 직후 대형 data/db 파일을 통째로 정규식 스캔하면 프로세스가 134로 죽을 수 있습니다.
    // 확실한 계정 파일은 읽되, 범용 대형 파일은 운영 화면의 안전한 재수집 대상에서도 제외합니다.
    if (stat.size > MAX_USER_SOURCE_BYTES && isGenericRuntimeUserSource(filePath)) return [];

    const raw = fs.readFileSync(filePath, "utf-8");
    const sourceKind = getRuntimeUserSourceKind(filePath);
    const sourceFile = path.basename(String(filePath || "")).toLowerCase();
    const markRuntimeUserSource = (rows) => mergeRuntimeUsers(rows).map((row) => ({
      ...row,
      __runtimeUserSourceKind: sourceKind,
      __runtimeUserSourceFile: sourceFile,
    }));

    let parsedRows = [];
    if (stat.size <= MAX_STARTUP_JSON_PARSE_BYTES) {
      try {
        parsedRows = markRuntimeUserSource(extractRuntimeUserRows(JSON.parse(raw), 0, "", { sourceKind }));
      } catch {}
    }

    const looseRows = raw.length <= MAX_LOOSE_TEXT_SCAN_BYTES
      ? markRuntimeUserSource(extractRuntimeUserRowsFromLooseText(raw, { sourceKind }))
      : [];

    return mergeRuntimeUsers(parsedRows, looseRows);
  } catch {
    return [];
  }
}

function getRuntimeFileSignature(filename) {
  try {
    const filePath = resolveDataPath(filename);
    if (!filePath || !fs.existsSync(filePath)) return "";
    const stat = fs.statSync(filePath);
    return `${stat.size}:${Math.round(stat.mtimeMs)}`;
  } catch {
    return "";
  }
}


function collectJsonPathsDeep(root, { depth = 4, maxFiles = 260, userFilesOnly = true } = {}) {
  const found = [];
  const seen = new Set();
  const blockedDirs = new Set(["node_modules", ".git", "build", "dist", "coverage", ".cache", ".next", "client", "static"]);
  const wantedName = /(user|users|account|accounts|member|members|owner|owners|login|auth|registered|database|db|data|backup|index)/i;
  const allowedExt = /\.(json|bak|txt|log)$/i;

  function shouldTakeFile(entryName, fullPath) {
    const lower = String(entryName || "").toLowerCase();
    if (!allowedExt.test(lower) && !lower.endsWith(".bak.json")) return false;
    if (userFilesOnly && !wantedName.test(entryName) && !wantedName.test(fullPath)) return false;
    try {
      const stat = fs.statSync(fullPath);
      if (stat.size <= 0 || stat.size > MAX_USER_SOURCE_BYTES) return false;
    } catch {
      return false;
    }
    return true;
  }

  function walk(dir, level) {
    if (!dir || found.length >= maxFiles || level > depth) return;
    let realDir = "";
    try {
      if (!fs.existsSync(dir)) return;
      realDir = fs.realpathSync(dir);
      if (seen.has(realDir)) return;
      seen.add(realDir);
      const entries = fs.readdirSync(realDir, { withFileTypes: true });
      for (const entry of entries) {
        if (found.length >= maxFiles) break;
        if (entry.name.startsWith(".") && entry.name !== ".data") continue;
        const fullPath = path.join(realDir, entry.name);
        if (entry.isDirectory()) {
          if (blockedDirs.has(entry.name)) continue;
          walk(fullPath, level + 1);
          continue;
        }
        if (!entry.isFile()) continue;
        if (shouldTakeFile(entry.name, fullPath)) found.push(fullPath);
      }
    } catch {}
  }

  walk(root, 0);
  return found;
}

function getRuntimeSearchRoots({ deep = false } = {}) {
  const baseRoots = [
    DATA_DIR,
    LEGACY_DATA_DIR,
    process.cwd(),
    path.dirname(DATA_DIR),
    path.dirname(LEGACY_DATA_DIR),
  ];

  const deepRoots = deep ? [
    path.resolve(__dirname, ".."),
    path.resolve(process.cwd(), ".."),
    "/var/data",
    "/data",
  ] : [];

  const roots = [];
  const seen = new Set();
  [...baseRoots, ...deepRoots].filter(Boolean).forEach((root) => {
    try {
      const resolved = path.resolve(root);
      if (seen.has(resolved)) return;
      seen.add(resolved);
      roots.push(resolved);
    } catch {}
  });
  return roots;
}

function collectKnownRuntimeJsonPaths(filename, { deep = false } = {}) {
  const cacheKey = `${filename || "json"}:${deep ? "deep" : "shallow"}`;
  const cached = runtimeJsonPathCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.at < RUNTIME_USER_PATH_CACHE_TTL_MS) {
    return cached.paths.slice();
  }

  const roots = getRuntimeSearchRoots({ deep });

  const directUserFiles = [
    "users.json",
    "accounts.json",
    "members.json",
    "owners.json",
    "userList.json",
    "usersDB.json",
    "registeredUsers.json",
    "adminUserIndex.json",
    "allUserIds.json",
    "publicUserIndex.json",
    "auth.json",
    "login.json",
  ];
  const relatedUserFiles = filename === "users.json"
    ? directUserFiles
    : [filename];

  const candidates = [];
  relatedUserFiles.forEach((name) => {
    candidates.push(resolveDataPath(name));
    candidates.push(resolveBundledPath(name));
  });

  roots.forEach((root) => {
    relatedUserFiles.forEach((name) => {
      candidates.push(path.join(root, name));
      ["protocol-last-core-data", "data", "runtime-data", "storage", "db", "database"].forEach((dirName) => {
        candidates.push(path.join(root, dirName, name));
      });
    });
  });

  if (filename === "users.json") {
    roots.forEach((root) => {
      try {
        if (!root || !fs.existsSync(root)) return;
        fs.readdirSync(root, { withFileTypes: true }).forEach((entry) => {
          if (!entry.isFile()) return;
          const lower = entry.name.toLowerCase();
          if (!lower.endsWith(".json")) return;
          if (!/(user|account|member|owner|login|auth|registered)/.test(lower)) return;
          candidates.push(path.join(root, entry.name));
        });
      } catch {}
    });

    if (deep) {
      getRuntimeSearchRoots({ deep: true }).forEach((root) => {
        collectJsonPathsDeep(root, { depth: 3, maxFiles: 120, userFilesOnly: true }).forEach((targetPath) => candidates.push(targetPath));
      });
    }
  }

  const seen = new Set();
  const result = candidates
    .filter(Boolean)
    .map((targetPath) => path.resolve(targetPath))
    .filter((targetPath) => {
      if (seen.has(targetPath)) return false;
      seen.add(targetPath);
      return true;
    });

  runtimeJsonPathCache.set(cacheKey, { at: now, paths: result });
  return result.slice();
}


function getRuntimeUserBackupRows() {
  try {
    const backupDirs = [
      RUNTIME_BACKUP_DIR,
      path.join(DATA_DIR, "backups"),
      path.join(DATA_DIR, "backup"),
      path.join(LEGACY_DATA_DIR, "_backups"),
      path.join(LEGACY_DATA_DIR, "backups"),
    ];
    const candidates = [];
    backupDirs.forEach((dir) => {
      try {
        if (!fs.existsSync(dir)) return;
        fs.readdirSync(dir)
          .filter((name) => /(?:user|account|member|owner|login|auth|registered).*\.(?:json|bak|txt|log)$/i.test(name) || name.endsWith(".bak.json"))
          .sort()
          .slice(-80)
          .forEach((name) => candidates.push(path.join(dir, name)));
      } catch {}
    });
    return mergeRuntimeUsers(...candidates.map(readRuntimeArrayFromExactPath));
  } catch {
    return [];
  }
}

function isDisplayableAdminAccount(user) {
  const id = getRuntimeAccountId(user) || getRuntimeUserId(user);
  if (!id || isBlockedRuntimeUserToken(id) || isKnownNonUserRuntimeId(id)) return false;
  if (/^\d+$/.test(String(id)) && String(id).length >= 10) return false;
  if (/^E-\d+$/i.test(String(id))) return false;

  // 운영 계정 선택은 실제 회원가입/로그인 계정 저장소와 서버가 만든 계정 색인만 표시합니다.
  // 아이템/디자인/패키지 데이터처럼 id만 있는 일반 JSON 객체는 계속 차단합니다.
  const source = String(user?.source || "");
  if (source === "online" || source === "character-owner") return true;
  if (hasRuntimeUserAuthEvidence(user)) return true;

  const sourceFile = path.basename(String(user?.__runtimeUserSourceFile || "")).toLowerCase();
  const sourceKind = String(user?.__runtimeUserSourceKind || "");
  const fromAccountFile = sourceKind === "account" || sourceFile === "users.json" || RUNTIME_USER_SOURCE_NAMES.has(sourceFile);
  const fromServerIndexFile = RUNTIME_USER_INDEX_SOURCE_NAMES.has(sourceFile);

  if (hasRuntimeUserIndexEvidence(user) && (fromServerIndexFile || fromAccountFile)) return true;

  // 과거 배포에서 비밀번호 필드 없이 id/type/createdAt 형태로 저장된 users.json 계정도
  // 운영 목록에서 빠지지 않게 하되, 범용 data/db 파일에서는 허용하지 않습니다.
  if (fromAccountFile && (
    Object.prototype.hasOwnProperty.call(user, "type") ||
    Object.prototype.hasOwnProperty.call(user, "role") ||
    Object.prototype.hasOwnProperty.call(user, "createdAt") ||
    Object.prototype.hasOwnProperty.call(user, "registeredAt")
  )) {
    return true;
  }

  return false;
}

function normalizeRuntimeUserIndexRows(rows) {
  return mergeRuntimeUsers(rows)
    .map((user) => ({
      id: normalizeUserIdText(getRuntimeAccountId(user) || getRuntimeUserId(user)),
      type: user?.type || user?.role || "owner",
      indexedByServer: user?.indexedByServer === true,
    }))
    .filter((user) => user.id && user.id !== "PLC")
    .sort((a, b) => String(a.id || "").localeCompare(String(b.id || ""), "ko"));
}

function areRuntimeUserIndexRowsEquivalent(leftRows, rightRows) {
  return JSON.stringify(normalizeRuntimeUserIndexRows(leftRows)) === JSON.stringify(normalizeRuntimeUserIndexRows(rightRows));
}

function writeRuntimeUserIndexes(userRows) {
  try {
    const safeRows = mergeRuntimeUsers(userRows)
      .filter(isDisplayableAdminAccount)
      .map((user) => ({
        id: getRuntimeAccountId(user) || getRuntimeUserId(user),
        type: user.type || user.role || "owner",
        indexedByServer: true,
      }))
      .filter((user) => user.id && user.id !== "PLC");
    if (safeRows.length === 0) return;
    ["registeredUsers.json", "adminUserIndex.json", "allUserIds.json", "publicUserIndex.json"].forEach((filename) => {
      const indexPath = resolveDataPath(filename);
      const existingRows = readRuntimeArrayFromExactPath(indexPath);
      const mergedRows = mergeRuntimeUsers(existingRows, safeRows);
      if (areRuntimeUserIndexRowsEquivalent(existingRows, mergedRows)) return;
      writeJsonAtomicSync(indexPath, mergedRows);
      clearRuntimeUserCaches();
    });
  } catch (error) {
    console.error("writeRuntimeUserIndexes failed", error);
  }
}

function getAllKnownRuntimeUsersFromDisk({ deep = true } = {}) {
  // 여러 저장 위치/백업이 섞여 있어도 가능한 모든 회원가입 원본을 합쳐 운영 목록에서 누락되지 않게 합니다.
  // 단, 서버 시작 단계에서는 대형 파일 스캔/색인 저장을 하지 않아 Render 시작 실패를 막습니다.
  const pendingUsersPath = resolveDataPath("users.json");
  const pendingPayload = pendingJsonWrites.get(pendingUsersPath)?.payload;
  let pendingRows = [];
  if (pendingPayload) {
    try { pendingRows = pendingPayload.length <= MAX_STARTUP_JSON_PARSE_BYTES ? extractRuntimeUserRows(JSON.parse(pendingPayload), 0, "", { sourceKind: "account" }) : []; } catch {}
  }

  const paths = collectKnownRuntimeJsonPaths("users.json", { deep });
  const directPaths = [
    resolveDataPath("users.json"),
    resolveBundledPath("users.json"),
    path.join(process.cwd(), "users.json"),
    resolveDataPath("registeredUsers.json"),
    resolveDataPath("adminUserIndex.json"),
    resolveDataPath("allUserIds.json"),
    resolveDataPath("publicUserIndex.json"),
  ];
  const cacheable = !pendingPayload;
  const cacheKey = `users:${deep ? "deep" : "shallow"}:${getRuntimePathsSignature([...directPaths, ...paths])}`;
  if (cacheable) {
    const cached = runtimeUserRowsCache.get(cacheKey);
    if (cached && Date.now() - cached.at < RUNTIME_USER_SCAN_CACHE_TTL_MS) {
      return cloneRuntimeUserRows(cached.rows);
    }
  }

  const backupRows = deep ? getRuntimeUserBackupRows() : [];

  const rows = mergeRuntimeUsers(
    ...directPaths.map(readRuntimeArrayFromExactPath),
    backupRows,
    ...paths.reverse().map(readRuntimeArrayFromExactPath),
    pendingRows
  );

  if (deep && rows.length > 0) writeRuntimeUserIndexes(rows);
  if (cacheable) runtimeUserRowsCache.set(cacheKey, { at: Date.now(), rows: cloneRuntimeUserRows(rows) });
  return rows;
}


function refreshUsersFromKnownSources(options = {}) {
  usersDB = mergeRuntimeUsers(getAllKnownRuntimeUsersFromDisk({ deep: options.deep === true }), usersDB);
  return usersDB;
}

function shouldBlockDangerousEmptyWrite(filename, nextValue) {
  if (!PROTECTED_RUNTIME_ARRAYS.has(filename)) return false;
  if (!Array.isArray(nextValue) || nextValue.length > 0) return false;
  const diskRows = getRuntimeArrayFromDisk(filename);
  return diskRows.length > 0;
}

function writeRuntimeArray(filename, value) {
  try {
    const nextValue = Array.isArray(value) ? value : [];
    const filePath = resolveDataPath(filename);

    if (shouldBlockDangerousEmptyWrite(filename, nextValue)) {
      console.error(`[data-protect] ${filename} 빈 배열 저장을 차단했습니다. 기존 데이터 보호 중입니다.`);
      return false;
    }

    if (PROTECTED_RUNTIME_ARRAYS.has(filename)) {
      if (shouldMakeRuntimeBackupNow(filename)) {
        const backupRows = getRowsForBackup(filename, nextValue);
        if (backupRows.length > 0) makeRuntimeBackup(filename, backupRows);
      }
      // 캐릭터/계정 데이터는 홈페이지 수정 중 서버가 꺼져도 유실되지 않도록 즉시 원자 저장합니다.
      writeJsonAtomicSync(filePath, nextValue);
      if (filename === "users.json") clearRuntimeUserCaches();
      if (filename === "characters.json") {
        charactersDiskSignature = getRuntimeFileSignature("characters.json");
        publicCharacterSummaryCache = null;
      }

      // 회원가입은 공통 API 저장소에 저장하고, 운영 화면/이전 코드가 legacy users.json을 읽어도
      // 최신 계정이 누락되지 않도록 users.json만 보조 위치에도 안전하게 동기화합니다.
      if (filename === "users.json") {
        const mirrorPaths = [
          resolveBundledPath(filename),
          path.join(process.cwd(), filename),
          path.join(process.cwd(), "data", filename),
          path.join(process.cwd(), "runtime-data", filename),
          path.join(DATA_DIR, "registeredUsers.json"),
          path.join(DATA_DIR, "adminUserIndex.json"),
        ];
        const written = new Set([path.resolve(filePath)]);
        mirrorPaths.forEach((mirrorPath) => {
          try {
            const resolvedMirrorPath = path.resolve(mirrorPath);
            if (written.has(resolvedMirrorPath)) return;
            written.add(resolvedMirrorPath);
            const previousUsers = readRuntimeArrayFromExactPath(resolvedMirrorPath);
            const mergedUsers = mergeRuntimeUsers(previousUsers, nextValue);
            writeJsonAtomicSync(resolvedMirrorPath, mergedUsers);
          } catch (error) {
            console.error(`[data-mirror] users.json 보조 저장 실패: ${mirrorPath}`, error.message);
          }
        });
      }

      return true;
    }

    scheduleJsonWrite(filePath, nextValue);
    return true;
  } catch (error) {
    console.error(`writeRuntimeArray failed: ${filename}`, error);
    return false;
  }
}

function rememberRegisteredRuntimeUser(user) {
  try {
    const id = getRuntimeUserId(user);
    if (!id || id === "PLC") return;
    const row = { id, type: user?.type || user?.role || "owner", lastSeenAt: new Date().toISOString() };
    writeRuntimeUserIndexes([row]);
  } catch (error) {
    console.error("rememberRegisteredRuntimeUser failed", error);
  }
}

function refreshCharactersFromDiskIfNeeded({ force = false } = {}) {
  const nextSignature = getRuntimeFileSignature("characters.json");
  if (!force && nextSignature && charactersDiskSignature && nextSignature === charactersDiskSignature) {
    return charactersDB;
  }

  const diskCharacters = getRuntimeArrayFromDisk("characters.json");
  if (diskCharacters.length > 0 && (force || !Array.isArray(charactersDB) || charactersDB.length === 0 || diskCharacters.length >= charactersDB.length || nextSignature !== charactersDiskSignature)) {
    charactersDB = diskCharacters;
  }
  charactersDiskSignature = nextSignature || charactersDiskSignature;
  return charactersDB;
}

let usersDB = mergeRuntimeUsers(readRuntimeArray("users.json"), getAllKnownRuntimeUsersFromDisk({ deep: false }));
let charactersDB = readRuntimeArray("characters.json");
let charactersDiskSignature = getRuntimeFileSignature("characters.json");
let roomChats = {};

function mergeRuntimeUsers(...lists) {
  const merged = [];
  const indexById = new Map();

  lists.forEach((list) => {
    if (!Array.isArray(list)) return;
    list.forEach((user) => {
      if (!user || typeof user !== "object") return;
      const id = getRuntimeUserId(user);
      if (!id) return;
      const key = id.toLowerCase();
      const normalized = {
        ...user,
        id,
        type: user.type || user.role || "owner",
      };

      if (indexById.has(key)) {
        const index = indexById.get(key);
        merged[index] = { ...merged[index], ...normalized, id: merged[index].id || id };
      } else {
        indexById.set(key, merged.length);
        merged.push(normalized);
      }
    });
  });

  return merged;
}

function refreshProtectedRuntimeArraysIfNeeded() {
  refreshUsersFromKnownSources();
  refreshCharactersFromDiskIfNeeded();
}

function getOnlineRuntimeUserRows() {
  try {
    return Object.values(socketUsers || {})
      .map((user) => ({
        id: getRuntimeAccountId(user) || normalizeUserIdText(user?.accountKey) || getRuntimeUserId(user),
        type: user?.type || "owner",
        source: "online",
      }))
      .filter((user) => user.id && isDisplayableAdminAccount(user));
  } catch {
    return [];
  }
}

function getRuntimeAccountRowsFromCharacters() {
  try {
    const rows = [];
    const seenCharacterKeys = new Set();
    const sourceCharacters = [];
    [charactersDB, getRuntimeArrayFromDisk("characters.json")].forEach((list) => {
      if (!Array.isArray(list)) return;
      list.forEach((character, index) => {
        if (!character || typeof character !== "object") return;
        const key = normalizeUserIdText(character.id || character.name || character.characterId || String(index));
        if (key && seenCharacterKeys.has(key.toLowerCase())) return;
        if (key) seenCharacterKeys.add(key.toLowerCase());
        sourceCharacters.push(character);
      });
    });
    sourceCharacters.forEach((character) => {
      if (!character || typeof character !== "object") return;
      [
        character.ownerId,
        character.ownerID,
        character.owner_id,
        character.accountId,
        character.accountID,
        character.account_id,
        character.userId,
        character.userID,
        character.user_id,
        character.loginId,
        character.loginID,
        character.login_id,
        character.createdBy,
        character.updatedBy,
      ].forEach((value) => {
        const id = normalizeUserIdText(value);
        if (id && !isKnownNonUserRuntimeId(id) && !isBlockedRuntimeUserToken(id)) {
          rows.push({ id, type: "owner", source: "character-owner" });
        }
      });
    });
    return mergeRuntimeUsers(rows);
  } catch {
    return [];
  }
}

function getSafeUsersForAdmin(searchText = "", options = {}) {
  const deep = options.deep === true || !!normalizeUserIdText(searchText);
  refreshUsersFromKnownSources({ deep: false });

  const knownDiskRows = getAllKnownRuntimeUsersFromDisk({ deep });
  const safeRows = mergeRuntimeUsers(knownDiskRows, usersDB, getOnlineRuntimeUserRows())
    .filter(isDisplayableAdminAccount)
    .map((user) => ({
      id: getRuntimeAccountId(user) || getRuntimeUserId(user),
      type: user.type || "owner",
    }));

  const keyword = normalizeUserIdText(searchText).toLowerCase();
  const filteredRows = keyword
    ? safeRows.filter((user) => {
        const id = normalizeUserIdText(user.id).toLowerCase();
        const type = String(user.type || "").toLowerCase();
        return id.includes(keyword) || type.includes(keyword);
      })
    : safeRows;

  return filteredRows.sort((a, b) => String(a.id || "").localeCompare(String(b.id || ""), "ko"));
}


function getDirectAdminAccountRows(searchText = "", options = {}) {
  // 운영 계정 선택 전용: 실제 계정 저장/색인 파일만 직접 읽습니다.
  // data/db/backup처럼 아이템·디자인 객체가 섞일 수 있는 범용 JSON은 여기서 읽지 않습니다.
  const directFiles = [
    "users.json",
    "accounts.json",
    "members.json",
    "owners.json",
    "userList.json",
    "usersDB.json",
    "registeredUsers.json",
    "adminUserIndex.json",
    "allUserIds.json",
    "publicUserIndex.json",
    "auth.json",
    "login.json",
  ];

  const directPaths = [];
  directFiles.forEach((filename) => {
    directPaths.push(resolveDataPath(filename));
    directPaths.push(resolveBundledPath(filename));
    directPaths.push(path.join(process.cwd(), filename));
  });

  const deep = options.deep === true;
  const rows = mergeRuntimeUsers(
    ...directPaths.map(readRuntimeArrayFromExactPath),
    ...(deep ? [getAllKnownRuntimeUsersFromDisk({ deep: true })] : []),
    usersDB,
    getOnlineRuntimeUserRows()
  )
    .filter(isDisplayableAdminAccount)
    .map((user) => ({
      id: getRuntimeAccountId(user) || getRuntimeUserId(user),
      type: user.type || user.role || "owner",
    }))
    .filter((user) => user.id && !isKnownNonUserRuntimeId(user.id));

  const keyword = normalizeUserIdText(searchText).toLowerCase();
  const filteredRows = keyword
    ? rows.filter((user) => {
        const id = normalizeUserIdText(user.id).toLowerCase();
        const type = String(user.type || "").toLowerCase();
        return id.includes(keyword) || type.includes(keyword);
      })
    : rows;

  return mergeRuntimeUsers(filteredRows).sort((a, b) => String(a.id || "").localeCompare(String(b.id || ""), "ko"));
}

function getExactAdminUser(userId = "") {
  refreshProtectedRuntimeArraysIfNeeded();
  const keyword = normalizeUserIdText(userId).toLowerCase();
  if (!keyword) return null;
  return getSafeUsersForAdmin("").find((user) => normalizeUserIdText(user.id).toLowerCase() === keyword) || null;
}

let socketUsers = {};
let dailyInvestigationAttempts = {};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}


function isDataImage(value) {
  return typeof value === "string" && /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(value);
}

function pathSegments(pathKey = "") {
  return String(pathKey || "").match(/[^.[\]]+/g) || [];
}

function getValueByPath(source, pathKey = "") {
  return pathSegments(pathKey).reduce((acc, key) => (acc == null ? undefined : acc[key]), source);
}

function mapDataImages(source, makeUrl, currentPath = "") {
  if (Array.isArray(source)) return source.map((value, index) => mapDataImages(value, makeUrl, `${currentPath}[${index}]`));
  if (source && typeof source === "object") {
    return Object.fromEntries(
      Object.entries(source).map(([key, value]) => {
        const nextPath = currentPath ? `${currentPath}.${key}` : key;
        return [key, mapDataImages(value, makeUrl, nextPath)];
      })
    );
  }
  if (isDataImage(source)) return makeUrl(currentPath, source);
  return source;
}

const DATA_IMAGE_RESPONSE_CACHE = new Map();
const DATA_IMAGE_RESPONSE_CACHE_LIMIT = Number(process.env.IMAGE_MEMORY_CACHE_LIMIT || 160);

function makeWeakEtagFromText(text) {
  const source = String(text || "");
  const headHash = source.slice(0, 80).split("").reduce((sum, ch) => (sum + ch.charCodeAt(0)) % 1000000007, 0).toString(36);
  return 'W/"' + source.length.toString(36) + '-' + headHash + '"';
}

function rememberDataImageCache(key, value) {
  if (DATA_IMAGE_RESPONSE_CACHE.has(key)) DATA_IMAGE_RESPONSE_CACHE.delete(key);
  DATA_IMAGE_RESPONSE_CACHE.set(key, value);
  while (DATA_IMAGE_RESPONSE_CACHE.size > DATA_IMAGE_RESPONSE_CACHE_LIMIT) {
    const firstKey = DATA_IMAGE_RESPONSE_CACHE.keys().next().value;
    DATA_IMAGE_RESPONSE_CACHE.delete(firstKey);
  }
}

function reqFresh(req, etag) {
  const incoming = String(req?.headers?.["if-none-match"] || "");
  return incoming && incoming.split(",").map((part) => part.trim()).includes(etag);
}

function sendDataImage(res, value) {
  const raw = String(value || "");
  const match = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return res.status(404).end();
  const [, mime, payload] = match;
  const etag = makeWeakEtagFromText(raw);
  res.set("Cache-Control", "public, max-age=31536000, immutable");
  res.set("ETag", etag);
  res.set("Accept-Ranges", "bytes");
  res.type(mime);
  if (reqFresh(res.req, etag)) return res.status(304).end();
  let cached = DATA_IMAGE_RESPONSE_CACHE.get(etag);
  if (!cached) {
    cached = { mime, buffer: Buffer.from(payload, "base64") };
    rememberDataImageCache(etag, cached);
  }
  return res.send(cached.buffer);
}

function toCharacterAssetUrl(characterId, pathKey, version = "") {
  const base = `/asset/character/${encodeURIComponent(String(characterId || "unknown"))}?path=${encodeURIComponent(String(pathKey || ""))}`;
  return version ? `${base}&v=${encodeURIComponent(String(version))}` : base;
}

function toInvestigationAssetUrl(investigationId, pathKey) {
  return `/asset/investigation/${encodeURIComponent(String(investigationId || "unknown"))}?path=${encodeURIComponent(String(pathKey || ""))}`;
}

function toDesignAssetUrl(pathKey, version = designAssetVersion) {
  const base = `/asset/design?path=${encodeURIComponent(String(pathKey || ""))}`;
  return version ? `${base}&v=${encodeURIComponent(String(version))}` : base;
}

function applyCharacterCorrosion(character, amount = 0) {
  const delta = Math.max(0, Number(amount || 0));
  if (!character || delta <= 0) return character;
  character.corrosion = Math.max(0, Math.min(100, Number(character.corrosion || 0) + delta));
  return character;
}

function createLogEntry(text) {
  return {
    id: Date.now() + Math.random(),
    text,
    time: new Date().toISOString(),
  };
}

function getTodayKey() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function canDoDaily(characterName) {
  const today = getTodayKey();
  if (!dailyInvestigationAttempts[today]) dailyInvestigationAttempts[today] = {};
  return !dailyInvestigationAttempts[today][characterName];
}

function markDaily(characterName) {
  const today = getTodayKey();
  if (!dailyInvestigationAttempts[today]) dailyInvestigationAttempts[today] = {};
  dailyInvestigationAttempts[today][characterName] = true;
}

const defaultTheme = {
  bgMain: "#040812",
  panel: "rgba(10, 18, 34, 0.62)",
  textMain: "#f5fbff",
  accent: "#7edcff",
  line: "rgba(196, 228, 255, 0.12)",
  fontFamily: '"Pretendard", "Noto Sans KR", "Apple SD Gothic Neo", sans-serif',
};

function loadSavedDesignConfigAtStartup() {
  const runtimeDesign = readJsonFromPath(resolveDataPath("designConfig.json"), null);
  if (runtimeDesign && typeof runtimeDesign === "object") return runtimeDesign;
  return readJsonFromPath(resolveBundledPath("designConfig.json"), {});
}

const savedDesign = loadSavedDesignConfigAtStartup();
let designConfig = defaultDesign;
let designAssetVersion = Date.now();
if (savedDesign && typeof savedDesign === "object") {
  designConfig = {
    ...defaultDesign,
    ...savedDesign,
    theme: { ...(defaultDesign.theme || {}), ...(savedDesign.theme || {}) },
    pages: { ...(defaultDesign.pages || {}), ...(savedDesign.pages || {}) },
    siteContent: { ...(defaultDesign.siteContent || {}), ...(savedDesign.siteContent || {}) },
    sharedShellElements: Array.isArray(savedDesign.sharedShellElements) ? savedDesign.sharedShellElements : (Array.isArray(defaultDesign.sharedShellElements) ? defaultDesign.sharedShellElements : []),
    sharedShellOverrides: typeof savedDesign.sharedShellOverrides === "object" && savedDesign.sharedShellOverrides ? savedDesign.sharedShellOverrides : (defaultDesign.sharedShellOverrides || {}),
  };
}

let publicDesignShellCache = null;
let publicDesignMapsCache = null;

const STAT_RULES = {
  baseHp: 100,
  hpPerPoint: 10,
  maxHp: 500,
  maxHpPoints: 40,
  baseCombat: 10,
  combatPerPoint: 5,
  maxCombatTotal: 100,
  maxCombatPoints: 18,
};

function clampNumber(value, min, max) {
  const next = Number(value || 0);
  if (!Number.isFinite(next)) return min;
  return Math.max(min, Math.min(max, next));
}

function getCharacterHpStat(rawHp) {
  const value = Number(rawHp || 0);
  if (value >= STAT_RULES.baseHp) return clampNumber(Math.round((value - STAT_RULES.baseHp) / STAT_RULES.hpPerPoint), 0, STAT_RULES.maxHpPoints);
  return clampNumber(value, 0, STAT_RULES.maxHpPoints);
}

function getCharacterMaxHp(rawHp) {
  return Math.min(STAT_RULES.maxHp, STAT_RULES.baseHp + getCharacterHpStat(rawHp) * STAT_RULES.hpPerPoint);
}

function getCombatStatPoint(rawValue) {
  return clampNumber(rawValue, 0, STAT_RULES.maxCombatPoints);
}

function getCombatStatTotal(rawValue) {
  return Math.min(STAT_RULES.maxCombatTotal, STAT_RULES.baseCombat + getCombatStatPoint(rawValue) * STAT_RULES.combatPerPoint);
}

function normalizeCharacterStats(stats = {}) {
  return {
    hp: getCharacterHpStat(stats?.hp),
    atk: getCombatStatPoint(stats?.atk),
    def: getCombatStatPoint(stats?.def),
    agi: getCombatStatPoint(stats?.agi),
  };
}

function getCharacterCurrentHp(character) {
  const maxHp = getCharacterMaxHp(character?.stats?.hp);
  const current = Number(character?.currentHp);
  if (Number.isFinite(current)) return Math.max(0, Math.min(maxHp, current));
  return maxHp;
}

function getIncomingDamageAfterDefense(rawDamage, defenderState) {
  const baseDamage = Math.max(1, Number(rawDamage || 0));
  const defTotal = clampNumber(defenderState?.def, 0, STAT_RULES.maxCombatTotal);
  const guardBonus = typeof getBuffValue === "function" ? getBuffValue(defenderState, "guardUp") : 0;
  const reductionPercent = Math.min(80, (defenderState?.defending ? defTotal * 2 : defTotal) + Number(guardBonus || 0));
  return Math.max(1, Math.ceil(baseDamage * (1 - reductionPercent / 100)));
}

function baseParticipantState(character) {
  const safeStats = normalizeCharacterStats(character?.stats || {});
  const maxHp = getCharacterMaxHp(safeStats.hp);
  const hp = getCharacterCurrentHp({ ...character, stats: safeStats });
  const spriteImage = character?.spriteImage || character?.sdImage || character?.sdImageUrl || character?.sd || character?.investigationImage || character?.image || "";
  const investigationImage = character?.investigationImage || spriteImage || character?.image || "";
  return {
    name: character?.name || "알 수 없음",
    maxHp,
    hp,
    status: "정상",
    atk: getCombatStatTotal(safeStats.atk),
    def: getCombatStatTotal(safeStats.def),
    agi: getCombatStatTotal(safeStats.agi),
    image: investigationImage || character?.image || "",
    investigationImage,
    spriteImage,
    sdImage: spriteImage,
    defending: false,
    buffs: [],
    skillCooldowns: {},
  };
}

function normalizeChoice(choice) {
  return {
    text: String(choice?.text || ""),
    target: String(choice?.target || ""),
  };
}

function normalizeClue(clue) {
  return {
    id: String(clue?.id || ""),
    title: String(clue?.title || clue?.name || "단서"),
    text: String(clue?.text || clue?.description || ""),
    description: String(clue?.description || clue?.text || ""),
    image: String(clue?.image || ""),
  };
}

function normalizeNpcScene(scene) {
  if (!scene) return null;
  return {
    name: String(scene?.name || ""),
    image: String(scene?.image || scene?.sdImage || ""),
    sdImage: String(scene?.sdImage || scene?.image || ""),
    profileImage: String(scene?.profileImage || scene?.npcProfileImage || scene?.portrait || scene?.dialogueImage || ""),
    npcProfileImage: String(scene?.npcProfileImage || scene?.profileImage || scene?.portrait || scene?.dialogueImage || ""),
    portrait: String(scene?.portrait || scene?.profileImage || scene?.npcProfileImage || scene?.dialogueImage || ""),
    dialogueImage: String(scene?.dialogueImage || scene?.profileImage || scene?.npcProfileImage || scene?.portrait || ""),
    lines: Array.isArray(scene?.lines)
      ? scene.lines.map((line) => ({
          text: String(line?.text || ""),
          options: Array.isArray(line?.options)
            ? line.options.map((option) => ({
                text: String(option?.text || ""),
                nextIndex: option?.nextIndex === "" || option?.nextIndex === undefined || option?.nextIndex === null ? undefined : Number(option.nextIndex),
                rewardItem: String(option?.rewardItem || ""),
                rewardStatPoints: Number(option?.rewardStatPoints || 0),
                clue: option?.clue || "",
              }))
            : [],
        }))
      : [],
  };
}

function normalizeInvestigationImageFrame(frame) {
  return {
    x: Number(frame?.x ?? 50),
    y: Number(frame?.y ?? 50),
    scale: Number(frame?.scale ?? 1),
  };
}

function normalizeActionResult(result) {
  const clueTitle = String(result?.clue || "");
  const clueText = String(result?.clueText || "");
  const clueImage = String(result?.clueImage || "");
  return {
    log: String(result?.log || ""),
    points: Number(result?.points || 0),
    item: String(result?.item || ""),
    reward: String(result?.reward || ""),
    clue: clueTitle
      ? {
          title: clueTitle,
          text: clueText,
          description: clueText,
          image: clueImage,
        }
      : "",
    statPoints: Number(result?.statPoints || 0),
    damage: Number(result?.damage || 0),
    muteMinutes: Number(result?.muteMinutes || 0),
    corrosionIncrease: Number(result?.corrosionIncrease || 0),
  };
}

function normalizeBattleEnemy(enemy, index = 0) {
  const baseHp = Number(enemy?.hp ?? enemy?.maxHp ?? 0);
  return {
    id: String(enemy?.id || `enemy-${index + 1}`),
    name: String(enemy?.name || `E-Beast ${index + 1}`),
    hp: Number(enemy?.hp ?? baseHp),
    maxHp: Number(enemy?.maxHp ?? baseHp),
    atk: Number(enemy?.atk || 0),
    def: Number(enemy?.def || 0),
    agi: Number(enemy?.agi || 0),
    aoe_chance: Number(enemy?.aoe_chance ?? 0.3),
    finisher_chance: Number(enemy?.finisher_chance ?? 0.05),
    finisherType: String(enemy?.finisherType || "single"),
    rewardPoints: Number(enemy?.rewardPoints || 0),
    rewardItem: String(enemy?.rewardItem || ""),
    image: String(enemy?.image || ""),
    __engaged: !!enemy?.__engaged,
    turnsElapsed: Number(enemy?.turnsElapsed || 0),
    buffs: Array.isArray(enemy?.buffs) ? enemy.buffs : [],
  };
}

function syncBattleEnemyTotals(battle) {
  if (!battle) return null;
  const enemies = Array.isArray(battle.enemies) ? battle.enemies : [];
  if (!enemies.length) return battle;
  battle.hp = enemies.reduce((sum, enemy) => sum + Math.max(0, Number(enemy?.hp || 0)), 0);
  battle.maxHp = enemies.reduce((sum, enemy) => sum + Math.max(0, Number(enemy?.maxHp || enemy?.hp || 0)), 0);
  const firstAlive = enemies.find((enemy) => Number(enemy?.hp || 0) > 0) || enemies[0];
  battle.name = enemies.length === 1 ? String(firstAlive?.name || battle.name || "E-Beast") : String(battle.name || `E-Beast x${enemies.length}`);
  battle.atk = Number(firstAlive?.atk || battle.atk || 0);
  battle.def = Number(firstAlive?.def || battle.def || 0);
  battle.agi = Number(firstAlive?.agi || battle.agi || 0);
  battle.aoe_chance = Number(firstAlive?.aoe_chance ?? battle.aoe_chance ?? 0.3);
  battle.finisher_chance = Number(firstAlive?.finisher_chance ?? battle.finisher_chance ?? 0.05);
  battle.finisherType = String(firstAlive?.finisherType || battle.finisherType || "single");
  battle.image = String(firstAlive?.image || battle.image || "");
  return battle;
}

function normalizeBattle(battle) {
  if (!battle) return null;
  const rawEnemies = Array.isArray(battle) ? battle : Array.isArray(battle?.enemies) ? battle.enemies : [battle];
  const enemies = rawEnemies.map((enemy, index) => normalizeBattleEnemy(enemy, index)).filter((enemy) => enemy.maxHp > 0 || enemy.hp > 0 || enemy.name);
  if (!enemies.length) return null;
  const normalized = {
    ...normalizeBattleEnemy({ ...battle, name: battle?.name || (enemies.length > 1 ? `E-Beast x${enemies.length}` : enemies[0]?.name) }, 0),
    enemies,
    rewardPoints: Number(battle?.rewardPoints ?? enemies.reduce((sum, enemy) => sum + Number(enemy.rewardPoints || 0), 0)),
    rewardItem: String(battle?.rewardItem || ""),
  };
  return syncBattleEnemyTotals(normalized);
}

function getBattleEnemies(battle) {
  if (!battle) return [];
  if (!Array.isArray(battle.enemies) || battle.enemies.length === 0) battle.enemies = [normalizeBattleEnemy(battle, 0)];
  battle.enemies = battle.enemies.map((enemy, index) => normalizeBattleEnemy(enemy, index));
  syncBattleEnemyTotals(battle);
  return battle.enemies;
}

function getAliveBattleEnemies(battle) {
  return getBattleEnemies(battle).filter((enemy) => Number(enemy?.hp || 0) > 0);
}

function makeBattleSnapshot(item, battle) {
  syncBattleEnemyTotals(battle);
  return {
    participantStates: cloneParticipantStates(item.participantStates),
    battleHp: Number(battle?.hp || 0),
    battleMaxHp: Number(battle?.maxHp || 0),
    battleEnemies: clone(getBattleEnemies(battle)),
  };
}

function normalizeNode(key, node) {
  return {
    id: key,
    name: node.name || key,
    log: node.log || "",
    image: String(node?.image || ""),
    investigations: Array.isArray(node.investigations) ? node.investigations.filter(Boolean) : [],
    battle: normalizeBattle(node.battle),
    choices: Array.isArray(node.choices) ? node.choices.map(normalizeChoice).filter((choice) => choice.text) : [],
    npc: Array.isArray(node.npc) ? node.npc : [],
    npcScene: normalizeNpcScene(node.npcScene),
    clues: Array.isArray(node.clues) ? node.clues.map(normalizeClue) : [],
    onEnterDamage: Number(node?.onEnterDamage || 0),
    onEnterMuteMinutes: Number(node?.onEnterMuteMinutes || 0),
    mapX: typeof node.mapX === "number" ? node.mapX : Number(node?.mapX || 0),
    mapY: typeof node.mapY === "number" ? node.mapY : Number(node?.mapY || 0),
    actionResults: Object.fromEntries(Object.entries(node.actionResults || {}).map(([key, value]) => [key, normalizeActionResult(value)])),
  };
}

function buildInvestigation(def) {
  const bgmUrl = String(def?.bgmUrl || def?.data?.bgmUrl || "");
  const normalizedNodes = Object.fromEntries(
    Object.entries(def.data.nodes).map(([key, node]) => [key, normalizeNode(key, node)])
  );
  const nodeIds = Object.keys(normalizedNodes);
  const requestedStartNodeId = String(def.data.start || "").trim();
  const startNodeId = normalizedNodes[requestedStartNodeId] ? requestedStartNodeId : (nodeIds[0] || "start");
  const startNode = normalizedNodes[startNodeId] || { name: startNodeId || "시작 지점", log: "" };

  return {
    id: def.id,
    title: def.title,
    type: def.type,
    listImage: String(def?.listImage || def?.data?.listImage || ""),
    entryImage: String(def?.entryImage || def?.data?.entryImage || def?.listImage || def?.data?.listImage || ""),
    listImageFrame: normalizeInvestigationImageFrame(def?.listImageFrame || def?.data?.listImageFrame),
    entryImageFrame: normalizeInvestigationImageFrame(def?.entryImageFrame || def?.data?.entryImageFrame || def?.listImageFrame || def?.data?.listImageFrame),
    imageUpdatedAt: Number(def?.imageUpdatedAt ?? def?.data?.imageUpdatedAt ?? 0),
    entryCorrosion: Number(def?.entryCorrosion ?? def?.data?.entryCorrosion ?? 0),
    endCorrosion: Number(def?.endCorrosion ?? def?.data?.endCorrosion ?? 0),
    bgmUrl,
    bgmVolume: Number(def?.bgmVolume ?? def?.data?.bgmVolume ?? 1),
    data: {
      ...def.data,
      backgroundImage: def?.data?.backgroundImage || def?.backgroundImage || "",
      listImage: String(def?.listImage || def?.data?.listImage || ""),
      entryImage: String(def?.entryImage || def?.data?.entryImage || def?.listImage || def?.data?.listImage || ""),
      listImageFrame: normalizeInvestigationImageFrame(def?.listImageFrame || def?.data?.listImageFrame),
      entryImageFrame: normalizeInvestigationImageFrame(def?.entryImageFrame || def?.data?.entryImageFrame || def?.listImageFrame || def?.data?.listImageFrame),
      imageUpdatedAt: Number(def?.imageUpdatedAt ?? def?.data?.imageUpdatedAt ?? 0),
      entryCorrosion: Number(def?.entryCorrosion ?? def?.data?.entryCorrosion ?? 0),
      endCorrosion: Number(def?.endCorrosion ?? def?.data?.endCorrosion ?? 0),
      bgmUrl,
      bgmVolume: Number(def?.bgmVolume ?? def?.data?.bgmVolume ?? 1),
      nodes: normalizedNodes,
      start: startNodeId,
    },
    opened: def?.opened !== undefined ? !!def.opened : true,
    hidden: def?.hidden !== undefined ? !!def.hidden : false,
    scheduleEnabled: def?.scheduleEnabled !== undefined ? !!def.scheduleEnabled : false,
    openAt: String(def?.openAt || ""),
    closeAt: String(def?.closeAt || ""),
    started: false,
    ended: false,
    endedAt: "",
    endedReason: "",
    leaders: [],
    participants: [],
    currentNodeId: startNodeId,
    sharedLog: startNode.log,
    sharedLogs: [createLogEntry(startNode.log)],
    routeHistory: [{ nodeId: startNodeId, name: startNode.name, time: new Date().toISOString() }],
    foundItems: [],
    foundNPCs: [],
    rewards: [],
    points: 0,
    discoveredFlags: {},
    participantStates: {},
    resultSummary: "",
    battleTurn: 1,
    pendingBattleActions: {},
    lastBattleRound: [],
    pendingRewardQueue: [],
    endCorrosionApplied: false,
    originalTemplate: clone(def),
  };
}

const investigationDefinitions = [
  {
    id: "investigation-1",
    title: "대저택 조사",
    type: "group",
    data: {
      start: "entrance",
      nodes: {
        entrance: {
          name: "현관",
          log: "대저택의 현관에 도착했습니다.",
          investigations: ["현관문 조사", "바닥 조사"],
          battle: null,
          npc: ["관리인 메모"],
          mapX: 20,
          mapY: 50,
          choices: [
            { text: "큰 방으로 이동", target: "bigRoom" },
            { text: "부엌으로 이동", target: "kitchen" },
          ],
          actionResults: {
            "현관문 조사": { log: "문틀에 긁힌 흔적이 있습니다. 누군가 급히 안으로 들어간 것 같습니다.", points: 5, item: "문틀 파편", reward: "현관 단서 확보" },
            "바닥 조사": { log: "바닥에서 젖은 발자국을 발견했습니다. 큰 방 쪽으로 이어집니다.", points: 4, npc: "관리인의 이동 흔적" },
          },
        },
        bigRoom: {
          name: "큰 방",
          log: "넓은 큰 방입니다. 먼지가 가득합니다.",
          investigations: ["책장 조사", "벽난로 조사"],
          battle: null,
          npc: ["초상화 속 인물"],
          mapX: 48,
          mapY: 36,
          choices: [
            { text: "현관으로 돌아간다", target: "entrance" },
            { text: "작은 방으로 이동", target: "smallRoom" },
          ],
          actionResults: {
            "책장 조사": { log: "숨겨진 기록철을 발견했습니다. 실종자 명단 일부가 찢겨 있습니다.", points: 8, item: "찢긴 기록철", reward: "실종자 단서" },
            "벽난로 조사": { log: "벽난로 뒤쪽에서 오래된 열쇠 하나가 발견되었다.", points: 6, item: "녹슨 열쇠" },
          },
        },
        kitchen: {
          name: "부엌",
          log: "부엌 안쪽에서 수상한 기척이 느껴집니다.",
          investigations: ["식탁 조사", "찬장 조사"],
          battle: { name: "오염체 잔존체", hp: 36, maxHp: 36, atk: 7, def: 3, aoe_chance: 0.25, rewardPoints: 12, rewardItem: "오염핵 파편" },
          npc: ["부엌 종업원 기록"],
          mapX: 48,
          mapY: 64,
          choices: [{ text: "현관으로 돌아간다", target: "entrance" }],
          actionResults: {
            "식탁 조사": { log: "식탁 밑에서 부서진 약병과 응급 붕대를 찾았습니다.", points: 4, item: "응급 붕대" },
            "찬장 조사": { log: "찬장 속 장부에서 최근 이상 징후를 적은 메모를 발견했습니다.", points: 7, npc: "종업원의 메모" },
          },
        },
        smallRoom: {
          name: "작은 방",
          log: "작은 방입니다. 누군가 머문 흔적이 있습니다.",
          investigations: ["침대 조사", "창문 조사"],
          battle: null,
          npc: ["실종자의 흔적"],
          mapX: 76,
          mapY: 36,
          choices: [{ text: "큰 방으로 돌아간다", target: "bigRoom" }],
          actionResults: {
            "침대 조사": { log: "침대 아래에서 사진 한 장을 발견했습니다. 대저택 주인과 관리인의 사진입니다.", points: 5, item: "낡은 사진", reward: "인물 관계 단서" },
            "창문 조사": { log: "창문 밖으로 정원으로 향하는 흔적을 발견했습니다.", points: 3 },
          },
        },
      },
    },
  },
  {
    id: "investigation-2",
    title: "폐병원 조사",
    type: "daily",
    data: {
      start: "hall",
      nodes: {
        hall: {
          name: "로비",
          log: "폐병원 로비에 들어섰습니다.",
          investigations: ["접수대 조사", "안내판 조사"],
          battle: null,
          npc: ["야간근무 기록"],
          mapX: 18,
          mapY: 50,
          choices: [
            { text: "진료실로 이동", target: "ward" },
            { text: "지하 통로로 이동", target: "basement" },
          ],
          actionResults: {
            "접수대 조사": { log: "접수대 서랍에서 잠긴 약품 보관함 키를 찾았습니다.", points: 4, item: "약품 보관함 키" },
            "안내판 조사": { log: "안내판에서 환자 이송 경로를 확인했습니다.", points: 2 },
          },
        },
        ward: {
          name: "진료실",
          log: "낡은 진료기구와 차가운 침대가 보입니다.",
          investigations: ["캐비닛 조사", "침대 조사"],
          battle: null,
          npc: ["담당 의사의 메모"],
          mapX: 52,
          mapY: 34,
          choices: [{ text: "로비로 돌아간다", target: "hall" }],
          actionResults: {
            "캐비닛 조사": { log: "캐비닛 안에서 소독약과 사용기록을 발견했습니다.", points: 5, item: "소독약" },
            "침대 조사": { log: "침대 밑에 숨겨진 환자 메모가 있습니다. 지하를 경계하라는 글이 적혀 있습니다.", points: 6, reward: "지하 경고 확보" },
          },
        },
        basement: {
          name: "지하 통로",
          log: "축축한 냄새가 감도는 지하 통로입니다.",
          investigations: ["배관 조사", "보관함 조사"],
          battle: { name: "배회 오염체", hp: 28, maxHp: 28, atk: 6, def: 2, aoe_chance: 0.2, rewardPoints: 10, rewardItem: "손상된 출입카드" },
          npc: ["지하 격리실 표식"],
          mapX: 56,
          mapY: 66,
          choices: [{ text: "로비로 돌아간다", target: "hall" }],
          actionResults: {
            "배관 조사": { log: "배관 사이에서 수상한 액체 샘플을 확보했습니다.", points: 4, item: "수상한 샘플" },
            "보관함 조사": { log: "보관함 안에서 지하 격리실의 출입 기록을 찾았습니다.", points: 6, reward: "격리실 출입 기록" },
          },
        },
      },
    },
  },
  {
    id: "test-multi-enemy-battle",
    title: "[테스트] 다중 적 전투 확인용 단체조사",
    type: "group",
    data: {
      start: "testEntry",
      nodes: {
        testEntry: {
          name: "테스트 진입로",
          log: "다중 적 전투를 확인하기 위한 테스트 구역입니다.",
          investigations: ["전투 구역 확인"],
          battle: null,
          npc: [],
          mapX: 24,
          mapY: 52,
          choices: [{ text: "다중 적 전투 구역으로 이동", target: "testBattleRoom" }],
          actionResults: {
            "전투 구역 확인": { log: "앞쪽에서 여러 개의 오염 반응이 동시에 감지됩니다.", points: 1 },
          },
        },
        testBattleRoom: {
          name: "다중 적 전투 구역",
          log: "세 개체의 오염체가 동시에 출현했습니다.",
          investigations: [],
          battle: {
            name: "테스트 오염체 무리",
            enemies: [
              { id: "test-enemy-1", name: "테스트 오염체 A", hp: 24, maxHp: 24, atk: 6, def: 2, agi: 8, aoe_chance: 0.1, finisher_chance: 0.02, finisherType: "single", rewardPoints: 4, rewardItem: "" },
              { id: "test-enemy-2", name: "테스트 오염체 B", hp: 30, maxHp: 30, atk: 7, def: 3, agi: 6, aoe_chance: 0.2, finisher_chance: 0.02, finisherType: "single", rewardPoints: 5, rewardItem: "" },
              { id: "test-enemy-3", name: "테스트 오염체 C", hp: 20, maxHp: 20, atk: 5, def: 1, agi: 10, aoe_chance: 0.35, finisher_chance: 0.03, finisherType: "aoe", rewardPoints: 4, rewardItem: "" },
            ],
            rewardPoints: 13,
            rewardItem: "",
          },
          npc: [],
          mapX: 68,
          mapY: 52,
          choices: [{ text: "테스트 진입로로 돌아간다", target: "testEntry" }],
          actionResults: {},
        },
      },
    },
  },
];

let investigationsDB = investigationDefinitions.map(buildInvestigation);

function mergePersistedInvestigationState(baseItem, persistedItem) {
  if (!baseItem || !persistedItem || typeof persistedItem !== "object") return baseItem;
  const merged = {
    ...baseItem,
    opened: persistedItem.opened !== undefined ? !!persistedItem.opened : baseItem.opened,
    hidden: persistedItem.hidden !== undefined ? !!persistedItem.hidden : !!baseItem.hidden,
    started: persistedItem.started !== undefined ? !!persistedItem.started : baseItem.started,
    ended: persistedItem.ended !== undefined ? !!persistedItem.ended : baseItem.ended,
    endedAt: String(persistedItem.endedAt || baseItem.endedAt || ""),
    endedReason: String(persistedItem.endedReason || baseItem.endedReason || ""),
    leaders: Array.isArray(persistedItem.leaders) ? persistedItem.leaders : (Array.isArray(baseItem.leaders) ? baseItem.leaders : []),
    participants: Array.isArray(persistedItem.participants) ? persistedItem.participants : (Array.isArray(baseItem.participants) ? baseItem.participants : []),
    currentNodeId: String(persistedItem.currentNodeId || baseItem.currentNodeId || ""),
    sharedLog: String(persistedItem.sharedLog || baseItem.sharedLog || ""),
    sharedLogs: Array.isArray(persistedItem.sharedLogs) && persistedItem.sharedLogs.length ? persistedItem.sharedLogs : (Array.isArray(baseItem.sharedLogs) ? baseItem.sharedLogs : []),
    routeHistory: Array.isArray(persistedItem.routeHistory) && persistedItem.routeHistory.length ? persistedItem.routeHistory : (Array.isArray(baseItem.routeHistory) ? baseItem.routeHistory : []),
    foundItems: Array.isArray(persistedItem.foundItems) ? persistedItem.foundItems : (Array.isArray(baseItem.foundItems) ? baseItem.foundItems : []),
    foundNPCs: Array.isArray(persistedItem.foundNPCs) ? persistedItem.foundNPCs : (Array.isArray(baseItem.foundNPCs) ? baseItem.foundNPCs : []),
    rewards: Array.isArray(persistedItem.rewards) ? persistedItem.rewards : (Array.isArray(baseItem.rewards) ? baseItem.rewards : []),
    points: Number.isFinite(Number(persistedItem.points)) ? Number(persistedItem.points) : Number(baseItem.points || 0),
    discoveredFlags: persistedItem.discoveredFlags && typeof persistedItem.discoveredFlags === "object" ? persistedItem.discoveredFlags : (baseItem.discoveredFlags || {}),
    participantStates: persistedItem.participantStates && typeof persistedItem.participantStates === "object" ? persistedItem.participantStates : (baseItem.participantStates || {}),
    resultSummary: String(persistedItem.resultSummary || baseItem.resultSummary || ""),
    battleTurn: Number.isFinite(Number(persistedItem.battleTurn)) ? Number(persistedItem.battleTurn) : Number(baseItem.battleTurn || 1),
    pendingBattleActions: persistedItem.pendingBattleActions && typeof persistedItem.pendingBattleActions === "object" ? persistedItem.pendingBattleActions : (baseItem.pendingBattleActions || {}),
    lastBattleRound: Array.isArray(persistedItem.lastBattleRound) ? persistedItem.lastBattleRound : (Array.isArray(baseItem.lastBattleRound) ? baseItem.lastBattleRound : []),
    pendingRewardQueue: Array.isArray(persistedItem.pendingRewardQueue) ? persistedItem.pendingRewardQueue : (Array.isArray(baseItem.pendingRewardQueue) ? baseItem.pendingRewardQueue : []),
    endCorrosionApplied: persistedItem.endCorrosionApplied !== undefined ? !!persistedItem.endCorrosionApplied : !!baseItem.endCorrosionApplied,
    scheduleEnabled: persistedItem.scheduleEnabled !== undefined ? !!persistedItem.scheduleEnabled : !!baseItem.scheduleEnabled,
    openAt: String(persistedItem.openAt || baseItem.openAt || ""),
    closeAt: String(persistedItem.closeAt || baseItem.closeAt || ""),
    listImage: String(persistedItem.listImage || baseItem.listImage || ""),
    entryImage: String(persistedItem.entryImage || baseItem.entryImage || persistedItem.listImage || baseItem.listImage || ""),
    listImageFrame: normalizeInvestigationImageFrame(persistedItem.listImageFrame || baseItem.listImageFrame),
    entryImageFrame: normalizeInvestigationImageFrame(persistedItem.entryImageFrame || baseItem.entryImageFrame),
    imageUpdatedAt: Number(persistedItem.imageUpdatedAt || baseItem.imageUpdatedAt || 0),
    entryCorrosion: Number(persistedItem.entryCorrosion ?? baseItem.entryCorrosion ?? 0),
    endCorrosion: Number(persistedItem.endCorrosion ?? baseItem.endCorrosion ?? 0),
    bgmUrl: String(persistedItem.bgmUrl || baseItem.bgmUrl || ""),
    bgmVolume: Number(persistedItem.bgmVolume ?? baseItem.bgmVolume ?? 1),
  };

  if (merged.currentNodeId && baseItem.data?.nodes?.[merged.currentNodeId]) {
    merged.currentNodeId = merged.currentNodeId;
  } else {
    merged.currentNodeId = baseItem.currentNodeId;
  }

  const backgroundImage = String(persistedItem?.data?.backgroundImage || persistedItem.backgroundImage || baseItem?.data?.backgroundImage || "");
  merged.data = {
    ...baseItem.data,
    backgroundImage,
    listImage: merged.listImage || baseItem.data?.listImage || "",
    entryImage: merged.entryImage || baseItem.data?.entryImage || merged.listImage || "",
    listImageFrame: normalizeInvestigationImageFrame(merged.listImageFrame || baseItem.data?.listImageFrame),
    entryImageFrame: normalizeInvestigationImageFrame(merged.entryImageFrame || baseItem.data?.entryImageFrame),
    imageUpdatedAt: merged.imageUpdatedAt || baseItem.data?.imageUpdatedAt || 0,
    entryCorrosion: merged.entryCorrosion,
    endCorrosion: merged.endCorrosion,
    bgmUrl: merged.bgmUrl,
    bgmVolume: merged.bgmVolume,
  };

  if (!merged.sharedLog && Array.isArray(merged.sharedLogs) && merged.sharedLogs.length) {
    merged.sharedLog = String(merged.sharedLogs[merged.sharedLogs.length - 1]?.text || baseItem.sharedLog || "");
  }
  return merged;
}

function rehydrateInvestigationsFromRuntime() {
  const persisted = readRuntimeArray("investigations.json");
  if (!Array.isArray(persisted) || !persisted.length) return;
  investigationsDB = investigationsDB.map((item) => {
    const saved = persisted.find((entry) => String(entry?.id) === String(item?.id));
    return saved ? mergePersistedInvestigationState(item, saved) : item;
  });
}

rehydrateInvestigationsFromRuntime();

function getAccountKey(user) {
  return user?.ownerId || user?.id || user?.name || "unknown";
}
function getDisplayName(user) {
  return user?.id || user?.name || "알 수 없음";
}

function getInvestigationProgressMeta(item) {
  const totalNodeCount = Object.keys(item?.data?.nodes || {}).length || 0;
  const visitedNodeCount = Array.from(new Set((item?.routeHistory || []).map((entry) => entry?.nodeId).filter(Boolean))).length;
  const totalInvestigationActionCount = Object.values(item?.data?.nodes || {}).reduce((sum, node) => {
    const fromList = Array.isArray(node?.investigations) ? node.investigations.filter(Boolean).length : 0;
    const fromResults = Object.keys(node?.actionResults || {}).length;
    return sum + Math.max(fromList, fromResults);
  }, 0);
  const completedInvestigationActionCount = Math.min(Object.keys(item?.discoveredFlags || {}).length, totalInvestigationActionCount);
  const totalProgressCount = totalNodeCount + totalInvestigationActionCount;
  const completedProgressCount = visitedNodeCount + completedInvestigationActionCount;
  const visitProgressPercent = totalNodeCount > 0 ? Math.min(100, Math.round((visitedNodeCount / totalNodeCount) * 100)) : 0;
  const overallProgressPercent = totalProgressCount > 0 ? Math.min(100, Math.round((completedProgressCount / totalProgressCount) * 100)) : 0;
  return {
    totalNodeCount,
    visitedNodeCount,
    totalInvestigationActionCount,
    completedInvestigationActionCount,
    totalProgressCount,
    completedProgressCount,
    visitProgressPercent,
    overallProgressPercent,
  };
}

function refreshInvestigationCompletionState(item) {
  if (!item) return null;
  const progress = getInvestigationProgressMeta(item);
  const currentNode = item?.data?.nodes?.[item?.currentNodeId];
  const shouldReadyToEnd = progress.totalProgressCount > 0
    && progress.completedProgressCount >= progress.totalProgressCount
    && !currentNode?.battle;
  if (shouldReadyToEnd && !item.readyToEnd) {
    item.endNoticeDismissed = false;
  }
  item.readyToEnd = shouldReadyToEnd;
  return progress;
}

function getInvestigationSummary(item) {
  syncInvestigationRoster(item);
  const participantsCount = Array.isArray(item.participants) ? item.participants.length : 0;
  const progress = refreshInvestigationCompletionState(item);
  const progressPercent = Number(progress?.overallProgressPercent || 0);
  const effectiveOpened = getEffectiveOpened(item);
  const payload = {
    id: item.id,
    title: item.title,
    type: item.type || "group",
    listImage: String(item.listImage || item.data?.listImage || ""),
    entryImage: String(item.entryImage || item.data?.entryImage || item.listImage || item.data?.listImage || ""),
    listImageFrame: normalizeInvestigationImageFrame(item.listImageFrame || item.data?.listImageFrame),
    entryImageFrame: normalizeInvestigationImageFrame(item.entryImageFrame || item.data?.entryImageFrame || item.listImageFrame || item.data?.listImageFrame),
    imageUpdatedAt: Number(item.imageUpdatedAt || item.data?.imageUpdatedAt || 0),
    opened: item.opened,
    hidden: !!item.hidden,
    effectiveOpened,
    scheduleEnabled: !!item.scheduleEnabled,
    openAt: item.openAt || "",
    closeAt: item.closeAt || "",
    started: item.started,
    ended: item.ended,
    endedAt: item.endedAt || "",
    endedReason: item.endedReason || "",
    statusLabel: item.ended ? "종료" : item.started ? "진행중" : effectiveOpened ? "대기중" : "비활성화",
    participantsCount,
    leadersCount: Array.isArray(item.leaders) ? item.leaders.length : 0,
    points: 0,
    rewardsCount: Array.isArray(item.rewards) ? item.rewards.length : 0,
    progressPercent,
    visitProgressPercent: Number(progress?.visitProgressPercent || 0),
    overallProgressPercent: Number(progress?.overallProgressPercent || 0),
    totalNodeCount: Number(progress?.totalNodeCount || 0),
    visitedNodeCount: Number(progress?.visitedNodeCount || 0),
    totalInvestigationActionCount: Number(progress?.totalInvestigationActionCount || 0),
    completedInvestigationActionCount: Number(progress?.completedInvestigationActionCount || 0),
    currentNodeName: item.data?.nodes?.[item.currentNodeId]?.name || "-",
    dailyOwnerKey: String(item.dailyOwnerKey || ""),
    dailyResumeOwnerKey: String(item.dailyResumeOwnerKey || ""),
    entryCorrosion: Number(item.entryCorrosion || item.data?.entryCorrosion || 0),
    endCorrosion: Number(item.endCorrosion || item.data?.endCorrosion || 0),
    leaders: Array.isArray(item.leaders) ? [...item.leaders] : [],
    participants: (Array.isArray(item.participants) ? item.participants : []).map(buildPublicCharacterSummary),
  };
  return mapDataImages(payload, (pathKey) => toInvestigationAssetUrl(item.id, pathKey));
}

function buildInvestigationLobbyState(item) {
  if (!item) return null;
  syncInvestigationRoster(item);
  const payload = {
    id: item.id,
    investigationId: item.id,
    title: item.title,
    type: item.type || "group",
    listImage: String(item.listImage || item.data?.listImage || ""),
    entryImage: String(item.entryImage || item.data?.entryImage || item.listImage || item.data?.listImage || ""),
    listImageFrame: normalizeInvestigationImageFrame(item.listImageFrame || item.data?.listImageFrame),
    entryImageFrame: normalizeInvestigationImageFrame(item.entryImageFrame || item.data?.entryImageFrame || item.listImageFrame || item.data?.listImageFrame),
    imageUpdatedAt: Number(item.imageUpdatedAt || item.data?.imageUpdatedAt || 0),
    opened: !!item.opened,
    hidden: !!item.hidden,
    effectiveOpened: getEffectiveOpened(item),
    started: !!item.started,
    ended: !!item.ended,
    endedAt: item.endedAt || "",
    statusLabel: item.ended ? "종료" : item.started ? "진행중" : getEffectiveOpened(item) ? "대기중" : "비활성화",
    leaders: Array.isArray(item.leaders) ? [...item.leaders] : [],
    participants: (Array.isArray(item.participants) ? item.participants : []).map(buildPublicCharacterSummary),
    participantStates: item.participantStates || {},
    spectators: Array.isArray(item.spectators) ? item.spectators : [],
    currentNodeId: item.currentNodeId || item.data?.start || "",
    endCorrosion: Number(item.endCorrosion || item.data?.endCorrosion || 0),
  };
  return mapDataImages(payload, (pathKey) => toInvestigationAssetUrl(item.id, pathKey));
}


function emitOnlineAccounts() {
  const onlineMap = new Map();
  Object.values(socketUsers).forEach((user) => {
    if (!user || !user.online) return;
    const key = user.accountKey;
    if (!key) return;
    if (!onlineMap.has(key)) {
      onlineMap.set(key, {
        accountKey: key,
        displayName: user.displayName,
        ownerId: user.ownerId || "",
        id: user.id || "",
        name: user.name || "",
        characterId: user.characterId || "",
        roomId: user.roomId || null,
        online: true,
      });
    } else {
      const existing = onlineMap.get(key);
      if (!existing.roomId && user.roomId) existing.roomId = user.roomId;
    }
  });
  io.emit("onlineAccounts", Array.from(onlineMap.values()));
}
function emitUsers() {
  io.emit("users", Object.values(socketUsers));
  emitOnlineAccounts();
}
function emitParticipantsUpdated() {
  investigationsDB.forEach((item) => syncInvestigationRoster(item));
  io.emit("participantsUpdated", investigationsDB.map(getInvestigationSummary));
}

function emitInvestigationState(investigationId) {
  const item = investigationsDB.find((v) => v.id === investigationId);
  if (!item) return;
  syncInvestigationRoster(item);
  io.to(investigationId).emit("investigationStateUpdated", buildPublicInvestigationState(item));
}

function ensureParticipantState(item, character) {
  if (!item.participantStates) item.participantStates = {};
  if (!Array.isArray(item.pendingRewardQueue)) item.pendingRewardQueue = [];
  if (!character?.name) return;
  const current = item.participantStates[character.name];
  if (!current) {
    item.participantStates[character.name] = baseParticipantState(character);
    return;
  }
  const spriteImage = character?.spriteImage || character?.sdImage || character?.sdImageUrl || character?.sd || character?.investigationImage || current.spriteImage || current.sdImage || current.investigationImage || current.image || character?.image || "";
  const investigationImage = character?.investigationImage || current.investigationImage || spriteImage || character?.image || current.image || "";
  item.participantStates[character.name] = {
    ...current,
    maxHp: getCharacterMaxHp(character?.stats?.hp ?? current.maxHp ?? 100),
    atk: character?.stats ? getCombatStatTotal(character.stats.atk) : Number(current.atk || STAT_RULES.baseCombat),
    def: character?.stats ? getCombatStatTotal(character.stats.def) : Number(current.def || STAT_RULES.baseCombat),
    agi: character?.stats ? getCombatStatTotal(character.stats.agi) : Number(current.agi || STAT_RULES.baseCombat),
    image: investigationImage || character?.image || current.image || "",
    investigationImage,
    spriteImage,
    sdImage: spriteImage,
    buffs: Array.isArray(current.buffs) ? current.buffs : [],
    skillCooldowns: current.skillCooldowns && typeof current.skillCooldowns === "object" ? current.skillCooldowns : {},
  };
  item.participantStates[character.name].hp = Math.min(item.participantStates[character.name].hp, item.participantStates[character.name].maxHp);
}


function ensureRouteHistorySeed(item) {
  if (!Array.isArray(item.routeHistory)) item.routeHistory = [];
  const currentNode = item.data?.nodes?.[item.currentNodeId];
  if (!item.currentNodeId || !currentNode) return;
  const hasCurrent = item.routeHistory.some((entry) => entry.nodeId === item.currentNodeId);
  if (!hasCurrent) {
    item.routeHistory.unshift({
      nodeId: item.currentNodeId,
      name: currentNode.name,
      time: new Date().toISOString(),
    });
  }
}
function getDailyOwnerKey(character) {
  if (!character) return "";
  return String(character.id || `${character.ownerId || "owner"}:${character.name || ""}`);
}

function canResumeDailyInvestigation(item, character) {
  if (!item || item.type !== "daily" || !character) return false;
  const ownerKey = getDailyOwnerKey(character);
  return !!ownerKey && String(item.dailyResumeOwnerKey || "") === ownerKey;
}

function isDailyOwnedByCharacter(item, character) {
  if (!item || item.type !== "daily" || !character) return false;
  const ownerKey = getDailyOwnerKey(character);
  return !!ownerKey && String(item.dailyOwnerKey || "") === ownerKey;
}


function ensureRuntimeState(item) {
  const startNode = item.data.nodes[item.data.start];
  if (!item.currentNodeId) item.currentNodeId = item.data.start;
  if (!item.sharedLog) item.sharedLog = startNode.log;
  if (!Array.isArray(item.sharedLogs) || item.sharedLogs.length === 0) item.sharedLogs = [createLogEntry(startNode.log)];
  if (!Array.isArray(item.routeHistory) || item.routeHistory.length === 0) {
    item.routeHistory = [{ nodeId: item.data.start, name: startNode.name, time: new Date().toISOString() }];
  }
  if (!Array.isArray(item.foundItems)) item.foundItems = [];
  if (!Array.isArray(item.foundNPCs)) item.foundNPCs = [];
  if (!Array.isArray(item.rewards)) item.rewards = [];
  if (!item.discoveredFlags) item.discoveredFlags = {};
  if (!item.participantStates) item.participantStates = {};
  if (!Array.isArray(item.participants)) item.participants = [];
  if (!Array.isArray(item.leaders)) item.leaders = [];
  if ((item.started || item.ended || item.type === "daily") && item.participants.length === 0 && item.participantStates && Object.keys(item.participantStates).length > 0) {
    item.participants = Object.entries(item.participantStates).map(([name, state]) => {
      const found = charactersDB.find((character) => String(character?.name || "") === String(name));
      if (found) return found;
      return {
        id: String(name || "unknown"),
        ownerId: String(name || "unknown"),
        name,
        image: state?.image || "",
        investigationImage: state?.image || "",
        stats: {
          hp: Number(state?.maxHp || 0),
          atk: Number(state?.atk || 0),
          def: Number(state?.def || 0),
          agi: Number(state?.agi || 0),
        },
      };
    });
  }
  if (item.type === "daily" && item.leaders.length === 0 && item.participants.length > 0) item.leaders = [item.participants[0].name];
  if (typeof item.points !== "number") item.points = 0;
  if (typeof item.battleTurn !== "number") item.battleTurn = 1;
  if (!item.pendingBattleActions) item.pendingBattleActions = {};
  if (!Array.isArray(item.lastBattleRound)) item.lastBattleRound = [];
  if (!item.completedNpcScenes || typeof item.completedNpcScenes !== "object") item.completedNpcScenes = {};
}

function syncInvestigationRoster(item) {
  if (!item) return item;
  ensureRuntimeState(item);

  const roster = new Map();
  const pushCharacter = (entry) => {
    if (!entry) return;
    const name = String(entry?.name || "").trim();
    if (!name || name === "운영자" || String(entry?.id || "") === "admin" || String(entry?.ownerId || "") === "admin" || entry?.isAdmin) return;
    const existing = roster.get(name) || {};
    roster.set(name, { ...existing, ...entry, name });
  };

  (Array.isArray(item.participants) ? item.participants : []).forEach((participant) => {
    const found = charactersDB.find((character) => String(character?.id || "") === String(participant?.id || ""))
      || charactersDB.find((character) => String(character?.name || "") === String(participant?.name || ""));
    pushCharacter(found || participant);
  });

  const shouldHydrateFromStates = item.started || item.ended || item.type === "daily" || ((Array.isArray(item.participants) ? item.participants.length : 0) === 0 && Object.keys(item.participantStates || {}).length > 0);
  if (shouldHydrateFromStates) {
    Object.entries(item.participantStates || {}).forEach(([name, state]) => {
      const found = charactersDB.find((character) => String(character?.name || "") === String(name));
      pushCharacter(found || {
      id: String(name || "unknown"),
      ownerId: String(found?.ownerId || name || "unknown"),
      name: String(name || ""),
      image: state?.image || found?.image || "",
      investigationImage: state?.image || found?.investigationImage || found?.image || "",
      level: found?.level || 1,
      stats: found?.stats || {
        hp: Math.max(0, Math.round((Number(state?.maxHp || 100) - 100) / 10)),
        atk: Number(state?.atk || 0),
        def: Number(state?.def || 0),
        agi: Number(state?.agi || 0),
      },
      });
    });
  }

  if (roster.size === 0 && shouldHydrateFromStates) {
    Object.values(socketUsers || {}).forEach((user) => {
      if (!user || user.roomId !== item.id || user.isAdmin || String(user.id || "") === "admin" || String(user.ownerId || "") === "admin") return;
      const found = charactersDB.find((character) => String(character?.id || "") === String(user.characterId || ""))
        || charactersDB.find((character) => String(character?.name || "") === String(user.name || ""));
      pushCharacter(found || {
        id: String(user.characterId || user.id || user.name || "unknown"),
        ownerId: String(user.ownerId || user.id || user.name || "unknown"),
        name: String(found?.name || user.name || ""),
        image: found?.image || "",
        investigationImage: found?.investigationImage || found?.image || "",
        level: found?.level || 1,
        stats: found?.stats || { hp: 0, atk: 0, def: 0, agi: 0 },
      });
    });
  }

  item.participants = Array.from(roster.values());
  if (!Array.isArray(item.leaders)) item.leaders = [];
  const validLeaderNames = new Set([
    ...Array.from(roster.keys()),
    ...Object.keys(item.participantStates || {}).map((name) => String(name || "").trim()).filter(Boolean),
  ]);
  item.leaders = item.leaders.filter((leaderName) => validLeaderNames.has(String(leaderName || "")));
  if (item.type === "daily" && item.leaders.length === 0 && item.participants[0]?.name) item.leaders = [item.participants[0].name];

  item.participants.forEach((participant) => ensureParticipantState(item, participant));
  return item;
}

function getInvestigationTemplateById(id) {
  const baseDef = investigationDefinitions.find((v) => v.id === id);
  if (baseDef) return baseDef;
  const customDef = (customInvestigationsDB || []).find((template) => template?.json?.id === id)?.json;
  if (customDef) return customDef;
  if (investigationsDB.find((entry) => entry.id === id)?.data?.nodes) {
    const current = investigationsDB.find((entry) => entry.id === id);
    if (current?.originalTemplate?.data?.nodes) return clone(current.originalTemplate);
    return {
      id: current.id,
      title: current.title,
      type: current.type,
      data: current.data,
    };
  }
  return null;
}

function resetInvestigationProgress(item) {
  const templateSource = clone(item?.originalTemplate || getInvestigationTemplateById(item.id));
  if (!templateSource) return;
  const template = clone(templateSource);
  const fresh = buildInvestigation(template);
  const preserved = {
    opened: item.opened,
    hidden: item.hidden,
    scheduleEnabled: item.scheduleEnabled,
    openAt: item.openAt,
    closeAt: item.closeAt,
    effectiveOpened: item.effectiveOpened,
    statusLabel: item.statusLabel,
    dailyOwnerKey: "",
    dailyResumeOwnerKey: "",
  };
  Object.assign(item, fresh, preserved);
  item.originalTemplate = clone(templateSource);
  item.started = false;
  item.ended = false;
  item.endedAt = "";
  item.endedReason = "";
  item.resultSummary = "";
  item.participants = [];
  item.leaders = [];
  item.participantStates = {};
  item.pendingBattleActions = {};
  item.lastBattleRound = [];
  item.pendingReward = null;
  item.pendingRewardQueue = [];
  item.activeNpcScene = null;
  item.npcLineIndex = 0;
  item.readyToEnd = false;
  item.endNoticeDismissed = false;
  item.endConfirmations = [];
  item.eventBanner = "";
  item.eventBannerType = "normal";
  item.eventBannerUntil = 0;
  item.completedNpcScenes = {};
  item.endCorrosionApplied = false;
}

function applyInvestigationEndCorrosion(item) {
  if (!item || item.endCorrosionApplied) return;
  const delta = Number(item.endCorrosion || item.data?.endCorrosion || 0);
  item.endCorrosionApplied = true;
  if (!(delta > 0)) return;
  (Array.isArray(item.participants) ? item.participants : []).forEach((participant) => {
    const char = charactersDB.find((character) => String(character?.id || "") === String(participant?.id || ""))
      || charactersDB.find((character) => String(character?.name || "") === String(participant?.name || ""));
    if (char) applyCharacterCorrosion(char, delta);
  });
  markCharactersDirty();
  writeRuntimeArray("characters.json", charactersDB);
}

function finishInvestigation(item, reason, summary) {
  item.ended = true;
  item.endedAt = new Date().toISOString();
  item.endedReason = reason;
  item.started = false;
  item.resultSummary = summary;
  item.sharedLog = summary;
  item.pendingBattleActions = {};
  item.pendingReward = null;
  item.pendingRewardQueue = [];
  item.sharedLogs.push(createLogEntry(summary));
  setEventBanner(item, reason === "전멸" ? "조사가 종료되었습니다" : "조사가 종료되었습니다", reason === "전멸" ? "danger" : "success", 3600);
  applyFaintedEndRecovery(item);
  applyInvestigationEndCorrosion(item);
}

function getNodeActionResult(item, actionName) {
  const node = item.data.nodes[item.currentNodeId];
  return node?.actionResults?.[actionName] || null;
}

function cloneParticipantStates(states = {}) {
  return JSON.parse(JSON.stringify(states || {}));
}

function createBattleLogEntry(text, phase, extra = {}) {
  return { text, phase, ...extra };
}

function getBattleEnemyLogIdentity(battle, enemy) {
  const enemies = getBattleEnemies(battle);
  const index = enemies.findIndex((candidate) => candidate === enemy || String(candidate?.id || "") === String(enemy?.id || ""));
  const safeIndex = index >= 0 ? index : 0;
  const found = index >= 0 ? enemies[index] : enemy;
  return {
    name: String(found?.name || `E-Beast ${safeIndex + 1}`),
    id: String(found?.id || `enemy-${safeIndex + 1}`),
    index: safeIndex,
  };
}

function withBattleEnemyActor(battle, enemy, extra = {}) {
  const identity = getBattleEnemyLogIdentity(battle, enemy);
  return { ...extra, actor: identity.name, actorId: identity.id, actorIndex: identity.index };
}

function withBattleEnemyTarget(battle, enemy, extra = {}) {
  const identity = getBattleEnemyLogIdentity(battle, enemy);
  return { ...extra, target: identity.name, targetId: identity.id, targetIndex: identity.index };
}

function getNpcSceneKey(item, nodeId = item?.currentNodeId) {
  const node = item?.data?.nodes?.[nodeId];
  if (!node?.npcScene?.lines?.length) return "";
  return String(node.npcScene.name || nodeId || "npc-scene");
}
function getBattleEncounterName(battle) {
  if (!battle) return "E-Beast";
  const enemies = Array.isArray(battle?.enemies) ? battle.enemies : [];
  if (enemies.length > 1) return enemies.map((enemy) => enemy?.name || "E-Beast").join(", ");
  return battle.name || enemies[0]?.name || "E-Beast";
}

function announceNodeBattleStartIfReady(item, node = item?.data?.nodes?.[item?.currentNodeId]) {
  if (!item || !node?.battle) return false;
  if (item.activeNpcScene?.lines?.length) return false;
  if (node.battle.__battleAnnounced) return false;
  node.battle.__battleAnnounced = true;
  addSharedLog(item, `[E-Beast 조우] ${getBattleEncounterName(node.battle)}와 맞닥뜨렸습니다! 전원 전투 태세!`);
  setEventBanner(item, "전투 시작!", "danger", 2600);
  return true;
}


function markNpcSceneCompleted(item, nodeId = item?.currentNodeId) {
  ensureRuntimeState(item);
  const key = getNpcSceneKey(item, nodeId);
  if (!key) return;
  item.completedNpcScenes[key] = true;
}

function hasCompletedNpcScene(item, nodeId = item?.currentNodeId) {
  ensureRuntimeState(item);
  const key = getNpcSceneKey(item, nodeId);
  if (!key) return false;
  return !!item.completedNpcScenes[key];
}


function setEventBanner(item, text, type = "normal", duration = 2600) {
  item.eventBanner = text;
  item.eventBannerType = type;
  item.eventBannerUntil = Date.now() + duration;
}

function addSharedLog(item, text) {
  item.sharedLog = text;
  if (!Array.isArray(item.sharedLogs)) item.sharedLogs = [];
  item.sharedLogs.push(createLogEntry(text));
}

function applyRewardToCharacter(char, reward) {
  if (!char || !reward) return;
  if (reward.type === "item" && reward.value) {
    char.items = Array.isArray(char.items) ? [...char.items, reward.value] : [reward.value];
  }
  if ((reward.type === "statPoints" || reward.type === "stat" || reward.type === "stat_points") && reward.value !== undefined) {
    char.statPoints = Number(char.statPoints || 0) + Number(reward.value || 0);
  }
}

function queueRewardAssignment(item, reward) {
  if (!reward) return;
  if (reward.type === "item" && reward.value) {
    if (!Array.isArray(item.foundItems)) item.foundItems = [];
    if (!item.foundItems.includes(reward.value)) item.foundItems.push(reward.value);
  }
  if (item?.type === "daily") {
    const receiver = (item.participants || [])[0];
    const char = receiver ? (charactersDB.find((c) => String(c.id) === String(receiver.id)) || charactersDB.find((c) => c.name === receiver.name)) : null;
    if (char) {
      applyRewardToCharacter(char, reward);
      addSharedLog(item, `[획득] ${receiver.name}이(가) ${reward.label}을(를) 받았습니다.`);
      item.pendingReward = null;
      item.pendingRewardQueue = [];
      emitParticipantsUpdated();
      emitInvestigationState(item.id);
      return;
    }
  }
  if (!Array.isArray(item.pendingRewardQueue)) item.pendingRewardQueue = [];
  if (!item.pendingReward) {
    item.pendingReward = reward;
    return;
  }
  item.pendingRewardQueue.push(reward);
}

function addClue(item, clue) {
  if (!clue) return;
  if (!Array.isArray(item.clues)) item.clues = [];
  const id = clue.id || `${item.currentNodeId}-${clue.title || clue.name || "clue"}-${item.clues.length + 1}`;
  if (item.clues.find((v) => v.id === id)) return;
  item.clues.push({ id, title: clue.title || clue.name || "단서", text: clue.text || clue.description || "", image: clue.image || "" });
}

function applyNodeEntryEffects(item, node) {
  const participants = Array.isArray(item.participants) ? item.participants : [];
  const states = item.participantStates || {};
  if (Number(node?.onEnterDamage || 0) > 0) {
    participants.forEach((participant) => {
      const state = states[participant.name];
      if (!state || Number(state.hp || 0) <= 0) return;
      state.hp = Math.max(0, Number(state.hp || 0) - Number(node.onEnterDamage || 0));
      normalizeFaintedParticipantState(state);
    });
    addSharedLog(item, `[진입 효과] ${node.name}에서 피해 ${Number(node.onEnterDamage || 0)}를 받았습니다.`);
  }
  if (Number(node?.onEnterMuteMinutes || 0) > 0) {
    const until = Date.now() + Number(node.onEnterMuteMinutes || 0) * 60 * 1000;
    participants.forEach((participant) => {
      const state = states[participant.name];
      if (!state) return;
      state.mutedUntil = until;
    });
    addSharedLog(item, `[디버프] ${node.name} 진입 효과로 ${Number(node.onEnterMuteMinutes || 0)}분간 채팅 불가.`);
  }
  if (node?.npcScene?.lines?.length && !hasCompletedNpcScene(item, item.currentNodeId)) {
    item.activeNpcScene = node.npcScene;
    item.npcLineIndex = 0;
    if (!Array.isArray(item.foundNPCs)) item.foundNPCs = [];
    if (node.npcScene.name && !item.foundNPCs.includes(node.npcScene.name)) item.foundNPCs.push(node.npcScene.name);
    setEventBanner(item, `${node.npcScene.name || "NPC"} 등장`, "normal", 2200);
    addSharedLog(item, `[NPC 조우] ${node.npcScene.name || "NPC"}와 대화를 시작합니다.`);
    const firstNpcLine = Array.isArray(node.npcScene.lines) ? node.npcScene.lines[0] : null;
    if (firstNpcLine?.text) addSharedLog(item, `[NPC] ${node.npcScene.name || "NPC"}: ${firstNpcLine.text}`);
  }
}

function applyActionRewards(item, result, locationName) {
  if (!result) return { changed: false, text: `[${locationName}] 특별한 성과는 없었습니다.` };
  const textParts = [result.log || `[${locationName}] ${locationName}에서 단서를 조사했습니다.`];
  let changed = false;

  if (typeof result.points === "number") {
    changed = true;
  }

  if (result.item) {
    queueRewardAssignment(item, { type: "item", label: result.item, value: result.item });
    textParts.push(item?.type === "daily" ? `${result.item}을(를) 획득했습니다!` : `${result.item}을(를) 획득했습니다. 누구에게 지급하시겠습니까?`);
    changed = true;
  }

  if (typeof result.statPoints === "number" && result.statPoints > 0) {
    queueRewardAssignment(item, { type: "statPoints", label: `스탯 포인트 +${result.statPoints}`, value: Number(result.statPoints) });
    textParts.push(item?.type === "daily" ? `스탯 포인트 +${result.statPoints}!` : `스탯 포인트 +${result.statPoints}! 누구에게 지급하시겠습니까?`);
    changed = true;
  }

  if (result.clue) {
    addClue(item, typeof result.clue === "string" ? { title: result.clue, text: result.clue } : result.clue);
    textParts.push(`단서 확보: ${typeof result.clue === "string" ? result.clue : (result.clue.title || "단서")}`);
    changed = true;
  }
  if (Array.isArray(result.clues)) {
    result.clues.forEach((clue) => addClue(item, clue));
    if (result.clues.length > 0) {
      textParts.push(`단서 ${result.clues.length}개 확보`);
      changed = true;
    }
  }

  if (result.npc && !item.foundNPCs.includes(result.npc)) {
    item.foundNPCs.push(result.npc);
    textParts.push(`NPC 조우: ${result.npc}`);
    changed = true;
  }

  if (typeof result.damage === "number" && result.damage > 0) {
    (item.participants || []).forEach((participant) => {
      const state = item.participantStates?.[participant.name];
      if (!state || Number(state.hp || 0) <= 0) return;
      state.hp = Math.max(0, Number(state.hp || 0) - Number(result.damage));
      normalizeFaintedParticipantState(state);
    });
    textParts.push(`피해 ${result.damage}`);
    changed = true;
  }

  if (typeof result.muteMinutes === "number" && result.muteMinutes > 0) {
    const until = Date.now() + Number(result.muteMinutes) * 60 * 1000;
    (item.participants || []).forEach((participant) => {
      const state = item.participantStates?.[participant.name];
      if (!state) return;
      state.mutedUntil = until;
    });
    textParts.push(`${result.muteMinutes}분간 채팅 금지`);
    changed = true;
  }

  if (typeof result.corrosionIncrease === "number" && result.corrosionIncrease > 0) {
    (item.participants || []).forEach((participant) => {
      const foundCharacter =
        charactersDB.find((character) => String(character?.id || "") === String(participant?.id || "")) ||
        charactersDB.find((character) => String(character?.name || "") === String(participant?.name || ""));
      if (foundCharacter) applyCharacterCorrosion(foundCharacter, result.corrosionIncrease);
    });
    writeRuntimeArray("characters.json", charactersDB);
    textParts.push(`침식 진행도 +${result.corrosionIncrease}`);
    changed = true;
  }

  if (result.reward && !item.rewards.includes(result.reward)) {
    item.rewards.push(result.reward);
    textParts.push(`보상 기록: ${result.reward}`);
    changed = true;
  }

  return { changed, text: textParts.join(" / ") };
}

function isInvestigationPlayableParticipant(participant) {
  return !!participant
    && !participant.isAdmin
    && !participant.isSpectator
    && String(participant.role || "") !== "spectator"
    && String(participant.id || "") !== "admin"
    && String(participant.ownerId || "") !== "admin"
    && participant.name !== "운영자";
}

function normalizeFaintedParticipantState(state) {
  if (!state) return;
  if (Number(state.hp || 0) <= 0) {
    state.hp = 0;
    state.status = "기절 상태";
    state.defending = false;
  }
}

function normalizeFaintedParticipantStates(item) {
  Object.values(item?.participantStates || {}).forEach(normalizeFaintedParticipantState);
}

function getActiveInvestigationParticipantStates(item) {
  const participants = Array.isArray(item?.participants) ? item.participants : [];
  const states = item?.participantStates || {};
  const participantNames = Array.from(new Set(participants
    .filter(isInvestigationPlayableParticipant)
    .map((participant) => String(participant?.name || "").trim())
    .filter(Boolean)));
  if (participantNames.length > 0) {
    return participantNames.map((name) => states[name]).filter(Boolean);
  }
  return Object.values(states).filter((state) => state && String(state.name || "") !== "운영자");
}

function allParticipantsDown(item) {
  normalizeFaintedParticipantStates(item);
  const states = getActiveInvestigationParticipantStates(item);
  return states.length > 0 && states.every((state) => Number(state.hp || 0) <= 0);
}

function applyFaintedEndRecovery(item) {
  normalizeFaintedParticipantStates(item);
  const participants = Array.isArray(item?.participants) ? item.participants : [];
  let changed = false;
  participants.filter(isInvestigationPlayableParticipant).forEach((participant) => {
    const state = item?.participantStates?.[participant.name];
    if (!state || Number(state.hp || 0) > 0) return;
    const char = charactersDB.find((character) => String(character?.id || "") === String(participant?.id || ""))
      || charactersDB.find((character) => String(character?.name || "") === String(participant?.name || ""));
    if (!char) return;
    const maxHp = getCharacterMaxHp(char?.stats?.hp);
    const recoveryHp = maxHp > 0 ? Math.max(1, Math.ceil(maxHp * 0.05)) : 0;
    char.currentHp = Math.max(0, Math.min(maxHp, recoveryHp));
    changed = true;
  });
  if (changed) {
    markCharactersDirty();
    writeRuntimeArray("characters.json", charactersDB);
  }
}
function canMoveBetweenNodes(item, fromNodeId, toNodeId) {
  const nodes = item?.data?.nodes || {};
  const fromNode = nodes[fromNodeId];
  const toNode = nodes[toNodeId];
  if (!fromNode || !toNode) return false;
  const forward = Array.isArray(fromNode.choices) && fromNode.choices.some((choice) => String(choice?.target || "") === String(toNodeId));
  const backward = Array.isArray(toNode.choices) && toNode.choices.some((choice) => String(choice?.target || "") === String(fromNodeId));
  return forward || backward;
}

function getPreviousRouteNodeId(item) {
  const history = Array.isArray(item.routeHistory) ? item.routeHistory : [];
  if (history.length >= 2) return history[history.length - 2]?.nodeId || item.data.start;
  return item.data.start;
}

function getUsableHealItem(item) {
  const healItems = ["응급 붕대", "소독약"];
  return item.foundItems.find((v) => healItems.includes(v));
}

function consumeBattleItem(item, state) {
  const usable = getUsableHealItem(item);
  if (!usable) return { text: `${state.name}은(는) 사용할 수 있는 전투용 아이템이 없었습니다.`, changed: false };
  const heal = usable === "응급 붕대" ? 18 : 24;
  state.hp = Math.min(state.maxHp, state.hp + heal);
  const idx = item.foundItems.indexOf(usable);
  if (idx >= 0) item.foundItems.splice(idx, 1);
  return { text: `${state.name}은(는) ${usable}를 사용해 HP ${heal} 회복했습니다.`, changed: true };
}

function addBuff(state, type, duration, value) {
  if (!Array.isArray(state.buffs)) state.buffs = [];
  state.buffs.push({ type, duration, value });
}

function getBuffValue(state, type) {
  return (Array.isArray(state.buffs) ? state.buffs : [])
    .filter((buff) => buff.type === type && buff.duration > 0)
    .reduce((sum, buff) => sum + Number(buff.value || 0), 0);
}


function parseBattleAction(actionName) {
  const raw = String(actionName || "공격");
  const parts = raw.split("::");
  return { type: parts[0] || "공격", payload: parts[1] || "", target: parts.slice(2).join("::") || "" };
}

const PRESET_SKILLS = {
  "일격": { key: "일격", label: "일격", mode: "singleDamage", target: "enemy", multiplier: 2.5, desc: "단일 적에게 2.5배 데미지" },
  "연격": { key: "연격", label: "연격", mode: "aoeDamage", target: "enemyAll", multiplier: 0.75, desc: "모든 적에게 일반 공격 75% 데미지" },
  "축복": { key: "축복", label: "축복", mode: "allyAtkBuff", target: "ally", rate: 0.5, duration: 2, desc: "아군 1명의 공격력 50% 증가" },
  "저주": { key: "저주", label: "저주", mode: "enemyDamageTakenDebuff", target: "enemy", rate: 0.5, duration: 2, desc: "적 1명이 받는 피해 50% 증가" },
  "희생": { key: "희생", label: "희생", mode: "protectOne", target: "ally", duration: 1, desc: "선택한 아군에게 가는 공격을 대신 받음" },
  "가호": { key: "가호", label: "가호", mode: "protectAll", target: "allyAll", duration: 2, desc: "아군 전체에게 시전자 방어력 기반 보호막" },
  "구원": { key: "구원", label: "구원", mode: "singleHeal", target: "ally", desc: "아군 1명 회복" },
  "격려": { key: "격려", label: "격려", mode: "aoeHeal", target: "allyAll", desc: "아군 전체 회복" },
};
function normalizeSkillKey(skillKey) { const key = String(skillKey || "").trim(); if (PRESET_SKILLS[key]) return key; return Object.keys(PRESET_SKILLS).find((name) => name.toLowerCase() === key.toLowerCase()) || key; }
function getPresetSkillList() { return Object.values(PRESET_SKILLS).map((skill) => ({ ...skill })); }
function getSkillSpec(skillKey) {
  const key = normalizeSkillKey(skillKey);
  if (PRESET_SKILLS[key]) return { ...PRESET_SKILLS[key], cooldownTurns: 0 };
  const byCatalog = (shopItemsDB || []).find((item) => item?.useType === "skill" && [item.skillKey, item.useValue, item.skillName, item.name].map((v) => String(v || "").trim()).includes(String(skillKey || "").trim()));
  if (byCatalog) { const catalogKey = normalizeSkillKey(byCatalog.skillKey || byCatalog.useValue || byCatalog.skillName || byCatalog.name); if (PRESET_SKILLS[catalogKey]) return { ...PRESET_SKILLS[catalogKey], cooldownTurns: Number(byCatalog.cooldownTurns || 0) }; }
  return { key: key || "일격", label: key || "일격", mode: "singleDamage", target: "enemy", multiplier: 1, cooldownTurns: 0 };
}
function findTargetEnemy(battle, targetKey) { const alive = getAliveBattleEnemies(battle); if (!alive.length) return null; const key = String(targetKey || "").trim(); if (!key) return alive[0]; return alive.find((enemy, index) => String(enemy?.id || "") === key || String(enemy?.name || "") === key || String(index) === key || String(index + 1) === key) || alive[0]; }
function findTargetAllyState(item, targetKey, fallbackName = "") { const states = item.participantStates || {}; const key = String(targetKey || "").trim(); if (key && states[key]) return states[key]; const byName = Object.values(states).find((state) => String(state?.name || "") === key); if (byName) return byName; if (fallbackName && states[fallbackName]) return states[fallbackName]; return Object.values(states).find((state) => Number(state?.hp || 0) > 0) || null; }
function getEffectiveAttack(state) { const base = Number(state?.atk || 0); const flat = getBuffValue(state, "atkUp"); const rate = getBuffValue(state, "atkRateUp"); return Math.max(1, Math.round((base + flat) * (1 + rate))); }
function applyEnemyDamage(enemy, rawDamage) { const multiplier = 1 + Math.max(0, getBuffValue(enemy, "damageTakenRateUp")); const damage = Math.max(1, Math.round(Number(rawDamage || 0) * multiplier)); enemy.hp = Math.max(0, Number(enemy.hp || 0) - damage); return damage; }
function getProtectionRedirect(item, targetState) { const targetName = String(targetState?.name || ""); if (!targetName) return null; return Object.values(item.participantStates || {}).find((state) => state && Number(state.hp || 0) > 0 && String(state.name || "") !== targetName && Array.isArray(state.buffs) && state.buffs.some((buff) => buff?.type === "protect" && buff.duration > 0 && String(buff.target || "") === targetName)) || null; }
function getIncomingDamageForTarget(item, targetState, rawDamage) {
  const protector = getProtectionRedirect(item, targetState);
  if (protector) {
    const protectedDamage = getIncomingDamageAfterDefense(rawDamage, { ...protector, defending: true });
    protector.hp = Math.max(0, Number(protector.hp || 0) - protectedDamage);
    protector.status = protector.hp <= 0 ? "기절 상태" : "희생 보호";
    normalizeFaintedParticipantState(protector);
    return { actualTarget: protector, damage: protectedDamage, protectedName: targetState.name };
  }
  const damage = getIncomingDamageAfterDefense(rawDamage, targetState);
  targetState.hp = Math.max(0, Number(targetState.hp || 0) - damage);
  normalizeFaintedParticipantState(targetState);
  return { actualTarget: targetState, damage, protectedName: "" };
}


function applyEnemyDamageToParticipant(item, targetState, rawDamage, hitStatus) {
  const result = getIncomingDamageForTarget(item, targetState, rawDamage);
  const actualTarget = result.actualTarget || targetState;
  const isDown = Number(actualTarget?.hp || 0) <= 0;
  actualTarget.status = isDown ? "기절 상태" : (result.protectedName ? "희생 보호" : hitStatus);
  normalizeFaintedParticipantState(actualTarget);
  return { ...result, actualTarget };
}

function getEnemyDamageLogTarget(result, fallbackState) {
  const actualName = result?.actualTarget?.name || fallbackState?.name || "대상";
  return result?.protectedName ? `${result.protectedName} 대신 ${actualName}` : actualName;
}

function rollEvasion(attackerAgi, defenderAgi) {
  const chance = Math.max(0.03, Math.min(0.32, 0.06 + (Number(defenderAgi || 0) - Number(attackerAgi || 0)) * 0.015));
  return Math.random() < chance;
}

function rollCritical(agi) {
  const chance = clampNumber(agi, 0, STAT_RULES.maxCombatTotal) / 100;
  return Math.random() < chance;
}

function tickBuffs(state) {
  const changes = [];
  if (Array.isArray(state.buffs)) {
    const nextBuffs = [];
    state.buffs.forEach((buff) => {
      const nextDuration = Number(buff?.duration || 0) - 1;
      const nextBuff = { ...buff, duration: nextDuration };
      if (nextDuration > 0) {
        nextBuffs.push(nextBuff);
      } else if (buff?.type) {
        changes.push({ type: buff.type, expired: true, value: Number(buff.value || 0) });
      }
    });
    state.buffs = nextBuffs;
  }
  if (state.skillCooldowns && typeof state.skillCooldowns === "object") {
    Object.keys(state.skillCooldowns).forEach((key) => {
      const next = Number(state.skillCooldowns[key] || 0) - 1;
      if (next > 0) state.skillCooldowns[key] = next;
      else delete state.skillCooldowns[key];
    });
  }
  return changes;
}

function resolveFlee(item) {
  const node = item.data.nodes[item.currentNodeId];
  const battle = node?.battle;
  const states = Object.values(item.participantStates || {}).filter((state) => state.hp > 0);
  const avgAgi = states.length > 0 ? states.reduce((sum, state) => sum + Number(state.agi || 0), 0) / states.length : 0;
  const fleeSuccess = avgAgi >= 6 || Math.random() > 0.45;
  if (fleeSuccess) {
    const backNodeId = getPreviousRouteNodeId(item);
    const backNode = item.data.nodes[backNodeId];
    item.currentNodeId = backNodeId;
    setEventBanner(item, "도주했습니다", "normal", 2200);
    item.sharedLog = `[${node.name}] 우리는 E-Beast에게서 도주했습니다. ${backNode?.name || "이전 구역"}으로 후퇴합니다.`;
    item.sharedLogs.push(createLogEntry(item.sharedLog));
    item.routeHistory.push({ nodeId: backNodeId, name: backNode?.name || "이전 구역", time: new Date().toISOString() });
    item.pendingBattleActions = {};
    item.lastBattleRound = [{ text: "파티가 도주에 성공했습니다." }];
    emitInvestigationState(item.id);
    return { success: true };
  }
  states.forEach((state) => {
    const damage = Math.max(1, Number(battle?.atk || 0) - Math.floor(Number(state.def || 0) / 2));
    state.hp = Math.max(0, state.hp - damage);
    state.status = state.hp <= 0 ? "기절 상태" : "후퇴 실패";
  });
  setEventBanner(item, "도주 실패", "danger", 2200);
  item.sharedLog = `[${node.name}] 도주에 실패했습니다. 적의 추격으로 피해를 입었습니다.`;
  item.sharedLogs.push(createLogEntry(item.sharedLog));
  item.lastBattleRound = [{ text: "도주에 실패했습니다. 적의 추격을 받았습니다." }];
  if (allParticipantsDown(item)) {
    finishInvestigation(item, "전멸", "패배하였습니다. 활동할 수 있는 인원이 없습니다. 조사가 종료됩니다.");
  }
  emitInvestigationState(item.id);
  return { success: true };
}


function applyBattleTurn(item, actions) {
  const node = item.data.nodes[item.currentNodeId];
  if (!node?.battle) return { success: false, message: "현재 위치에는 전투 대상이 없습니다." };
  ensureRuntimeState(item);
  const battle = node.battle;
  const enemies = getBattleEnemies(battle);
  enemies.forEach((enemy, index) => {
    if (typeof enemy.maxHp !== "number") enemy.maxHp = Number(enemy.hp || 0);
    if (typeof enemy.def !== "number") enemy.def = 2;
    if (typeof enemy.atk !== "number") enemy.atk = 6;
    if (typeof enemy.agi !== "number") enemy.agi = 6;
    if (typeof enemy.aoe_chance !== "number") enemy.aoe_chance = 0.3;
    if (typeof enemy.finisher_chance !== "number") enemy.finisher_chance = 0.05;
    if (!enemy.finisherType) enemy.finisherType = "single";
    if (!enemy.id) enemy.id = `enemy-${index + 1}`;
  });
  syncBattleEnemyTotals(battle);

  const aliveNames = (item.participants || [])
    .filter((participant) => !participant?.isAdmin && String(participant?.id || "") !== "admin" && String(participant?.ownerId || "") !== "admin" && participant?.name !== "운영자")
    .map((participant) => participant.name)
    .filter((name) => Number(item.participantStates?.[name]?.hp || 0) > 0);
  if (aliveNames.length === 0) return { success: false, message: "행동 가능한 인원이 없습니다." };

  const missing = aliveNames.filter((name) => !actions?.[name]);
  if (missing.length > 0) return { success: false, message: `아직 행동을 정하지 않은 인원: ${missing.join(", ")}` };

  const aliveEnemyCount = getAliveBattleEnemies(battle).length;
  enemies.forEach((enemy) => {
    if (enemy.__engaged) return;
    const scale = Math.max(1, Math.min(2.2, 1 + Math.max(0, aliveNames.length - 1) * 0.42));
    const multiScale = Math.max(0.62, 1 - Math.max(0, aliveEnemyCount - 1) * 0.12);
    const beforeHp = Math.max(0, Number(enemy.hp || 0));
    const beforeMaxHp = Math.max(0, Number(enemy.maxHp || enemy.hp || 0));
    const alreadyDamaged = beforeMaxHp > 0 && beforeHp > 0 && beforeHp < beforeMaxHp;
    enemy.maxHp = Math.max(beforeMaxHp, Math.round(beforeMaxHp * scale * multiScale));
    enemy.hp = alreadyDamaged ? Math.min(beforeHp, enemy.maxHp) : Math.max(beforeHp, enemy.maxHp);
    enemy.atk = Math.max(1, Math.round(Number(enemy.atk || 0) * (aliveNames.length >= 3 ? 0.92 : 1)));
    enemy.__engaged = true;
    enemy.turnsElapsed = 0;
  });
  syncBattleEnemyTotals(battle);

  item.pendingBattleActions = clone(actions);
  item.lastBattleRound = [];
  const roundLogs = [createBattleLogEntry("[아군 행동]", "allies", { isPhaseHeader: true, snapshot: makeBattleSnapshot(item, battle) })];
  const persistRoundLogsToShared = (entries) => {
    (Array.isArray(entries) ? entries : []).forEach((entry) => {
      if (!entry?.text) return;
      item.sharedLogs.push(createLogEntry(entry.text));
    });
    item.sharedLogs = item.sharedLogs.slice(-160);
  };
  const firstAliveEnemy = () => getAliveBattleEnemies(battle)[0] || null;
  const markEnemyHit = (enemy, damage) => {
    if (!enemy) return;
    enemy.hp = Math.max(0, Number(enemy.hp || 0) - Math.max(0, Number(damage || 0)));
    syncBattleEnemyTotals(battle);
  };

  const actingOrder = aliveNames.map((name) => ({ name, ...item.participantStates[name] }))
    .sort((a, b) => Number(b.agi || 0) - Number(a.agi || 0));

  actingOrder.forEach((actor) => {
    const state = item.participantStates[actor.name];
    if (!state || state.hp <= 0) return;
    const parsed = parseBattleAction(actions[actor.name]);
    const targetEnemy = findTargetEnemy(battle, parsed.target);
    if (!targetEnemy) return;
    state.defending = false;

    if (parsed.type === "방어") {
      state.defending = true;
      addBuff(state, "guardUp", 1, 2);
      state.status = "방어 태세";
      roundLogs.push(createBattleLogEntry(`${actor.name}은(는) 방어 태세를 취했습니다.`, "allies", { actor: actor.name, effect: "guard", snapshot: makeBattleSnapshot(item, battle) }));
      return;
    }
    if (parsed.type === "아이템") {
      const result = consumeBattleItem(item, state, parsed.payload);
      state.status = result.changed ? "회복" : "대기";
      roundLogs.push(createBattleLogEntry(result.text, "allies", { actor: actor.name, effect: "item", snapshot: makeBattleSnapshot(item, battle) }));
      return;
    }
    if (parsed.type === "스킬") {
      const spec = getSkillSpec(parsed.payload);
      if (!state.skillCooldowns || typeof state.skillCooldowns !== "object") state.skillCooldowns = {};
      const cooldownLeft = Number(state.skillCooldowns[parsed.payload] || 0);
      if (cooldownLeft > 0) {
        roundLogs.push(createBattleLogEntry(`${actor.name}은(는) ${spec.label}을 아직 사용할 수 없습니다. (${cooldownLeft}턴 남음)`, "allies", { actor: actor.name, effect: "wait", snapshot: makeBattleSnapshot(item, battle) }));
        return;
      }
      if (Number(spec.cooldownTurns || 0) > 0) state.skillCooldowns[parsed.payload] = Number(spec.cooldownTurns || 0) + 1;
      const actorAtk = getEffectiveAttack(state);
      if (spec.mode === "allyAtkBuff") { const ally = findTargetAllyState(item, parsed.target, actor.name); if (!ally) return; addBuff(ally, "atkRateUp", Number(spec.duration || 2), Number(spec.rate || 0.5)); ally.status = "축복"; state.status = "지원"; roundLogs.push(createBattleLogEntry(`${actor.name}의 ${spec.label}! ${ally.name}의 공격력이 증가했습니다.`, "allies", { actor: actor.name, target: ally.name, effect: "buff", skillKey: spec.key, skillName: spec.label, skillMode: spec.mode, snapshot: makeBattleSnapshot(item, battle) })); return; }
      if (spec.mode === "enemyDamageTakenDebuff") { const enemyTarget = findTargetEnemy(battle, parsed.target); if (!enemyTarget) return; addBuff(enemyTarget, "damageTakenRateUp", Number(spec.duration || 2), Number(spec.rate || 0.5)); state.status = "저주"; roundLogs.push(createBattleLogEntry(`${actor.name}의 ${spec.label}! ${enemyTarget.name}이(가) 받는 피해가 증가했습니다.`, "allies", withBattleEnemyTarget(battle, enemyTarget, { actor: actor.name, effect: "debuff", skillKey: spec.key, skillName: spec.label, skillMode: spec.mode, snapshot: makeBattleSnapshot(item, battle) }))); return; }
      if (spec.mode === "protectOne") { const ally = findTargetAllyState(item, parsed.target, actor.name); if (!ally) return; addBuff(state, "protect", Number(spec.duration || 1), 1); state.buffs[state.buffs.length - 1].target = ally.name; state.status = "희생 보호"; roundLogs.push(createBattleLogEntry(`${actor.name}의 ${spec.label}! ${ally.name}에게 향하는 공격을 대신 받습니다.`, "allies", { actor: actor.name, target: ally.name, effect: "shield", skillKey: spec.key, skillName: spec.label, skillMode: spec.mode, snapshot: makeBattleSnapshot(item, battle) })); return; }
      if (spec.mode === "protectAll") { const shield = Math.max(1, Math.round(Number(state.def || 0) / 2)); Object.values(item.participantStates || {}).forEach((ally) => { if (!ally || Number(ally.hp || 0) <= 0) return; addBuff(ally, "guardUp", Number(spec.duration || 2), shield); ally.status = "가호"; }); state.status = "가호"; roundLogs.push(createBattleLogEntry(`${actor.name}의 ${spec.label}! 아군 전체에게 보호막을 씌웠습니다.`, "allies", { actor: actor.name, effect: "shield", skillKey: spec.key, skillName: spec.label, skillMode: spec.mode, snapshot: makeBattleSnapshot(item, battle) })); return; }
      if (spec.mode === "singleHeal") { const ally = findTargetAllyState(item, parsed.target, actor.name); if (!ally) return; const heal = Math.max(1, Math.round(actorAtk * 2)); ally.hp = Math.min(ally.maxHp, Number(ally.hp || 0) + heal); ally.status = "구원"; state.status = "회복"; roundLogs.push(createBattleLogEntry(`${actor.name}의 ${spec.label}! ${ally.name} HP ${heal} 회복`, "allies", { actor: actor.name, target: ally.name, effect: "heal", skillKey: spec.key, skillName: spec.label, skillMode: spec.mode, snapshot: makeBattleSnapshot(item, battle) })); return; }
      if (spec.mode === "aoeHeal") { const heal = Math.max(1, Math.round(actorAtk / 2)); Object.values(item.participantStates || {}).forEach((ally) => { if (!ally || Number(ally.hp || 0) <= 0) return; ally.hp = Math.min(ally.maxHp, Number(ally.hp || 0) + heal); ally.status = "격려"; }); state.status = "회복"; roundLogs.push(createBattleLogEntry(`${actor.name}의 ${spec.label}! 아군 전체 HP ${heal} 회복`, "allies", { actor: actor.name, effect: "heal", skillKey: spec.key, skillName: spec.label, skillMode: spec.mode, snapshot: makeBattleSnapshot(item, battle) })); return; }
      if (spec.mode === "aoeDamage") {
        const crit = rollCritical(state.agi);
        const hitResults = [];
        getAliveBattleEnemies(battle).forEach((enemyTarget) => {
          let raw = Math.max(1, Math.round(actorAtk * Number(spec.multiplier || 0.75) - Math.floor(Number(enemyTarget.def || 0) / 2)));
          if (crit) raw *= 2;
          const damage = applyEnemyDamage(enemyTarget, raw);
          hitResults.push({ name: enemyTarget.name, id: enemyTarget.id, damage });
        });
        syncBattleEnemyTotals(battle);
        if (hitResults.length > 0) {
          roundLogs.push(createBattleLogEntry(`${actor.name}의 ${spec.label}! ${hitResults.map((result) => `${result.name} ${result.damage}데미지`).join(", ")}${crit ? " / 치명타" : ""}`, "allies", { actor: actor.name, target: "전체", targets: hitResults.map((result) => result.name), targetIds: hitResults.map((result) => result.id).filter(Boolean), effect: "skill", skillKey: spec.key, skillName: spec.label, skillMode: spec.mode, snapshot: makeBattleSnapshot(item, battle) }));
          hitResults.forEach((result) => {
            const defeated = getBattleEnemies(battle).find((enemyTarget) => String(enemyTarget.id || "") === String(result.id || ""))
              || getBattleEnemies(battle).find((enemyTarget) => String(enemyTarget.name) === String(result.name));
            if (defeated && Number(defeated.hp || 0) <= 0) {
              roundLogs.push(createBattleLogEntry(`${defeated.name}가 쓰러졌습니다.`, "allies", withBattleEnemyTarget(battle, defeated, { effect: "defeat", snapshot: makeBattleSnapshot(item, battle) })));
            }
          });
        }
        state.status = crit ? "치명타" : "연격";
        return;
      }
      if (rollEvasion(Number(state.agi || 0), Number(targetEnemy.agi || 0))) {
        roundLogs.push(createBattleLogEntry(`${targetEnemy.name}가 ${actor.name}의 ${spec.label}을(를) 피해냈습니다!`, "allies", withBattleEnemyTarget(battle, targetEnemy, { actor: actor.name, effect: "evade", skillKey: spec.key, skillName: spec.label, skillMode: spec.mode, snapshot: makeBattleSnapshot(item, battle) })));
        state.status = "회피당함";
        return;
      }
      const crit = rollCritical(state.agi);
      let rawDamage = Math.max(1, Math.round(getEffectiveAttack(state) * Number(spec.multiplier || 1) + Number(spec.power || 0) - Math.floor(Number(targetEnemy.def || 0) / 2)));
      if (crit) rawDamage *= 2;
      const damage = applyEnemyDamage(targetEnemy, rawDamage);
      syncBattleEnemyTotals(battle);
      state.status = crit ? "치명타" : "스킬";
      roundLogs.push(createBattleLogEntry(`${actor.name}의 ${spec.label}! ${targetEnemy.name}에게 ${damage}데미지${crit ? " / 치명타" : ""}`, "allies", withBattleEnemyTarget(battle, targetEnemy, { actor: actor.name, effect: spec.mode === "drain" ? "drain" : "skill", skillKey: spec.key, skillName: spec.label, skillMode: spec.mode, snapshot: makeBattleSnapshot(item, battle) })));
      if (targetEnemy.hp <= 0) roundLogs.push(createBattleLogEntry(`${targetEnemy.name}가 쓰러졌습니다.`, "allies", withBattleEnemyTarget(battle, targetEnemy, { effect: "defeat", snapshot: makeBattleSnapshot(item, battle) })));
      return;
    }

    if (rollEvasion(Number(state.agi || 0), Number(targetEnemy.agi || 0))) {
      roundLogs.push(createBattleLogEntry(`${targetEnemy.name}가 ${actor.name}의 공격을 피해냈습니다!`, "allies", withBattleEnemyTarget(battle, targetEnemy, { actor: actor.name, effect: "evade", snapshot: makeBattleSnapshot(item, battle) })));
      state.status = "회피당함";
      return;
    }
    const crit = rollCritical(state.agi);
    let rawDamage = Math.max(1, getEffectiveAttack(state) - Math.floor(Number(targetEnemy.def || 0) / 2));
    if (crit) rawDamage *= 2;
    const damage = applyEnemyDamage(targetEnemy, rawDamage);
    syncBattleEnemyTotals(battle);
    state.status = crit ? "치명타" : "공격";
    roundLogs.push(createBattleLogEntry(`${actor.name}의 ${crit ? "치명타!" : "공격!"} ${targetEnemy.name}에게 ${damage}데미지`, "allies", withBattleEnemyTarget(battle, targetEnemy, { actor: actor.name, effect: "attack", snapshot: makeBattleSnapshot(item, battle) })));
    if (targetEnemy.hp <= 0) roundLogs.push(createBattleLogEntry(`${targetEnemy.name}가 쓰러졌습니다.`, "allies", withBattleEnemyTarget(battle, targetEnemy, { effect: "defeat", snapshot: makeBattleSnapshot(item, battle) })));
  });

  if (getAliveBattleEnemies(battle).length === 0) {
    Object.values(item.participantStates || {}).forEach((state) => {
      if (!state) return;
      state.defending = false;
      if (Array.isArray(state.buffs)) state.buffs = state.buffs.filter((buff) => buff?.type !== "guardUp");
    });
    const defeatedEnemies = getBattleEnemies(battle);
    node.battle = null;
    const rewardItems = [];
    let rewardPoints = 0;
    defeatedEnemies.forEach((enemy) => {
      if (enemy.rewardItem) rewardItems.push(enemy.rewardItem);
      rewardPoints += Number(enemy.rewardPoints || 0);
    });
    if (battle.rewardItem) rewardItems.push(battle.rewardItem);
    rewardItems.filter(Boolean).forEach((rewardItem) => {
      queueRewardAssignment(item, { type: "item", label: rewardItem, value: rewardItem });
      roundLogs.push(createBattleLogEntry(`[보상] ${rewardItem} 획득`, "allies", { effect: "item", snapshot: makeBattleSnapshot(item, battle) }));
    });
    item.rewards.push(`${defeatedEnemies.map((enemy) => enemy.name).join(", ")} 제압`);
    setEventBanner(item, "승리", "success", 2600);
    const victoryText = `[${node.name}] ${defeatedEnemies.map((enemy) => enemy.name).join(", ")}를 제압했습니다.${rewardItems.length ? ` ${rewardItems.join(", ")} 획득` : ""}`;
    item.sharedLog = victoryText;
    persistRoundLogsToShared(roundLogs);
    item.sharedLogs.push(createLogEntry(victoryText));
    item.sharedLogs = item.sharedLogs.slice(-160);
    item.lastBattleRound = roundLogs;
    item.pendingBattleActions = {};
    item.battleTurn += 1;
    refreshInvestigationCompletionState(item);
    const expReward = 15 + rewardPoints;
    item.participants.forEach((participant) => {
      const char = charactersDB.find((c) => c.id === participant.id);
      if (!char) return;
      char.exp = Number(char.exp || 0) + expReward;
      char.coins = Number(char.coins || 0) + Math.max(8, Math.floor(rewardPoints / 2));
      while (char.exp >= (char.level || 1) * 100) {
        char.exp -= (char.level || 1) * 100;
        char.level = Number(char.level || 1) + 1;
        char.statPoints = Number(char.statPoints || 0) + 3;
      }
    });
    emitInvestigationState(item.id);
    return { success: true };
  }

  roundLogs.push(createBattleLogEntry("[적군 행동]", "enemy", { isPhaseHeader: true }));
  getAliveBattleEnemies(battle).forEach((enemy) => {
    const aliveTargets = Object.values(item.participantStates).filter((state) => Number(state.hp || 0) > 0);
    if (aliveTargets.length === 0) return;
    const enemyAtkPenalty = getBuffValue(enemy, "atkDown");
    const finisher = Math.random() < Number(enemy.finisher_chance || 0.05);
    const aoe = !finisher && Math.random() < Number(enemy.aoe_chance || 0.3);
    if (finisher && String(enemy.finisherType || "single") === "aoe") {
      aliveTargets.forEach((state) => {
        if (rollEvasion(Number(enemy.agi || 0), Number(state.agi || 0))) {
          roundLogs.push(createBattleLogEntry(`${state.name}이(가) ${enemy.name}의 필살기를 피했습니다!`, "enemy", withBattleEnemyActor(battle, enemy, { target: state.name, effect: "evade", snapshot: makeBattleSnapshot(item, battle) })));
          state.defending = false;
          return;
        }
        const result = applyEnemyDamageToParticipant(item, state, Number(enemy.atk || 0) + enemyAtkPenalty + 6, "필살기 피격");
        const logTarget = getEnemyDamageLogTarget(result, state);
        roundLogs.push(createBattleLogEntry(`${enemy.name}의 필살기! ${logTarget} 피해 ${result.damage}`, "enemy", withBattleEnemyActor(battle, enemy, { target: result.actualTarget?.name || state.name, effect: "damage", snapshot: makeBattleSnapshot(item, battle) })));
        state.defending = false;
        if (result.actualTarget && result.actualTarget !== state) result.actualTarget.defending = false;
      });
    } else if (aoe) {
      aliveTargets.forEach((state) => {
        if (rollEvasion(Number(enemy.agi || 0), Number(state.agi || 0))) {
          roundLogs.push(createBattleLogEntry(`${state.name}이(가) ${enemy.name}의 전체 공격을 피했습니다!`, "enemy", withBattleEnemyActor(battle, enemy, { target: state.name, effect: "evade", snapshot: makeBattleSnapshot(item, battle) })));
          state.defending = false;
          return;
        }
        const result = applyEnemyDamageToParticipant(item, state, Number(enemy.atk || 0) + enemyAtkPenalty + 1, "피격");
        const logTarget = getEnemyDamageLogTarget(result, state);
        roundLogs.push(createBattleLogEntry(`${enemy.name}의 전체 공격! ${logTarget} 피해 ${result.damage}`, "enemy", withBattleEnemyActor(battle, enemy, { target: result.actualTarget?.name || state.name, effect: "damage", snapshot: makeBattleSnapshot(item, battle) })));
        state.defending = false;
        if (result.actualTarget && result.actualTarget !== state) result.actualTarget.defending = false;
      });
    } else {
      const target = aliveTargets.sort((a, b) => Number(b.atk || 0) - Number(a.atk || 0))[0];
      if (rollEvasion(Number(enemy.agi || 0), Number(target.agi || 0))) {
        roundLogs.push(createBattleLogEntry(`${target.name}이(가) ${enemy.name}의 공격을 피했습니다!`, "enemy", withBattleEnemyActor(battle, enemy, { target: target.name, effect: "evade", snapshot: makeBattleSnapshot(item, battle) })));
      } else {
        const bonus = finisher ? 8 : 2;
        const result = applyEnemyDamageToParticipant(item, target, Number(enemy.atk || 0) + enemyAtkPenalty + bonus, finisher ? "필살기 피격" : "집중 공격");
        const logTarget = getEnemyDamageLogTarget(result, target);
        roundLogs.push(createBattleLogEntry(`${enemy.name}${finisher ? "의 필살기" : "의 단일 공격"}! ${logTarget} 피해 ${result.damage}`, "enemy", withBattleEnemyActor(battle, enemy, { target: result.actualTarget?.name || target.name, effect: "damage", snapshot: makeBattleSnapshot(item, battle) })));
      }
      target.defending = false;
    }
    enemy.turnsElapsed = Number(enemy.turnsElapsed || 0) + 1;
  });

  Object.values(item.participantStates || {}).forEach((state) => {
    if (!state) return;
    state.defending = false;
    if (Array.isArray(state.buffs)) state.buffs = state.buffs.filter((buff) => buff?.type !== "guardUp");
  });
  const endTurnChanges = [];
  Object.values(item.participantStates).forEach((state) => {
    if (!state) return;
    const changes = tickBuffs(state);
    changes.forEach((change) => endTurnChanges.push({ owner: state.name, ...change }));
  });
  getBattleEnemies(battle).forEach((enemy) => tickBuffs(enemy));
  if (endTurnChanges.length > 0) {
    roundLogs.push(createBattleLogEntry("[상태 변화]", "allies", { isPhaseHeader: true }));
    endTurnChanges.forEach((change) => {
      const label = change.type === "atkUp" ? "공격 강화" : change.type === "guardUp" ? "방어 강화" : change.type === "atkDown" ? "약화" : change.type;
      roundLogs.push(createBattleLogEntry(`${change.owner}의 ${label} 효과가 정리되었습니다.`, "allies", { actor: change.owner, effect: change.type === "guardUp" ? "shield" : change.type === "atkUp" ? "buff" : "debuff", snapshot: makeBattleSnapshot(item, battle) }));
    });
  }
  syncBattleEnemyTotals(battle);
  item.lastBattleRound = roundLogs;
  item.sharedLog = `[턴 ${item.battleTurn}] 적군 ${battle.hp}/${battle.maxHp}`;
  persistRoundLogsToShared(roundLogs);
  item.pendingBattleActions = {};
  item.battleTurn += 1;
  if (allParticipantsDown(item)) finishInvestigation(item, "전멸", "패배하였습니다. 활동할 수 있는 인원이 없습니다. 조사가 종료됩니다.");
  refreshInvestigationCompletionState(item);
  emitInvestigationState(item.id);
  return { success: true };
}



app.get("/designConfig", (req, res) => res.json(designConfig));

app.get("/presetSkills", (req, res) => res.json(getPresetSkillList()));

app.get("/designConfigPublic", (req, res) => res.json(getPublicDesignShellConfig()));

app.get("/designMapsPublic", (req, res) => res.json(getPublicDesignMapsConfig()));

app.get("/image-manifest", (req, res) => {
  const characters = getPublicCharacterSummaries()
    .filter((character) => character && character.approved !== false)
    .map((character) => ({
      id: character.id,
      name: character.name,
      cardImage: character.cardImage || character.mainImage || character.profileImage || character.image || "",
      mainImage: character.mainImage || character.cardImage || character.profileImage || character.image || "",
      spriteImage: character.spriteImage || character.investigationImage || character.cardImage || character.mainImage || character.profileImage || character.image || "",
      profileImage: character.profileImage || character.image || "",
      updatedAt: character.updatedAt || character.assetVersion || 0,
    }));
  const maps = getPublicDesignMapsConfig();
  res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
  res.json({ success: true, generatedAt: Date.now(), characters, maps });
});

app.get("/asset/design", (req, res) => {
  const value = getValueByPath(designConfig, req.query.path || "");
  if (!isDataImage(value)) return res.status(404).end();
  return sendDataImage(res, value);
});

app.get("/asset/character/:id", (req, res) => {
  const character = charactersDB.find((item) => String(item.id) === String(req.params.id));
  if (!character) return res.status(404).end();
  let pathKey = String(req.query.path || "");
  if (pathKey === "profileImage") pathKey = pickCharacterAssetPath(character, ["profileImage", "image", "avatar", "portraitImage", "portrait", "mainImage", "cardImage", "investigationImage", "spriteImage"]);
  if (pathKey === "mainImage" || pathKey === "cardImage") pathKey = pickCharacterAssetPath(character, ["mainImage", "cardImage", "fullBodyImage", "fullImage", "profileImage", "image"]);
  if (pathKey === "investigationImage" || pathKey === "spriteImage") pathKey = pickCharacterAssetPath(character, ["spriteImage", "investigationImage", "sdImage", "sdImageUrl", "sd", "mainImage", "cardImage", "profileImage", "image"]);
  const value = getValueByPath(character, pathKey || "");
  if (!isDataImage(value)) return res.status(404).end();
  return sendDataImage(res, value);
});

app.get("/asset/investigation/:id", (req, res) => {
  const item = investigationsDB.find((entry) => String(entry.id) === String(req.params.id));
  if (!item) return res.status(404).end();
  const value = getValueByPath(item, req.query.path || "");
  if (!isDataImage(value)) return res.status(404).end();
  return sendDataImage(res, value);
});
app.post("/designConfig", (req, res) => {
  const payload = req.body && typeof req.body === "object" ? req.body : {};
  designConfig = {
    ...defaultDesign,
    ...payload,
    theme: { ...(defaultDesign.theme || {}), ...(payload.theme || {}) },
    pages: { ...(defaultDesign.pages || {}), ...(payload.pages || {}) },
    siteContent: { ...(defaultDesign.siteContent || {}), ...(payload.siteContent || {}) },
    sharedShellElements: Array.isArray(payload.sharedShellElements) ? payload.sharedShellElements : (Array.isArray(defaultDesign.sharedShellElements) ? defaultDesign.sharedShellElements : []),
    sharedShellOverrides: typeof payload.sharedShellOverrides === "object" && payload.sharedShellOverrides ? payload.sharedShellOverrides : (defaultDesign.sharedShellOverrides || {}),
  };
  designAssetVersion = Date.now();
  publicDesignShellCache = null;
  publicDesignMapsCache = null;

  try {
    const designConfigPath = resolveDataPath("designConfig.json");
    fs.writeFileSync(designConfigPath, JSON.stringify(designConfig, null, 2), "utf-8");
  } catch (error) {
    console.error("design save failed", error);
  }

  res.json({ success: true, designConfig });
});

app.post("/register", (req, res) => {
  refreshUsersFromKnownSources({ deep: true });
  const nextId = normalizeUserIdText(req.body?.id);
  const nextPw = String(req.body?.pw || "").trim();
  const type = req.body?.type || "owner";

  if (!nextId || !nextPw) {
    return res.json({ success: false, message: "아이디와 비밀번호를 입력해 주세요." });
  }
  if (nextId === "PLC") return res.json({ success: false, message: "이 아이디는 사용할 수 없습니다." });
  const exists = usersDB.find((u) => normalizeUserIdText(u.id).toLowerCase() === nextId.toLowerCase());
  if (exists) return res.json({ success: false, message: "이미 존재하는 아이디입니다." });
  const nextUser = { id: nextId, pw: nextPw, type, createdAt: new Date().toISOString() };
  usersDB = mergeRuntimeUsers(usersDB, [nextUser]);
  const saved = writeRuntimeArray("users.json", usersDB);
  if (!saved) return res.json({ success: false, message: "계정 저장이 차단되었습니다. 기존 데이터 보호 중입니다." });
  rememberRegisteredRuntimeUser(nextUser);
  res.json({ success: true });
});

app.post("/login", (req, res) => {
  refreshProtectedRuntimeArraysIfNeeded();
  const nextId = normalizeUserIdText(req.body?.id);
  const nextPw = String(req.body?.pw || "").trim();
  if (!nextId || !nextPw) {
    return res.json({ success: false, message: "아이디와 비밀번호를 입력해 주세요." });
  }
  if (nextId === "PLC" && nextPw === "1119") {
    return res.json({ success: true, user: { id: "PLC", pw: "1119", type: "owner", isAdmin: true } });
  }
  const user = usersDB.find((u) => normalizeUserIdText(u.id).toLowerCase() === nextId.toLowerCase() && String(u.pw || "") === nextPw);
  if (!user) return res.json({ success: false, message: "아이디 또는 비밀번호가 맞지 않습니다." });
  rememberRegisteredRuntimeUser(user);
  res.json({ success: true, user: { ...user, isAdmin: false } });
});

app.post("/createCharacter", (req, res) => {
  refreshProtectedRuntimeArraysIfNeeded();
  const {
    ownerId,
    name,
    image,
    mainImage,
    investigationImage,
    profile,
    age,
    bodyInfo,
    rank,
    oneLine,
    profileBgm,
    profileBgmVolume,
    sdQuotes,
    dailyAttemptsLeft,
    gambleCountLeft,
    currentMap,
    mainImageFrame,
  } = req.body;

  const newChar = {
    id: Date.now(),
    ownerId,
    name,
    approved: false,
    image: image || "",
    mainImage: mainImage || "",
    investigationImage: investigationImage || "",
    profileBgm: profileBgm || "",
    profileBgmVolume: Number.isFinite(Number(profileBgmVolume)) ? Math.max(0, Math.min(1, Number(profileBgmVolume))) : 1,
    profile: profile || "",
    level: 1,
    statPoints: 0,
    corrosion: 0,
    coins: 0,
    exp: 0,
    stats: { atk: 0, hp: 0, def: 0, agi: 0 },
    currentHp: 100,
    skills: [],
    items: [],
    age: age || "",
    bodyInfo: bodyInfo || "",
    rank: rank || "대원",
    oneLine: oneLine || "",
    mainImageFrame: typeof mainImageFrame === "object" && mainImageFrame
      ? {
          x: Number(mainImageFrame.x ?? 50),
          y: Number(mainImageFrame.y ?? 26),
          scale: Number(mainImageFrame.scale ?? 1.06),
        }
      : { x: 50, y: 26, scale: 1.06 },
    sdQuotes: Array.isArray(sdQuotes) ? sdQuotes : [],
    dailyAttemptsLeft: Number(dailyAttemptsLeft ?? 1),
    gambleCountLeft: Number(gambleCountLeft ?? 3),
    currentMap: currentMap || "sector-01",
    x: 20,
    y: 20,
    updatedAt: Date.now(),
    assetVersion: Date.now(),
  };

  charactersDB.push(newChar);
  writeRuntimeArray("characters.json", charactersDB);
  res.json({ success: true, character: buildPublicCharacter(newChar) });
});


function normalizeLookupKey(value) {
  return String(value || "").trim().toLowerCase();
}

function findCharacterByLooseIdentifiers(payload = {}) {
  refreshProtectedRuntimeArraysIfNeeded();
  const ids = [
    payload.charId,
    payload.characterId,
    payload.id,
    payload.activeCharacterId,
  ].map((value) => String(value || "").trim()).filter(Boolean);

  for (const targetId of ids) {
    const found = charactersDB.find((character) => String(character?.id || "") === targetId);
    if (found) return found;
  }

  const ownerId = normalizeLookupKey(payload.ownerId || payload.userId || payload.accountId);
  const name = normalizeLookupKey(payload.name || payload.characterName || payload.character_name);
  if (ownerId && name) {
    const found = charactersDB.find((character) =>
      normalizeLookupKey(character?.ownerId) === ownerId &&
      normalizeLookupKey(character?.name) === name
    );
    if (found) return found;
  }

  if (name) {
    const matches = charactersDB.filter((character) => normalizeLookupKey(character?.name) === name);
    if (matches.length === 1) return matches[0];
  }

  return null;
}

function isBlankIncomingString(value) {
  return typeof value === "string" && value.trim() === "";
}

function assignCharacterStringFieldSafely(character, key, value, { protectExisting = false } = {}) {
  if (!character || value === undefined) return;
  if (protectExisting && isBlankIncomingString(value) && String(character[key] || "").trim()) return;
  character[key] = value;
}

function assignCharacterArrayFieldSafely(character, key, value) {
  if (!character || value === undefined) return;
  if (Array.isArray(value)) {
    character[key] = value;
    return;
  }
  if (value === null) return;
  if (!Array.isArray(character[key])) character[key] = [];
}

app.post("/updateCharacter", (req, res) => {
  refreshProtectedRuntimeArraysIfNeeded();
  const {
    charId,
    characterId,
    id,
    ownerId,
    userId,
    accountId,
    characterName,
    image,
    profileImage,
    mainImage,
    cardImage,
    investigationImage,
    spriteImage,
    profile,
    profileText,
    profileContent,
    level,
    statPoints,
    corrosion,
    coins,
    exp,
    stats,
    items,
    age,
    bodyInfo,
    rank,
    oneLine,
    profileBgm,
    bgmUrl,
    profileBgmVolume,
    sdQuotes,
    dailyAttemptsLeft,
    gambleCountLeft,
    currentMap,
    x,
    y,
    dx,
    dy,
    waitMs,
    moveCooldownMs,
    currentHp,
    skills,
    approved,
    name,
    mainImageFrame,
  } = req.body || {};

  const positionSyncKeys = new Set(["charId", "characterId", "id", "ownerId", "userId", "accountId", "characterName", "currentMap", "x", "y", "dx", "dy", "waitMs", "moveCooldownMs"]);
  const incomingKeys = Object.keys(req.body || {}).filter((key) => req.body[key] !== undefined);
  const hasPositionPayload = ["currentMap", "x", "y", "dx", "dy", "waitMs", "moveCooldownMs"].some((key) => req.body?.[key] !== undefined);
  const isPositionOnlyUpdate = hasPositionPayload && incomingKeys.length > 0 && incomingKeys.every((key) => positionSyncKeys.has(key));

  const char = findCharacterByLooseIdentifiers({ charId, characterId, id, ownerId, userId, accountId, name, characterName });

  if (!char) {
    return res.json({ success: false, message: "캐릭터를 찾을 수 없습니다." });
  }

  if (name !== undefined) char.name = name;

  // 중요: 이미지 / 프로필 글 / BGM은 빈 값으로 기존 데이터를 덮어쓰지 않게 보호합니다.
  // 브라우저를 바꾸거나 캐시가 비어 있는 운영 화면에서 저장해도 기존 캐릭터 정보가 사라지지 않도록 합니다.
  assignCharacterStringFieldSafely(char, "image", image ?? profileImage, { protectExisting: true });
  assignCharacterStringFieldSafely(char, "mainImage", mainImage ?? cardImage, { protectExisting: true });
  assignCharacterStringFieldSafely(char, "investigationImage", investigationImage ?? spriteImage, { protectExisting: true });
  assignCharacterStringFieldSafely(char, "profileBgm", profileBgm ?? bgmUrl, { protectExisting: true });
  assignCharacterStringFieldSafely(char, "profile", profile ?? profileText ?? profileContent, { protectExisting: true });
  assignCharacterStringFieldSafely(char, "profileText", profileText ?? profile, { protectExisting: true });
  assignCharacterStringFieldSafely(char, "profileContent", profileContent ?? profile, { protectExisting: true });

  if (profileBgmVolume !== undefined) char.profileBgmVolume = Math.max(0, Math.min(1, Number(profileBgmVolume) || 0));
  if (level !== undefined) char.level = Number(level);
  if (statPoints !== undefined) char.statPoints = Number(statPoints);
  if (corrosion !== undefined) char.corrosion = Number(corrosion);
  if (coins !== undefined) char.coins = Number(coins);
  if (exp !== undefined) char.exp = Number(exp);
  if (stats !== undefined) char.stats = normalizeCharacterStats(stats);
  if (items !== undefined) {
    if (Array.isArray(items)) {
      const allowEmptyItems = req.body?.replaceItems === true || req.body?.__replaceItems === true;
      if (items.length > 0 || allowEmptyItems || !Array.isArray(char.items) || char.items.length === 0) {
        char.items = items;
      }
    } else if (!Array.isArray(char.items)) {
      char.items = [];
    }
  }
  assignCharacterStringFieldSafely(char, "age", age, { protectExisting: true });
  assignCharacterStringFieldSafely(char, "bodyInfo", bodyInfo, { protectExisting: true });
  assignCharacterStringFieldSafely(char, "rank", rank, { protectExisting: true });
  if (oneLine !== undefined && !(isBlankIncomingString(oneLine) && String(char.oneLine || "").trim())) char.oneLine = oneLine;
  if (mainImageFrame !== undefined) {
    char.mainImageFrame = {
      x: Number(mainImageFrame?.x ?? char.mainImageFrame?.x ?? 50),
      y: Number(mainImageFrame?.y ?? char.mainImageFrame?.y ?? 26),
      scale: Number(mainImageFrame?.scale ?? char.mainImageFrame?.scale ?? 1.06),
    };
  }
  assignCharacterArrayFieldSafely(char, "sdQuotes", sdQuotes);
  if (dailyAttemptsLeft !== undefined) char.dailyAttemptsLeft = Number(dailyAttemptsLeft);
  if (gambleCountLeft !== undefined) char.gambleCountLeft = Number(gambleCountLeft);
  if (currentMap !== undefined) char.currentMap = currentMap;
  if (x !== undefined) char.x = Number(x);
  if (y !== undefined) char.y = Number(y);
  if (dx !== undefined) char.dx = Number(dx);
  if (dy !== undefined) char.dy = Number(dy);
  if (waitMs !== undefined) char.waitMs = Number(waitMs);
  if (moveCooldownMs !== undefined) char.moveCooldownMs = Number(moveCooldownMs);
  if (currentHp !== undefined) char.currentHp = Number(currentHp);
  assignCharacterArrayFieldSafely(char, "skills", skills);
  if (approved !== undefined) char.approved = !!approved;

  const nextMaxHp = getCharacterMaxHp(char?.stats?.hp);
  if (!Number.isFinite(Number(char.currentHp))) char.currentHp = nextMaxHp;
  char.currentHp = Math.max(0, Math.min(nextMaxHp, Number(char.currentHp)));
  if (!Array.isArray(char.skills)) char.skills = [];
  if (!Array.isArray(char.items)) char.items = [];
  if (!Array.isArray(char.sdQuotes)) char.sdQuotes = [];
  if (!char.mainImageFrame || typeof char.mainImageFrame !== "object") {
    char.mainImageFrame = { x: 50, y: 26, scale: 1.06 };
  }
  if (isPositionOnlyUpdate) {
    markCharactersDirty();
    publicCharacterSummaryCache = null;
    return res.json({ success: true, character: buildPublicCharacterSummary(char) });
  }

  char.updatedAt = Date.now();
  char.assetVersion = char.updatedAt;

  const saved = writeRuntimeArray("characters.json", charactersDB);
  if (!saved) return res.json({ success: false, message: "캐릭터 저장이 차단되었습니다. 기존 데이터 보호 중입니다." });
  return res.json({ success: true, character: buildPublicCharacter(char) });
});

app.get("/characters/:ownerId", (req, res) => { refreshProtectedRuntimeArraysIfNeeded(); return res.json(charactersDB.filter((c) => c.ownerId === req.params.ownerId).map(attachRelationsToCharacter)); });
app.get("/characters", (req, res) => { refreshProtectedRuntimeArraysIfNeeded(); return res.json(charactersDB.map(attachRelationsToCharacter)); });
app.delete("/admin/characters/:id", (req, res) => {
  const id = String(req.params.id || "");
  const target = charactersDB.find((character) => String(character.id) === id);
  if (!target) return res.json({ success: false, message: "캐릭터를 찾을 수 없습니다." });

  charactersDB = charactersDB.filter((character) => String(character.id) !== id);
  relationRequestsDB = relationRequestsDB.filter((entry) => String(entry.fromCharacterId) !== id && String(entry.toCharacterId) !== id);
  relationsDB = relationsDB.filter((entry) => String(entry.characterId) !== id && String(entry.otherCharacterId) !== id);
  mailsDB = mailsDB.filter((mail) => String(mail.fromCharacterId) !== id && String(mail.toCharacterId) !== id);

  investigationsDB = investigationsDB.map((item) => {
    const next = { ...item };
    next.participants = (item.participants || []).filter((participant) => String(participant.id) !== id && String(participant.name) !== String(target.name));
    next.leaders = (item.leaders || []).filter((leaderName) => String(leaderName) !== String(target.name));
    next.participantStates = Object.fromEntries(Object.entries(item.participantStates || {}).filter(([name]) => String(name) !== String(target.name)));
    next.pendingBattleActions = Object.fromEntries(Object.entries(item.pendingBattleActions || {}).filter(([name]) => String(name) !== String(target.name)));
    return next;
  });

  writeRuntimeArray("characters.json", charactersDB);
  writeRuntimeArray("relationRequests.json", relationRequestsDB);
  writeRuntimeArray("relations.json", relationsDB);
  writeRuntimeArray("mails.json", mailsDB);
  writeRuntimeArray("customInvestigations.json", customInvestigationsDB);
  writeRuntimeArray("investigations.json", investigationsDB);

  emitParticipantsUpdated();
  res.json({ success: true });
});

app.post("/approveCharacter", (req, res) => {
  const { charId } = req.body;
  const char = charactersDB.find((c) => c.id === charId);
  if (char) {
    char.approved = true;
    writeRuntimeArray("characters.json", charactersDB);
  }
  res.json({ success: true });
});

function isWithinScheduledWindow(item) {
  if (!item?.scheduleEnabled) return !!item?.opened;

  const now = Date.now();
  const openTime = item.openAt ? new Date(item.openAt).getTime() : null;
  const closeTime = item.closeAt ? new Date(item.closeAt).getTime() : null;

  if (openTime && now < openTime) return false;
  if (closeTime && now > closeTime) return false;

  return true;
}

function getEffectiveOpened(item) {
  if (!item?.scheduleEnabled) return !!item?.opened;
  return isWithinScheduledWindow(item);
}

app.post("/admin/investigationSchedule", (req, res) => {
  const { investigationId, scheduleEnabled, openAt, closeAt } = req.body || {};
  const item = investigationsDB.find((v) => v.id === investigationId);

  if (!item) {
    return res.json({ success: false, message: "조사를 찾을 수 없습니다." });
  }

  item.scheduleEnabled = !!scheduleEnabled;
  item.openAt = openAt || "";
  item.closeAt = closeAt || "";
  writeRuntimeArray("investigations.json", investigationsDB);
  emitParticipantsUpdated();
  emitInvestigationState(item.id);

  res.json({ success: true, started: true, investigationId: item.id, item: getInvestigationSummary(item) });
});

app.get("/investigations", (req, res) => {
  const includeHidden = String(req.query.includeHidden || "") === "1";
  const rows = investigationsDB
    .filter((item) => includeHidden || !item.hidden)
    .map(getInvestigationSummary);
  res.json(rows);
});
app.get("/investigations/:id", (req, res) => {
  const item = investigationsDB.find((v) => v.id === req.params.id);
  if (!item) return res.status(404).json({ success: false });
  syncInvestigationRoster(item);
  res.json({ ...item, activeNpcScene: normalizeNpcScene(item.activeNpcScene) || null });
});

app.get("/investigationView/:id", (req, res) => {
  const item = investigationsDB.find((v) => v.id === req.params.id);
  if (!item) return res.status(404).json({ success: false });
  syncInvestigationRoster(item);
  res.json(buildPublicInvestigationState(item));
});

app.get("/investigationLobby/:id", (req, res) => {
  const item = investigationsDB.find((v) => v.id === req.params.id);
  if (!item) return res.status(404).json({ success: false });
  syncInvestigationRoster(item);
  res.json(buildInvestigationLobbyState(item));
});

app.get("/investigationChats/:id", (req, res) => res.json(roomChats[req.params.id] || []));
app.post("/investigationChat", (req, res) => {
  const { investigationId, message } = req.body;
  if (!investigationId || !message) return res.json({ success: false, message: "채팅 정보가 부족합니다." });
  const item = investigationsDB.find((v) => v.id === investigationId);
  if (item?.type === "daily") return res.json({ success: false, message: "일일조사에서는 채팅을 사용할 수 없습니다." });
  const state = item?.participantStates?.[message?.name || ""];
  if (!message?.isAdminNotice && state?.mutedUntil && Number(state.mutedUntil) > Date.now()) {
    return res.json({ success: false, message: "현재 채팅할 수 없는 상태입니다." });
  }
  const safeMessage = {
    ...message,
    createdAt: message?.createdAt || new Date().toISOString(),
    isAdminNotice: !!message?.isAdminNotice,
  };
  if (!roomChats[investigationId]) roomChats[investigationId] = [];
  roomChats[investigationId].push(safeMessage);
  if (roomChats[investigationId].length > 160) {
    roomChats[investigationId] = roomChats[investigationId].slice(-160);
  }
  io.to(investigationId).emit("chat", safeMessage);
  res.json({ success: true });
});

app.post("/toggleInvestigation", (req, res) => {
  const { id, opened, hidden } = req.body;
  const item = investigationsDB.find((v) => v.id === id);
  if (!item) return res.json({ success: false });
  if (opened !== undefined) item.opened = !!opened;
  if (hidden !== undefined) item.hidden = !!hidden;
  writeRuntimeArray("investigations.json", investigationsDB);
  emitParticipantsUpdated();
  emitInvestigationState(item.id);
  res.json({ success: true, item: getInvestigationSummary(item) });
});


app.post("/startDailyInvestigation", (req, res) => {
  try {
    const { id, character } = req.body || {};
    const item = investigationsDB.find((v) => v.id === id);
    if (!item) return res.json({ success: false, message: "조사를 찾을 수 없습니다." });
    if (item.type !== "daily") return res.json({ success: false, message: "일일조사가 아닙니다." });
    if (!getEffectiveOpened(item)) return res.json({ success: false, message: "현재 이 일일조사는 비활성화 상태입니다." });
    if (!character?.id && !character?.name) return res.json({ success: false, message: "캐릭터를 찾을 수 없습니다." });

    const sourceCharacter =
      charactersDB.find((c) => String(c.id) === String(character.id)) ||
      charactersDB.find((c) => c.name === character.name && c.ownerId === character.ownerId);

    if (!sourceCharacter) return res.json({ success: false, message: "캐릭터를 찾을 수 없습니다." });
    const ownerKey = getDailyOwnerKey(sourceCharacter);

    if (item.started && !item.ended) {
      if (canResumeDailyInvestigation(item, sourceCharacter)) {
        item.dailyOwnerKey = ownerKey;
        item.dailyResumeOwnerKey = "";
        item.participants = [sourceCharacter];
        item.leaders = [sourceCharacter.name];
        ensureParticipantState(item, sourceCharacter);
        ensureRouteHistorySeed(item);
        emitParticipantsUpdated();
        emitInvestigationState(id);
        return res.json({ success: true, started: true, resumed: true, investigationId: item.id, character: sourceCharacter });
      }
      if (item.dailyOwnerKey && item.dailyOwnerKey !== ownerKey) {
        const hasLiveDailyUser = Object.values(socketUsers || {}).some((user) => {
          if (!user || user.isAdmin || String(user.id || "") === "admin" || String(user.ownerId || "") === "admin") return false;
          return String(user.roomId || "") === String(item.id || "");
        });
        if (hasLiveDailyUser) return res.json({ success: false, message: "다른 캐릭터가 진행 중인 일일조사입니다." });
      }
      resetInvestigationProgress(item);
      syncInvestigationRoster(item);
    }

    const remain = Number(sourceCharacter.dailyAttemptsLeft ?? 1);
    if (remain <= 0) return res.json({ success: false, message: "남은 일일조사 횟수가 없습니다." });

    sourceCharacter.dailyAttemptsLeft = remain - 1;
    applyCharacterCorrosion(sourceCharacter, item.entryCorrosion || item.data?.entryCorrosion || 0);

    resetInvestigationProgress(item);
    ensureRuntimeState(item);
    item.started = true;
    item.ended = false;
    item.endedReason = "";
    item.participants = [sourceCharacter];
    item.leaders = [sourceCharacter.name];
    item.dailyOwnerKey = ownerKey;
    item.dailyResumeOwnerKey = "";
    ensureParticipantState(item, sourceCharacter);
    roomChats[id] = [];
    ensureRouteHistorySeed(item);
    item.endConfirmations = [];
    setEventBanner(item, "조사 시작", "normal", 2400);
    addSharedLog(item, `[일일조사 시작] ${item.title}`);

    writeRuntimeArray("characters.json", charactersDB);
    try { io.emit("investigationStarted", { id }); } catch (emitErr) { console.error("investigationStarted emit failed", emitErr); }
    try { emitParticipantsUpdated(); } catch (emitErr) { console.error("participantsUpdated emit failed", emitErr); }
    try { emitInvestigationState(id); } catch (emitErr) { console.error("investigationState emit failed", emitErr); }

    return res.json({ success: true, started: true, investigationId: item.id, character: buildPublicCharacter(sourceCharacter) });
  } catch (err) {
    console.error("startDailyInvestigation failed", err);
    return res.status(500).json({ success: false, message: "일일조사 시작 처리 중 오류가 발생했습니다." });
  }
});

app.post("/participateInvestigation", (req, res) => {
  const { id, character } = req.body;
  const inv = investigationsDB.find((i) => i.id === id);
  if (!inv) return res.json({ success: false, message: "조사를 찾을 수 없습니다." });
  if (!getEffectiveOpened(inv)) return res.json({ success: false, message: "현재 이 조사는 개방 시간이 아닙니다." });
  if (inv.type === "daily") {
    return res.json({ success: false, message: "일일조사는 참여가 아니라 바로 시작해야 합니다." });
  }
  ensureRuntimeState(inv);
  const sourceCharacter =
    charactersDB.find((c) => String(c.id) === String(character?.id || "")) ||
    charactersDB.find((c) => c.name === character?.name && (!character?.ownerId || c.ownerId === character.ownerId)) ||
    character;
  if (!sourceCharacter?.name) return res.json({ success: false, message: "참여할 캐릭터를 찾을 수 없습니다." });
  const existingIndex = (inv.participants || []).findIndex((p) => String(p?.name || "") === String(sourceCharacter.name));
  if (existingIndex >= 0) inv.participants[existingIndex] = { ...(inv.participants[existingIndex] || {}), ...sourceCharacter };
  else inv.participants.push(sourceCharacter);
  ensureParticipantState(inv, sourceCharacter);
  syncInvestigationRoster(inv);
  emitParticipantsUpdated();
  emitInvestigationState(id);
  res.json({ success: true, investigation: inv });
});

app.post("/leaveInvestigation", (req, res) => {
  const { id, characterName } = req.body;
  const item = investigationsDB.find((v) => v.id === id);
  if (!item) return res.json({ success: false });
  const leavingCharacter = (item.participants || []).find((p) => p.name === characterName) || charactersDB.find((c) => c.name === characterName);
  if (item.type === "daily" && item.started && !item.ended && isDailyOwnedByCharacter(item, leavingCharacter)) {
    item.dailyResumeOwnerKey = getDailyOwnerKey(leavingCharacter);
    item.participants = [];
    item.leaders = [];
  } else if (item.type === "group" && item.started && !item.ended) {
    if (item.pendingBattleActions) delete item.pendingBattleActions[characterName];
  } else {
    item.participants = item.participants.filter((p) => p.name !== characterName);
    item.leaders = item.leaders.filter((name) => name !== characterName);
    if (item.participantStates) delete item.participantStates[characterName];
    if (item.pendingBattleActions) delete item.pendingBattleActions[characterName];
  }
  syncInvestigationRoster(item);
  emitParticipantsUpdated();
  emitInvestigationState(id);
  res.json({ success: true, item });
});

app.post("/setInvestigationLeaders", (req, res) => {
  const { id, leaders } = req.body;
  const item = investigationsDB.find((v) => v.id === id);
  if (!item) return res.json({ success: false, message: "조사를 찾을 수 없습니다." });
  syncInvestigationRoster(item);
  const participantNames = new Set((item.participants || []).map((p) => p.name));
  item.leaders = Array.isArray(leaders) ? leaders.filter((name) => participantNames.has(name)) : [];
  syncInvestigationRoster(item);
  emitParticipantsUpdated();
  emitInvestigationState(id);
  res.json({ success: true, item });
});

app.post("/startInvestigation", (req, res) => {
  try {
    const { id } = req.body || {};
    const item = investigationsDB.find((v) => v.id === id);
    if (!item) return res.json({ success: false, message: "조사를 찾을 수 없습니다." });
    if (!getEffectiveOpened(item)) {
      return res.json({ success: false, message: "현재 이 조사는 시작할 수 있는 개방 시간이 아닙니다." });
    }
    ensureRuntimeState(item);
    if (item.started && !item.ended) {
      return res.json({ success: true, started: true, investigationId: item.id, leaders: item.leaders || [] });
    }
    if (!Array.isArray(item.participants) || item.participants.length <= 0) {
      return res.json({ success: false, message: "참여 인원이 있어야 조사를 시작할 수 있습니다." });
    }
    if ((!Array.isArray(item.leaders) || item.leaders.length <= 0) && item.participants[0]?.name) {
      item.leaders = [item.participants[0].name];
    }
    syncInvestigationRoster(item);
    const preservedParticipants = (item.participants || []).map((participant) => ({ ...participant }));
    const preservedLeaders = Array.isArray(item.leaders) ? [...item.leaders] : [];
    resetInvestigationProgress(item);
    ensureRuntimeState(item);
    item.participants = preservedParticipants;
    item.leaders = preservedLeaders.filter((leaderName) => preservedParticipants.some((participant) => participant?.name === leaderName));
    item.participantStates = {};
    item.endCorrosionApplied = false;
    item.started = true;
    item.ended = false;
    item.endedReason = "";
    roomChats[id] = [];
    ensureRouteHistorySeed(item);
    item.endConfirmations = [];
    setEventBanner(item, "조사 시작", "normal", 2400);
    addSharedLog(item, `[조사 시작] ${item.title}`);
    item.participants.forEach((participant) => {
      const foundCharacter =
        charactersDB.find((character) => String(character?.id || "") === String(participant?.id || "")) ||
        charactersDB.find((character) => String(character?.name || "") === String(participant?.name || ""));
      if (foundCharacter) applyCharacterCorrosion(foundCharacter, item.entryCorrosion || item.data?.entryCorrosion || 0);
      ensureParticipantState(item, foundCharacter || participant);
    });
    writeRuntimeArray("characters.json", charactersDB);
    syncInvestigationRoster(item);
    try { io.emit("investigationStarted", { id }); } catch (emitErr) { console.error("investigationStarted emit failed", emitErr); }
    try { emitParticipantsUpdated(); } catch (emitErr) { console.error("participantsUpdated emit failed", emitErr); }
    try { emitInvestigationState(id); } catch (emitErr) { console.error("investigationState emit failed", emitErr); }
    res.json({ success: true, started: true, investigationId: item.id, leaders: item.leaders });
  } catch (err) {
    console.error("startInvestigation failed", err);
    res.status(500).json({ success: false, message: "조사 시작 처리 중 오류가 발생했습니다." });
  }
});

app.post("/stopInvestigation", (req, res) => {
  const { id } = req.body;
  const item = investigationsDB.find((v) => v.id === id);
  if (!item) return res.json({ success: false });
  resetInvestigationProgress(item);
  item.leaders = [];
  item.participants = [];
  emitParticipantsUpdated();
  emitInvestigationState(id);
  res.json({ success: true, item });
});

app.post("/moveInvestigation", (req, res) => {
  const { investigationId, targetNodeId } = req.body;
  const item = investigationsDB.find((v) => v.id === investigationId);
  if (!item) return res.json({ success: false, message: "조사를 찾을 수 없습니다." });
  if (item.ended) return res.json({ success: false, message: "이미 종료된 조사입니다." });
  if (item.pendingReward) return res.json({ success: false, message: "보상 배분이 끝나야 다음 진행을 할 수 있습니다." });
  if (item.activeNpcScene?.lines?.length) return res.json({ success: false, message: "NPC 대화가 끝나야 이동할 수 있습니다." });
  const currentNode = item.data?.nodes?.[item.currentNodeId];
  if (currentNode?.battle) return res.json({ success: false, message: "전투가 끝나기 전에는 다음 구역으로 갈 수 없습니다." });
  const nextNode = item.data?.nodes?.[targetNodeId];
  if (!nextNode) return res.json({ success: false, message: "이동할 위치가 없습니다." });
  if (!canMoveBetweenNodes(item, item.currentNodeId, targetNodeId)) return res.json({ success: false, message: "현재 위치에서 연결되지 않은 구역입니다." });

  item.currentNodeId = targetNodeId;
  addSharedLog(item, `[이동] ${nextNode.name} - ${nextNode.log || ""}`);
  item.routeHistory.push({ nodeId: targetNodeId, name: nextNode.name, time: new Date().toISOString() });
  applyNodeEntryEffects(item, nextNode);
  if (allParticipantsDown(item)) {
    finishInvestigation(item, "전멸", "패배하였습니다. 활동할 수 있는 인원이 없습니다. 조사가 종료됩니다.");
    emitParticipantsUpdated();
    emitInvestigationState(investigationId);
    return res.json({ success: true, currentNodeId: item.currentNodeId, sharedLog: item.sharedLog, ended: true });
  }
  announceNodeBattleStartIfReady(item, nextNode);

  refreshInvestigationCompletionState(item);

  emitInvestigationState(investigationId);
  res.json({ success: true, currentNodeId: item.currentNodeId, sharedLog: item.sharedLog });
});

app.post("/investigationAction", (req, res) => {
  const { investigationId, actionName } = req.body;
  const item = investigationsDB.find((v) => v.id === investigationId);
  if (!item) return res.json({ success: false, message: "조사를 찾을 수 없습니다." });
  if (item.ended) return res.json({ success: false, message: "이미 종료된 조사입니다." });

  ensureRuntimeState(item);
  if (item.pendingReward) {
    return res.json({ success: false, message: "보상 배분이 끝나야 다음 행동을 할 수 있습니다." });
  }
  if (item.activeNpcScene?.lines?.length) {
    return res.json({ success: false, message: "NPC 대화가 끝나야 행동할 수 있습니다." });
  }
  const currentNode = item.data?.nodes?.[item.currentNodeId];
  const locationName = currentNode?.name || "알 수 없는 장소";
  const flagKey = `${item.currentNodeId}:${actionName}`;
  const result = getNodeActionResult(item, actionName);

  if (item.discoveredFlags[flagKey]) {
    item.sharedLog = `[${locationName}] ${actionName}는 이미 조사 완료된 항목이다.`;
  } else {
    item.discoveredFlags[flagKey] = true;
    const actionResult = applyActionRewards(item, result, locationName);
    item.sharedLog = `[${locationName}] ${actionResult.text}`;
    if (Array.isArray(currentNode?.clues)) {
      currentNode.clues.forEach((clue) => addClue(item, clue));
    }
    if (currentNode?.npcScene?.lines?.length && !hasCompletedNpcScene(item, item.currentNodeId)) {
      item.activeNpcScene = normalizeNpcScene(currentNode.npcScene);
      item.npcLineIndex = 0;
    }
  }

  item.sharedLogs.push(createLogEntry(item.sharedLog));
  if (allParticipantsDown(item)) {
    finishInvestigation(item, "전멸", "패배하였습니다. 활동할 수 있는 인원이 없습니다. 조사가 종료됩니다.");
    emitParticipantsUpdated();
    emitInvestigationState(investigationId);
    return res.json({ success: true, currentNodeId: item.currentNodeId, sharedLog: item.sharedLog, ended: true });
  }
  refreshInvestigationCompletionState(item);
  emitInvestigationState(investigationId);
  res.json({ success: true, currentNodeId: item.currentNodeId, sharedLog: item.sharedLog });
});

app.post("/setBattleAction", (req, res) => {
  const { investigationId, characterName, actionName } = req.body;
  const item = investigationsDB.find((v) => v.id === investigationId);
  if (!item) return res.json({ success: false, message: "조사를 찾을 수 없습니다." });
  if (item.ended) return res.json({ success: false, message: "이미 종료된 조사입니다." });
  if (item.activeNpcScene?.lines?.length) return res.json({ success: false, message: "NPC 대화가 끝나야 전투를 시작할 수 있습니다." });
  const node = item.data?.nodes?.[item.currentNodeId];
  announceNodeBattleStartIfReady(item, node);
  if (!node?.battle) return res.json({ success: false, message: "현재 전투 중이 아닙니다." });
  const state = item.participantStates?.[characterName];
  if (!state) return res.json({ success: false, message: "참가자 상태를 찾을 수 없습니다." });
  if (Number(state.hp || 0) <= 0) return res.json({ success: false, message: "행동 불가능한 상태입니다." });
  item.pendingBattleActions[characterName] = actionName || "공격";

  const aliveNames = Array.from(new Set((item.participants || [])
    .filter((participant) => !participant?.isAdmin && String(participant?.id || "") !== "admin" && String(participant?.ownerId || "") !== "admin" && participant?.name !== "운영자")
    .map((participant) => String(participant?.name || "").trim())
    .filter(Boolean)
    .filter((name) => Number(item.participantStates?.[name]?.hp || 0) > 0)));
  const allReady = aliveNames.length > 0 && aliveNames.every((name) => !!item.pendingBattleActions?.[name]);

  if (allReady) {
    const outcome = applyBattleTurn(item, item.pendingBattleActions || {});
    if (!outcome.success) return res.json(outcome);
    return res.json({
      success: true,
      autoSubmitted: true,
      pendingBattleActions: item.pendingBattleActions,
      currentNodeId: item.currentNodeId,
      sharedLog: item.sharedLog,
      participantStates: item.participantStates,
      battleTurn: item.battleTurn,
      lastBattleRound: item.lastBattleRound,
      investigation: buildPublicInvestigationState(item),
    });
  }

  emitInvestigationState(investigationId);
  res.json({ success: true, pendingBattleActions: item.pendingBattleActions });
});

app.post("/submitBattleTurn", (req, res) => {
  const { investigationId } = req.body;
  const item = investigationsDB.find((v) => v.id === investigationId);
  if (!item) return res.json({ success: false, message: "조사를 찾을 수 없습니다." });
  if (item.ended) return res.json({ success: false, message: "이미 종료된 조사입니다." });
  if (item.activeNpcScene?.lines?.length) return res.json({ success: false, message: "NPC 대화가 끝나야 전투를 시작할 수 있습니다." });
  announceNodeBattleStartIfReady(item);
  const outcome = applyBattleTurn(item, item.pendingBattleActions || {});
  if (!outcome.success) return res.json(outcome);
  return res.json({
    success: true,
    currentNodeId: item.currentNodeId,
    sharedLog: item.sharedLog,
    participantStates: item.participantStates,
    battleTurn: item.battleTurn,
    lastBattleRound: item.lastBattleRound,
    investigation: buildPublicInvestigationState(item),
  });
});

app.post("/battleAction", (req, res) => {
  const { investigationId, actionName } = req.body;
  const item = investigationsDB.find((v) => v.id === investigationId);
  if (!item) return res.json({ success: false, message: "조사를 찾을 수 없습니다." });
  if (item.ended) return res.json({ success: false, message: "이미 종료된 조사입니다." });
  if (item.activeNpcScene?.lines?.length) return res.json({ success: false, message: "NPC 대화가 끝나야 전투를 시작할 수 있습니다." });
  announceNodeBattleStartIfReady(item);
  if (actionName === "도주" || actionName === "도주 선택" || actionName === "파티 도주") {
    const outcome = resolveFlee(item);
    if (!outcome.success) return res.json(outcome);
    return res.json({ success: true, currentNodeId: item.currentNodeId, sharedLog: item.sharedLog, participantStates: item.participantStates, battleTurn: item.battleTurn, investigation: buildPublicInvestigationState(item) });
  }
  return res.json({ success: false, message: "지원되지 않는 전투 처리입니다." });
});


app.post("/assignInvestigationReward", (req, res) => {
  const { investigationId, receiverName: requestedReceiverName, actorName = "", isAdmin = false } = req.body || {};
  let receiverName = requestedReceiverName;
  const item = investigationsDB.find((v) => v.id === investigationId);
  if (!item) return res.json({ success: false, message: "조사를 찾을 수 없습니다." });
  ensureRuntimeState(item);
  if (!item.pendingReward) return res.json({ success: false, message: "배분할 보상이 없습니다." });
  if (item.type === "group" && !isAdmin) {
    const leaderNames = Array.isArray(item.leaders) ? item.leaders.map((name) => String(name || "")) : [];
    if (!leaderNames.includes(String(actorName || ""))) {
      return res.json({ success: false, message: "단체조사 보상 배분은 리더만 할 수 있습니다." });
    }
  }

  if (!receiverName && item.type === "daily" && item.participants?.[0]?.name) receiverName = item.participants[0].name;
  const receiver = (item.participants || []).find((p) => p.name === receiverName);
  if (!receiver) return res.json({ success: false, message: "지급 대상을 찾을 수 없습니다." });

  const char = charactersDB.find((c) => String(c.id) === String(receiver.id)) || charactersDB.find((c) => c.name === receiver.name);
  if (!char) return res.json({ success: false, message: "캐릭터를 찾을 수 없습니다." });

  const reward = item.pendingReward;
  applyRewardToCharacter(char, reward)

  addSharedLog(item, `[획득] ${receiver.name}이(가) ${reward.label}을(를) 받았습니다.`);
  item.pendingReward = null;
  item.pendingRewardQueue = [];
  emitInvestigationState(investigationId);
  res.json({ success: true, character: char });
});

function applyNpcOptionOutcome(item, option) {
  if (!item || !option) return;
  if (option.rewardItem) queueRewardAssignment(item, { type: "item", label: option.rewardItem, value: option.rewardItem });
  if (option.rewardStatPoints) queueRewardAssignment(item, { type: "statPoints", label: `스탯 포인트 +${option.rewardStatPoints}`, value: Number(option.rewardStatPoints) });
  if (option.clue) addClue(item, typeof option.clue === "string" ? { title: option.clue, text: option.clue } : option.clue);

  if (typeof option.nextIndex === "number" && Number.isFinite(option.nextIndex)) {
    item.npcLineIndex = option.nextIndex;
  } else if (item.npcLineIndex >= item.activeNpcScene.lines.length - 1) {
    markNpcSceneCompleted(item, item.currentNodeId);
    item.activeNpcScene = null;
    item.npcLineIndex = 0;
  } else {
    item.npcLineIndex += 1;
  }
}

app.post("/advanceNpcScene", (req, res) => {
  const { investigationId } = req.body || {};
  const item = investigationsDB.find((v) => v.id === investigationId);
  if (!item || !item.activeNpcScene?.lines?.length) return res.json({ success: true, closed: true });
  const current = item.activeNpcScene.lines[item.npcLineIndex] || {};
  const npcName = item.activeNpcScene?.name || "NPC";
  const rawOptions = Array.isArray(current.options) ? current.options.filter(Boolean) : [];
  const visibleOptions = rawOptions.filter((option) => String(option?.text || "").trim());
  if (visibleOptions.length > 0) {
    return res.json({ success: false, message: "선택지를 골라야 합니다." });
  }
  if (rawOptions.length > 0) {
    if (current?.text) addSharedLog(item, `[NPC] ${npcName}: ${current.text}`);
    applyNpcOptionOutcome(item, rawOptions[0]);
    announceNodeBattleStartIfReady(item);
    emitInvestigationState(investigationId);
    return res.json({ success: true });
  }
  if (current?.text) addSharedLog(item, `[NPC] ${npcName}: ${current.text}`);
  if (item.npcLineIndex >= item.activeNpcScene.lines.length - 1) {
    markNpcSceneCompleted(item, item.currentNodeId);
    item.activeNpcScene = null;
    item.npcLineIndex = 0;
  } else {
    item.npcLineIndex += 1;
  }
  announceNodeBattleStartIfReady(item);
  emitInvestigationState(investigationId);
  res.json({ success: true });
});

app.post("/chooseNpcOption", (req, res) => {
  const { investigationId, optionIndex } = req.body || {};
  const item = investigationsDB.find((v) => v.id === investigationId);
  if (!item || !item.activeNpcScene?.lines?.length) return res.json({ success: true, closed: true });
  const current = item.activeNpcScene.lines[item.npcLineIndex] || {};
  const npcName = item.activeNpcScene?.name || "NPC";
  const option = Array.isArray(current.options) ? current.options[Number(optionIndex)] : null;
  if (!option) return res.json({ success: false, message: "선택지를 찾을 수 없습니다." });

  if (current?.text) addSharedLog(item, `[NPC] ${npcName}: ${current.text}`);
  if (option?.text) addSharedLog(item, `[선택] ${option.text}`);
  applyNpcOptionOutcome(item, option);
  announceNodeBattleStartIfReady(item);

  emitInvestigationState(investigationId);
  res.json({ success: true });
});

app.post("/dismissEndNotice", (req, res) => {
  const { investigationId } = req.body || {};
  const item = investigationsDB.find((v) => v.id === investigationId);
  if (!item) return res.json({ success: false });
  item.endNoticeDismissed = true;
  emitInvestigationState(investigationId);
  res.json({ success: true });
});



app.post("/reassignInvestigationLeader", (req, res) => {
  const { investigationId, leaderName } = req.body || {};
  const item = investigationsDB.find((v) => v.id === investigationId);
  if (!item) return res.json({ success: false, message: "조사를 찾을 수 없습니다." });
  const participant = (item.participants || []).find((p) => p.name === leaderName);
  if (!participant) return res.json({ success: false, message: "지정할 리더를 찾을 수 없습니다." });
  const state = item.participantStates?.[leaderName];
  if (state && Number(state.hp || 0) <= 0) {
    return res.json({ success: false, message: "HP가 0인 캐릭터는 리더가 될 수 없습니다." });
  }
  item.leaders = [leaderName];
  addSharedLog(item, `[리더 변경] ${leaderName}이(가) 새 리더가 되었다.`);
  emitParticipantsUpdated();
  emitInvestigationState(investigationId);
  return res.json({ success: true, leaders: item.leaders });
});


app.post("/confirmInvestigationExit", (req, res) => {
  const { investigationId, characterName } = req.body || {};
  const item = investigationsDB.find((v) => v.id === investigationId);
  if (!item) return res.json({ success: false, message: "조사를 찾을 수 없습니다." });
  if (!item.ended) return res.json({ success: false, message: "아직 종료된 조사가 아닙니다." });
  if (!characterName) return res.json({ success: false, message: "캐릭터 이름이 필요합니다." });

  if (!Array.isArray(item.endConfirmations)) item.endConfirmations = [];
  if (!item.endConfirmations.includes(characterName)) {
    item.endConfirmations.push(characterName);
  }

  emitInvestigationState(investigationId);
  return res.json({ success: true, endConfirmations: item.endConfirmations });
});

io.on("connection", (socket) => {
  socket.on("register", (user) => {
    socketUsers[socket.id] = {
      ...user,
      accountKey: getAccountKey(user),
      displayName: getDisplayName(user),
      online: true,
      roomId: null,
      role: "viewer",
    };
    emitUsers();
    emitOnlineAccounts();
  });

  socket.on("unregister", () => {
    delete socketUsers[socket.id];
    emitUsers();
    emitOnlineAccounts();
  });

  socket.on("joinRoom", (roomId) => {
    socket.join(roomId);
    if (socketUsers[socket.id]) {
      socketUsers[socket.id].roomId = roomId;
      socketUsers[socket.id].role = "viewer";
    }
    if (!roomChats[roomId]) roomChats[roomId] = [];
    socket.emit("init", roomChats[roomId]);
    emitInvestigationState(roomId);
    emitUsers();
    emitOnlineAccounts();
  });

  socket.on("leaveRoom", () => {
    if (socketUsers[socket.id]) {
      socketUsers[socket.id].roomId = null;
      socketUsers[socket.id].role = "viewer";
    }
    emitUsers();
    emitOnlineAccounts();
  });

  socket.on("chat", ({ roomId, message }) => {
    if (!roomChats[roomId]) roomChats[roomId] = [];
    roomChats[roomId].push(message);
    if (roomChats[roomId].length > 160) {
      roomChats[roomId] = roomChats[roomId].slice(-160);
    }
    io.to(roomId).emit("chat", message);
  });

  socket.on("disconnect", () => {
    delete socketUsers[socket.id];
    emitUsers();
    emitOnlineAccounts();
  });
});

// --- add these routes anywhere after app initialization and before server.listen ---


app.get("/admin/accountIds", (req, res) => {
  const keyword = normalizeUserIdText(req.query?.q || req.query?.search || "");
  // 운영 계정 선택창은 “회원가입만 한 계정”도 보여야 하므로 기본값을 전체 재수집으로 둡니다.
  // 단, 필요할 때 deep=0/false를 붙이면 기존처럼 빠른 조회만 사용합니다.
  const deepParam = String(req.query?.deep ?? "").toLowerCase();
  const deep = !(deepParam === "0" || deepParam === "false");
  refreshUsersFromKnownSources({ deep: false });
  const users = getDirectAdminAccountRows(keyword, { deep });
  if (users.length > 0) writeRuntimeUserIndexes(users);
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.json({
    success: true,
    users,
    accounts: users,
    accountIds: users.map((user) => user.id).filter(Boolean),
    count: users.length,
    deep,
  });
});

app.get("/admin/users/check", (req, res) => {
  const id = normalizeUserIdText(req.query?.id || req.query?.q || req.query?.search || "");
  refreshUsersFromKnownSources({ deep: false });
  let user = getExactAdminUser(id);
  if (!user && id) {
    const recovered = getDirectAdminAccountRows(id, { deep: true }).find((row) => normalizeUserIdText(row?.id).toLowerCase() === id.toLowerCase());
    if (recovered) {
      usersDB = mergeRuntimeUsers(usersDB, [recovered]);
      writeRuntimeUserIndexes([recovered]);
      user = recovered;
    }
  }
  res.json({
    success: true,
    exists: !!user,
    user: user ? { id: user.id, type: user.type || "owner" } : null,
  });
});

app.get("/admin/users", (req, res) => {
  // 운영 화면에서는 캐릭터가 없는 회원가입 계정까지 누락 없이 보여야 하므로
  // 기본 조회도 전체 계정 저장소/색인을 함께 확인합니다. deep=0/false일 때만 빠른 조회를 사용합니다.
  const deepParam = String(req.query?.deep ?? "").toLowerCase();
  const deep = !(deepParam === "0" || deepParam === "false");
  refreshUsersFromKnownSources({ deep: false });
  refreshCharactersFromDiskIfNeeded();
  const searchText = req.query?.q || req.query?.search || "";
  const users = mergeRuntimeUsers(
    getSafeUsersForAdmin(searchText, { deep }),
    getDirectAdminAccountRows(searchText, { deep })
  )
    .filter(isDisplayableAdminAccount)
    .map((user) => ({
      id: getRuntimeAccountId(user) || getRuntimeUserId(user),
      type: user.type || user.role || "owner",
    }))
    .filter((user) => user.id && !isKnownNonUserRuntimeId(user.id))
    .sort((a, b) => String(a.id || "").localeCompare(String(b.id || ""), "ko"));
  if (users.length > 0) writeRuntimeUserIndexes(users);
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.json({ success: true, users, count: users.length, deep });
});

app.get("/admin/users/rebuild", (req, res) => {
  refreshUsersFromKnownSources({ deep: true });
  refreshCharactersFromDiskIfNeeded({ force: true });
  const users = getSafeUsersForAdmin(req.query?.q || req.query?.search || "", { deep: true });
  writeRuntimeUserIndexes(users);
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.json({ success: true, users, count: users.length, rebuilt: true });
});


app.get("/admin/dataBackups", (req, res) => {
  try {
    ensureRuntimeBackupDir();
    const files = fs.readdirSync(RUNTIME_BACKUP_DIR)
      .filter((name) => name.endsWith(".bak.json"))
      .sort()
      .reverse()
      .slice(0, 80);
    res.json({ success: true, backups: files });
  } catch (error) {
    res.json({ success: false, backups: [], message: "백업 목록을 불러오지 못했습니다." });
  }
});

// ===== custom investigation publish routes =====
// Paste this whole block into server.js
// Place it AFTER buildInvestigation / investigationDefinitions / investigationsDB are defined
// and BEFORE server.listen(...)

const customInvestigationsPath = resolveDataPath("customInvestigations.json");

function serializeInvestigationForPersistence(item) {
  const templateSource = item?.originalTemplate?.data?.nodes ? clone(item.originalTemplate) : {
    id: item?.id || `custom-${Date.now()}`,
    title: item?.title || "새 조사",
    type: item?.type || "group",
    data: clone(item?.data || {}),
  };

  return {
    ...templateSource,
    id: item?.id || templateSource.id,
    title: item?.title || templateSource.title || "새 조사",
    type: item?.type || templateSource.type || "group",
    opened: item?.opened !== undefined ? !!item.opened : (templateSource?.opened !== undefined ? !!templateSource.opened : true),
    hidden: item?.hidden !== undefined ? !!item.hidden : !!templateSource?.hidden,
    scheduleEnabled: item?.scheduleEnabled !== undefined ? !!item.scheduleEnabled : !!templateSource?.scheduleEnabled,
    openAt: String(item?.openAt || templateSource?.openAt || ""),
    closeAt: String(item?.closeAt || templateSource?.closeAt || ""),
    listImage: String(item?.listImage || item?.data?.listImage || templateSource?.listImage || templateSource?.data?.listImage || ""),
    entryImage: String(item?.entryImage || item?.data?.entryImage || templateSource?.entryImage || templateSource?.data?.entryImage || item?.listImage || item?.data?.listImage || templateSource?.listImage || templateSource?.data?.listImage || ""),
    listImageFrame: normalizeInvestigationImageFrame(item?.listImageFrame || item?.data?.listImageFrame || templateSource?.listImageFrame || templateSource?.data?.listImageFrame),
    entryImageFrame: normalizeInvestigationImageFrame(item?.entryImageFrame || item?.data?.entryImageFrame || templateSource?.entryImageFrame || templateSource?.data?.entryImageFrame || item?.listImageFrame || item?.data?.listImageFrame || templateSource?.listImageFrame || templateSource?.data?.listImageFrame),
    imageUpdatedAt: Number(item?.imageUpdatedAt ?? item?.data?.imageUpdatedAt ?? templateSource?.imageUpdatedAt ?? templateSource?.data?.imageUpdatedAt ?? 0),
    backgroundImage: String(item?.data?.backgroundImage || templateSource?.backgroundImage || templateSource?.data?.backgroundImage || ""),
    bgmUrl: String(item?.bgmUrl || item?.data?.bgmUrl || templateSource?.bgmUrl || templateSource?.data?.bgmUrl || ""),
    bgmVolume: Number(item?.bgmVolume ?? item?.data?.bgmVolume ?? templateSource?.bgmVolume ?? templateSource?.data?.bgmVolume ?? 1),
    entryCorrosion: Number(item?.entryCorrosion ?? item?.data?.entryCorrosion ?? templateSource?.entryCorrosion ?? templateSource?.data?.entryCorrosion ?? 0),
    endCorrosion: Number(item?.endCorrosion ?? item?.data?.endCorrosion ?? templateSource?.endCorrosion ?? templateSource?.data?.endCorrosion ?? 0),
    data: {
      ...(templateSource?.data || {}),
      ...(clone(item?.data || {})),
      start: item?.data?.start || templateSource?.data?.start || item?.currentNodeId || "",
      nodes: clone(item?.data?.nodes || templateSource?.data?.nodes || {}),
      backgroundImage: String(item?.data?.backgroundImage || templateSource?.data?.backgroundImage || templateSource?.backgroundImage || ""),
      listImage: String(item?.listImage || item?.data?.listImage || templateSource?.listImage || templateSource?.data?.listImage || ""),
      entryImage: String(item?.entryImage || item?.data?.entryImage || templateSource?.entryImage || templateSource?.data?.entryImage || item?.listImage || item?.data?.listImage || templateSource?.listImage || templateSource?.data?.listImage || ""),
      listImageFrame: normalizeInvestigationImageFrame(item?.listImageFrame || item?.data?.listImageFrame || templateSource?.listImageFrame || templateSource?.data?.listImageFrame),
      entryImageFrame: normalizeInvestigationImageFrame(item?.entryImageFrame || item?.data?.entryImageFrame || templateSource?.entryImageFrame || templateSource?.data?.entryImageFrame || item?.listImageFrame || item?.data?.listImageFrame || templateSource?.listImageFrame || templateSource?.data?.listImageFrame),
      imageUpdatedAt: Number(item?.imageUpdatedAt ?? item?.data?.imageUpdatedAt ?? templateSource?.imageUpdatedAt ?? templateSource?.data?.imageUpdatedAt ?? 0),
      bgmUrl: String(item?.bgmUrl || item?.data?.bgmUrl || templateSource?.bgmUrl || templateSource?.data?.bgmUrl || ""),
      bgmVolume: Number(item?.bgmVolume ?? item?.data?.bgmVolume ?? templateSource?.bgmVolume ?? templateSource?.data?.bgmVolume ?? 1),
      entryCorrosion: Number(item?.entryCorrosion ?? item?.data?.entryCorrosion ?? templateSource?.entryCorrosion ?? templateSource?.data?.entryCorrosion ?? 0),
      endCorrosion: Number(item?.endCorrosion ?? item?.data?.endCorrosion ?? templateSource?.endCorrosion ?? templateSource?.data?.endCorrosion ?? 0),
    },
  };
}

function readCustomInvestigationsFromFile() {
  try {
    const parsed = safeReadJsonFileStrict(customInvestigationsPath, [], "customInvestigations.json");
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("readCustomInvestigationsFromFile error", err.message);
    return [];
  }
}

function writeCustomInvestigationsToFile(list) {
  try {
    writeJsonAtomicSync(customInvestigationsPath, Array.isArray(list) ? list : []);
  } catch (err) {
    console.error("writeCustomInvestigationsToFile error", err);
  }
}

function normalizeCustomTemplate(template) {
  return {
    id: template.id || `custom-${Date.now()}`,
    title: template.title || "새 조사",
    type: template.type || "group",
    createdAt: template.createdAt || new Date().toISOString(),
    json: template.json || template,
  };
}

let customInvestigationsDB = readCustomInvestigationsFromFile();

function upsertPublishedInvestigation(def) {
  const built = buildInvestigation(def);
  const existingIndex = investigationsDB.findIndex((item) => item.id === def.id);
  const existing = existingIndex >= 0 ? investigationsDB[existingIndex] : null;
  if (existing) {
    built.opened = def?.opened !== undefined ? !!def.opened : !!existing.opened;
    built.hidden = def?.hidden !== undefined ? !!def.hidden : !!existing.hidden;
    built.scheduleEnabled = def?.scheduleEnabled !== undefined ? !!def.scheduleEnabled : !!existing.scheduleEnabled;
    built.openAt = String(def?.openAt || existing.openAt || "");
    built.closeAt = String(def?.closeAt || existing.closeAt || "");
    investigationsDB[existingIndex] = built;
  } else {
    investigationsDB.push(built);
  }
  writeRuntimeArray("investigations.json", investigationsDB);
  emitParticipantsUpdated();
  emitInvestigationState(def.id);
}

customInvestigationsDB.forEach((template) => {
  if (template?.json?.data?.nodes) {
    try {
      upsertPublishedInvestigation(template.json);
    } catch (err) {
      console.error("custom investigation bootstrap failed", template?.id, err);
    }
  }
});

rehydrateInvestigationsFromRuntime();

app.get("/admin/customInvestigations", (req, res) => {
  res.json(customInvestigationsDB);
});

app.post("/admin/customInvestigations", (req, res) => {
  const template = normalizeCustomTemplate(req.body || {});
  const nextList = [
    ...customInvestigationsDB.filter((item) => item.id !== template.id),
    template,
  ];
  customInvestigationsDB = nextList;
  writeCustomInvestigationsToFile(customInvestigationsDB);
  res.json({ success: true, template });
});

app.delete("/admin/customInvestigations/:id", (req, res) => {
  const id = req.params.id;
  customInvestigationsDB = customInvestigationsDB.filter((item) => item.id !== id);
  writeCustomInvestigationsToFile(customInvestigationsDB);
  res.json({ success: true });
});

app.post("/admin/publishInvestigation", (req, res) => {
  const def = req.body || {};
  if (!def.id || !def.title || !def.data?.nodes || Object.keys(def.data.nodes || {}).length === 0) {
    return res.json({ success: false, message: "조사 JSON 형식이 올바르지 않습니다." });
  }

  try {
    const nodeIds = Object.keys(def.data.nodes || {});
    if (!def.data.start || !def.data.nodes[def.data.start]) def.data.start = nodeIds[0];
    upsertPublishedInvestigation(def);

    const template = normalizeCustomTemplate({
      id: def.id,
      title: def.title,
      type: def.type || "group",
      json: def,
    });

    customInvestigationsDB = [
      ...customInvestigationsDB.filter((item) => item.id !== template.id),
      template,
    ];
    writeCustomInvestigationsToFile(customInvestigationsDB);

    res.json({ success: true, investigationId: def.id });
  } catch (err) {
    console.error("publishInvestigation error", err);
    res.json({ success: false, message: "실제 조사 반영에 실패했습니다." });
  }
});
app.post("/admin/investigationCardImage", (req, res) => {
  try {
    const { investigationId, listImage, entryImage, listImageFrame, entryImageFrame } = req.body || {};
    const item = investigationsDB.find((v) => v.id === investigationId);
    if (!item) return res.json({ success: false, message: "조사를 찾을 수 없습니다." });

    const nextListImage = listImage !== undefined ? String(listImage || "") : String(item.listImage || item.data?.listImage || "");
    const nextEntryImage = entryImage !== undefined ? String(entryImage || "") : String(item.entryImage || item.data?.entryImage || item.listImage || item.data?.listImage || nextListImage || "");
    const nextListImageFrame = listImageFrame !== undefined ? normalizeInvestigationImageFrame(listImageFrame) : normalizeInvestigationImageFrame(item.listImageFrame || item.data?.listImageFrame);
    const nextEntryImageFrame = entryImageFrame !== undefined ? normalizeInvestigationImageFrame(entryImageFrame) : normalizeInvestigationImageFrame(item.entryImageFrame || item.data?.entryImageFrame || item.listImageFrame || item.data?.listImageFrame);
    const imageUpdatedAt = Date.now();
    const finalListImage = item.type === "daily" ? (nextEntryImage || nextListImage) : nextListImage;
    const finalEntryImage = item.type === "daily" ? (nextEntryImage || nextListImage) : nextEntryImage;
    const finalListImageFrame = item.type === "daily" ? normalizeInvestigationImageFrame(nextEntryImageFrame || nextListImageFrame) : nextListImageFrame;
    const finalEntryImageFrame = item.type === "daily" ? normalizeInvestigationImageFrame(nextEntryImageFrame || nextListImageFrame) : nextEntryImageFrame;
    item.listImage = finalListImage;
    item.entryImage = finalEntryImage;
    item.listImageFrame = finalListImageFrame;
    item.entryImageFrame = finalEntryImageFrame;
    item.imageUpdatedAt = imageUpdatedAt;
    item.data = {
      ...(item.data || {}),
      listImage: finalListImage,
      entryImage: finalEntryImage,
      listImageFrame: finalListImageFrame,
      entryImageFrame: finalEntryImageFrame,
      imageUpdatedAt,
    };
    if (item.originalTemplate) {
      item.originalTemplate = serializeInvestigationForPersistence(item);
    }

    const template = normalizeCustomTemplate({
      id: item.id,
      title: item.title,
      type: item.type || "group",
      json: serializeInvestigationForPersistence(item),
    });

    customInvestigationsDB = [
      ...customInvestigationsDB.filter((entry) => entry.id !== template.id),
      template,
    ];
    writeCustomInvestigationsToFile(customInvestigationsDB);
    emitParticipantsUpdated();
    emitInvestigationState(item.id);
    return res.json({ success: true, item: getInvestigationSummary(item) });
  } catch (err) {
    console.error("investigationCardImage error", err);
    return res.status(500).json({ success: false, message: "조사 카드 이미지를 저장하지 못했습니다." });
  }
});

// ===== end custom investigation publish routes =====

// ===== relation system routes =====
// Paste this block into server.js
// Place it BEFORE server.listen(...)
// It assumes express app and charactersDB already exist

const relationRequestsPath = resolveDataPath("relationRequests.json");
const relationsPath = resolveDataPath("relations.json");

function readJsonArraySafe(filePath) {
  try {
    const parsed = safeReadJsonFileStrict(filePath, [], path.basename(String(filePath || "array.json")));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("readJsonArraySafe error", filePath, err.message);
    return [];
  }
}

function writeJsonArraySafe(filePath, value) {
  try {
    scheduleJsonWrite(filePath, value);
  } catch (err) {
    console.error("writeJsonArraySafe error", filePath, err);
  }
}

let relationRequestsDB = readJsonArraySafe(relationRequestsPath);
let relationsDB = readJsonArraySafe(relationsPath);

function buildRelationEntriesForApproval(request) {
  return {
    requester: {
      id: `${request.id}-requester`,
      characterId: request.fromCharacterId,
      characterName: request.fromCharacter,
      otherCharacterId: request.toCharacterId,
      otherCharacter: request.toCharacter,
      relationName: request.relationName || "",
      description: request.description || "",
    },
    receiverDefault: {
      id: `${request.id}-receiver`,
      characterId: request.toCharacterId,
      characterName: request.toCharacter,
      otherCharacterId: request.fromCharacterId,
      otherCharacter: request.fromCharacter,
      relationName: "",
      description: "",
    },
  };
}

function attachRelationsToCharacter(character) {
  if (!character) return character;
  return {
    ...character,
    relations: relationsDB.filter((entry) => String(entry.characterId) === String(character.id)),
  };
}

function summarizeCharacter(character) {
  if (!character) return character;
  const profileImage = character.profileImage || character.image || character.avatar || character.portraitImage || character.portrait || "";
  const mainImage = character.mainImage || character.cardImage || character.fullBodyImage || character.fullImage || profileImage || "";
  const investigationImage = character.investigationImage || character.spriteImage || character.sdImage || character.sdImageUrl || character.sd || mainImage || profileImage || "";
  const cardImage = character.cardImage || mainImage || profileImage || "";
  const spriteImage = character.spriteImage || investigationImage || cardImage || "";
  return {
    id: character.id,
    ownerId: character.ownerId,
    name: character.name,
    approved: character.approved,
    image: profileImage,
    profileImage,
    mainImage,
    cardImage,
    investigationImage,
    spriteImage,
    currentMap: character.currentMap || "",
    oneLine: character.oneLine || "",
    rank: character.rank || "",
    corrosion: Number(character.corrosion || 0),
    level: Number(character.level || 1),
    x: typeof character.x === "number" ? character.x : undefined,
    y: typeof character.y === "number" ? character.y : undefined,
    dx: typeof character.dx === "number" ? character.dx : undefined,
    dy: typeof character.dy === "number" ? character.dy : undefined,
    waitMs: typeof character.waitMs === "number" ? character.waitMs : undefined,
    moveCooldownMs: typeof character.moveCooldownMs === "number" ? character.moveCooldownMs : undefined,
    sdQuotes: Array.isArray(character.sdQuotes) ? character.sdQuotes : [],
    profileBgm: character.profileBgm || "",
    profileBgmVolume: Number.isFinite(Number(character.profileBgmVolume)) ? Math.max(0, Math.min(1, Number(character.profileBgmVolume))) : 1,
    mainImageFrame: character.mainImageFrame || undefined,
    updatedAt: Number(character.updatedAt || character.assetVersion || 0),
    assetVersion: Number(character.assetVersion || character.updatedAt || 0),
  };
}

function pickCharacterAssetPath(character, candidates = []) {
  const list = Array.isArray(candidates) ? candidates : [candidates];
  for (const key of list) {
    const value = character?.[key];
    if (typeof value === "string" && value.trim()) return key;
  }
  return "";
}

function getCharacterImageLength(character, key) {
  const value = typeof character?.[key] === "string" ? character[key] : "";
  return value ? value.length : Number.MAX_SAFE_INTEGER;
}

function pickLightCharacterAssetPath(character, candidates = [], maxLength = Number.MAX_SAFE_INTEGER) {
  const list = (Array.isArray(candidates) ? candidates : [candidates]).filter(Boolean);
  let bestKey = "";
  let bestLength = Number.MAX_SAFE_INTEGER;
  for (const key of list) {
    const value = typeof character?.[key] === "string" ? character[key] : "";
    if (!value.trim()) continue;
    const length = value.length;
    if (length <= maxLength && length < bestLength) {
      bestKey = key;
      bestLength = length;
    }
  }
  return bestKey || pickCharacterAssetPath(character, list);
}

function buildPublicCharacterSummary(character) {
  if (!character) return character;
  const summary = summarizeCharacter(character);
  const characterId = summary.id || summary.name || "unknown";
  const profilePath = pickCharacterAssetPath(character, ["profileImage", "image", "avatar", "portraitImage", "portrait", "mainImage", "cardImage", "investigationImage", "spriteImage"]);
  const mainPath = pickCharacterAssetPath(character, ["mainImage", "cardImage", "fullBodyImage", "fullImage", "profileImage", "image"]);
  const spritePath = pickCharacterAssetPath(character, ["spriteImage", "investigationImage", "sdImage", "sdImageUrl", "sd", "mainImage", "cardImage", "profileImage", "image"]);

  const version = summary.assetVersion || summary.updatedAt || "";
  const toUrl = (pathKey, fallbackValue) => {
    const rawValue = getValueByPath(character, pathKey);
    if (isDataImage(rawValue)) return toCharacterAssetUrl(characterId, pathKey, version);
    return typeof rawValue === "string" && rawValue.trim() ? rawValue : (fallbackValue || "");
  };

  const profileImage = profilePath ? toUrl(profilePath, summary.profileImage) : summary.profileImage;
  const mainImage = mainPath ? toUrl(mainPath, summary.mainImage) : summary.mainImage;
  const investigationImage = spritePath ? toUrl(spritePath, summary.investigationImage) : summary.investigationImage;

  return {
    ...summary,
    image: profileImage,
    profileImage,
    mainImage,
    cardImage: mainImage || profileImage || summary.cardImage,
    investigationImage,
    spriteImage: investigationImage || mainImage || profileImage || summary.spriteImage,
  };
}

let publicCharacterSummaryCache = null;

function getPublicCharacterSummarySignature(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((character) => [
    character?.id,
    character?.ownerId,
    character?.name,
    character?.approved,
    character?.currentMap,
    Number(character?.x ?? ""),
    Number(character?.y ?? ""),
    Number(character?.dx ?? ""),
    Number(character?.dy ?? ""),
    Number(character?.waitMs ?? ""),
    Number(character?.moveCooldownMs ?? ""),
    Number(character?.corrosion || 0),
    Number(character?.updatedAt || character?.assetVersion || 0),
    String(character?.profileImage || character?.image || "").length,
    String(character?.mainImage || character?.cardImage || "").length,
    String(character?.spriteImage || character?.investigationImage || "").length,
  ].join(":"))
    .join("|");
}

function getPublicCharacterSummaries({ refresh = true } = {}) {
  if (refresh) refreshCharactersFromDiskIfNeeded();
  const source = Array.isArray(charactersDB) ? charactersDB : [];
  const signature = getPublicCharacterSummarySignature(source);
  if (publicCharacterSummaryCache && publicCharacterSummaryCache.signature === signature) {
    return publicCharacterSummaryCache.rows;
  }
  const rows = source.map(buildPublicCharacterSummary);
  publicCharacterSummaryCache = { signature, rows };
  return rows;
}

function buildPublicCharacter(character) {
  if (!character) return character;
  const detailed = attachRelationsToCharacter(character);
  const version = detailed.assetVersion || detailed.updatedAt || character.assetVersion || character.updatedAt || "";
  return mapDataImages(detailed, (pathKey) => toCharacterAssetUrl(character.id || character.name || "unknown", pathKey, version));
}

function buildPublicDesignShellConfig(config) {
  const source = config && typeof config === "object" ? config : {};
  const nextSiteContent = { ...(source.siteContent || {}) };
  delete nextSiteContent.maps;
  return mapDataImages({
    ...source,
    siteContent: nextSiteContent,
  }, (pathKey) => toDesignAssetUrl(pathKey));
}

function buildPublicDesignMapsConfig(config) {
  return mapDataImages((config && config.siteContent && config.siteContent.maps) ? config.siteContent.maps : {}, (pathKey) => toDesignAssetUrl(`siteContent.maps.${pathKey}`));
}

function getPublicDesignShellConfig() {
  if (!publicDesignShellCache) publicDesignShellCache = buildPublicDesignShellConfig(designConfig);
  return publicDesignShellCache;
}

function getPublicDesignMapsConfig() {
  if (!publicDesignMapsCache) publicDesignMapsCache = buildPublicDesignMapsConfig(designConfig);
  return publicDesignMapsCache;
}

const SD_FALLBACK_MAPS = [
  { id: "sector-01", name: "구역 1", neighbors: { right: "sector-02" } },
  { id: "sector-02", name: "구역 2", neighbors: { left: "sector-01" } },
];

function sdClamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sdRand(min, max) {
  return Math.random() * (max - min) + min;
}

function getSdServerMaps() {
  const mapRoot = (designConfig && designConfig.siteContent && designConfig.siteContent.maps) ? designConfig.siteContent.maps : {};
  const collections = Array.isArray(mapRoot.collections) ? mapRoot.collections : [];
  const activeCollectionId = mapRoot.activeCollectionId || collections[0]?.id || "";
  if (collections.length > 0) {
    const found = collections.find((item) => String(item.id) === String(activeCollectionId)) || collections[0];
    return Array.isArray(found?.presets) && found.presets.length > 0 ? found.presets : SD_FALLBACK_MAPS;
  }
  return Array.isArray(mapRoot.presets) && mapRoot.presets.length > 0 ? mapRoot.presets : SD_FALLBACK_MAPS;
}

function getSdNextMapId(maps, currentMapId, dir) {
  const found = (maps || []).find((item) => String(item.id) === String(currentMapId));
  const linked = found?.neighbors?.[dir];
  return linked && (maps || []).some((item) => String(item.id) === String(linked)) ? linked : currentMapId;
}

function markCharactersDirty() {
  global.__plcCharactersDirty = true;
}

function tickSdCharactersOnServer() {
  const maps = getSdServerMaps();
  if (!Array.isArray(maps) || maps.length === 0) return;
  let changed = false;
  const dt = 0.15;

  charactersDB.forEach((character) => {
    if (!character || !character.approved) return;
    const hasSprite = !!(character.investigationImage || character.mainImage || character.image);
    if (!hasSprite) return;

    let currentMap = character.currentMap || maps[0]?.id || "";
    let x = Number.isFinite(Number(character.x)) ? Number(character.x) : 20;
    let y = Number.isFinite(Number(character.y)) ? Number(character.y) : 20;
    let dx = Number.isFinite(Number(character.dx)) ? Number(character.dx) : 0;
    let dy = Number.isFinite(Number(character.dy)) ? Number(character.dy) : 0;
    let waitMs = Number.isFinite(Number(character.waitMs)) ? Number(character.waitMs) : 0;
    let moveCooldownMs = Number.isFinite(Number(character.moveCooldownMs)) ? Number(character.moveCooldownMs) : 0;

    if (waitMs > 0) {
      waitMs = Math.max(0, waitMs - 150);
      dx *= 0.94;
      dy *= 0.94;
    } else {
      moveCooldownMs -= 150;
      if (moveCooldownMs <= 0) {
        const mapDef = maps.find((item) => String(item.id) === String(currentMap)) || null;
        const linkedDirs = Object.entries(mapDef?.neighbors || {}).filter(([dir, nextId]) => nextId && maps.some((item) => String(item.id) === String(nextId)));
        const wantsPause = Math.random() < 0.14;
        const wantsMapChange = linkedDirs.length > 0 && Math.random() < 0.18;
        if (wantsPause) {
          waitMs = Math.round(sdRand(800, 1700));
          dx *= 0.24;
          dy *= 0.24;
          moveCooldownMs = Math.round(sdRand(3400, 6200));
        } else if (wantsMapChange) {
          const [dir] = linkedDirs[Math.floor(Math.random() * linkedDirs.length)];
          if (dir === "left") {
            dx = -sdRand(1.38, 2.05);
            dy = sdRand(-0.42, 0.42);
          } else if (dir === "right") {
            dx = sdRand(1.38, 2.05);
            dy = sdRand(-0.42, 0.42);
          } else if (dir === "up") {
            dx = sdRand(-0.42, 0.42);
            dy = -sdRand(1.24, 1.88);
          } else {
            dx = sdRand(-0.42, 0.42);
            dy = sdRand(1.24, 1.88);
          }
          moveCooldownMs = Math.round(sdRand(3200, 6000));
        } else {
          dx = sdRand(-1.62, 1.62);
          dy = sdRand(-0.88, 0.88);
          if (Math.abs(dx) < 0.68) dx = dx >= 0 ? 0.68 : -0.68;
          if (Math.abs(dy) < 0.28) dy = dy >= 0 ? 0.28 : -0.28;
          moveCooldownMs = Math.round(sdRand(4000, 7200));
        }
      }

      let nx = x + dx * dt * 1.32;
      let ny = y + dy * dt * 1.32;

      if (nx <= 4) {
        const nextMap = getSdNextMapId(maps, currentMap, "left");
        if (nextMap && nextMap !== currentMap) {
          currentMap = nextMap;
          nx = 91.2;
          ny = sdClamp(ny, 10, 76);
          dx = -Math.max(0.62, Math.abs(dx || sdRand(0.72, 1.12)));
          dy = sdClamp(dy || sdRand(-0.30, 0.30), -0.54, 0.54);
          moveCooldownMs = Math.round(sdRand(3200, 6000));
        } else {
          dx *= -1;
          nx = sdClamp(x + dx * dt * 1.32, 4, 92);
        }
      } else if (nx >= 92) {
        const nextMap = getSdNextMapId(maps, currentMap, "right");
        if (nextMap && nextMap !== currentMap) {
          currentMap = nextMap;
          nx = 8.8;
          ny = sdClamp(ny, 10, 76);
          dx = Math.max(0.62, Math.abs(dx || sdRand(0.72, 1.12)));
          dy = sdClamp(dy || sdRand(-0.30, 0.30), -0.54, 0.54);
          moveCooldownMs = Math.round(sdRand(3200, 6000));
        } else {
          dx *= -1;
          nx = sdClamp(x + dx * dt * 1.32, 4, 92);
        }
      }
      if (ny <= 8) {
        const nextMap = getSdNextMapId(maps, currentMap, "up");
        if (nextMap && nextMap !== currentMap) {
          currentMap = nextMap;
          nx = sdClamp(nx, 8, 92);
          ny = 77.2;
          dx = sdClamp(dx || sdRand(-0.30, 0.30), -0.54, 0.54);
          dy = -Math.max(0.62, Math.abs(dy || sdRand(0.72, 1.12)));
          moveCooldownMs = Math.round(sdRand(3200, 6000));
        } else {
          dy *= -1;
          ny = sdClamp(y + dy * dt * 1.32, 8, 78);
        }
      } else if (ny >= 78) {
        const nextMap = getSdNextMapId(maps, currentMap, "down");
        if (nextMap && nextMap !== currentMap) {
          currentMap = nextMap;
          nx = sdClamp(nx, 8, 92);
          ny = 8.8;
          dx = sdClamp(dx || sdRand(-0.30, 0.30), -0.54, 0.54);
          dy = Math.max(0.62, Math.abs(dy || sdRand(0.72, 1.12)));
          moveCooldownMs = Math.round(sdRand(3200, 6000));
        } else {
          dy *= -1;
          ny = sdClamp(y + dy * dt * 1.32, 8, 78);
        }
      }

      x = sdClamp(nx, 4, 92);
      y = sdClamp(ny, 8, 78);
    }

    if (
      character.currentMap !== currentMap ||
      Number(character.x) !== x ||
      Number(character.y) !== y ||
      Number(character.dx) !== dx ||
      Number(character.dy) !== dy ||
      Number(character.waitMs) !== waitMs ||
      Number(character.moveCooldownMs) !== moveCooldownMs
    ) {
      character.currentMap = currentMap;
      character.x = x;
      character.y = y;
      character.dx = dx;
      character.dy = dy;
      character.waitMs = waitMs;
      character.moveCooldownMs = moveCooldownMs;
      changed = true;
    }
  });

  if (changed) markCharactersDirty();
}

setInterval(() => {
  try {
    tickSdCharactersOnServer();
  } catch {}
}, 150);

setInterval(() => {
  if (!global.__plcCharactersDirty) return;
  try {
    writeRuntimeArray("characters.json", charactersDB);
    global.__plcCharactersDirty = false;
  } catch {}
}, 8000);

function buildPublicInvestigationState(item) {
  if (!item) return null;
  syncInvestigationRoster(item);
  const progress = refreshInvestigationCompletionState(item);
  const payload = {
    id: item.id,
    investigationId: item.id,
    title: item.title,
    type: item.type,
    listImage: String(item.listImage || item.data?.listImage || ""),
    entryImage: String(item.entryImage || item.data?.entryImage || item.listImage || item.data?.listImage || ""),
    listImageFrame: normalizeInvestigationImageFrame(item.listImageFrame || item.data?.listImageFrame),
    entryImageFrame: normalizeInvestigationImageFrame(item.entryImageFrame || item.data?.entryImageFrame || item.listImageFrame || item.data?.listImageFrame),
    imageUpdatedAt: Number(item.imageUpdatedAt || item.data?.imageUpdatedAt || 0),
    entryCorrosion: Number(item.entryCorrosion || item.data?.entryCorrosion || 0),
    endCorrosion: Number(item.endCorrosion || item.data?.endCorrosion || 0),
    currentNodeId: item.currentNodeId,
    sharedLog: item.sharedLog,
    sharedLogs: item.sharedLogs || [],
    leaders: Array.isArray(item.leaders) ? [...item.leaders] : [],
    participants: (Array.isArray(item.participants) ? item.participants : []).map(buildPublicCharacterSummary),
    started: !!item.started,
    routeHistory: item.routeHistory || [],
    mapBackgroundImage: item.data?.backgroundImage || "",
    foundItems: item.foundItems || [],
    foundNPCs: item.foundNPCs || [],
    rewards: item.rewards || [],
    points: 0,
    participantStates: item.participantStates || {},
    discoveredFlags: item.discoveredFlags || {},
    visitProgressPercent: Number(progress?.visitProgressPercent || 0),
    overallProgressPercent: Number(progress?.overallProgressPercent || 0),
    totalNodeCount: Number(progress?.totalNodeCount || 0),
    visitedNodeCount: Number(progress?.visitedNodeCount || 0),
    totalInvestigationActionCount: Number(progress?.totalInvestigationActionCount || 0),
    completedInvestigationActionCount: Number(progress?.completedInvestigationActionCount || 0),
    ended: item.ended || false,
    endedAt: item.endedAt || "",
    endedReason: item.endedReason || "",
    resultSummary: item.resultSummary || "",
    battleTurn: item.battleTurn || 1,
    pendingBattleActions: item.pendingBattleActions || {},
    lastBattleRound: item.lastBattleRound || [],
    clues: item.clues || [],
    pendingReward: item.pendingReward || null,
    activeNpcScene: normalizeNpcScene(item.activeNpcScene) || null,
    npcLineIndex: typeof item.npcLineIndex === "number" ? item.npcLineIndex : 0,
    readyToEnd: !!item.readyToEnd,
    endNoticeDismissed: !!item.endNoticeDismissed,
    eventBanner: item.eventBanner || "",
    eventBannerType: item.eventBannerType || "normal",
    eventBannerUntil: Number(item.eventBannerUntil || 0),
    endConfirmations: item.endConfirmations || [],
    data: item.data,
  };
  return mapDataImages(payload, (pathKey) => toInvestigationAssetUrl(item.id, pathKey));
}

app.get("/character/:id", (req, res) => {
  const character = charactersDB.find((item) => String(item.id) === String(req.params.id));
  if (!character) return res.status(404).json({ success: false, message: "캐릭터를 찾지 못했습니다." });
  res.json({ success: true, character: attachRelationsToCharacter(character) });
});

app.get("/character-public/:id", (req, res) => {
  const character = charactersDB.find((item) => String(item.id) === String(req.params.id));
  if (!character) return res.status(404).json({ success: false, message: "캐릭터를 찾지 못했습니다." });
  res.json({ success: true, character: buildPublicCharacter(character) });
});

app.get("/character-items/:id", (req, res) => {
  const character = charactersDB.find((item) => String(item.id) === String(req.params.id));
  if (!character) return res.status(404).json({ success: false, items: [] });
  res.json({ success: true, items: Array.isArray(character.items) ? character.items : [] });
});

app.get("/characters-lite/:ownerId", (req, res) => {
  res.json(charactersDB.filter((c) => String(c.ownerId) === String(req.params.ownerId)).map(summarizeCharacter));
});

app.get("/characters-lite", (req, res) => {
  refreshCharactersFromDiskIfNeeded();
  res.set("Cache-Control", "public, max-age=2, stale-while-revalidate=30");
  res.json(charactersDB.map(summarizeCharacter));
});

app.get("/characters-public/:ownerId", (req, res) => {
  const rows = getPublicCharacterSummaries().filter((c) => String(c.ownerId) === String(req.params.ownerId));
  res.set("Cache-Control", "public, max-age=2, stale-while-revalidate=30");
  res.json(rows);
});

app.get("/characters-public", (req, res) => {
  res.set("Cache-Control", "public, max-age=2, stale-while-revalidate=30");
  res.json(getPublicCharacterSummaries());
});

app.get("/health", (req, res) => {
  res.json({ success: true, ok: true, ts: Date.now() });
});

app.get("/admin/relationRequests", (req, res) => {
  res.json(relationRequestsDB.filter((item) => item.status === "pending"));
});

app.get("/admin/relations", (req, res) => {
  const rows = (relationsDB || []).map((item) => ({
    ...item,
    characterName: item.character || charactersDB.find((character) => String(character.id) === String(item.characterId))?.name || item.characterId,
    otherCharacterName: item.otherCharacter || charactersDB.find((character) => String(character.id) === String(item.otherCharacterId))?.name || item.otherCharacterId,
  }));
  res.json(rows);
});

app.post("/admin/relations/delete", (req, res) => {
  const { characterId, otherCharacterId } = req.body || {};
  if (!characterId || !otherCharacterId) {
    return res.json({ success: false, message: "삭제할 관계 정보를 찾지 못했습니다." });
  }

  const before = relationsDB.length;
  relationsDB = relationsDB.filter((item) => {
    const forward = String(item.characterId) === String(characterId) && String(item.otherCharacterId) === String(otherCharacterId);
    const reverse = String(item.characterId) === String(otherCharacterId) && String(item.otherCharacterId) === String(characterId);
    return !forward && !reverse;
  });
  relationRequestsDB = relationRequestsDB.filter((item) => {
    const forward = String(item.fromCharacterId) === String(characterId) && String(item.toCharacterId) === String(otherCharacterId);
    const reverse = String(item.fromCharacterId) === String(otherCharacterId) && String(item.toCharacterId) === String(characterId);
    return !forward && !reverse;
  });

  writeJsonArraySafe(relationsPath, relationsDB);
  writeJsonArraySafe(relationRequestsPath, relationRequestsDB);
  res.json({ success: before !== relationsDB.length });
});

app.get("/relationRequests/byCharacter/:characterId", (req, res) => {
  const characterId = String(req.params.characterId);
  res.json(relationRequestsDB.filter((item) => String(item.fromCharacterId) === characterId));
});

app.post("/relationRequests", (req, res) => {
  const body = req.body || {};
  if (!body.fromCharacterId || !body.toCharacterId || !body.fromCharacter || !body.toCharacter) {
    return res.json({ success: false, message: "관계 신청 정보가 부족합니다." });
  }

  const duplicated = relationRequestsDB.find((item) =>
    item.status === "pending" &&
    String(item.fromCharacterId) === String(body.fromCharacterId) &&
    String(item.toCharacterId) === String(body.toCharacterId)
  );

  if (duplicated) {
    return res.json({ success: false, message: "이미 같은 대상에게 신청을 보냈습니다." });
  }

  const sameDirectionRelation = relationsDB.find((item) =>
    String(item.characterId) === String(body.fromCharacterId) &&
    String(item.otherCharacterId) === String(body.toCharacterId) &&
    (String(item.relationName || "").trim() || String(item.description || "").trim())
  );

  if (sameDirectionRelation) {
    return res.json({ success: false, message: "이미 이 방향의 관계가 등록되어 있습니다." });
  }

  const request = {
    id: `relreq-${Date.now()}`,
    fromCharacterId: body.fromCharacterId,
    fromCharacter: body.fromCharacter,
    toCharacterId: body.toCharacterId,
    toCharacter: body.toCharacter,
    relationName: body.relationName || "",
    description: body.description || "",
    status: "pending",
    createdAt: new Date().toISOString(),
  };

  relationRequestsDB.push(request);
  writeJsonArraySafe(relationRequestsPath, relationRequestsDB);
  res.json({ success: true, request });
});

app.post("/admin/relationRequests/decision", (req, res) => {
  const { requestId, decision } = req.body || {};
  const target = relationRequestsDB.find((item) => item.id === requestId);

  if (!target) {
    return res.json({ success: false, message: "관계 신청을 찾지 못했습니다." });
  }

  if (!["approved", "rejected"].includes(decision)) {
    return res.json({ success: false, message: "올바르지 않은 처리 값입니다." });
  }

  target.status = decision;

  if (decision === "approved") {
    const { requester, receiverDefault } = buildRelationEntriesForApproval(target);
    const nextRelations = [...relationsDB];
    const requesterIndex = nextRelations.findIndex((item) =>
      String(item.characterId) === String(target.fromCharacterId) &&
      String(item.otherCharacterId) === String(target.toCharacterId)
    );
    if (requesterIndex >= 0) {
      nextRelations[requesterIndex] = {
        ...nextRelations[requesterIndex],
        ...requester,
      };
    } else {
      nextRelations.push(requester);
    }

    const receiverIndex = nextRelations.findIndex((item) =>
      String(item.characterId) === String(target.toCharacterId) &&
      String(item.otherCharacterId) === String(target.fromCharacterId)
    );
    if (receiverIndex < 0) {
      nextRelations.push(receiverDefault);
    }

    relationsDB = nextRelations;
    writeJsonArraySafe(relationsPath, relationsDB);
  }

  writeJsonArraySafe(relationRequestsPath, relationRequestsDB);
  res.json({ success: true });
});

app.get("/relations/:characterId", (req, res) => {
  const characterId = String(req.params.characterId);
  res.json(relationsDB.filter((item) => String(item.characterId) === characterId));
});
// ===== end relation system routes =====



// ===== shop item / mail / extra admin routes =====
const shopItemsPath = resolveDataPath("shopItems.json");
const mailsPath = resolveDataPath("mails.json");
const shopConfigPath = resolveDataPath("shopConfig.json");

function normalizeShopItem(item = {}) {
  const useType = item.useType || "none";
  return {
    ...item,
    id: item.id || `item-${Date.now()}`,
    name: item.name || "새 아이템",
    price: Number(item.price || 0),
    sellPrice: Number(item.sellPrice || 0),
    description: item.description || "",
    image: String(item.image || item.icon || ""),
    useType,
    useValue: useType === "skill" ? String(item.useValue || item.skillKey || "") : Number(item.useValue || 0),
    statTarget: item.statTarget || item.targetStat || "hp",
    skillName: item.skillName || "",
    skillKey: item.skillKey || (useType === "skill" ? String(item.useValue || "") : ""),
    skillEffect: item.skillEffect || "damage",
    skillPower: Number(item.skillPower || item.useValue || 0),
    cooldownTurns: Number(item.cooldownTurns || 0),
    hidden: item.hidden !== false,
  };
}

function readJsonFileSafe(filePath, fallback) {
  try {
    const parsed = safeReadJsonFileStrict(filePath, fallback, path.basename(String(filePath || "json")));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}
function writeJsonFileSafe(filePath, value) {
  try { scheduleJsonWrite(filePath, value); } catch (err) { console.error(err); }
}

let shopItemsDB = readJsonFileSafe(shopItemsPath, [
  { id: "heal_pack", name: "응급 치료 키트", price: 30, sellPrice: 15, description: "체력을 회복하는 아이템", useType: "heal", useValue: 20, hidden: false },
  { id: "sharp_blade", name: "예리한 단검", price: 60, sellPrice: 30, description: "공격력을 높여주는 장비", useType: "statBoost", statTarget: "atk", useValue: 1, hidden: false },
]).map(normalizeShopItem);
let mailsDB = readJsonFileSafe(mailsPath, []);
let shopConfigDB = readJsonFileSafe(shopConfigPath, {
  blackjackDealerImage: "",
  ebeasts: [
    { key: "E-01", image: "" },
    { key: "E-02", image: "" },
    { key: "E-03", image: "" },
    { key: "E-04", image: "" },
    { key: "E-05", image: "" },
  ],
});
function normalizeShopConfig(config = {}) {
  const rawBeasts = Array.isArray(config?.ebeasts) ? config.ebeasts : [];
  const defaults = ["E-01", "E-02", "E-03", "E-04", "E-05"];
  const normalizedBeasts = defaults.map((key) => {
    const found = rawBeasts.find((item) => String(item?.key || "") === key) || {};
    return { key, image: String(found?.image || "") };
  });
  return {
    blackjackDealerImage: String(config?.blackjackDealerImage || ""),
    ebeasts: normalizedBeasts,
  };
}
shopConfigDB = normalizeShopConfig(shopConfigDB);

function collectKnownSiteItemNames() {
  const found = new Set();
  const pushName = (value) => {
    const name = String(value || "").trim();
    if (name) found.add(name);
  };

  shopItemsDB.forEach((item) => {
    pushName(item?.name);
    pushName(item?.id);
  });

  charactersDB.forEach((character) => {
    (Array.isArray(character?.items) ? character.items : []).forEach(pushName);
  });

  investigationsDB.forEach((investigation) => {
    const nodes = investigation?.data?.nodes || {};
    Object.values(nodes).forEach((node) => {
      if (node?.battle) {
        pushName(node.battle.rewardItem);
      }

      Object.values(node?.actionResults || {}).forEach((result) => {
        pushName(result?.item);
        pushName(result?.reward);
      });

      const npcLines = Array.isArray(node?.npcScene?.lines) ? node.npcScene.lines : [];
      npcLines.forEach((line) => {
        (Array.isArray(line?.options) ? line.options : []).forEach((option) => {
          pushName(option?.rewardItem);
        });
      });
    });
  });

  return Array.from(found);
}

function syncShopItemsWithKnownItems() {
  const knownNames = collectKnownSiteItemNames();
  knownNames.forEach((name) => {
    const exists = shopItemsDB.some((item) => String(item?.name || "") === name || String(item?.id || "") === name);
    if (!exists) {
      shopItemsDB.push(normalizeShopItem({
        id: `auto-${name}`.replace(/[^a-zA-Z0-9-_가-힣]/g, "-").slice(0, 80),
        name,
        price: 0,
        sellPrice: 0,
        description: "자동 등록된 아이템",
        useType: "none",
        hidden: true,
      }));
    }
  });
  writeJsonFileSafe(shopItemsPath, shopItemsDB.map(normalizeShopItem));
}

app.get("/shopItems", (req, res) => {
  syncShopItemsWithKnownItems();
  res.json(shopItemsDB.map(normalizeShopItem));
});
app.post("/shopItems/reorder", (req, res) => {
  syncShopItemsWithKnownItems();
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((id) => String(id || "")).filter(Boolean) : [];
  if (ids.length === 0) return res.status(400).json({ success: false, message: "저장할 물품 순서가 없습니다." });

  const byId = new Map(shopItemsDB.map((item) => [String(item?.id || ""), item]));
  const nextItems = [];
  ids.forEach((id) => {
    if (!byId.has(id)) return;
    nextItems.push(byId.get(id));
    byId.delete(id);
  });
  shopItemsDB.forEach((item) => {
    const id = String(item?.id || "");
    if (!byId.has(id)) return;
    nextItems.push(item);
    byId.delete(id);
  });

  shopItemsDB = nextItems.map(normalizeShopItem);
  writeJsonFileSafe(shopItemsPath, shopItemsDB);
  res.json({ success: true, items: shopItemsDB.map(normalizeShopItem) });
});
app.post("/shopItems", (req, res) => {
  syncShopItemsWithKnownItems();
  const payload = normalizeShopItem(req.body || {});
  const id = payload.id || `item-${Date.now()}`;
  const target = shopItemsDB.find((item) => String(item.id) === String(id));
  if (target) Object.assign(target, normalizeShopItem({ ...target, ...payload, id }));
  else shopItemsDB.push(normalizeShopItem({ ...payload, id }));
  writeJsonFileSafe(shopItemsPath, shopItemsDB.map(normalizeShopItem));
  syncShopItemsWithKnownItems();
  res.json({ success: true, items: shopItemsDB.map(normalizeShopItem) });
});
app.delete("/shopItems/:id", (req, res) => {
  shopItemsDB = shopItemsDB.filter((item) => String(item.id) !== String(req.params.id));
  writeJsonFileSafe(shopItemsPath, shopItemsDB.map(normalizeShopItem));
  syncShopItemsWithKnownItems();
  res.json({ success: true });
});

app.get("/shopConfig", (req, res) => {
  shopConfigDB = normalizeShopConfig(shopConfigDB);
  res.json(shopConfigDB);
});
app.post("/shopConfig", (req, res) => {
  shopConfigDB = normalizeShopConfig(req.body || {});
  writeJsonFileSafe(shopConfigPath, shopConfigDB);
  res.json({ success: true, shopConfig: shopConfigDB });
});


function findShopItemByLooseId(itemIdOrName) {
  const key = String(itemIdOrName || "").trim();
  if (!key) return null;
  return (shopItemsDB || []).map(normalizeShopItem).find((item) =>
    String(item.id || "") === key || String(item.name || "") === key
  ) || null;
}

function getInventoryItemKey(value) {
  if (value && typeof value === "object") {
    return String(value.id || value.itemId || value.name || value.itemName || value.key || "").trim();
  }
  return String(value || "").trim();
}

function inventoryItemMatches(value, requestedKey) {
  const ownedKey = getInventoryItemKey(value);
  const key = String(requestedKey || "").trim();
  if (!ownedKey || !key) return false;
  if (ownedKey === key) return true;

  const ownedMeta = findShopItemByLooseId(ownedKey);
  const requestMeta = findShopItemByLooseId(key);
  const ownedNames = [ownedKey, ownedMeta?.id, ownedMeta?.name].filter(Boolean).map(String);
  const requestNames = [key, requestMeta?.id, requestMeta?.name].filter(Boolean).map(String);
  return ownedNames.some((owned) => requestNames.includes(owned));
}

app.post("/shop/buy", (req, res) => {
  refreshProtectedRuntimeArraysIfNeeded();
  const { characterId, charId, ownerId, characterName, itemId, itemName } = req.body || {};
  const char = findCharacterByLooseIdentifiers({ charId: charId || characterId, characterId, ownerId, characterName });
  if (!char) return res.json({ success: false, message: "캐릭터를 찾을 수 없습니다." });

  syncShopItemsWithKnownItems();
  const item = findShopItemByLooseId(itemId || itemName);
  if (!item) return res.json({ success: false, message: "상점 아이템을 찾을 수 없습니다." });

  const price = Math.max(0, Number(item.price || 0));
  const currentCoins = Number(char.coins || 0);
  if (currentCoins < price) return res.json({ success: false, message: "코인이 부족합니다." });

  char.coins = currentCoins - price;
  char.items = Array.isArray(char.items) ? char.items : [];
  char.items.push(item.name || item.id);
  char.updatedAt = Date.now();
  char.assetVersion = char.updatedAt;

  const saved = writeRuntimeArray("characters.json", charactersDB);
  if (!saved) return res.json({ success: false, message: "캐릭터 저장이 차단되었습니다. 기존 데이터 보호 중입니다." });
  return res.json({ success: true, character: buildPublicCharacter(char), item: normalizeShopItem(item) });
});

app.post("/shop/sell", (req, res) => {
  refreshProtectedRuntimeArraysIfNeeded();
  const { characterId, charId, ownerId, characterName, itemId, itemName } = req.body || {};
  const char = findCharacterByLooseIdentifiers({ charId: charId || characterId, characterId, ownerId, characterName });
  if (!char) return res.json({ success: false, message: "캐릭터를 찾을 수 없습니다." });

  syncShopItemsWithKnownItems();
  const key = String(itemName || itemId || "").trim();
  if (!key) return res.json({ success: false, message: "판매할 아이템을 찾을 수 없습니다." });

  char.items = Array.isArray(char.items) ? char.items : [];
  const index = char.items.findIndex((value) => inventoryItemMatches(value, key));
  if (index < 0) return res.json({ success: false, message: "보유 아이템에 없습니다." });

  const [removed] = char.items.splice(index, 1);
  const removedKey = getInventoryItemKey(removed);
  const item = findShopItemByLooseId(removedKey) || findShopItemByLooseId(key) || {};
  char.coins = Number(char.coins || 0) + Math.max(0, Number(item.sellPrice || 0));
  char.updatedAt = Date.now();
  char.assetVersion = char.updatedAt;

  const saved = writeRuntimeArray("characters.json", charactersDB);
  if (!saved) return res.json({ success: false, message: "캐릭터 저장이 차단되었습니다. 기존 데이터 보호 중입니다." });
  return res.json({ success: true, character: buildPublicCharacter(char), item: normalizeShopItem(item) });
});

app.post("/shop/use", (req, res) => {
  refreshProtectedRuntimeArraysIfNeeded();
  const { characterId, charId, ownerId, characterName, itemId, itemName, itemIndex } = req.body || {};
  const char = findCharacterByLooseIdentifiers({ charId: charId || characterId, characterId, ownerId, characterName });
  if (!char) return res.json({ success: false, message: "캐릭터를 찾을 수 없습니다." });

  char.items = Array.isArray(char.items) ? char.items : [];
  const key = String(itemName || itemId || "").trim();
  if (!key) return res.json({ success: false, message: "사용할 아이템을 찾을 수 없습니다." });

  syncShopItemsWithKnownItems();
  const requestedIndex = Number(itemIndex);
  let index = Number.isInteger(requestedIndex) && requestedIndex >= 0 && requestedIndex < char.items.length
    ? requestedIndex
    : -1;
  if (index >= 0 && !inventoryItemMatches(char.items[index], key)) index = -1;
  if (index < 0) index = char.items.findIndex((value) => inventoryItemMatches(value, key));
  if (index < 0) return res.json({ success: false, message: "보유 아이템에 없습니다." });

  const [removed] = char.items.splice(index, 1);
  const removedKey = getInventoryItemKey(removed);
  const item = findShopItemByLooseId(removedKey) || findShopItemByLooseId(key) || normalizeShopItem({ name: removedKey || key });
  const normalized = normalizeShopItem(item);
  const useType = String(normalized.useType || "none").toLowerCase();
  const useValue = Number(normalized.useValue || 0);

  if (useType === "heal" || useType === "hp") {
    const maxHp = getCharacterMaxHp(char?.stats?.hp);
    const currentHp = Number.isFinite(Number(char.currentHp)) ? Number(char.currentHp) : maxHp;
    char.currentHp = Math.max(0, Math.min(maxHp, currentHp + Math.max(0, useValue || 10)));
  }

  if (useType === "corrosion" || useType === "corrosiondown" || useType === "reducecorrosion") {
    char.corrosion = Math.max(0, Number(char.corrosion || 0) - Math.max(0, useValue || 5));
  }

  if (useType === "coin" || useType === "coins") {
    char.coins = Math.max(0, Number(char.coins || 0) + useValue);
  }

  if (useType === "stat") {
    const statTarget = String(normalized.statTarget || "").trim();
    if (statTarget) {
      char.stats = normalizeCharacterStats(char.stats || {});
      char.stats[statTarget] = Number(char.stats?.[statTarget] || 0) + useValue;
    }
  }

  if (useType === "skill") {
    char.skills = Array.isArray(char.skills) ? char.skills : [];
    const skillKey = String(normalized.skillKey || normalized.useValue || normalized.name || "").trim();
    const skillName = String(normalized.skillName || normalized.name || skillKey || "스킬").trim();
    const alreadyLearned = char.skills.some((skill) => String(skill?.key || skill?.name || skill) === skillKey || String(skill?.name || skill) === skillName);
    if (!alreadyLearned) {
      char.skills.push({
        key: skillKey || `skill-${Date.now()}`,
        name: skillName,
        effect: normalized.skillEffect || "damage",
        power: Number(normalized.skillPower || 0),
        cooldownTurns: Number(normalized.cooldownTurns || 0),
      });
    }
  }

  char.updatedAt = Date.now();
  char.assetVersion = char.updatedAt;

  const saved = writeRuntimeArray("characters.json", charactersDB);
  if (!saved) return res.json({ success: false, message: "캐릭터 저장이 차단되었습니다. 기존 데이터 보호 중입니다." });
  return res.json({ success: true, character: buildPublicCharacter(char), item: normalized });
});

app.get("/mails/unreadCount/:characterId", (req, res) => {
  const count = mailsDB.filter((mail) => String(mail.toCharacterId) === String(req.params.characterId) && !mail.read).length;
  res.json({ count });
});
app.get("/mails/:characterId", (req, res) => {
  res.json(mailsDB.filter((mail) => String(mail.toCharacterId) === String(req.params.characterId)).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
});
app.post("/mails/send", (req, res) => {
  const { fromCharacterId, toCharacterId, title, body, coins, items } = req.body || {};
  const fromChar = charactersDB.find((char) => String(char.id) === String(fromCharacterId));
  const toChar = charactersDB.find((char) => String(char.id) === String(toCharacterId));
  if (!fromChar || !toChar) return res.json({ success: false, message: "캐릭터를 찾을 수 없습니다." });
  mailsDB.push({
    id: `mail-${Date.now()}-${Math.random()}`,
    fromCharacterId,
    toCharacterId,
    fromName: fromChar.name,
    fromImage: fromChar.image || "",
    title: title || `${fromChar.name}의 우편`,
    body: body || "",
    coins: Number(coins || 0),
    items: Array.isArray(items) ? items : [],
    read: false,
    received: false,
    createdAt: new Date().toISOString(),
  });
  writeJsonFileSafe(mailsPath, mailsDB);
  res.json({ success: true });
});
app.post("/mails/:id/read", (req, res) => {
  const target = mailsDB.find((mail) => String(mail.id) === String(req.params.id));
  if (!target) return res.json({ success: false, message: "우편을 찾지 못했습니다." });
  target.read = true;
  writeJsonFileSafe(mailsPath, mailsDB);
  res.json({ success: true });
});
app.post("/mails/:id/receive", (req, res) => {
  const target = mailsDB.find((mail) => String(mail.id) === String(req.params.id));
  if (!target) return res.json({ success: false, message: "우편을 찾지 못했습니다." });
  if (target.received) return res.json({ success: false, message: "이미 받은 우편입니다." });
  const char = charactersDB.find((item) => String(item.id) === String(target.toCharacterId));
  if (!char) return res.json({ success: false, message: "캐릭터를 찾지 못했습니다." });
  char.coins = Number(char.coins || 0) + Number(target.coins || 0);
  char.items = [...(Array.isArray(char.items) ? char.items : []), ...(Array.isArray(target.items) ? target.items : [])];
  target.received = true;
  target.read = true;
  writeJsonFileSafe(mailsPath, mailsDB);
  res.json({ success: true, character: char });
});


app.post("/deleteInvestigation", (req, res) => {
  const { id } = req.body || {};
  const index = investigationsDB.findIndex((v) => v.id === id);
  if (index < 0) return res.json({ success: false, message: "조사를 찾지 못했습니다." });
  investigationsDB.splice(index, 1);
  delete roomChats[id];
  emitParticipantsUpdated();
  res.json({ success: true });
});

app.post("/endInvestigationOnly", (req, res) => {
  const { id, endedBy } = req.body || {};
  const item = investigationsDB.find((v) => v.id === id);
  if (!item) return res.json({ success: false, message: "조사를 찾지 못했습니다." });
  const safeEndedBy = String(endedBy || "운영자");
  const isLeader = safeEndedBy !== "운영자" && Array.isArray(item.leaders) && item.leaders.includes(safeEndedBy);
  if (safeEndedBy !== "운영자" && !isLeader) {
    return res.json({ success: false, message: "리더 또는 운영자만 조사를 종료할 수 있습니다." });
  }
  item.ended = true;
  item.started = false;
  item.endedAt = new Date().toISOString();
  item.endedReason = safeEndedBy === "운영자" ? "운영자 종료" : "조사 종료";
  item.resultSummary = safeEndedBy === "운영자" ? "운영자가 조사를 종료했습니다." : `${safeEndedBy}이(가) 조사를 종료했습니다.`;
  item.sharedLog = item.resultSummary;
  item.sharedLogs.push(createLogEntry(item.resultSummary));
  applyFaintedEndRecovery(item);
  applyInvestigationEndCorrosion(item);
  emitParticipantsUpdated();
  emitInvestigationState(id);
  res.json({ success: true, item });
});
// ===== end extra routes =====

const clientBuildPath = path.join(__dirname, "client", "build");
if (fs.existsSync(clientBuildPath)) {
  app.use(express.static(clientBuildPath, {
    etag: true,
    lastModified: true,
    maxAge: "7d",
    setHeaders(res, filePath) {
      if (String(filePath || "").toLowerCase().endsWith(".html")) {
        res.setHeader("Cache-Control", "no-cache");
      }
    },
  }));
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.path.startsWith("/socket.io")) return res.status(404).end();
    res.sendFile(path.join(clientBuildPath, "index.html"));
  });
}

appBootReady = true;

if (!IS_ASSET_COMPACT_CHILD) {
  // Render 헬스체크가 안정적으로 통과한 뒤에만 이미지/JSON 정리 작업을 시작합니다.
  // Render에서는 기본 자동 실행을 끄고, 필요할 때 PLC_ASSET_COMPACT_ON_RENDER=1로만 켭니다.
  const shouldRunAssetCompact = process.env.PLC_DISABLE_ASSET_COMPACT !== "1" && (!process.env.RENDER || process.env.PLC_ASSET_COMPACT_ON_RENDER === "1");
  if (shouldRunAssetCompact) {
    const assetCompactDelayMs = Number(process.env.PLC_ASSET_COMPACT_DELAY_MS || (process.env.RENDER ? 600000 : 3000));
    setTimeout(runAssetCompactChildProcess, assetCompactDelayMs);
  }
}

