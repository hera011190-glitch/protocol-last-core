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
const MAX_STARTUP_JSON_PARSE_BYTES = Number(process.env.MAX_STARTUP_JSON_PARSE_BYTES || 24 * 1024 * 1024);
const MAX_DATA_ASSET_MEMORY_CACHE_BYTES = Number(process.env.MAX_DATA_ASSET_MEMORY_CACHE_BYTES || 1024 * 1024);
const MAX_TOTAL_DATA_ASSET_MEMORY_CACHE_BYTES = Number(process.env.MAX_TOTAL_DATA_ASSET_MEMORY_CACHE_BYTES || 12 * 1024 * 1024);

function isAssetFileUrl(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (text.startsWith("/asset-file/")) return true;
  try {
    const parsed = new URL(text, "http://local.invalid");
    return parsed.pathname.startsWith("/asset-file/");
  } catch {
    return /\/asset-file\//.test(text);
  }
}

function getAssetFileRelativePath(value) {
  const text = String(value || "").trim();
  if (!isAssetFileUrl(text)) return "";
  try {
    const parsed = new URL(text, "http://local.invalid");
    return decodeURIComponent(parsed.pathname.replace(/^\/asset-file\//, ""));
  } catch {
    return text.replace(/^.*?\/asset-file\//, "");
  }
}

function sendAssetFileUrl(res, value) {
  const relative = getAssetFileRelativePath(value);
  if (!relative || relative.includes("..")) return res.status(404).end();
  const runtimePath = path.join(RUNTIME_ASSET_DIR, relative);
  const bundledPath = path.join(BUNDLED_ASSET_DIR, relative);
  const foundPath = fs.existsSync(runtimePath) ? runtimePath : (fs.existsSync(bundledPath) ? bundledPath : "");
  if (!foundPath) return res.redirect(302, `/asset-file/${relative}`);
  res.set("Cache-Control", "public, max-age=31536000, immutable");
  return res.sendFile(foundPath);
}

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

function compactSingleDataUrlToAssetFile(value, namespace) {
  const raw = String(value || "");
  const match = raw.match(/^data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+\/_=-]+)$/);
  if (!match) return raw;
  const [, mime, base64Text] = match;
  const targetNamespace = String(namespace || "assets").replace(/[^a-zA-Z0-9_-]/g, "_");
  const targetDir = path.join(RUNTIME_ASSET_DIR, targetNamespace);
  fs.mkdirSync(targetDir, { recursive: true });
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
  const assetName = `${hash}.${getAssetExtensionFromMime(mime)}`;
  const assetPath = path.join(targetDir, assetName);
  if (!fs.existsSync(assetPath)) fs.writeFileSync(assetPath, Buffer.from(normalizedBase64, "base64"));
  return `/asset-file/${targetNamespace}/${assetName}`;
}

function compactDataUrlsInValue(value, namespace, seen = new WeakSet()) {
  if (typeof value === "string") {
    if (value.startsWith("data:") && value.includes(";base64,")) {
      try { return compactSingleDataUrlToAssetFile(value, namespace); } catch (error) {
        console.error(`[asset-compact] 메모리 data URL 분리 실패: ${namespace}`, error.message);
        return value;
      }
    }
    return value;
  }
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      value[i] = compactDataUrlsInValue(value[i], namespace, seen);
    }
    return value;
  }
  Object.keys(value).forEach((key) => {
    value[key] = compactDataUrlsInValue(value[key], namespace, seen);
  });
  return value;
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

function getSafeRuntimeBackupName(filename) {
  return String(filename || "runtime").replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function findLatestRuntimeBackupFile(filename) {
  try {
    const backupDir = path.join(DATA_DIR, "_backups");
    if (!filename || !fs.existsSync(backupDir)) return "";
    const safeName = getSafeRuntimeBackupName(filename);
    const candidates = fs.readdirSync(backupDir)
      .filter((name) => name.startsWith(`${safeName}.`) && name.endsWith(".bak.json"))
      .map((name) => {
        const fullPath = path.join(backupDir, name);
        try {
          const stat = fs.statSync(fullPath);
          return { name, fullPath, mtimeMs: Number(stat.mtimeMs || 0), size: Number(stat.size || 0) };
        } catch {
          return null;
        }
      })
      .filter((item) => item && item.size > 0)
      .sort((a, b) => b.mtimeMs - a.mtimeMs || String(b.name).localeCompare(String(a.name)));
    return candidates[0]?.fullPath || "";
  } catch {
    return "";
  }
}

function resolveDataPath(filename) {
  const nextPath = path.join(DATA_DIR, filename);
  const legacyPath = path.join(LEGACY_DATA_DIR, filename);
  if (!fs.existsSync(nextPath)) {
    const backupPath = findLatestRuntimeBackupFile(filename);
    if (backupPath && fs.existsSync(backupPath)) {
      try {
        fs.copyFileSync(backupPath, nextPath);
        console.log(`[data-restore] ${filename} 파일이 없어 최신 백업에서 복원했습니다.`);
        return nextPath;
      } catch (error) {
        console.error(`[data-restore] ${filename} 백업 복원 실패`, error.message);
      }
    }
  }
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

    if (stat.size > DATA_IMAGE_COMPACT_MIN_BYTES) {
      try {
        compactDataImagesInJsonFile(filePath, path.basename(String(filePath || label), ".json"));
      } catch (error) {
        console.error(`[json-safe] ${label} 사전 에셋 분리 실패: ${filePath}`, error.message);
      }
    }

    const nextStat = fs.statSync(filePath);
    if (nextStat.size > MAX_STARTUP_JSON_PARSE_BYTES) {
      console.error(`[json-safe] ${label} 파일이 너무 커서 서버 시작 중 파싱하지 않았습니다: ${filePath} (${nextStat.size} bytes)`);
      return fallback;
    }

    if (nextStat.size > 1024 * 1024) {
      console.log(`[json-safe] ${label} 읽는 중: ${path.basename(filePath)} (${nextStat.size} bytes)`);
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
ensureRuntimeFile("adminCharacterConfig.json", {
  hourlyCorrosionEnabled: false,
  hourlyCorrosionDecrease: 0,
  lastHourlyCorrosionAt: "",
});

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
const RUNTIME_JSON_BACKUP_TARGETS = new Set([
  "designConfig.json",
  "designMaps.json",
  "customInvestigations.json",
  "shopItems.json",
  "shopConfig.json",
  "investigations.json",
  "mails.json",
  "relations.json",
  "relationRequests.json",
]);
const LAST_RUNTIME_FILE_BACKUP_AT = new Map();

function shouldMakeRuntimeFileBackupNow(filename) {
  const key = String(filename || "runtime");
  const now = Date.now();
  const lastAt = Number(LAST_RUNTIME_FILE_BACKUP_AT.get(key) || 0);
  if (now - lastAt < 60 * 1000) return false;
  LAST_RUNTIME_FILE_BACKUP_AT.set(key, now);
  return true;
}

function backupRuntimeFileBeforeWrite(filePath) {
  try {
    const filename = path.basename(String(filePath || ""));
    if (!RUNTIME_JSON_BACKUP_TARGETS.has(filename)) return;
    if (!fs.existsSync(filePath)) return;
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size <= 0) return;
    if (!shouldMakeRuntimeFileBackupNow(filename)) return;
    const backupDir = path.join(DATA_DIR, "_backups");
    fs.mkdirSync(backupDir, { recursive: true });
    const safeName = getSafeRuntimeBackupName(filename);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.copyFileSync(filePath, path.join(backupDir, `${safeName}.${stamp}.bak.json`));
    const backups = fs.readdirSync(backupDir)
      .filter((name) => name.startsWith(`${safeName}.`) && name.endsWith(".bak.json"))
      .sort();
    while (backups.length > 30) {
      const removeName = backups.shift();
      try { fs.unlinkSync(path.join(backupDir, removeName)); } catch {}
    }
  } catch (error) {
    console.error("runtime file backup failed", filePath, error.message);
  }
}

function stringifyRuntimeJsonPayload(filePath, value) {
  const namespace = path.basename(String(filePath || "assets"), ".json");
  const compactedValue = compactDataUrlsInValue(value === undefined ? null : value, namespace);
  return JSON.stringify(compactedValue, null, 2);
}

function writeJsonAtomicSync(filePath, value) {
  const payload = stringifyRuntimeJsonPayload(filePath, value);
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  backupRuntimeFileBeforeWrite(filePath);
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
      backupRuntimeFileBeforeWrite(filePath);
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
    const safeName = getSafeRuntimeBackupName(filename);
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
  Object.keys(value).forEach((key) => {
    const token = normalizeUserIdText(key);
    if (token && token.length <= 80) tokens.add(token.toLowerCase());
  });
  ["id", "name", "title", "key", "nodeId", "target", "slug", "type", "category", "background", "weight", "description", "effect", "image", "color", "price", "sellPrice"].forEach((field) => {
    const token = normalizeUserIdText(value?.[field]);
    if (token && token.length <= 80) tokens.add(token.toLowerCase());
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

const EXPLICIT_NON_ACCOUNT_IDS = new Set([
  "부엌 종업원 기록",
  "실종자의 흔적",
  "초상화 속 인물",
  "archive-slip",
  "surehomogeneity",
  "test1",
  "ward-note",
]);

function isExplicitNonAccountId(id) {
  const nextId = normalizeUserIdText(id);
  if (!nextId) return true;
  return EXPLICIT_NON_ACCOUNT_IDS.has(nextId) || EXPLICIT_NON_ACCOUNT_IDS.has(nextId.toLowerCase());
}

function isKnownNonUserRuntimeId(id) {
  const nextId = normalizeUserIdText(id);
  if (!nextId) return true;
  if (isExplicitNonAccountId(nextId)) return true;
  const lower = nextId.toLowerCase();
  if (lower === "plc") return true;
  if (/^\d+$/.test(nextId)) return true;
  if (/^item-\d{8,}$/.test(lower)) return true;
  if (/^(?:custom|investigation|shop|item|node|map|design|theme|npc|battle|reward|monster|enemy|e-beast|actionresults|clue|relreq|memo|note|adminmemo)[-_:.]/i.test(nextId)) return true;
  if (/(?:custom|investigation|shop|item|node|design|theme|npc|battle|reward|monster|enemy|login|auth|registered|actionresults|clue|relreq|memo|adminmemo|json)/i.test(nextId) && !/@/.test(nextId)) return true;
  if (/(?:조사|커스텀|상점|아이템|노드|디자인|테마|전투|보상|몬스터|이비스트|로그인|회원가입|숫자|공지|세계관|일정표|홈페이지|캐릭터|지도|맵|관리인|메모|단서)/.test(nextId)) return true;
  if (readKnownNonUserRuntimeTokens().has(lower)) return true;
  const blockedLooseWords = new Set([
    "background", "bg", "weight", "width", "height", "price", "sellprice", "description", "desc", "effect", "effects",
    "image", "profileimage", "sdimage", "listimage", "entryimage", "frame", "scale", "color", "title", "text", "value",
    "opened", "hidden", "scheduleenabled", "openat", "closeat", "createdat", "updatedat"
  ]);
  if (blockedLooseWords.has(lower)) return true;
  if (/(?:background|weight|sellprice|description|profileimage|sdimage|listimage|entryimage|scheduleenabled|actionresults|relreq|adminmemo|npcprofile|corrosion|damage|reward|choice|option)/i.test(nextId) && !/@/.test(nextId)) return true;
  return false;
}

function isPlausibleAdminAccountId(id) {
  const nextId = normalizeUserIdText(id);
  if (!nextId || nextId.length > 80) return false;
  const lower = nextId.toLowerCase();
  if (isBlockedRuntimeUserToken(nextId) || isKnownNonUserRuntimeId(nextId)) return false;
  if (/^https?:\/\//i.test(nextId) || nextId.includes("/static/") || nextId.includes("data:image/")) return false;
  if (/[{}\[\]"'<>]/.test(nextId)) return false;
  if (/\.(?:json|png|jpe?g|gif|webp|svg|mp3|wav|css|js|html)$/i.test(nextId)) return false;
  if (!/[A-Za-z가-힣@]/.test(nextId)) return false;
  const blockedExact = new Set([
    "login", "auth", "registered", "register", "account", "accounts", "user", "users", "member", "members",
    "data", "rows", "items", "item", "shop", "investigation", "custom", "node", "npc", "battle", "reward",
    "actionresults", "clue", "json", "relreq", "memo", "note", "adminmemo",
    "로그인", "회원가입", "계정", "계정선택", "숫자", "아이템", "조사", "커스텀", "상점", "노드", "전투", "보상", "디자인", "테마", "관리인 메모", "관리인", "메모", "단서"
  ]);
  if (blockedExact.has(lower) || blockedExact.has(nextId)) return false;
  return true;
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
    "users", "accounts", "members", "owners", "data", "rows", "items", "characters", "design", "theme", "admin", "plc", "actionresults", "clue", "json", "relreq", "memo", "note", "adminmemo"
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
  if (!isPlausibleAdminAccountId(id)) return false;
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
    .filter((user) => user.id && user.id !== "PLC" && isPlausibleAdminAccountId(user.id))
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
      .filter((user) => user.id && user.id !== "PLC" && isPlausibleAdminAccountId(user.id));
    if (safeRows.length === 0) return;
    ["registeredUsers.json", "adminUserIndex.json", "allUserIds.json", "publicUserIndex.json"].forEach((filename) => {
      const indexPath = resolveDataPath(filename);
      const existingRows = readRuntimeArrayFromExactPath(indexPath);
      const mergedRows = normalizeRuntimeUserIndexRows(mergeRuntimeUsers(existingRows, safeRows));
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

const DAILY_INVESTIGATION_ATTEMPTS_PER_DAY = 1;
const DAILY_GAMBLE_COUNT_PER_DAY = 3;

function getSeoulDateKey(date = new Date()) {
  const base = date instanceof Date ? date : new Date(date);
  const shifted = new Date(base.getTime() + 9 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function getSeoulHourKey(date = new Date()) {
  const base = date instanceof Date ? date : new Date(date);
  const shifted = new Date(base.getTime() + 9 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 13);
}

function getSeoulHourText(date = new Date()) {
  const base = date instanceof Date ? date : new Date(date);
  const shifted = new Date(base.getTime() + 9 * 60 * 60 * 1000);
  return shifted.toISOString().slice(11, 13);
}

function getSeoulMinuteText(date = new Date()) {
  const base = date instanceof Date ? date : new Date(date);
  const shifted = new Date(base.getTime() + 9 * 60 * 60 * 1000);
  return shifted.toISOString().slice(14, 16);
}

const adminCharacterConfigPath = resolveDataPath("adminCharacterConfig.json");
const DEFAULT_ADMIN_CHARACTER_CONFIG = {
  hourlyCorrosionEnabled: false,
  hourlyCorrosionDecrease: 0,
  lastHourlyCorrosionAt: "",
};

function normalizeAdminCharacterConfig(config = {}) {
  const decrease = Math.max(0, Math.min(100, Number(config?.hourlyCorrosionDecrease || 0)));
  return {
    hourlyCorrosionEnabled: !!config?.hourlyCorrosionEnabled,
    hourlyCorrosionDecrease: decrease,
    lastHourlyCorrosionAt: String(config?.lastHourlyCorrosionAt || ""),
    updatedAt: Number(config?.updatedAt || 0),
  };
}

let adminCharacterConfigDB = normalizeAdminCharacterConfig(readJsonFromPath(adminCharacterConfigPath, DEFAULT_ADMIN_CHARACTER_CONFIG));

function saveAdminCharacterConfig() {
  adminCharacterConfigDB = normalizeAdminCharacterConfig({ ...adminCharacterConfigDB, updatedAt: Date.now() });
  scheduleJsonWrite(adminCharacterConfigPath, adminCharacterConfigDB);
}

function applyHourlyCorrosionDecreaseIfNeeded({ force = false } = {}) {
  try {
    adminCharacterConfigDB = normalizeAdminCharacterConfig(readJsonFromPath(adminCharacterConfigPath, adminCharacterConfigDB));
    const amount = Math.max(0, Math.min(100, Number(adminCharacterConfigDB.hourlyCorrosionDecrease || 0)));
    if (!force) {
      if (!adminCharacterConfigDB.hourlyCorrosionEnabled || amount <= 0) return false;
      if (getSeoulHourText() !== "00" || getSeoulMinuteText() !== "00") return false;
    }
    if (amount <= 0) return false;

    const dailyKey = getSeoulDateKey();
    if (!force && String(adminCharacterConfigDB.lastHourlyCorrosionAt || "") === dailyKey) return false;

    refreshProtectedRuntimeArraysIfNeeded();
    let changed = false;
    (Array.isArray(charactersDB) ? charactersDB : []).forEach((character) => {
      if (!character || typeof character !== "object") return;
      const before = Math.max(0, Math.min(100, Number(character.corrosion || 0)));
      const after = Math.max(0, before - amount);
      if (after !== before) {
        character.corrosion = after;
        character.updatedAt = Date.now();
        character.assetVersion = character.updatedAt;
        changed = true;
      }
    });

    adminCharacterConfigDB.lastHourlyCorrosionAt = dailyKey;
    saveAdminCharacterConfig();
    if (changed) {
      publicCharacterSummaryCache = null;
      writeRuntimeArray("characters.json", charactersDB);
    }
    return changed;
  } catch (error) {
    console.error("hourly corrosion decrease failed", error);
    return false;
  }
}

function normalizeDailyUseLimitsForCharacter(character, todayKey = getSeoulDateKey()) {
  if (!character || typeof character !== "object") return false;
  let changed = false;

  if (String(character.dailyAttemptsResetDate || "") !== todayKey) {
    character.dailyAttemptsLeft = DAILY_INVESTIGATION_ATTEMPTS_PER_DAY;
    character.dailyAttemptsResetDate = todayKey;
    changed = true;
  } else if (!Number.isFinite(Number(character.dailyAttemptsLeft))) {
    character.dailyAttemptsLeft = DAILY_INVESTIGATION_ATTEMPTS_PER_DAY;
    changed = true;
  }

  if (String(character.gambleCountResetDate || "") !== todayKey) {
    character.gambleCountLeft = DAILY_GAMBLE_COUNT_PER_DAY;
    character.gambleCountResetDate = todayKey;
    changed = true;
  } else if (!Number.isFinite(Number(character.gambleCountLeft))) {
    character.gambleCountLeft = DAILY_GAMBLE_COUNT_PER_DAY;
    changed = true;
  }

  return changed;
}

function refreshDailyUseLimitsForAllCharacters({ save = true, forceDiskRefresh = false } = {}) {
  try {
    if (forceDiskRefresh) refreshCharactersFromDiskIfNeeded({ force: true });
    const todayKey = getSeoulDateKey();
    let changed = false;
    (Array.isArray(charactersDB) ? charactersDB : []).forEach((character) => {
      if (normalizeDailyUseLimitsForCharacter(character, todayKey)) changed = true;
    });
    if (changed) {
      publicCharacterSummaryCache = null;
      if (save) writeRuntimeArray("characters.json", charactersDB);
      else markCharactersDirty();
    }
    return changed;
  } catch (error) {
    console.error("daily use limit refresh failed", error);
    return false;
  }
}

setInterval(() => refreshDailyUseLimitsForAllCharacters({ save: true }), 60 * 1000);
setInterval(() => applyHourlyCorrosionDecreaseIfNeeded(), 60 * 1000);

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
  // 운영 계정 선택은 실제 회원가입/로그인 계정 파일과 서버 색인만 사용합니다.
  // 조사/아이템/디자인 JSON을 깊게 훑으면 보상명·노드명 같은 값이 계정처럼 섞일 수 있습니다.
  return getDirectAdminAccountRows(searchText, { deep: false });
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

  const rows = mergeRuntimeUsers(
    ...directPaths.map(readRuntimeArrayFromExactPath),
    getOnlineRuntimeUserRows()
  )
    .filter(isDisplayableAdminAccount)
    .map((user) => ({
      id: getRuntimeAccountId(user) || getRuntimeUserId(user),
      type: user.type || user.role || "owner",
    }))
    .filter((user) => isPlausibleAdminAccountId(user.id));

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

function isDataAudio(value) {
  return typeof value === "string" && /^data:audio\/[a-zA-Z0-9.+-]+;base64,/.test(value);
}

function isDataAsset(value) {
  return isDataImage(value) || isDataAudio(value);
}

function isResolvableAssetValue(value) {
  return isDataAsset(value) || isAssetFileUrl(value);
}

function isResolvableImageValue(value) {
  if (isDataImage(value)) return true;
  if (!isAssetFileUrl(value)) return false;
  return /\.(png|jpe?g|gif|webp|svg)(?:$|[?#])/i.test(String(value || ""));
}

function isGeneratedCharacterAssetUrl(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (text.startsWith("/asset/character/")) return true;
  try {
    const parsed = new URL(text, "http://local.invalid");
    return parsed.pathname.startsWith("/asset/character/");
  } catch {
    return /\/asset\/character\//.test(text);
  }
}

function getGeneratedCharacterAssetPath(value) {
  const text = String(value || "").trim();
  if (!text || !isGeneratedCharacterAssetUrl(text)) return "";
  try {
    const parsed = new URL(text, "http://local.invalid");
    return parsed.searchParams.get("path") || "";
  } catch {
    const match = text.match(/[?&]path=([^&]+)/);
    if (!match) return "";
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1] || "";
    }
  }
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

function mapDesignAssets(source, makeUrl, currentPath = "") {
  if (Array.isArray(source)) return source.map((value, index) => mapDesignAssets(value, makeUrl, `${currentPath}[${index}]`));
  if (source && typeof source === "object") {
    return Object.fromEntries(
      Object.entries(source).map(([key, value]) => {
        const nextPath = currentPath ? `${currentPath}.${key}` : key;
        return [key, mapDesignAssets(value, makeUrl, nextPath)];
      })
    );
  }
  if (isDataAsset(source)) return makeUrl(currentPath, source);
  return source;
}

const DATA_IMAGE_RESPONSE_CACHE = new Map();
const DATA_IMAGE_RESPONSE_CACHE_LIMIT = Number(process.env.IMAGE_MEMORY_CACHE_LIMIT || 24);
let DATA_IMAGE_RESPONSE_CACHE_BYTES = 0;

function makeWeakEtagFromText(text) {
  const source = String(text || "");
  const headHash = source.slice(0, 80).split("").reduce((sum, ch) => (sum + ch.charCodeAt(0)) % 1000000007, 0).toString(36);
  return 'W/"' + source.length.toString(36) + '-' + headHash + '"';
}

function rememberDataImageCache(key, value) {
  const byteLength = Number(value?.byteLength || value?.buffer?.length || 0);
  if (!Number.isFinite(byteLength) || byteLength <= 0) return;
  if (byteLength > MAX_DATA_ASSET_MEMORY_CACHE_BYTES) return;
  if (DATA_IMAGE_RESPONSE_CACHE.has(key)) {
    const prev = DATA_IMAGE_RESPONSE_CACHE.get(key);
    DATA_IMAGE_RESPONSE_CACHE_BYTES -= Number(prev?.byteLength || prev?.buffer?.length || 0);
    DATA_IMAGE_RESPONSE_CACHE.delete(key);
  }
  DATA_IMAGE_RESPONSE_CACHE.set(key, { ...value, byteLength });
  DATA_IMAGE_RESPONSE_CACHE_BYTES += byteLength;
  while (DATA_IMAGE_RESPONSE_CACHE.size > DATA_IMAGE_RESPONSE_CACHE_LIMIT || DATA_IMAGE_RESPONSE_CACHE_BYTES > MAX_TOTAL_DATA_ASSET_MEMORY_CACHE_BYTES) {
    const firstKey = DATA_IMAGE_RESPONSE_CACHE.keys().next().value;
    const firstValue = DATA_IMAGE_RESPONSE_CACHE.get(firstKey);
    DATA_IMAGE_RESPONSE_CACHE_BYTES -= Number(firstValue?.byteLength || firstValue?.buffer?.length || 0);
    DATA_IMAGE_RESPONSE_CACHE.delete(firstKey);
  }
}

function reqFresh(req, etag) {
  const incoming = String(req?.headers?.["if-none-match"] || "");
  return incoming && incoming.split(",").map((part) => part.trim()).includes(etag);
}

function sendDataAsset(res, value) {
  if (isAssetFileUrl(value)) return sendAssetFileUrl(res, value);
  const raw = String(value || "");
  const match = raw.match(/^data:((?:image|audio)\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return res.status(404).end();
  const [, mime, payload] = match;
  const etag = makeWeakEtagFromText(raw);
  res.set("Cache-Control", "public, max-age=31536000, immutable");
  res.set("ETag", etag);
  res.set("Accept-Ranges", "bytes");
  res.type(mime);
  if (reqFresh(res.req, etag)) return res.status(304).end();

  const expectedBytes = Math.floor(String(payload || "").length * 0.75);
  const canCache = mime.startsWith("image/") && expectedBytes <= MAX_DATA_ASSET_MEMORY_CACHE_BYTES;
  let cached = canCache ? DATA_IMAGE_RESPONSE_CACHE.get(etag) : null;
  if (!cached) {
    cached = { mime, buffer: Buffer.from(payload, "base64") };
    if (canCache) rememberDataImageCache(etag, cached);
  }
  const range = String(res.req?.headers?.range || "");
  if (range) {
    const total = cached.buffer.length;
    const matchRange = range.match(/bytes=(\d*)-(\d*)/);
    if (matchRange) {
      const start = matchRange[1] ? Number(matchRange[1]) : 0;
      const end = matchRange[2] ? Number(matchRange[2]) : total - 1;
      if (Number.isFinite(start) && Number.isFinite(end) && start <= end && start < total) {
        const safeEnd = Math.min(end, total - 1);
        res.status(206);
        res.set("Content-Range", `bytes ${start}-${safeEnd}/${total}`);
        res.set("Content-Length", String(safeEnd - start + 1));
        return res.send(cached.buffer.subarray(start, safeEnd + 1));
      }
    }
  }
  return res.send(cached.buffer);
}

function sendDataImage(res, value) {
  return sendDataAsset(res, value);
}

function toCharacterAssetUrl(characterId, pathKey, version = "") {
  const base = `/asset/character/${encodeURIComponent(String(characterId || "unknown"))}?path=${encodeURIComponent(String(pathKey || ""))}`;
  return version ? `${base}&v=${encodeURIComponent(String(version))}` : base;
}

function toInvestigationAssetUrl(investigationId, pathKey) {
  return `/asset/investigation/${encodeURIComponent(String(investigationId || "unknown"))}?path=${encodeURIComponent(String(pathKey || ""))}`;
}

function toShopAssetUrl(itemId, pathKey, version = "") {
  const base = `/asset/shop/${encodeURIComponent(String(itemId || "unknown"))}?path=${encodeURIComponent(String(pathKey || ""))}`;
  return version ? `${base}&v=${encodeURIComponent(String(version))}` : base;
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

const DESIGN_MAPS_STORE_FILE = "designMaps.json";

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

designConfig = protectDesignMapsOnStartup(designConfig);

let publicDesignShellCache = null;
let publicDesignMapsCache = null;

const STAT_RULES = {
  baseHp: 100,
  hpPerPoint: 10,
  maxHp: 500,
  maxHpPoints: 40,
  baseCombat: 10,
  combatPerPoint: 4,
  maxCombatTotal: 110,
  maxCombatPoints: 25,
  defenseReductionPerPoint: 1.5,
  maxDefenseReductionPercent: 60,
  defendingDamageMultiplier: 0.65,
  criticalChancePerPoint: 1.2,
  maxCriticalChancePercent: 40,
  evasionChancePerPointGap: 0.6,
  baseEvasionChancePercent: 3,
  minEvasionChancePercent: 2,
  maxEvasionChancePercent: 20,
  criticalDamageMultiplier: 1.5,
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

function getCombatPointFromTotal(rawValue) {
  const value = Number(rawValue || 0);
  if (!Number.isFinite(value)) return 0;
  if (value > STAT_RULES.baseCombat) {
    return clampNumber(Math.round((value - STAT_RULES.baseCombat) / STAT_RULES.combatPerPoint), 0, STAT_RULES.maxCombatPoints);
  }
  return clampNumber(value, 0, STAT_RULES.maxCombatPoints);
}

function getDefenseReductionPercent(rawDef, guardBonus = 0) {
  const defPoint = getCombatPointFromTotal(rawDef);
  const bonusPercent = Math.max(0, Number(guardBonus || 0));
  return Math.min(STAT_RULES.maxDefenseReductionPercent, defPoint * STAT_RULES.defenseReductionPerPoint + bonusPercent);
}

function calculateDamageAfterDefense(rawDamage, rawDef, options = {}) {
  const baseDamage = Math.max(1, Number(rawDamage || 0));
  const reductionPercent = getDefenseReductionPercent(rawDef, options.guardBonus || 0);
  let damage = baseDamage * (1 - reductionPercent / 100);
  if (options.defending) damage *= STAT_RULES.defendingDamageMultiplier;
  return Math.max(1, Math.ceil(damage));
}

function calculateOutgoingDamage(rawAttack, rawDefense, multiplier = 1, flatPower = 0) {
  const attackPower = Math.max(1, Number(rawAttack || 0) * Number(multiplier || 1) + Number(flatPower || 0));
  return calculateDamageAfterDefense(attackPower, rawDefense);
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
  const guardBonus = typeof getBuffValue === "function" ? getBuffValue(defenderState, "guardUp") : 0;
  return calculateDamageAfterDefense(rawDamage, defenderState?.def, {
    guardBonus,
    defending: Boolean(defenderState?.defending),
  });
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
  if (typeof choice === "string") {
    const target = String(choice || "").trim();
    return { text: target ? "이동" : "", target };
  }
  const target = String(choice?.target || choice?.to || choice?.nodeId || choice?.node || choice?.id || choice?.value || "").trim();
  const text = String(choice?.text || choice?.label || choice?.name || choice?.title || (target ? "이동" : "")).trim();
  return { text, target };
}

function normalizeNodeChoices(node) {
  const choices = Array.isArray(node?.choices) ? node.choices : [];
  const legacyConnections = Array.isArray(node?.connections)
    ? node.connections
    : (node?.connections && typeof node.connections === "object"
      ? Object.entries(node.connections).map(([target, label]) => ({ target, text: typeof label === "string" ? label : "이동" }))
      : []);
  const list = choices.length ? choices : legacyConnections;
  return list.map(normalizeChoice).filter((choice) => choice.text && choice.target);
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
                rewardExp: Number(option?.rewardExp || 0),
                rewardCoins: Number(option?.rewardCoins || 0),
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
    rewardExp: Number(result?.rewardExp ?? result?.exp ?? 0),
    rewardCoins: Number(result?.rewardCoins ?? result?.coins ?? 0),
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
    unlockToken: String(result?.unlockToken || result?.unlock_token || result?.unlockKey || result?.requiredKey || "").trim(),
    unlockLabel: String(result?.unlockLabel || result?.unlockName || result?.keyName || "").trim(),
  };
}

function normalizeInvestigationUnlockToken(value) {
  return String(value || "").trim();
}

function getNodeRequiredUnlockToken(node) {
  return normalizeInvestigationUnlockToken(
    node?.requiredUnlockToken ||
    node?.required_unlock_token ||
    node?.requiredKey ||
    node?.required_key ||
    node?.unlockToken ||
    node?.unlock_token ||
    ""
  );
}

function getNodeLockedMessage(node) {
  return String(node?.lockedMessage || node?.description_locked || node?.lockedLog || "잠겨 있습니다. 필요한 열쇠를 먼저 획득해야 합니다.").trim() || "잠겨 있습니다. 필요한 열쇠를 먼저 획득해야 합니다.";
}

function ensureInvestigationUnlockState(item) {
  if (!item) return;
  if (!Array.isArray(item.unlockedTokens)) item.unlockedTokens = [];
  if (!Array.isArray(item.unlockedNodeIds)) item.unlockedNodeIds = [];
}

function hasInvestigationUnlockToken(item, token) {
  const safeToken = normalizeInvestigationUnlockToken(token);
  if (!safeToken) return false;
  ensureInvestigationUnlockState(item);
  return item.unlockedTokens.some((value) => normalizeInvestigationUnlockToken(value) === safeToken);
}

function isInvestigationNodeManuallyUnlocked(item, nodeId) {
  const safeNodeId = String(nodeId || "").trim();
  if (!safeNodeId) return false;
  ensureInvestigationUnlockState(item);
  return item.unlockedNodeIds.some((value) => String(value || "").trim() === safeNodeId);
}

function isInvestigationNodeLockEnabled(node) {
  if (!node) return false;
  return !!(node.locked || node.isLocked || node.requiredKey || node.required_key || node.requiredUnlockToken || node.required_unlock_token || node.unlockToken || node.unlock_token);
}

function getInvestigationNodeLockInfo(item, node, nodeId) {
  ensureInvestigationUnlockState(item);
  if (!isInvestigationNodeLockEnabled(node)) return { locked: false, message: "", requiredToken: "", unlockedNow: false };
  const requiredToken = getNodeRequiredUnlockToken(node);
  if (isInvestigationNodeManuallyUnlocked(item, nodeId)) return { locked: false, message: "", requiredToken, unlockedNow: false };
  if (requiredToken && hasInvestigationUnlockToken(item, requiredToken)) {
    const safeNodeId = String(nodeId || "").trim();
    if (safeNodeId && !item.unlockedNodeIds.includes(safeNodeId)) item.unlockedNodeIds.push(safeNodeId);
    return { locked: false, message: "", requiredToken, unlockedNow: true };
  }
  return { locked: true, message: getNodeLockedMessage(node), requiredToken, unlockedNow: false };
}

function getCurrentInvestigationNodeLockInfo(item) {
  if (!item) return { locked: false, message: "", requiredToken: "", unlockedNow: false };
  const node = item.data?.nodes?.[item.currentNodeId];
  return getInvestigationNodeLockInfo(item, node, item.currentNodeId);
}

function grantInvestigationUnlockToken(item, token, label = "") {
  const safeToken = normalizeInvestigationUnlockToken(token);
  if (!item || !safeToken) return false;
  ensureInvestigationUnlockState(item);
  if (item.unlockedTokens.some((value) => normalizeInvestigationUnlockToken(value) === safeToken)) return false;
  item.unlockedTokens.push(safeToken);
  const displayLabel = String(label || safeToken).trim();
  if (!Array.isArray(item.foundItems)) item.foundItems = [];
  if (displayLabel && !item.foundItems.includes(displayLabel)) item.foundItems.push(displayLabel);
  setEventBanner(item, `${displayLabel} 획득`, "success", 2400);
  return true;
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
    rewardExp: Number(enemy?.rewardExp ?? enemy?.expReward ?? 0),
    rewardCoins: Number(enemy?.rewardCoins ?? enemy?.coinReward ?? 0),
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
    rewardExp: Number(battle?.rewardExp ?? enemies.reduce((sum, enemy) => sum + Number(enemy.rewardExp || 0), 0)),
    rewardCoins: Number(battle?.rewardCoins ?? enemies.reduce((sum, enemy) => sum + Number(enemy.rewardCoins || 0), 0)),
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
    choices: normalizeNodeChoices(node),
    npc: Array.isArray(node.npc) ? node.npc : [],
    npcScene: normalizeNpcScene(node.npcScene),
    clues: Array.isArray(node.clues) ? node.clues.map(normalizeClue) : [],
    onEnterDamage: Number(node?.onEnterDamage || 0),
    onEnterMuteMinutes: Number(node?.onEnterMuteMinutes || 0),
    locked: !!(node?.locked || node?.isLocked),
    requiredUnlockToken: getNodeRequiredUnlockToken(node),
    lockedMessage: getNodeLockedMessage(node),
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
    unlockedTokens: [],
    unlockedNodeIds: [],
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

const investigationDefinitions = [];


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
    unlockedTokens: Array.isArray(persistedItem.unlockedTokens) ? persistedItem.unlockedTokens : (Array.isArray(baseItem.unlockedTokens) ? baseItem.unlockedTokens : []),
    unlockedNodeIds: Array.isArray(persistedItem.unlockedNodeIds) ? persistedItem.unlockedNodeIds : (Array.isArray(baseItem.unlockedNodeIds) ? baseItem.unlockedNodeIds : []),
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

function hasInvestigationRuntimeHistory(entry) {
  if (!entry || typeof entry !== "object") return false;
  if (isDailyRuntimeInstance(entry)) return false;
  if (entry.started || entry.ended) return true;
  if (Array.isArray(entry.sharedLogs) && entry.sharedLogs.length > 1) return true;
  if (Array.isArray(entry.routeHistory) && entry.routeHistory.length > 1) return true;
  if (Array.isArray(entry.participants) && entry.participants.length > 0) return true;
  if (Array.isArray(entry.foundItems) && entry.foundItems.length > 0) return true;
  if (Array.isArray(entry.foundNPCs) && entry.foundNPCs.length > 0) return true;
  if (Array.isArray(entry.rewards) && entry.rewards.length > 0) return true;
  if (entry.discoveredFlags && typeof entry.discoveredFlags === "object" && Object.keys(entry.discoveredFlags).length > 0) return true;
  if (entry.participantStates && typeof entry.participantStates === "object" && Object.keys(entry.participantStates).length > 0) return true;
  return false;
}

function rehydrateInvestigationsFromRuntime(persistedOverride = null) {
  const persisted = Array.isArray(persistedOverride) ? persistedOverride : readRuntimeArray("investigations.json");
  if (!Array.isArray(persisted) || !persisted.length) return;
  const existingIds = new Set(investigationsDB.map((item) => String(item?.id || "")));
  investigationsDB = investigationsDB.map((item) => {
    const saved = persisted.find((entry) => String(entry?.id) === String(item?.id));
    return saved ? mergePersistedInvestigationState(item, saved) : item;
  });
  persisted.forEach((saved) => {
    const savedId = String(saved?.id || "");
    if (!savedId || existingIds.has(savedId)) return;
    if (!hasInvestigationRuntimeHistory(saved)) return;
    investigationsDB.push(saved);
    existingIds.add(savedId);
  });
}

rehydrateInvestigationsFromRuntime();

function getAccountKey(user) {
  return user?.ownerId || user?.id || user?.name || "unknown";
}
function getDisplayName(user) {
  return user?.id || user?.name || "알 수 없음";
}

function getProgressActionLabelsFromNode(node) {
  if (!node || typeof node !== "object") return [];
  const directLabels = (Array.isArray(node.investigations) ? node.investigations : [])
    .map((action) => {
      if (typeof action === "string") return action;
      return action?.name || action?.text || action?.label || action?.title || action?.action || "";
    })
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  if (directLabels.length > 0) return Array.from(new Set(directLabels));
  return Object.keys(node.actionResults || {})
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function getProgressFlagKey(nodeId, actionName) {
  return `${nodeId}:${actionName}`;
}

function getProgressReachableNodeIds(item) {
  const nodes = item?.data?.nodes || {};
  const allNodeIds = Object.keys(nodes).filter(Boolean);
  if (allNodeIds.length === 0) return [];
  const startNodeId = String(item?.data?.start || allNodeIds[0] || "").trim();
  const start = nodes[startNodeId] ? startNodeId : allNodeIds[0];
  const reachable = new Set();
  const stack = [start];
  while (stack.length > 0) {
    const nodeId = stack.pop();
    if (!nodeId || reachable.has(nodeId) || !nodes[nodeId]) continue;
    reachable.add(nodeId);
    (Array.isArray(nodes[nodeId]?.choices) ? nodes[nodeId].choices : []).forEach((choice) => {
      const target = String(choice?.target || "").trim();
      if (target && nodes[target] && !reachable.has(target)) stack.push(target);
    });
  }
  return reachable.size > 0 ? Array.from(reachable) : allNodeIds;
}

function getInvestigationProgressMeta(item) {
  const nodes = item?.data?.nodes || {};
  const progressNodeIds = getProgressReachableNodeIds(item);
  const progressNodeIdSet = new Set(progressNodeIds);
  const totalNodeCount = progressNodeIds.length;
  const visitedNodeCount = Array.from(new Set((item?.routeHistory || []).map((entry) => entry?.nodeId).filter(Boolean))).filter((nodeId) => progressNodeIdSet.has(nodeId)).length;
  const totalInvestigationActionCount = progressNodeIds.reduce((sum, nodeId) => {
    return sum + getProgressActionLabelsFromNode(nodes[nodeId]).length;
  }, 0);
  const completedInvestigationActionCount = progressNodeIds.reduce((sum, nodeId) => {
    const node = nodes[nodeId];
    return sum + getProgressActionLabelsFromNode(node).filter((actionName) => item?.discoveredFlags?.[getProgressFlagKey(nodeId, actionName)]).length;
  }, 0);
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
    unlockedTokens: item.unlockedTokens || [],
    unlockedNodeIds: item.unlockedNodeIds || [],
    currentNodeLock: getCurrentInvestigationNodeLockInfo(item),
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
  try {
    syncInvestigationRoster(item);
    const payload = buildPublicInvestigationState(item);
    if (!payload) return;
    io.to(String(investigationId)).emit("investigationStateUpdated", payload);
  } catch (err) {
    console.error("emitInvestigationState failed", err);
  }
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

const DAILY_INSTANCE_SEPARATOR = "__daily__";

function safeDailyOwnerSuffix(ownerKey = "") {
  const raw = String(ownerKey || "daily");
  try {
    return Buffer.from(raw).toString("base64url").slice(0, 72) || "daily";
  } catch {
    return raw.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 72) || "daily";
  }
}

function isDailyRuntimeInstance(item) {
  return !!(item && item.type === "daily" && item.dailyRuntimeInstance);
}

function getDailySourceId(itemOrId) {
  if (itemOrId && typeof itemOrId === "object") {
    return String(itemOrId.dailySourceId || itemOrId.sourceTemplateId || itemOrId.templateId || itemOrId.id || "");
  }
  const text = String(itemOrId || "");
  return text.includes(DAILY_INSTANCE_SEPARATOR) ? text.split(DAILY_INSTANCE_SEPARATOR)[0] : text;
}

function findDailyRuntimeInstance(sourceId, ownerKey) {
  return investigationsDB.find((entry) =>
    isDailyRuntimeInstance(entry) &&
    String(entry.dailySourceId || "") === String(sourceId || "") &&
    String(entry.dailyOwnerKey || "") === String(ownerKey || "")
  );
}

function findActiveDailyRuntimeInstanceByOwner(ownerKey) {
  return investigationsDB.find((entry) =>
    isDailyRuntimeInstance(entry) &&
    String(entry.dailyOwnerKey || "") === String(ownerKey || "") &&
    !!entry.started &&
    !entry.ended
  );
}

function getPersistableInvestigations() {
  return investigationsDB.filter((entry) => !isDailyRuntimeInstance(entry));
}

function getOrCreateDailyRuntimeInstance(templateItem, sourceCharacter) {
  if (!templateItem || templateItem.type !== "daily" || !sourceCharacter) return null;
  const sourceId = getDailySourceId(templateItem);
  const ownerKey = getDailyOwnerKey(sourceCharacter);
  const existing = findDailyRuntimeInstance(sourceId, ownerKey);
  if (existing) {
    existing.opened = templateItem.opened;
    existing.scheduleEnabled = !!templateItem.scheduleEnabled;
    existing.openAt = String(templateItem.openAt || "");
    existing.closeAt = String(templateItem.closeAt || "");
    existing.hidden = true;
    return existing;
  }

  const templateSource = clone(templateItem.originalTemplate || getInvestigationTemplateById(sourceId) || {
    id: sourceId,
    title: templateItem.title,
    type: "daily",
    data: templateItem.data,
  });
  const instanceId = `${sourceId}${DAILY_INSTANCE_SEPARATOR}${safeDailyOwnerSuffix(ownerKey)}`;
  templateSource.id = instanceId;
  templateSource.title = templateItem.title || templateSource.title || "일일조사";
  templateSource.type = "daily";
  templateSource.listImage = templateItem.listImage || templateSource.listImage || templateItem.data?.listImage || "";
  templateSource.entryImage = templateItem.entryImage || templateSource.entryImage || templateItem.listImage || templateItem.data?.entryImage || "";
  templateSource.listImageFrame = templateItem.listImageFrame || templateSource.listImageFrame;
  templateSource.entryImageFrame = templateItem.entryImageFrame || templateSource.entryImageFrame || templateSource.listImageFrame;
  templateSource.imageUpdatedAt = Number(templateItem.imageUpdatedAt || templateSource.imageUpdatedAt || 0);
  templateSource.entryCorrosion = Number(templateItem.entryCorrosion ?? templateSource.entryCorrosion ?? templateItem.data?.entryCorrosion ?? 0);
  templateSource.endCorrosion = Number(templateItem.endCorrosion ?? templateSource.endCorrosion ?? templateItem.data?.endCorrosion ?? 0);
  templateSource.bgmUrl = String(templateItem.bgmUrl || templateSource.bgmUrl || templateItem.data?.bgmUrl || "");
  templateSource.bgmVolume = Number(templateItem.bgmVolume ?? templateSource.bgmVolume ?? templateItem.data?.bgmVolume ?? 1);
  templateSource.opened = templateItem.opened;
  templateSource.hidden = true;
  templateSource.scheduleEnabled = !!templateItem.scheduleEnabled;
  templateSource.openAt = String(templateItem.openAt || "");
  templateSource.closeAt = String(templateItem.closeAt || "");

  const instance = buildInvestigation(templateSource);
  instance.dailyRuntimeInstance = true;
  instance.dailySourceId = sourceId;
  instance.dailyOwnerKey = ownerKey;
  instance.dailyResumeOwnerKey = "";
  instance.hidden = true;
  instance.opened = templateItem.opened;
  instance.scheduleEnabled = !!templateItem.scheduleEnabled;
  instance.openAt = String(templateItem.openAt || "");
  instance.closeAt = String(templateItem.closeAt || "");
  instance.originalTemplate = clone(templateSource);
  investigationsDB.push(instance);
  return instance;
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
  if (!Array.isArray(item.unlockedTokens)) item.unlockedTokens = [];
  if (!Array.isArray(item.unlockedNodeIds)) item.unlockedNodeIds = [];
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
  item.unlockedTokens = [];
  item.unlockedNodeIds = [];
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

function saveInvestigationsRuntimeState() {
  try {
    writeRuntimeArray("investigations.json", getPersistableInvestigations());
  } catch {}
}

function syncInvestigationParticipantHpToCharacters(item) {
  if (!item || !item.participantStates) return false;
  const participants = Array.isArray(item.participants) ? item.participants : [];
  let changed = false;
  participants.filter(isInvestigationPlayableParticipant).forEach((participant) => {
    const state = item.participantStates?.[participant.name];
    if (!state) return;
    const char = charactersDB.find((character) => String(character?.id || "") === String(participant?.id || ""))
      || charactersDB.find((character) => String(character?.name || "") === String(participant?.name || ""));
    if (!char) return;
    const maxHp = getCharacterMaxHp(char?.stats?.hp);
    if (Number(state.hp || 0) <= 0) return;
    const nextHp = Math.max(0, Math.min(maxHp, Number(state.hp || 0)));
    if (Number(char.currentHp ?? maxHp) !== nextHp) {
      char.currentHp = nextHp;
      changed = true;
    }
  });
  if (changed) {
    markCharactersDirty();
    writeRuntimeArray("characters.json", charactersDB);
  }
  return changed;
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
  setEventBanner(item, reason === "전멸" ? "패배" : "조사가 종료되었습니다", reason === "전멸" ? "danger" : "success", 3600);
  applyFaintedEndRecovery(item);
  syncInvestigationParticipantHpToCharacters(item);
  applyInvestigationEndCorrosion(item);
  saveInvestigationsRuntimeState();
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

function normalizeProgressRewardValue(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.floor(numeric);
}

function applyProgressRewardToCharacter(char, expReward = 0, coinReward = 0) {
  if (!char) return false;
  const exp = normalizeProgressRewardValue(expReward);
  const coins = normalizeProgressRewardValue(coinReward);
  let changed = false;
  if (exp > 0) {
    char.exp = Number(char.exp || 0) + exp;
    while (char.exp >= (char.level || 1) * 100) {
      char.exp -= (char.level || 1) * 100;
      char.level = Number(char.level || 1) + 1;
      char.statPoints = Number(char.statPoints || 0) + 3;
    }
    changed = true;
  }
  if (coins > 0) {
    char.coins = Number(char.coins || 0) + coins;
    changed = true;
  }
  if (changed) {
    char.updatedAt = Date.now();
    char.assetVersion = char.updatedAt;
  }
  return changed;
}

function getParticipantStateByName(item, participant) {
  if (!item || !participant) return null;
  const name = String(participant?.name || "").trim();
  if (!name) return null;
  return item.participantStates?.[name] || null;
}

function isInvestigationRewardEligibleParticipant(item, participant) {
  if (!isInvestigationPlayableParticipant(participant)) return false;
  if (String(item?.type || "group") !== "group") return true;
  const state = getParticipantStateByName(item, participant);
  if (state && Number(state.hp || 0) <= 0) return false;
  return true;
}

function grantProgressRewardsToInvestigationParticipants(item, expReward = 0, coinReward = 0) {
  const exp = normalizeProgressRewardValue(expReward);
  const coins = normalizeProgressRewardValue(coinReward);
  if (!item || (exp <= 0 && coins <= 0)) return 0;
  ensureRuntimeState(item);
  const receivers = (Array.isArray(item.participants) ? item.participants : []).filter((participant) => isInvestigationRewardEligibleParticipant(item, participant));
  let changedCount = 0;
  receivers.forEach((participant) => {
    const char = charactersDB.find((c) => String(c.id) === String(participant.id)) || charactersDB.find((c) => String(c.name) === String(participant.name));
    if (!char) return;
    if (applyProgressRewardToCharacter(char, exp, coins)) changedCount += 1;
  });
  if (changedCount > 0) {
    markCharactersDirty();
    writeRuntimeArray("characters.json", charactersDB);
    emitParticipantsUpdated();
  }
  return changedCount;
}

function applyRewardToCharacter(char, reward) {
  if (!char || !reward) return false;
  let changed = false;
  if (reward.type === "item" && reward.value) {
    char.items = Array.isArray(char.items) ? [...char.items, reward.value] : [reward.value];
    changed = true;
  }
  if ((reward.type === "statPoints" || reward.type === "stat" || reward.type === "stat_points") && reward.value !== undefined) {
    char.statPoints = Number(char.statPoints || 0) + Number(reward.value || 0);
    changed = true;
  }
  if ((reward.type === "exp" || reward.type === "experience") && reward.value !== undefined) {
    changed = applyProgressRewardToCharacter(char, Number(reward.value || 0), 0) || changed;
  }
  if ((reward.type === "coin" || reward.type === "coins") && reward.value !== undefined) {
    changed = applyProgressRewardToCharacter(char, 0, Number(reward.value || 0)) || changed;
  }
  if (changed) {
    char.updatedAt = Date.now();
    char.assetVersion = char.updatedAt;
  }
  return changed;
}

function getInvestigationRewardItemName(value, fallback = "") {
  const key = String(value || "").trim();
  if (!key) return String(fallback || "아이템");
  const found = (shopItemsDB || []).find((entry) => {
    const candidates = [entry?.id, entry?.itemId, entry?.key, entry?.name, entry?.title].map((candidate) => String(candidate || "").trim());
    return candidates.includes(key);
  });
  return String(found?.name || found?.title || fallback || key);
}

function normalizeInvestigationReward(reward) {
  if (!reward) return reward;
  if (reward.type !== "item") return reward;
  const label = getInvestigationRewardItemName(reward.value || reward.label, reward.label || reward.value || "아이템");
  return { ...reward, label };
}

function queueRewardAssignment(item, reward) {
  if (!reward) return;
  const safeReward = normalizeInvestigationReward(reward);
  if (safeReward.type === "item" && safeReward.value) {
    if (!Array.isArray(item.foundItems)) item.foundItems = [];
    const displayName = safeReward.label || getInvestigationRewardItemName(safeReward.value, safeReward.value);
    if (!item.foundItems.includes(displayName)) item.foundItems.push(displayName);
    setEventBanner(item, `${displayName} 획득`, "success", 2400);
  }
  if (item?.type === "daily") {
    const receiver = (item.participants || [])[0];
    const char = receiver ? (charactersDB.find((c) => String(c.id) === String(receiver.id)) || charactersDB.find((c) => c.name === receiver.name)) : null;
    if (char) {
      if (applyRewardToCharacter(char, safeReward)) {
        markCharactersDirty();
        writeRuntimeArray("characters.json", charactersDB);
      }
      addSharedLog(item, `[획득] ${receiver.name}이(가) ${safeReward.label}을(를) 받았습니다.`);
      item.pendingReward = null;
      item.pendingRewardQueue = [];
      saveInvestigationsRuntimeState();
      emitParticipantsUpdated();
      emitInvestigationState(item.id);
      return;
    }
  }
  if (!Array.isArray(item.pendingRewardQueue)) item.pendingRewardQueue = [];
  if (!item.pendingReward) {
    item.pendingReward = safeReward;
    return;
  }
  item.pendingRewardQueue.push(safeReward);
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
      if (!state || Number(state.hp || 0) <= 0) return;
      state.mutedUntil = until;
      setParticipantActionLock(state, until);
    });
    addSharedLog(item, `[디버프] ${node.name} 진입 효과로 ${Number(node.onEnterMuteMinutes || 0)}분간 기절 상태가 됩니다.`);
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

  const rewardExp = normalizeProgressRewardValue(result.rewardExp ?? result.exp ?? 0);
  const rewardCoins = normalizeProgressRewardValue(result.rewardCoins ?? result.coins ?? 0);
  if (rewardExp > 0 || rewardCoins > 0) {
    const receiverCount = grantProgressRewardsToInvestigationParticipants(item, rewardExp, rewardCoins);
    if (receiverCount > 0) {
      const rewardTexts = [];
      if (rewardExp > 0) rewardTexts.push(`경험치 +${rewardExp}`);
      if (rewardCoins > 0) rewardTexts.push(`코인 +${rewardCoins}`);
      textParts.push(`${rewardTexts.join(", ")} 지급`);
      changed = true;
    }
  }

  if (result.unlockToken) {
    const displayKeyName = result.unlockLabel || result.unlockToken;
    const unlockedNow = grantInvestigationUnlockToken(item, result.unlockToken, displayKeyName);
    textParts.push(unlockedNow ? `해금 열쇠 획득: ${displayKeyName}` : `이미 보유한 해금 열쇠: ${displayKeyName}`);
    changed = true;
  }

  if (result.item) {
    const itemReward = normalizeInvestigationReward({ type: "item", label: result.itemName || result.itemLabel || result.item, value: result.item });
    queueRewardAssignment(item, itemReward);
    textParts.push(item?.type === "daily" ? `${itemReward.label}을(를) 획득했습니다!` : `${itemReward.label}을(를) 획득했습니다. 누구에게 지급하시겠습니까?`);
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
      if (!state || Number(state.hp || 0) <= 0) return;
      state.mutedUntil = until;
      setParticipantActionLock(state, until);
    });
    textParts.push(`${result.muteMinutes}분간 기절`);
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

function setParticipantActionLock(state, until) {
  if (!state || !Number.isFinite(Number(until)) || Number(until) <= Date.now()) return;
  state.actionLockedUntil = Math.max(Number(state.actionLockedUntil || 0), Number(until));
  state.stunnedUntil = Math.max(Number(state.stunnedUntil || 0), Number(until));
  state.defending = false;
}

function getParticipantActionLockUntil(state) {
  if (!state || Number(state.hp || 0) <= 0) return 0;
  return Math.max(Number(state.actionLockedUntil || 0), Number(state.stunnedUntil || 0));
}

function getInvestigationActionLockInfo(item) {
  const now = Date.now();
  const participants = Array.isArray(item?.participants) ? item.participants : [];
  const states = item?.participantStates || {};
  const until = participants.reduce((maxUntil, participant) => {
    if (!isInvestigationPlayableParticipant(participant)) return maxUntil;
    const state = states?.[participant.name];
    const lockedUntil = getParticipantActionLockUntil(state);
    return lockedUntil > now ? Math.max(maxUntil, lockedUntil) : maxUntil;
  }, 0);
  return { locked: until > now, until, remainingSeconds: until > now ? Math.ceil((until - now) / 1000) : 0 };
}

function getActionLockMessage(lockInfo) {
  const seconds = Math.max(0, Number(lockInfo?.remainingSeconds || 0));
  const minuteText = seconds >= 60 ? `${Math.ceil(seconds / 60)}분` : `${seconds}초`;
  return `현재 기절 상태입니다. ${minuteText} 후 행동할 수 있습니다.`;
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
  const currentNodeId = String(item?.currentNodeId || "");
  for (let index = history.length - 2; index >= 0; index -= 1) {
    const nodeId = String(history[index]?.nodeId || "");
    if (nodeId && nodeId !== currentNodeId) return nodeId;
  }
  return item?.data?.start;
}

function isBacktrackTargetFromCurrentLockedNode(item, targetNodeId) {
  const safeTargetNodeId = String(targetNodeId || "").trim();
  if (!item || !safeTargetNodeId) return false;
  const currentLock = getCurrentInvestigationNodeLockInfo(item);
  if (!currentLock.locked) return false;
  if (!canMoveBetweenNodes(item, item.currentNodeId, safeTargetNodeId)) return false;
  const currentNodeId = String(item.currentNodeId || "");
  const history = Array.isArray(item.routeHistory) ? item.routeHistory : [];
  const visitedBeforeCurrent = history
    .slice(0, Math.max(0, history.length - 1))
    .some((entry) => String(entry?.nodeId || "") === safeTargetNodeId);
  if (visitedBeforeCurrent) return true;
  const previousRouteNodeId = String(getPreviousRouteNodeId(item) || "");
  return !!previousRouteNodeId && previousRouteNodeId !== currentNodeId && previousRouteNodeId === safeTargetNodeId;
}

const PRESET_BATTLE_HEAL_ITEMS = {
  "응급 붕대": 18,
  "소독약": 24,
};

function parseBattleItemPayload(payload) {
  const text = String(payload || "").trim();
  if (!text) return { source: "", index: -1, key: "" };
  try {
    const parsed = JSON.parse(decodeURIComponent(text));
    return {
      source: String(parsed?.source || "").trim(),
      index: Number.isInteger(Number(parsed?.index)) ? Number(parsed.index) : -1,
      key: String(parsed?.key || parsed?.name || parsed?.label || "").trim(),
    };
  } catch {
    return { source: "", index: -1, key: text };
  }
}

function getBattleHealItemMeta(value) {
  const key = getInventoryItemKey(value);
  const label = String(key || value || "").trim();
  if (Object.prototype.hasOwnProperty.call(PRESET_BATTLE_HEAL_ITEMS, label)) {
    return { key: label, label, heal: PRESET_BATTLE_HEAL_ITEMS[label], preset: true };
  }
  const shopItem = findShopItemByLooseId(label);
  if (!shopItem) return null;
  const normalized = normalizeShopItem(shopItem);
  const useType = String(normalized.useType || "").toLowerCase();
  if (!(useType === "heal" || useType === "hp")) return null;
  const rawUseValue = Number(normalized.useValue);
  const healValue = Number.isFinite(rawUseValue) && rawUseValue !== 0 ? rawUseValue : 10;
  return {
    key: String(normalized.id || normalized.name || label).trim(),
    label: String(normalized.name || label || "회복 아이템").trim(),
    heal: healValue,
    preset: false,
  };
}

function battleItemMatchesRequested(value, requestedKey) {
  const meta = getBattleHealItemMeta(value);
  if (!meta) return false;
  const key = String(requestedKey || "").trim();
  if (!key) return true;
  return inventoryItemMatches(value, key) || inventoryItemMatches(meta.key, key) || inventoryItemMatches(meta.label, key);
}

function findCharacterForBattleState(item, state) {
  const participant = (Array.isArray(item?.participants) ? item.participants : []).find((entry) => String(entry?.name || "") === String(state?.name || ""));
  return charactersDB.find((character) => participant?.id && String(character?.id || "") === String(participant.id))
    || charactersDB.find((character) => String(character?.name || "") === String(state?.name || ""));
}

function consumeFoundBattleItem(item, request) {
  item.foundItems = Array.isArray(item.foundItems) ? item.foundItems : [];
  const requestedKey = String(request?.key || "").trim();
  const requestedIndex = Number(request?.index);
  let index = request?.source === "found" && Number.isInteger(requestedIndex) && requestedIndex >= 0 && requestedIndex < item.foundItems.length
    ? requestedIndex
    : -1;
  if (index >= 0 && !battleItemMatchesRequested(item.foundItems[index], requestedKey)) index = -1;
  if (index < 0) index = item.foundItems.findIndex((value) => battleItemMatchesRequested(value, requestedKey));
  if (index < 0) return null;
  const value = item.foundItems[index];
  const meta = getBattleHealItemMeta(value);
  if (!meta) return null;
  item.foundItems.splice(index, 1);
  return { ...meta, source: "found" };
}

function consumeInventoryBattleItem(item, state, request) {
  const char = findCharacterForBattleState(item, state);
  if (!char) return null;
  char.items = Array.isArray(char.items) ? char.items : [];
  const requestedKey = String(request?.key || "").trim();
  const requestedIndex = Number(request?.index);
  let index = request?.source === "inventory" && Number.isInteger(requestedIndex) && requestedIndex >= 0 && requestedIndex < char.items.length
    ? requestedIndex
    : -1;
  if (index >= 0 && !battleItemMatchesRequested(char.items[index], requestedKey)) index = -1;
  if (index < 0) index = char.items.findIndex((value) => battleItemMatchesRequested(value, requestedKey));
  if (index < 0) return null;
  const value = char.items[index];
  const meta = getBattleHealItemMeta(value);
  if (!meta) return null;
  char.items.splice(index, 1);
  char.updatedAt = Date.now();
  char.assetVersion = char.updatedAt;
  return { ...meta, source: "inventory", character: char };
}

function consumeBattleItem(item, state, payload) {
  const request = parseBattleItemPayload(payload);
  let consumed = null;
  if (request.source === "inventory") {
    consumed = consumeInventoryBattleItem(item, state, request) || consumeFoundBattleItem(item, request);
  } else if (request.source === "found") {
    consumed = consumeFoundBattleItem(item, request) || consumeInventoryBattleItem(item, state, request);
  } else {
    consumed = consumeFoundBattleItem(item, request) || consumeInventoryBattleItem(item, state, request);
  }

  if (!consumed) return { text: `${state.name}은(는) 사용할 수 있는 전투용 회복 아이템이 없었습니다.`, changed: false };
  const heal = Number(consumed.heal || 0);
  const nextHp = Math.max(0, Math.min(Number(state.maxHp || 0), Number(state.hp || 0) + heal));
  state.hp = nextHp;
  if (consumed.character) {
    consumed.character.currentHp = Math.max(0, Math.min(getCharacterMaxHp(consumed.character?.stats?.hp), Number(state.hp || 0)));
    markCharactersDirty();
    writeRuntimeArray("characters.json", charactersDB);
  }
  const amount = Math.abs(heal);
  const effectText = heal < 0 ? `HP ${amount} 감소했습니다.` : `HP ${amount} 회복했습니다.`;
  return { text: `${state.name}은(는) ${consumed.label}을(를) 사용해 ${effectText}`, changed: true };
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
function findCharacterForBattleActor(actorName) {
  const name = String(actorName || "").trim();
  if (!name) return null;
  return (charactersDB || []).find((character) => String(character?.name || "").trim() === name) || null;
}
function findLearnedBattleSkill(actorName, skillKey) {
  const character = findCharacterForBattleActor(actorName);
  const key = String(skillKey || "").trim();
  if (!character || !key || !Array.isArray(character.skills)) return null;
  const normalizedKey = normalizeSkillKey(key);
  return character.skills.find((skill) => {
    const values = typeof skill === "string" ? [skill] : [skill?.key, skill?.skillKey, skill?.name, skill?.label, skill?.useValue];
    return values.map((value) => String(value || "").trim()).some((value) => value && (value === key || value === normalizedKey || value.toLowerCase() === key.toLowerCase()));
  }) || null;
}
function getSkillSpec(skillKey, actorName = "") {
  const requestedKey = String(skillKey || "").trim();
  const key = normalizeSkillKey(requestedKey);
  const learned = findLearnedBattleSkill(actorName, requestedKey);
  const learnedKey = typeof learned === "string" ? learned : String(learned?.key || learned?.skillKey || learned?.name || learned?.label || learned?.useValue || "").trim();
  const catalog = (shopItemsDB || []).find((item) => item?.useType === "skill" && [item.skillKey, item.useValue, item.skillName, item.name].map((v) => String(v || "").trim()).includes(requestedKey));
  const catalogKey = catalog ? normalizeSkillKey(catalog.skillKey || catalog.useValue || catalog.skillName || catalog.name) : "";
  const baseKey = PRESET_SKILLS[key] ? key : (PRESET_SKILLS[normalizeSkillKey(learnedKey)] ? normalizeSkillKey(learnedKey) : (PRESET_SKILLS[catalogKey] ? catalogKey : key));
  const base = PRESET_SKILLS[baseKey] ? { ...PRESET_SKILLS[baseKey] } : { key: baseKey || requestedKey || "일격", label: baseKey || requestedKey || "일격", mode: "singleDamage", target: "enemy", multiplier: 1 };
  const learnedCooldown = typeof learned === "object" && learned ? Number(learned.cooldownTurns ?? learned.cooldown ?? learned.cooldownRound ?? 0) : 0;
  const catalogCooldown = catalog ? Number(catalog.cooldownTurns ?? catalog.cooldown ?? 0) : 0;
  const cooldownTurns = Math.max(0, Number.isFinite(learnedCooldown) && learnedCooldown > 0 ? learnedCooldown : (Number.isFinite(catalogCooldown) ? catalogCooldown : 0));
  return {
    ...base,
    key: base.key || baseKey || requestedKey,
    label: base.label || (typeof learned === "object" ? learned.name : "") || requestedKey || base.key || "스킬",
    cooldownTurns,
  };
}
function getBattleSkillCooldown(state, skillKey) {
  if (!state?.skillCooldowns || typeof state.skillCooldowns !== "object") return 0;
  const rawKey = String(skillKey || "").trim();
  const normalizedKey = normalizeSkillKey(rawKey);
  return Math.max(Number(state.skillCooldowns[rawKey] || 0), Number(state.skillCooldowns[normalizedKey] || 0));
}
function setBattleSkillCooldown(state, skillKey, turns) {
  if (!state) return;
  if (!state.skillCooldowns || typeof state.skillCooldowns !== "object") state.skillCooldowns = {};
  const key = normalizeSkillKey(skillKey) || String(skillKey || "").trim();
  const safeTurns = Math.max(0, Math.round(Number(turns || 0)));
  if (safeTurns > 0) state.skillCooldowns[key] = safeTurns;
}
function resetBattleScopedCooldowns(item) {
  Object.values(item?.participantStates || {}).forEach((state) => {
    if (!state) return;
    state.skillCooldowns = {};
  });
}
function clearTransientBattleStatuses(item) {
  Object.values(item?.participantStates || {}).forEach((state) => {
    if (!state) return;
    if (Number(state.hp || 0) > 0) state.status = "정상";
    state.defending = false;
  });
  const node = item?.data?.nodes?.[item.currentNodeId];
  getBattleEnemies(node?.battle).forEach((enemy) => { if (enemy) enemy.status = ""; });
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
  const attackerPoint = getCombatPointFromTotal(attackerAgi);
  const defenderPoint = getCombatPointFromTotal(defenderAgi);
  const chancePercent = clampNumber(
    STAT_RULES.baseEvasionChancePercent + (defenderPoint - attackerPoint) * STAT_RULES.evasionChancePerPointGap,
    STAT_RULES.minEvasionChancePercent,
    STAT_RULES.maxEvasionChancePercent
  );
  return Math.random() < chancePercent / 100;
}

function rollCritical(agi) {
  const chancePercent = Math.min(STAT_RULES.maxCriticalChancePercent, getCombatPointFromTotal(agi) * STAT_RULES.criticalChancePerPoint);
  return Math.random() < chancePercent / 100;
}

function applyCriticalDamage(rawDamage) {
  return Math.max(1, Math.round(Number(rawDamage || 0) * STAT_RULES.criticalDamageMultiplier));
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
    resetBattleScopedCooldowns(item);
    clearTransientBattleStatuses(item);
    item.lastBattleRound = [{ text: "파티가 도주에 성공했습니다." }];
    saveInvestigationsRuntimeState();
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
  } else {
    saveInvestigationsRuntimeState();
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
  if (!battle.__cooldownsInitialized) {
    resetBattleScopedCooldowns(item);
    battle.__cooldownsInitialized = true;
  }
  clearTransientBattleStatuses(item);

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
      const spec = getSkillSpec(parsed.payload, actor.name);
      if (!state.skillCooldowns || typeof state.skillCooldowns !== "object") state.skillCooldowns = {};
      const cooldownLeft = getBattleSkillCooldown(state, spec.key || parsed.payload);
      if (cooldownLeft > 0) {
        roundLogs.push(createBattleLogEntry(`${actor.name}은(는) ${spec.label}을 아직 사용할 수 없습니다. (${cooldownLeft}턴 남음)`, "allies", { actor: actor.name, effect: "wait", snapshot: makeBattleSnapshot(item, battle) }));
        return;
      }
      if (Number(spec.cooldownTurns || 0) > 0) setBattleSkillCooldown(state, spec.key || parsed.payload, Number(spec.cooldownTurns || 0) + 1);
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
          let raw = calculateOutgoingDamage(actorAtk, enemyTarget.def, Number(spec.multiplier || 0.75));
          if (crit) raw = applyCriticalDamage(raw);
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
      let rawDamage = calculateOutgoingDamage(getEffectiveAttack(state), targetEnemy.def, Number(spec.multiplier || 1), Number(spec.power || 0));
      if (crit) rawDamage = applyCriticalDamage(rawDamage);
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
    let rawDamage = calculateOutgoingDamage(getEffectiveAttack(state), targetEnemy.def);
    if (crit) rawDamage = applyCriticalDamage(rawDamage);
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
      state.skillCooldowns = {};
      if (Number(state.hp || 0) > 0) state.status = "정상";
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
    const rewardItemLabels = [];
    rewardItems.filter(Boolean).forEach((rewardItem) => {
      const itemReward = normalizeInvestigationReward({ type: "item", label: rewardItem, value: rewardItem });
      rewardItemLabels.push(itemReward.label);
      queueRewardAssignment(item, itemReward);
      roundLogs.push(createBattleLogEntry(`[보상] ${itemReward.label} 획득`, "allies", { effect: "item", snapshot: makeBattleSnapshot(item, battle) }));
    });
    item.rewards.push(`${defeatedEnemies.map((enemy) => enemy.name).join(", ")} 제압`);
    setEventBanner(item, "승리", "success", 2600);
    const victoryText = `[${node.name}] ${defeatedEnemies.map((enemy) => enemy.name).join(", ")}를 제압했습니다.${rewardItemLabels.length ? ` ${rewardItemLabels.join(", ")} 획득` : ""}`;
    item.sharedLog = victoryText;
    item.sharedLogs.push(createLogEntry(victoryText));
    item.lastBattleRound = roundLogs;
    item.pendingBattleActions = {};
    item.battleTurn += 1;
    refreshInvestigationCompletionState(item);
    const hasExplicitBattleRewards = defeatedEnemies.some((enemy) => enemy.rewardExp !== undefined || enemy.rewardCoins !== undefined);
    const expReward = hasExplicitBattleRewards
      ? defeatedEnemies.reduce((sum, enemy) => sum + normalizeProgressRewardValue(enemy.rewardExp || 0), 0)
      : (rewardPoints > 0 ? 15 + rewardPoints : 0);
    const coinReward = hasExplicitBattleRewards
      ? defeatedEnemies.reduce((sum, enemy) => sum + normalizeProgressRewardValue(enemy.rewardCoins || 0), 0)
      : (rewardPoints > 0 ? Math.max(8, Math.floor(rewardPoints / 2)) : 0);
    const progressRewardTexts = [];
    if (expReward > 0) progressRewardTexts.push(`경험치 +${expReward}`);
    if (coinReward > 0) progressRewardTexts.push(`코인 +${coinReward}`);
    if (progressRewardTexts.length > 0) {
      const receiverCount = grantProgressRewardsToInvestigationParticipants(item, expReward, coinReward);
      if (receiverCount > 0) {
        roundLogs.push(createBattleLogEntry(`[보상] ${progressRewardTexts.join(", ")} 지급`, "allies", { effect: "reward", snapshot: makeBattleSnapshot(item, battle) }));
      }
    }
    persistRoundLogsToShared(roundLogs);
    item.lastBattleRound = roundLogs;
    saveInvestigationsRuntimeState();
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
    if (Number(state.hp || 0) > 0) state.status = "정상";
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
  saveInvestigationsRuntimeState();
  emitInvestigationState(item.id);
  return { success: true };
}



app.get("/designConfig", (req, res) => res.json(buildAdminDesignConfig()));

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
  if (!isResolvableAssetValue(value)) return res.status(404).end();
  return sendDataAsset(res, value);
});

app.get("/asset/character/:id", (req, res) => {
  const character = charactersDB.find((item) => String(item.id) === String(req.params.id));
  if (!character) return res.status(404).end();
  let pathKey = String(req.query.path || "");
  if (pathKey === "profileImage") pathKey = pickCharacterDataAssetPath(character, ["profileImage", "image", "avatar", "portraitImage", "portrait", "mainImage", "cardImage", "fullBodyImage", "fullImage", "investigationImage", "spriteImage"]);
  if (pathKey === "mainImage" || pathKey === "cardImage") pathKey = pickCharacterDataAssetPath(character, ["mainImage", "cardImage", "fullBodyImage", "fullImage", "profileImage", "image"]);
  if (pathKey === "investigationImage" || pathKey === "spriteImage") pathKey = pickCharacterDataAssetPath(character, ["spriteImage", "investigationImage", "sdImage", "sdImageUrl", "sd", "mainImage", "cardImage", "fullBodyImage", "fullImage", "profileImage", "image"]);
  const value = getCharacterDataImageByPath(character, pathKey || "");
  if (!isResolvableAssetValue(value)) return res.status(404).end();
  return sendDataAsset(res, value);
});

app.get("/asset/investigation/:id", (req, res) => {
  const item = investigationsDB.find((entry) => String(entry.id) === String(req.params.id));
  if (!item) return res.status(404).end();
  const value = getValueByPath(item, req.query.path || "");
  if (!isResolvableAssetValue(value)) return res.status(404).end();
  return sendDataAsset(res, value);
});

app.get("/asset/shop/:id", (req, res) => {
  const item = (shopItemsDB || []).find((entry) => String(entry.id) === String(req.params.id));
  if (!item) return res.status(404).end();
  const value = getValueByPath(item, req.query.path || "image");
  if (!isResolvableAssetValue(value)) return res.status(404).end();
  return sendDataAsset(res, value);
});
function readDedicatedDesignMapsStore() {
  return readJsonFromPath(resolveDataPath(DESIGN_MAPS_STORE_FILE), null);
}

function writeDedicatedDesignMapsStore(mapRoot) {
  if (!hasMeaningfulDesignMaps(mapRoot)) return;
  try {
    writeJsonAtomicSync(resolveDataPath(DESIGN_MAPS_STORE_FILE), mapRoot);
  } catch (error) {
    console.error("design maps store save failed", error);
  }
}

function getRuntimeFileMtimeMs(filename) {
  try {
    const filePath = resolveDataPath(filename);
    if (!filePath || !fs.existsSync(filePath)) return 0;
    return Number(fs.statSync(filePath).mtimeMs || 0);
  } catch {
    return 0;
  }
}

function pickFreshestDesignMaps(dedicatedMaps, savedMaps) {
  const dedicatedOk = hasMeaningfulDesignMaps(dedicatedMaps);
  const savedOk = hasMeaningfulDesignMaps(savedMaps);
  if (dedicatedOk && savedOk) {
    const dedicatedMtime = getRuntimeFileMtimeMs(DESIGN_MAPS_STORE_FILE);
    const designMtime = getRuntimeFileMtimeMs("designConfig.json");
    return designMtime > dedicatedMtime + 1000 ? savedMaps : dedicatedMaps;
  }
  if (dedicatedOk) return dedicatedMaps;
  if (savedOk) return savedMaps;
  return null;
}

function getProtectedDesignMaps(previousMaps = null) {
  // 서버가 이미 들고 있는 최신 맵을 우선합니다. 예전 designMaps.json이 현재 메모리 맵을 덮지 못하게 막습니다.
  if (hasMeaningfulDesignMaps(previousMaps)) return previousMaps;
  const currentMaps = designConfig?.siteContent?.maps;
  if (hasMeaningfulDesignMaps(currentMaps)) return currentMaps;
  const dedicatedMaps = readDedicatedDesignMapsStore();
  const savedDesign = readJsonFromPath(resolveDataPath("designConfig.json"), null);
  const savedMaps = savedDesign?.siteContent?.maps;
  return pickFreshestDesignMaps(dedicatedMaps, savedMaps);
}

function protectDesignMapsOnStartup(config) {
  const source = config && typeof config === "object" ? config : {};
  const siteContent = source.siteContent && typeof source.siteContent === "object" ? source.siteContent : {};
  const dedicatedMaps = readDedicatedDesignMapsStore();
  const savedMaps = siteContent.maps;
  const protectedMaps = pickFreshestDesignMaps(dedicatedMaps, savedMaps);
  if (!protectedMaps) return source;
  if (protectedMaps === savedMaps) writeDedicatedDesignMapsStore(protectedMaps);
  return {
    ...source,
    siteContent: {
      ...siteContent,
      maps: protectedMaps,
    },
  };
}

function applyProtectedDesignMapsToCurrentConfig(previousMaps = null) {
  const protectedMaps = getProtectedDesignMaps(previousMaps);
  if (!protectedMaps) return null;
  designConfig = {
    ...(designConfig || {}),
    siteContent: {
      ...((designConfig && designConfig.siteContent) || {}),
      maps: protectedMaps,
    },
  };
  return protectedMaps;
}

function hasMeaningfulDesignMaps(mapRoot) {
  if (!mapRoot || typeof mapRoot !== "object") return false;
  const presets = Array.isArray(mapRoot.presets) ? mapRoot.presets : [];
  const collections = Array.isArray(mapRoot.collections) ? mapRoot.collections : [];
  const editorCollections = Array.isArray(mapRoot.editorCollections) ? mapRoot.editorCollections : [];
  const appliedCollections = Array.isArray(mapRoot.appliedCollections) ? mapRoot.appliedCollections : [];
  const appliedPresets = Array.isArray(mapRoot.appliedPresets) ? mapRoot.appliedPresets : [];
  if (presets.length > 0 || appliedPresets.length > 0) return true;
  return [...collections, ...editorCollections, ...appliedCollections].some((collection) => Array.isArray(collection?.presets) && collection.presets.length > 0);
}

function normalizeAdminMapCollections(collections = [], fallbackPresets = []) {
  const source = Array.isArray(collections) && collections.length > 0
    ? collections
    : [{ id: "default", title: "기본 맵", presets: Array.isArray(fallbackPresets) ? fallbackPresets : [] }];
  const seen = new Set();
  return source.filter((collection, index) => {
    const id = String(collection?.id || `collection-${index}`);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  }).map((collection, index) => ({
    ...collection,
    id: collection?.id || `collection-${index}`,
    title: collection?.title || `맵 탭 ${index + 1}`,
    presets: Array.isArray(collection?.presets) ? collection.presets.map((map, mapIndex) => ({
      ...map,
      id: map?.id || `map-${index}-${mapIndex}`,
      neighbors: map?.neighbors && typeof map.neighbors === "object" ? map.neighbors : {},
    })) : [],
  }));
}

function getSelectedAdminMapPresets(collections = [], collectionId = "") {
  const found = (collections || []).find((collection) => String(collection.id) === String(collectionId)) || collections[0] || null;
  return Array.isArray(found?.presets) ? found.presets : [];
}

function collectDesignMapsById(mapRoot = {}) {
  const byId = new Map();
  const sources = [
    ...(Array.isArray(mapRoot.appliedCollections) ? mapRoot.appliedCollections : []),
    ...(Array.isArray(mapRoot.collections) ? mapRoot.collections : []),
    ...(Array.isArray(mapRoot.editorCollections) ? mapRoot.editorCollections : []),
  ];
  sources.forEach((collection) => {
    (Array.isArray(collection?.presets) ? collection.presets : []).forEach((map) => {
      if (map?.id) byId.set(String(map.id), map);
    });
  });
  (Array.isArray(mapRoot.appliedPresets) ? mapRoot.appliedPresets : []).forEach((map) => { if (map?.id) byId.set(String(map.id), map); });
  (Array.isArray(mapRoot.presets) ? mapRoot.presets : []).forEach((map) => { if (map?.id) byId.set(String(map.id), map); });
  return byId;
}

function resolveDesignAssetProxyValue(value) {
  const text = String(value || "");
  if (!text) return "";
  try {
    const parsed = new URL(text, "http://local.invalid");
    if (parsed.pathname !== "/asset/design") return "";
    const pathKey = parsed.searchParams.get("path") || "";
    const resolved = getValueByPath(designConfig, pathKey);
    return typeof resolved === "string" ? resolved : "";
  } catch {
    return "";
  }
}

function normalizeIncomingMapImageValue(value, previousValue = "") {
  const text = String(value || "").trim();
  const previous = String(previousValue || "");
  if (!text) return previous;
  const resolvedProxy = resolveDesignAssetProxyValue(text);
  if (resolvedProxy && !String(resolvedProxy || "").includes("/asset/design")) return resolvedProxy;
  if (text.includes("/asset/design")) return previous || resolvedProxy || "";
  return text;
}

function preserveAdminMapImages(collections = [], previousRoot = {}) {
  const previousById = collectDesignMapsById(previousRoot);
  return (collections || []).map((collection) => ({
    ...collection,
    presets: (Array.isArray(collection?.presets) ? collection.presets : []).map((map) => {
      const previousMap = previousById.get(String(map?.id || "")) || {};
      return {
        ...map,
        backgroundImage: normalizeIncomingMapImageValue(map?.backgroundImage, previousMap?.backgroundImage),
      };
    }),
  }));
}

function buildDraftMapRootFromPayload(incomingRoot = {}, currentRoot = {}) {
  const draftCollections = preserveAdminMapImages(
    normalizeAdminMapCollections(incomingRoot.editorCollections || incomingRoot.collections || [], incomingRoot.presets || []),
    currentRoot
  );
  const draftActiveId = incomingRoot.editorActiveCollectionId || incomingRoot.activeCollectionId || draftCollections[0]?.id || "";
  const draftPresets = getSelectedAdminMapPresets(draftCollections, draftActiveId);

  const existingAppliedCollections = preserveAdminMapImages(
    normalizeAdminMapCollections(currentRoot.appliedCollections || currentRoot.collections || [], currentRoot.appliedPresets || currentRoot.presets || []),
    currentRoot
  );
  const appliedCollectionId = currentRoot.appliedCollectionId || currentRoot.activeCollectionId || existingAppliedCollections[0]?.id || "";
  const appliedPresets = getSelectedAdminMapPresets(existingAppliedCollections, appliedCollectionId);

  return {
    ...currentRoot,
    ...incomingRoot,
    collections: draftCollections,
    activeCollectionId: draftActiveId,
    presets: draftPresets,
    editorCollections: draftCollections,
    editorActiveCollectionId: draftActiveId,
    appliedCollections: existingAppliedCollections,
    appliedCollectionId,
    appliedPresets,
  };
}

function buildAppliedMapRootFromPayload(incomingRoot = {}, currentRoot = {}) {
  const draftRoot = buildDraftMapRootFromPayload(incomingRoot, currentRoot);
  const draftCollections = preserveAdminMapImages(
    normalizeAdminMapCollections(draftRoot.editorCollections || draftRoot.collections || [], draftRoot.presets || []),
    currentRoot
  );
  const activeId = draftRoot.editorActiveCollectionId || draftRoot.activeCollectionId || draftCollections[0]?.id || "";
  const presets = getSelectedAdminMapPresets(draftCollections, activeId);
  return {
    ...draftRoot,
    collections: draftCollections,
    activeCollectionId: activeId,
    presets,
    editorCollections: draftCollections,
    editorActiveCollectionId: activeId,
    appliedCollections: draftCollections,
    appliedCollectionId: activeId,
    appliedPresets: presets,
  };
}

function commitDesignConfigChange(options = {}) {
  const preserveProtectedMaps = options?.preserveProtectedMaps !== false;
  if (preserveProtectedMaps) applyProtectedDesignMapsToCurrentConfig(designConfig?.siteContent?.maps);
  designAssetVersion = Date.now();
  publicDesignShellCache = null;
  publicDesignMapsCache = null;
  try {
    const designConfigPath = resolveDataPath("designConfig.json");
    writeJsonAtomicSync(designConfigPath, designConfig);
  } catch (error) {
    console.error("design save failed", error);
  }
}

function mergeDesignBgmSafely(previousBgm = {}, incomingBgm = {}, { allowClear = false } = {}) {
  const previous = previousBgm && typeof previousBgm === "object" ? previousBgm : {};
  const incoming = incomingBgm && typeof incomingBgm === "object" ? incomingBgm : {};
  const merged = { ...previous, ...incoming };
  ["site", "home"].forEach((key) => {
    const incomingHasKey = Object.prototype.hasOwnProperty.call(incoming, key);
    const incomingValue = String(incoming[key] || "");
    const previousValue = String(previous[key] || "");
    if (!allowClear && incomingHasKey && !incomingValue && previousValue) {
      merged[key] = previous[key];
    }
  });
  ["siteVolume", "volume"].forEach((key) => {
    if (merged[key] !== undefined) {
      const num = Number(merged[key]);
      merged[key] = Number.isFinite(num) ? Math.max(0, Math.min(1, num)) : (previous[key] ?? 1);
    }
  });
  return merged;
}

function normalizeDesignAssetProxyReferences(value, previousConfig, currentPath = "", seen = new WeakSet()) {
  if (typeof value === "string") {
    if (!value.includes("/asset/design")) return value;
    const resolved = resolveDesignAssetProxyValue(value);
    if (resolved) return resolved;
    const fallback = currentPath ? getValueByPath(previousConfig, currentPath) : undefined;
    return typeof fallback === "string" && fallback ? fallback : value;
  }
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item, index) => normalizeDesignAssetProxyReferences(item, previousConfig, `${currentPath}[${index}]`, seen));
  }
  return Object.fromEntries(Object.entries(value).map(([key, child]) => {
    const nextPath = currentPath ? `${currentPath}.${key}` : key;
    return [key, normalizeDesignAssetProxyReferences(child, previousConfig, nextPath, seen)];
  }));
}

function buildAdminDesignConfig() {
  return mapDesignAssets(designConfig, (pathKey) => toDesignAssetUrl(pathKey));
}

app.post("/designConfig", (req, res) => {
  const rawPayload = req.body && typeof req.body === "object" ? req.body : {};
  const payload = { ...rawPayload };
  delete payload.__allowBgmClear;
  delete payload.__intent;
  const previousConfig = designConfig && typeof designConfig === "object" ? designConfig : {};
  const normalizedPayload = normalizeDesignAssetProxyReferences(payload, previousConfig);
  Object.keys(payload).forEach((key) => delete payload[key]);
  Object.assign(payload, normalizedPayload);
  const previousMaps = getProtectedDesignMaps(previousConfig?.siteContent?.maps) || previousConfig?.siteContent?.maps;
  const hasIncomingSiteContent = payload.siteContent && typeof payload.siteContent === "object";
  const allowBgmClear = rawPayload.__allowBgmClear === true || rawPayload.__intent === "siteBgm";

  const nextSiteContent = {
    ...(defaultDesign.siteContent || {}),
    ...(previousConfig.siteContent || {}),
    ...(hasIncomingSiteContent ? payload.siteContent : {}),
  };

  if (hasIncomingSiteContent && payload.siteContent && Object.prototype.hasOwnProperty.call(payload.siteContent, "bgm")) {
    nextSiteContent.bgm = mergeDesignBgmSafely(previousConfig?.siteContent?.bgm, payload.siteContent.bgm, { allowClear: allowBgmClear });
  }

  // 맵 데이터는 다른 저장(홈, BGM, 캐릭터, 일반 디자인 저장)에서 절대 바뀌지 않게 보호합니다.
  // 실제 맵 변경은 /designMaps/saveDraft 또는 /designMaps/applyDraft에서만 처리합니다.
  if (hasMeaningfulDesignMaps(previousMaps)) nextSiteContent.maps = previousMaps;

  designConfig = {
    ...defaultDesign,
    ...previousConfig,
    ...payload,
    theme: { ...(defaultDesign.theme || {}), ...(previousConfig.theme || {}), ...(payload.theme || {}) },
    pages: { ...(defaultDesign.pages || {}), ...(previousConfig.pages || {}), ...(payload.pages || {}) },
    siteContent: nextSiteContent,
    sharedShellElements: Array.isArray(payload.sharedShellElements)
      ? payload.sharedShellElements
      : (Array.isArray(previousConfig.sharedShellElements) ? previousConfig.sharedShellElements : (Array.isArray(defaultDesign.sharedShellElements) ? defaultDesign.sharedShellElements : [])),
    sharedShellOverrides: typeof payload.sharedShellOverrides === "object" && payload.sharedShellOverrides
      ? payload.sharedShellOverrides
      : (typeof previousConfig.sharedShellOverrides === "object" && previousConfig.sharedShellOverrides ? previousConfig.sharedShellOverrides : (defaultDesign.sharedShellOverrides || {})),
  };
  commitDesignConfigChange();

  res.json({ success: true, designConfig: buildAdminDesignConfig() });
});

app.post("/designMaps/saveDraft", (req, res) => {
  const incomingMaps = req.body?.maps && typeof req.body.maps === "object" ? req.body.maps : {};
  const previousMaps = designConfig?.siteContent?.maps || {};
  const nextMaps = buildDraftMapRootFromPayload(incomingMaps, previousMaps);
  writeDedicatedDesignMapsStore(nextMaps);
  designConfig = {
    ...designConfig,
    siteContent: {
      ...(designConfig.siteContent || {}),
      maps: nextMaps,
    },
  };
  commitDesignConfigChange();
  res.json({ success: true, designConfig: buildAdminDesignConfig() });
});

app.post("/designMaps/applyDraft", (req, res) => {
  const incomingMaps = req.body?.maps && typeof req.body.maps === "object" ? req.body.maps : {};
  const previousMaps = designConfig?.siteContent?.maps || {};
  const nextMaps = buildAppliedMapRootFromPayload(incomingMaps, previousMaps);
  writeDedicatedDesignMapsStore(nextMaps);
  designConfig = {
    ...designConfig,
    siteContent: {
      ...(designConfig.siteContent || {}),
      maps: nextMaps,
    },
  };
  commitDesignConfigChange();
  res.json({ success: true, designConfig: buildAdminDesignConfig() });
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
    hiddenSdQuotes,
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
    hiddenSdQuotes: Array.isArray(hiddenSdQuotes) ? hiddenSdQuotes : [],
    dailyAttemptsLeft: Number(dailyAttemptsLeft ?? DAILY_INVESTIGATION_ATTEMPTS_PER_DAY),
    dailyAttemptsResetDate: getSeoulDateKey(),
    gambleCountLeft: Number(gambleCountLeft ?? DAILY_GAMBLE_COUNT_PER_DAY),
    gambleCountResetDate: getSeoulDateKey(),
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
    hiddenSdQuotes,
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

  normalizeDailyUseLimitsForCharacter(char);

  if (name !== undefined) char.name = name;

  // 중요: 이미지 / 프로필 글 / BGM은 빈 값으로 기존 데이터를 덮어쓰지 않게 보호합니다.
  // 브라우저를 바꾸거나 캐시가 비어 있는 운영 화면에서 저장해도 기존 캐릭터 정보가 사라지지 않도록 합니다.
  assignCharacterStringFieldSafely(char, "image", sanitizeIncomingCharacterImageValue(char, image) ?? sanitizeIncomingCharacterImageValue(char, profileImage), { protectExisting: true });
  assignCharacterStringFieldSafely(char, "mainImage", sanitizeIncomingCharacterImageValue(char, mainImage) ?? sanitizeIncomingCharacterImageValue(char, cardImage), { protectExisting: true });
  assignCharacterStringFieldSafely(char, "investigationImage", sanitizeIncomingCharacterImageValue(char, investigationImage) ?? sanitizeIncomingCharacterImageValue(char, spriteImage), { protectExisting: true });
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
  assignCharacterArrayFieldSafely(char, "hiddenSdQuotes", hiddenSdQuotes);
  if (dailyAttemptsLeft !== undefined) {
    char.dailyAttemptsLeft = Math.max(0, Number(dailyAttemptsLeft));
    char.dailyAttemptsResetDate = getSeoulDateKey();
  }
  if (gambleCountLeft !== undefined) {
    char.gambleCountLeft = Math.max(0, Number(gambleCountLeft));
    char.gambleCountResetDate = getSeoulDateKey();
  }
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
  if (!Array.isArray(char.hiddenSdQuotes)) char.hiddenSdQuotes = [];
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

app.get("/characters/:ownerId", (req, res) => { refreshProtectedRuntimeArraysIfNeeded(); refreshDailyUseLimitsForAllCharacters({ save: true }); return res.json(charactersDB.filter((c) => c.ownerId === req.params.ownerId).map(buildPublicCharacter)); });
app.get("/characters", (req, res) => { refreshProtectedRuntimeArraysIfNeeded(); refreshDailyUseLimitsForAllCharacters({ save: true }); return res.json(charactersDB.map(buildPublicCharacter)); });

app.get("/admin/characterGlobalConfig", (req, res) => {
  adminCharacterConfigDB = normalizeAdminCharacterConfig(readJsonFromPath(adminCharacterConfigPath, adminCharacterConfigDB));
  res.json({ success: true, config: adminCharacterConfigDB });
});

app.post("/admin/characterGlobalConfig", (req, res) => {
  const previous = normalizeAdminCharacterConfig(readJsonFromPath(adminCharacterConfigPath, adminCharacterConfigDB));
  adminCharacterConfigDB = normalizeAdminCharacterConfig({
    ...previous,
    hourlyCorrosionEnabled: !!req.body?.hourlyCorrosionEnabled,
    hourlyCorrosionDecrease: Math.max(0, Math.min(100, Number(req.body?.hourlyCorrosionDecrease || 0))),
    lastHourlyCorrosionAt: String(previous.lastHourlyCorrosionAt || ""),
  });
  saveAdminCharacterConfig();
  res.json({ success: true, config: adminCharacterConfigDB });
});

app.post("/admin/characters/bulkAdjust", (req, res) => {
  refreshProtectedRuntimeArraysIfNeeded();
  const action = String(req.body?.action || "").trim();
  const amount = Number(req.body?.amount || 0);
  const rawItemKey = String(req.body?.itemKey || req.body?.itemName || req.body?.itemId || "").trim();
  const now = Date.now();
  let changedCount = 0;
  let message = "전체 캐릭터 조정 완료";

  const touch = (character) => {
    character.updatedAt = now;
    character.assetVersion = now;
    changedCount += 1;
  };

  (Array.isArray(charactersDB) ? charactersDB : []).forEach((character) => {
    if (!character || typeof character !== "object") return;

    if (action === "coins") {
      if (!Number.isFinite(amount) || amount === 0) return;
      const before = Number(character.coins || 0);
      const after = Math.max(0, before + amount);
      if (after === before) return;
      character.coins = after;
      touch(character);
      return;
    }

    if (action === "healHpPercent") {
      if (!Number.isFinite(amount) || amount <= 0) return;
      const maxHp = getCharacterMaxHp(character?.stats?.hp);
      const currentHp = Number.isFinite(Number(character.currentHp)) ? Number(character.currentHp) : maxHp;
      const healAmount = Math.max(1, Math.ceil(maxHp * Math.min(100, amount) / 100));
      const after = Math.max(0, Math.min(maxHp, currentHp + healAmount));
      if (after === currentHp) return;
      character.currentHp = after;
      touch(character);
      return;
    }

    if (action === "grantItem") {
      if (!rawItemKey) return;
      const item = findShopItemByLooseId(rawItemKey);
      const itemValue = item?.name || item?.id || rawItemKey;
      character.items = Array.isArray(character.items) ? character.items : [];
      character.items.push(itemValue);
      touch(character);
    }
  });

  if (action === "coins") message = amount >= 0 ? `전체 캐릭터에게 코인 ${amount}개를 지급했습니다.` : `전체 캐릭터에게서 코인 ${Math.abs(amount)}개를 차감했습니다.`;
  if (action === "healHpPercent") message = `전체 캐릭터의 HP를 최대 HP 기준 ${Math.max(0, amount)}%만큼 회복했습니다.`;
  if (action === "grantItem") message = rawItemKey ? `전체 캐릭터에게 아이템을 지급했습니다: ${rawItemKey}` : "지급할 아이템을 선택해주세요.";
  if (!["coins", "healHpPercent", "grantItem"].includes(action)) {
    return res.json({ success: false, message: "지원하지 않는 전체 조정입니다." });
  }

  if (changedCount > 0) {
    publicCharacterSummaryCache = null;
    const saved = writeRuntimeArray("characters.json", charactersDB);
    if (!saved) return res.json({ success: false, message: "캐릭터 저장이 차단되었습니다. 기존 데이터 보호 중입니다." });
  }

  res.json({ success: true, changedCount, message, characters: getPublicCharacterSummaries({ refresh: false }) });
});

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
  saveInvestigationsRuntimeState();

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
  saveInvestigationsRuntimeState();
  emitParticipantsUpdated();
  emitInvestigationState(item.id);

  res.json({ success: true, started: true, investigationId: item.id, item: getInvestigationSummary(item) });
});

app.get("/investigations", (req, res) => {
  const includeHidden = String(req.query.includeHidden || "") === "1";
  const rows = investigationsDB
    .filter((item) => !isDailyRuntimeInstance(item))
    .filter((item) => includeHidden || !item.hidden)
    .map(getInvestigationSummary);
  rememberAllInvestigationCardVisuals(rows);
  res.json(rows);
});

app.get("/investigationCardVisuals", (req, res) => {
  rememberAllInvestigationCardVisuals(investigationsDB);
  res.json(readInvestigationCardVisuals());
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

function buildRoomChatMessage(roomId, message) {
  const roomKey = String(roomId || "");
  const createdAt = message?.createdAt || new Date().toISOString();
  const existingId = String(message?.id || message?.messageId || "").trim();
  const id = existingId || `${roomKey}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
  return {
    ...message,
    id,
    createdAt,
    isAdminNotice: !!message?.isAdminNotice,
    _roomId: roomKey,
  };
}

app.get("/investigationChats/:id", (req, res) => {
  const id = req.params.id;
  const item = investigationsDB.find((v) => String(v.id) === String(id));
  if (!roomChats[id] && Array.isArray(item?.roomChats)) roomChats[id] = item.roomChats.slice(-160).map((message) => buildRoomChatMessage(id, message));
  if (!roomChats[id]) roomChats[id] = [];
  res.json({ roomId: id, messages: roomChats[id] });
});
app.post("/investigationChat", (req, res) => {
  const { investigationId, message } = req.body;
  if (!investigationId || !message) return res.json({ success: false, message: "채팅 정보가 부족합니다." });
  const item = investigationsDB.find((v) => v.id === investigationId);
  if (item?.type === "daily") return res.json({ success: false, message: "일일조사에서는 채팅을 사용할 수 없습니다." });
  const state = item?.participantStates?.[message?.name || ""];
  if (!message?.isAdminNotice && state && Number(state.hp || 0) <= 0) {
    return res.json({ success: false, message: "HP가 0인 상태에서는 채팅할 수 없습니다." });
  }
  const safeMessage = buildRoomChatMessage(investigationId, message);
  if (!roomChats[investigationId]) roomChats[investigationId] = [];
  roomChats[investigationId].push(safeMessage);
  if (roomChats[investigationId].length > 160) {
    roomChats[investigationId] = roomChats[investigationId].slice(-160);
  }
  const chatItem = investigationsDB.find((v) => String(v.id) === String(investigationId));
  if (chatItem) {
    chatItem.roomChats = roomChats[investigationId];
    saveInvestigationsRuntimeState();
  }
  io.to(String(investigationId)).emit("chat", safeMessage);
  res.json({ success: true, message: safeMessage });
});

app.post("/toggleInvestigation", (req, res) => {
  const { id, opened, hidden } = req.body;
  const item = investigationsDB.find((v) => v.id === id);
  if (!item) return res.json({ success: false });
  if (opened !== undefined) item.opened = !!opened;
  if (hidden !== undefined) item.hidden = !!hidden;
  saveInvestigationsRuntimeState();
  emitParticipantsUpdated();
  emitInvestigationState(item.id);
  res.json({ success: true, item: getInvestigationSummary(item) });
});


app.post("/startDailyInvestigation", (req, res) => {
  try {
    const { id, character } = req.body || {};
    const requestedItem = investigationsDB.find((v) => String(v.id) === String(id));
    const sourceId = getDailySourceId(requestedItem || id);
    const templateItem = investigationsDB.find((v) => !isDailyRuntimeInstance(v) && String(v.id) === String(sourceId)) || requestedItem;
    if (!templateItem) return res.json({ success: false, message: "조사를 찾을 수 없습니다." });
    if (templateItem.type !== "daily") return res.json({ success: false, message: "일일조사가 아닙니다." });
    if (!getEffectiveOpened(templateItem)) return res.json({ success: false, message: "현재 이 일일조사는 비활성화 상태입니다." });
    if (!character?.id && !character?.name) return res.json({ success: false, message: "캐릭터를 찾을 수 없습니다." });

    const sourceCharacter =
      charactersDB.find((c) => String(c.id) === String(character.id)) ||
      charactersDB.find((c) => c.name === character.name && c.ownerId === character.ownerId);

    if (!sourceCharacter) return res.json({ success: false, message: "캐릭터를 찾을 수 없습니다." });
    normalizeDailyUseLimitsForCharacter(sourceCharacter);
    const ownerKey = getDailyOwnerKey(sourceCharacter);

    const existingInstance = findDailyRuntimeInstance(sourceId, ownerKey);
    const activeOwnedInstance = (existingInstance && existingInstance.started && !existingInstance.ended)
      ? existingInstance
      : findActiveDailyRuntimeInstanceByOwner(ownerKey);
    if (activeOwnedInstance && activeOwnedInstance.started && !activeOwnedInstance.ended) {
      activeOwnedInstance.dailyOwnerKey = ownerKey;
      activeOwnedInstance.dailyResumeOwnerKey = "";
      activeOwnedInstance.participants = [sourceCharacter];
      activeOwnedInstance.leaders = [sourceCharacter.name];
      ensureParticipantState(activeOwnedInstance, sourceCharacter);
      ensureRouteHistorySeed(activeOwnedInstance);
      emitParticipantsUpdated();
      emitInvestigationState(activeOwnedInstance.id);
      return res.json({ success: true, started: true, resumed: true, investigationId: activeOwnedInstance.id, sourceInvestigationId: getDailySourceId(activeOwnedInstance), character: buildPublicCharacter(sourceCharacter) });
    }

    const remain = Number(sourceCharacter.dailyAttemptsLeft ?? 1);
    if (remain <= 0) return res.json({ success: false, message: "남은 일일조사 횟수가 없습니다." });

    sourceCharacter.dailyAttemptsLeft = Math.max(0, remain - 1);
    sourceCharacter.dailyAttemptsResetDate = getSeoulDateKey();
    applyCharacterCorrosion(sourceCharacter, templateItem.entryCorrosion || templateItem.data?.entryCorrosion || 0);

    const item = getOrCreateDailyRuntimeInstance(templateItem, sourceCharacter);
    if (!item) return res.json({ success: false, message: "일일조사 세션을 만들 수 없습니다." });
    resetInvestigationProgress(item);
    item.dailyRuntimeInstance = true;
    item.dailySourceId = sourceId;
    item.hidden = true;
    item.opened = templateItem.opened;
    item.scheduleEnabled = !!templateItem.scheduleEnabled;
    item.openAt = String(templateItem.openAt || "");
    item.closeAt = String(templateItem.closeAt || "");
    ensureRuntimeState(item);
    item.started = true;
    item.ended = false;
    item.endedReason = "";
    item.participants = [sourceCharacter];
    item.leaders = [sourceCharacter.name];
    item.dailyOwnerKey = ownerKey;
    item.dailyResumeOwnerKey = "";
    ensureParticipantState(item, sourceCharacter);
    roomChats[item.id] = [];
    ensureRouteHistorySeed(item);
    item.endConfirmations = [];
    setEventBanner(item, "조사 시작", "normal", 2400);
    addSharedLog(item, `[일일조사 시작] ${item.title}`);

    writeRuntimeArray("characters.json", charactersDB);
    try { io.emit("investigationStarted", { id: item.id, sourceId }); } catch (emitErr) { console.error("investigationStarted emit failed", emitErr); }
    try { emitParticipantsUpdated(); } catch (emitErr) { console.error("participantsUpdated emit failed", emitErr); }
    try { emitInvestigationState(item.id); } catch (emitErr) { console.error("investigationState emit failed", emitErr); }

    return res.json({ success: true, started: true, investigationId: item.id, sourceInvestigationId: sourceId, character: buildPublicCharacter(sourceCharacter) });
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
  ensureRuntimeState(item);
  if (item.ended) return res.json({ success: false, message: "이미 종료된 조사입니다." });
  if (item.pendingReward) return res.json({ success: false, message: "보상 배분이 끝나야 다음 진행을 할 수 있습니다." });
  if (item.activeNpcScene?.lines?.length) return res.json({ success: false, message: "NPC 대화가 끝나야 이동할 수 있습니다." });
  const currentNode = item.data?.nodes?.[item.currentNodeId];
  const currentLock = getCurrentInvestigationNodeLockInfo(item);
  const nextNode = item.data?.nodes?.[targetNodeId];
  if (!nextNode) return res.json({ success: false, message: "이동할 위치가 없습니다." });
  if (!canMoveBetweenNodes(item, item.currentNodeId, targetNodeId)) return res.json({ success: false, message: "현재 위치에서 연결되지 않은 구역입니다." });
  const movingBackFromLockedNode = isBacktrackTargetFromCurrentLockedNode(item, targetNodeId);
  if (currentLock.locked && !movingBackFromLockedNode) return res.json({ success: false, message: currentLock.message || "잠금 상태에서는 이동할 수 없습니다." });
  if (currentNode?.battle && !movingBackFromLockedNode) return res.json({ success: false, message: "전투가 끝나기 전에는 다음 구역으로 갈 수 없습니다." });
  const actionLock = getInvestigationActionLockInfo(item);
  if (actionLock.locked && !movingBackFromLockedNode) return res.json({ success: false, message: getActionLockMessage(actionLock) });

  item.currentNodeId = targetNodeId;
  const nextLock = getInvestigationNodeLockInfo(item, nextNode, targetNodeId);
  item.routeHistory.push({ nodeId: targetNodeId, name: nextNode.name, time: new Date().toISOString() });

  if (nextLock.locked) {
    item.sharedLog = `[잠금] ${nextLock.message}`;
    item.sharedLogs.push(createLogEntry(item.sharedLog));
    setEventBanner(item, "잠금 구역", "danger", 2400);
    refreshInvestigationCompletionState(item);
    saveInvestigationsRuntimeState();
    emitInvestigationState(investigationId);
    return res.json({ success: true, locked: true, currentNodeId: item.currentNodeId, sharedLog: item.sharedLog, investigation: buildPublicInvestigationState(item) });
  }

  if (nextLock.unlockedNow) {
    addSharedLog(item, `[해금] ${nextNode.name}의 잠금이 해제되었습니다.`);
  }
  addSharedLog(item, `[이동] ${nextNode.name} - ${nextNode.log || ""}`);
  applyNodeEntryEffects(item, nextNode);
  if (allParticipantsDown(item)) {
    finishInvestigation(item, "전멸", "패배하였습니다. 활동할 수 있는 인원이 없습니다. 조사가 종료됩니다.");
    emitParticipantsUpdated();
    emitInvestigationState(investigationId);
    return res.json({ success: true, currentNodeId: item.currentNodeId, sharedLog: item.sharedLog, ended: true, investigation: buildPublicInvestigationState(item) });
  }
  announceNodeBattleStartIfReady(item, nextNode);

  refreshInvestigationCompletionState(item);
  saveInvestigationsRuntimeState();
  emitInvestigationState(investigationId);
  res.json({ success: true, currentNodeId: item.currentNodeId, sharedLog: item.sharedLog, investigation: buildPublicInvestigationState(item) });
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
  const actionLock = getInvestigationActionLockInfo(item);
  if (actionLock.locked) return res.json({ success: false, message: getActionLockMessage(actionLock) });
  const currentNodeLock = getCurrentInvestigationNodeLockInfo(item);
  if (currentNodeLock.locked) return res.json({ success: false, message: currentNodeLock.message || "잠금 상태에서는 조사할 수 없습니다." });
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
  saveInvestigationsRuntimeState();
  emitInvestigationState(investigationId);
  res.json({ success: true, currentNodeId: item.currentNodeId, sharedLog: item.sharedLog, investigation: buildPublicInvestigationState(item) });
});

app.post("/setBattleAction", (req, res) => {
  const { investigationId, characterName, actionName } = req.body;
  const item = investigationsDB.find((v) => v.id === investigationId);
  if (!item) return res.json({ success: false, message: "조사를 찾을 수 없습니다." });
  ensureRuntimeState(item);
  if (!item.pendingBattleActions || typeof item.pendingBattleActions !== "object") item.pendingBattleActions = {};
  if (item.ended) return res.json({ success: false, message: "이미 종료된 조사입니다." });
  if (item.activeNpcScene?.lines?.length) return res.json({ success: false, message: "NPC 대화가 끝나야 전투를 시작할 수 있습니다." });
  const currentNodeLock = getCurrentInvestigationNodeLockInfo(item);
  if (currentNodeLock.locked) return res.json({ success: false, message: currentNodeLock.message || "잠금 상태에서는 전투 행동을 할 수 없습니다." });
  const node = item.data?.nodes?.[item.currentNodeId];
  announceNodeBattleStartIfReady(item, node);
  if (!node?.battle) return res.json({ success: false, message: "현재 전투 중이 아닙니다." });
  const state = item.participantStates?.[characterName];
  if (!state) return res.json({ success: false, message: "참가자 상태를 찾을 수 없습니다." });
  if (Number(state.hp || 0) <= 0) return res.json({ success: false, message: "행동 불가능한 상태입니다." });
  const actionLockedUntil = getParticipantActionLockUntil(state);
  if (actionLockedUntil > Date.now()) return res.json({ success: false, message: getActionLockMessage({ until: actionLockedUntil, remainingSeconds: Math.ceil((actionLockedUntil - Date.now()) / 1000) }) });
  const parsedAction = parseBattleAction(actionName || "공격");
  if (parsedAction.type === "스킬") {
    const spec = getSkillSpec(parsedAction.payload, characterName);
    const cooldownLeft = getBattleSkillCooldown(state, spec.key || parsedAction.payload);
    if (cooldownLeft > 0) return res.json({ success: false, message: `${spec.label || "스킬"}은(는) 아직 사용할 수 없습니다. (${cooldownLeft}턴 남음)` });
  }
  item.pendingBattleActions[characterName] = actionName || "공격";

  const aliveNames = Array.from(new Set((item.participants || [])
    .filter((participant) => !participant?.isAdmin && String(participant?.id || "") !== "admin" && String(participant?.ownerId || "") !== "admin" && participant?.name !== "운영자")
    .map((participant) => String(participant?.name || "").trim())
    .filter(Boolean)
    .filter((name) => Number(item.participantStates?.[name]?.hp || 0) > 0)));
  const allReady = aliveNames.length > 0 && aliveNames.every((name) => !!item.pendingBattleActions?.[name]);

  if (allReady) {
    if (item.__battleResolving) return res.json({ success: true, pendingBattleActions: item.pendingBattleActions, investigation: buildPublicInvestigationState(item) });
    item.__battleResolving = true;
    let outcome;
    try {
      outcome = applyBattleTurn(item, item.pendingBattleActions || {});
    } catch (err) {
      console.error("setBattleAction applyBattleTurn error", err);
      outcome = { success: false, message: "전투 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." };
      emitInvestigationState(investigationId);
    } finally {
      item.__battleResolving = false;
    }
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
  ensureRuntimeState(item);
  if (!item.pendingBattleActions || typeof item.pendingBattleActions !== "object") item.pendingBattleActions = {};
  if (item.ended) return res.json({ success: false, message: "이미 종료된 조사입니다." });
  if (item.activeNpcScene?.lines?.length) return res.json({ success: false, message: "NPC 대화가 끝나야 전투를 시작할 수 있습니다." });
  const currentNodeLock = getCurrentInvestigationNodeLockInfo(item);
  if (currentNodeLock.locked) return res.json({ success: false, message: currentNodeLock.message || "잠금 상태에서는 전투를 진행할 수 없습니다." });
  const actionLock = getInvestigationActionLockInfo(item);
  if (actionLock.locked) return res.json({ success: false, message: getActionLockMessage(actionLock) });
  announceNodeBattleStartIfReady(item);
  if (item.__battleResolving) return res.json({ success: true, pendingBattleActions: item.pendingBattleActions, investigation: buildPublicInvestigationState(item) });
  item.__battleResolving = true;
  let outcome;
  try {
    outcome = applyBattleTurn(item, item.pendingBattleActions || {});
  } catch (err) {
    console.error("submitBattleTurn applyBattleTurn error", err);
    outcome = { success: false, message: "전투 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." };
    emitInvestigationState(investigationId);
  } finally {
    item.__battleResolving = false;
  }
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
  const currentNodeLock = getCurrentInvestigationNodeLockInfo(item);
  if (currentNodeLock.locked) return res.json({ success: false, message: currentNodeLock.message || "잠금 상태에서는 전투 행동을 할 수 없습니다." });
  const actionLock = getInvestigationActionLockInfo(item);
  if (actionLock.locked) return res.json({ success: false, message: getActionLockMessage(actionLock) });
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
  if (String(item.type || "group") === "group" && !isInvestigationRewardEligibleParticipant(item, receiver)) {
    return res.json({ success: false, message: "기절한 참여자는 조사 보상을 받을 수 없습니다." });
  }

  const char = charactersDB.find((c) => String(c.id) === String(receiver.id)) || charactersDB.find((c) => c.name === receiver.name);
  if (!char) return res.json({ success: false, message: "캐릭터를 찾을 수 없습니다." });

  const reward = normalizeInvestigationReward(item.pendingReward);
  if (applyRewardToCharacter(char, reward)) {
    markCharactersDirty();
    writeRuntimeArray("characters.json", charactersDB);
  }

  addSharedLog(item, `[획득] ${receiver.name}이(가) ${reward.label}을(를) 받았습니다.`);
  const queue = Array.isArray(item.pendingRewardQueue) ? item.pendingRewardQueue : [];
  item.pendingReward = queue.length > 0 ? queue.shift() : null;
  item.pendingRewardQueue = queue;
  saveInvestigationsRuntimeState();
  emitInvestigationState(investigationId);
  res.json({ success: true, character: char, pendingReward: item.pendingReward });
});

function applyNpcOptionOutcome(item, option) {
  if (!item || !option) return;
  const npcUnlockToken = normalizeInvestigationUnlockToken(option.unlockToken || option.unlock_token || option.unlockKey || "");
  if (npcUnlockToken) {
    const displayKeyName = String(option.unlockLabel || option.unlockName || npcUnlockToken).trim();
    const unlockedNow = grantInvestigationUnlockToken(item, npcUnlockToken, displayKeyName);
    addSharedLog(item, unlockedNow ? `[해금] ${displayKeyName}을(를) 획득했습니다.` : `[해금] ${displayKeyName}은(는) 이미 보유하고 있습니다.`);
  }
  if (option.rewardItem) queueRewardAssignment(item, { type: "item", label: option.rewardItem, value: option.rewardItem });
  if (option.rewardStatPoints) queueRewardAssignment(item, { type: "statPoints", label: `스탯 포인트 +${option.rewardStatPoints}`, value: Number(option.rewardStatPoints) });
  const rewardExp = normalizeProgressRewardValue(option.rewardExp ?? option.exp ?? 0);
  const rewardCoins = normalizeProgressRewardValue(option.rewardCoins ?? option.coins ?? 0);
  if (rewardExp > 0 || rewardCoins > 0) {
    const receiverCount = grantProgressRewardsToInvestigationParticipants(item, rewardExp, rewardCoins);
    if (receiverCount > 0) {
      const rewardTexts = [];
      if (rewardExp > 0) rewardTexts.push(`경험치 +${rewardExp}`);
      if (rewardCoins > 0) rewardTexts.push(`코인 +${rewardCoins}`);
      addSharedLog(item, `[NPC 보상] ${rewardTexts.join(", ")} 지급`);
    }
  }
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

  saveInvestigationsRuntimeState();
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
    const roomKey = String(roomId || "");
    if (!roomKey) return;
    for (const joinedRoom of socket.rooms) {
      if (joinedRoom !== socket.id && joinedRoom !== roomKey) socket.leave(joinedRoom);
    }
    socket.join(roomKey);
    if (socketUsers[socket.id]) {
      socketUsers[socket.id].roomId = roomKey;
      socketUsers[socket.id].role = "viewer";
    }
    const chatItem = investigationsDB.find((v) => String(v.id) === roomKey);
    if (!roomChats[roomKey] && Array.isArray(chatItem?.roomChats)) roomChats[roomKey] = chatItem.roomChats.slice(-160).map((message) => buildRoomChatMessage(roomKey, message));
    if (!roomChats[roomKey]) roomChats[roomKey] = [];
    socket.emit("init", { roomId: roomKey, messages: roomChats[roomKey] });
    emitInvestigationState(roomKey);
    emitUsers();
    emitOnlineAccounts();
  });

  socket.on("leaveRoom", (roomId) => {
    const roomKey = String(roomId || socketUsers[socket.id]?.roomId || "");
    if (roomKey) socket.leave(roomKey);
    if (socketUsers[socket.id]) {
      if (!roomKey || String(socketUsers[socket.id].roomId || "") === roomKey) socketUsers[socket.id].roomId = null;
      socketUsers[socket.id].role = "viewer";
    }
    emitUsers();
    emitOnlineAccounts();
  });

  socket.on("chat", ({ roomId, message } = {}) => {
    const roomKey = String(roomId || "");
    if (!roomKey || !message) return;
    const safeMessage = buildRoomChatMessage(roomKey, message);
    if (!roomChats[roomKey]) roomChats[roomKey] = [];
    roomChats[roomKey].push(safeMessage);
    if (roomChats[roomKey].length > 160) {
      roomChats[roomKey] = roomChats[roomKey].slice(-160);
    }
    const chatItem = investigationsDB.find((v) => String(v.id) === roomKey);
    if (chatItem) {
      chatItem.roomChats = roomChats[roomKey];
      saveInvestigationsRuntimeState();
    }
    io.to(roomKey).emit("chat", safeMessage);
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
  const users = getDirectAdminAccountRows(searchText, { deep })
    .filter(isDisplayableAdminAccount)
    .map((user) => ({
      id: getRuntimeAccountId(user) || getRuntimeUserId(user),
      type: user.type || user.role || "owner",
    }))
    .filter((user) => isPlausibleAdminAccountId(user.id))
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
  const source = template && typeof template === "object" ? template : {};
  const normalized = {
    id: source.id || `custom-${Date.now()}`,
    title: source.title || "새 조사",
    type: source.type || "group",
    createdAt: source.createdAt || new Date().toISOString(),
    json: source.json || source,
  };
  if (source.published === false) normalized.published = false;
  if (source.runtimeDeleted === true || source.unpublished === true) normalized.runtimeDeleted = true;
  return normalized;
}

function isCustomTemplateRuntimeDeleted(template) {
  return !!(template && (template.published === false || template.runtimeDeleted === true || template.unpublished === true));
}

function markCustomTemplateRuntimeDeleted(id, deleted = true) {
  const safeId = String(id || "").trim();
  if (!safeId) return false;
  let changed = false;
  customInvestigationsDB = customInvestigationsDB.map((entry) => {
    const entryId = String(entry?.id || entry?.json?.id || "").trim();
    if (entryId !== safeId) return entry;
    changed = true;
    const next = { ...(entry || {}) };
    if (deleted) {
      next.published = false;
      next.runtimeDeleted = true;
    } else {
      next.published = true;
      delete next.runtimeDeleted;
      delete next.unpublished;
    }
    return next;
  });
  return changed;
}

const INVESTIGATION_CARD_VISUALS_FILE = "investigationCardVisuals.json";

function normalizeInvestigationCardVisualPayload(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    listImage: String(source.listImage || source.data?.listImage || ""),
    entryImage: String(source.entryImage || source.data?.entryImage || source.listImage || source.data?.listImage || ""),
    listImageFrame: normalizeInvestigationImageFrame(source.listImageFrame || source.data?.listImageFrame),
    entryImageFrame: normalizeInvestigationImageFrame(source.entryImageFrame || source.data?.entryImageFrame || source.listImageFrame || source.data?.listImageFrame),
    imageUpdatedAt: Number(source.imageUpdatedAt || source.data?.imageUpdatedAt || 0),
  };
}

function readInvestigationCardVisuals() {
  const fallback = { daily: {}, group: {} };
  try {
    const parsed = safeReadJsonFileStrict(resolveDataPath(INVESTIGATION_CARD_VISUALS_FILE), fallback, INVESTIGATION_CARD_VISUALS_FILE);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fallback;
    return {
      daily: normalizeInvestigationCardVisualPayload(parsed.daily || {}),
      group: normalizeInvestigationCardVisualPayload(parsed.group || {}),
    };
  } catch {
    return fallback;
  }
}

function writeInvestigationCardVisuals(value) {
  try {
    const next = {
      daily: normalizeInvestigationCardVisualPayload(value?.daily || {}),
      group: normalizeInvestigationCardVisualPayload(value?.group || {}),
    };
    writeJsonAtomicSync(resolveDataPath(INVESTIGATION_CARD_VISUALS_FILE), next);
    return next;
  } catch (error) {
    console.error("writeInvestigationCardVisuals error", error.message);
    return value;
  }
}

function rememberInvestigationCardVisual(item) {
  if (!item || typeof item !== "object") return;
  const type = item.type === "daily" ? "daily" : item.type === "group" ? "group" : "";
  if (!type) return;
  const visual = normalizeInvestigationCardVisualPayload(item);
  if (!visual.listImage && !visual.entryImage) return;
  const current = readInvestigationCardVisuals();
  const previous = current[type] || {};
  current[type] = {
    listImage: visual.listImage || previous.listImage || "",
    entryImage: visual.entryImage || previous.entryImage || visual.listImage || previous.listImage || "",
    listImageFrame: visual.listImageFrame || previous.listImageFrame,
    entryImageFrame: visual.entryImageFrame || previous.entryImageFrame || visual.listImageFrame || previous.listImageFrame,
    imageUpdatedAt: Number(visual.imageUpdatedAt || previous.imageUpdatedAt || Date.now()),
  };
  writeInvestigationCardVisuals(current);
}

function rememberAllInvestigationCardVisuals(rows = []) {
  (Array.isArray(rows) ? rows : []).forEach((item) => rememberInvestigationCardVisual(item));
}

const DEFAULT_INVESTIGATION_IDS_TO_PRUNE = new Set([
  "investigation-1",
  "investigation-2",
  "test-multi-enemy-battle",
  "custom-group-test-01",
  "custom-daily-test-01",
]);

const DEFAULT_INVESTIGATION_TITLES_TO_PRUNE = new Set([
  "[테스트] 격리동 합동조사",
  "[테스트] 야간 진료실 일일조사",
]);

function getInvestigationTemplateId(template) {
  return String(template?.id || template?.json?.id || "").trim();
}

function getInvestigationTemplateTitle(template) {
  return String(template?.title || template?.json?.title || "").trim();
}

function pruneDefaultInvestigationTemplates(list) {
  const rows = Array.isArray(list) ? list : [];
  return rows.filter((template) => {
    const id = getInvestigationTemplateId(template);
    const title = getInvestigationTemplateTitle(template);
    return !DEFAULT_INVESTIGATION_IDS_TO_PRUNE.has(id) && !DEFAULT_INVESTIGATION_TITLES_TO_PRUNE.has(title);
  });
}

const loadedCustomInvestigations = readCustomInvestigationsFromFile();
let customInvestigationsDB = pruneDefaultInvestigationTemplates(loadedCustomInvestigations);
if (customInvestigationsDB.length !== (Array.isArray(loadedCustomInvestigations) ? loadedCustomInvestigations.length : 0)) {
  writeCustomInvestigationsToFile(customInvestigationsDB);
}


function hasInvestigationVisualValue(def, key) {
  return typeof def?.[key] === "string" && def[key].trim()
    || typeof def?.data?.[key] === "string" && def.data[key].trim();
}

function mergeInvestigationVisualFieldsForPublish(def, existing) {
  if (!existing) return def;
  const next = clone(def || {});
  next.data = { ...(next.data || {}) };

  if (!hasInvestigationVisualValue(next, "listImage") && (existing.listImage || existing.data?.listImage)) {
    next.listImage = existing.listImage || existing.data?.listImage || "";
    next.data.listImage = next.data.listImage || next.listImage;
  }
  if (!hasInvestigationVisualValue(next, "entryImage") && (existing.entryImage || existing.data?.entryImage || next.listImage)) {
    next.entryImage = existing.entryImage || existing.data?.entryImage || next.listImage || "";
    next.data.entryImage = next.data.entryImage || next.entryImage;
  }
  if (!next.listImageFrame && !next.data.listImageFrame && (existing.listImageFrame || existing.data?.listImageFrame)) {
    next.listImageFrame = normalizeInvestigationImageFrame(existing.listImageFrame || existing.data?.listImageFrame);
    next.data.listImageFrame = next.data.listImageFrame || next.listImageFrame;
  }
  if (!next.entryImageFrame && !next.data.entryImageFrame && (existing.entryImageFrame || existing.data?.entryImageFrame || next.listImageFrame)) {
    next.entryImageFrame = normalizeInvestigationImageFrame(existing.entryImageFrame || existing.data?.entryImageFrame || next.listImageFrame);
    next.data.entryImageFrame = next.data.entryImageFrame || next.entryImageFrame;
  }
  if (!Number(next.imageUpdatedAt || next.data.imageUpdatedAt || 0) && Number(existing.imageUpdatedAt || existing.data?.imageUpdatedAt || 0)) {
    next.imageUpdatedAt = Number(existing.imageUpdatedAt || existing.data?.imageUpdatedAt || 0);
    next.data.imageUpdatedAt = next.imageUpdatedAt;
  }
  return next;
}

function makeUniquePublishedInvestigationId(rawId, rawTitle = "") {
  const fallbackBase = String(rawTitle || "investigation").trim()
    .replace(/\s+/g, "-")
    .replace(/[^가-힣a-zA-Z0-9_-]/g, "")
    .slice(0, 48) || "investigation";
  const base = String(rawId || fallbackBase).trim() || fallbackBase;
  const usedIds = new Set([
    ...investigationsDB.map((item) => String(item?.id || "")),
    ...customInvestigationsDB.map((item) => String(item?.id || item?.json?.id || "")),
  ].filter(Boolean));
  if (!usedIds.has(base)) return base;
  let index = 1;
  let next = `${base}-copy-${Date.now()}`;
  while (usedIds.has(next)) {
    index += 1;
    next = `${base}-copy-${Date.now()}-${index}`;
  }
  return next;
}

function upsertPublishedInvestigation(def, options = {}) {
  const existingIndex = investigationsDB.findIndex((item) => item.id === def.id);
  const existing = existingIndex >= 0 ? investigationsDB[existingIndex] : null;
  const publishDef = mergeInvestigationVisualFieldsForPublish(def, existing);
  const built = buildInvestigation(publishDef);
  let published = built;
  if (existing) {
    published = mergePersistedInvestigationState(built, existing);
    published.opened = publishDef?.opened !== undefined ? !!publishDef.opened : !!existing.opened;
    published.hidden = publishDef?.hidden !== undefined ? !!publishDef.hidden : !!existing.hidden;
    published.scheduleEnabled = publishDef?.scheduleEnabled !== undefined ? !!publishDef.scheduleEnabled : !!existing.scheduleEnabled;
    published.openAt = String(publishDef?.openAt || existing.openAt || "");
    published.closeAt = String(publishDef?.closeAt || existing.closeAt || "");
    investigationsDB[existingIndex] = published;
  } else {
    investigationsDB.push(published);
  }
  if (options.save !== false) saveInvestigationsRuntimeState();
  if (options.emit !== false) {
    emitParticipantsUpdated();
    emitInvestigationState(publishDef.id);
  }
  return published;
}

const persistedInvestigationsAtStartup = readRuntimeArray("investigations.json");
customInvestigationsDB.forEach((template) => {
  if (isCustomTemplateRuntimeDeleted(template)) return;
  if (template?.json?.data?.nodes) {
    try {
      upsertPublishedInvestigation(template.json, { save: false, emit: false });
    } catch (err) {
      console.error("custom investigation bootstrap failed", template?.id, err);
    }
  }
});
rememberAllInvestigationCardVisuals(investigationsDB);

rehydrateInvestigationsFromRuntime(persistedInvestigationsAtStartup);
rememberAllInvestigationCardVisuals(investigationsDB);
saveInvestigationsRuntimeState();

app.get("/admin/customInvestigations", (req, res) => {
  res.json(customInvestigationsDB);
});

app.post("/admin/customInvestigations", (req, res) => {
  const incoming = req.body || {};
  const existing = customInvestigationsDB.find((item) => String(item?.id || item?.json?.id || "") === String(incoming?.id || incoming?.json?.id || ""));
  const template = normalizeCustomTemplate({
    ...(existing || {}),
    ...incoming,
    published: incoming.published !== undefined ? incoming.published : existing?.published,
    runtimeDeleted: incoming.runtimeDeleted !== undefined ? incoming.runtimeDeleted : existing?.runtimeDeleted,
  });
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
  const def = clone(req.body || {});
  const forceCreateDuplicate = !!(def.forceCreateDuplicate || def.createDuplicate || def.forceNew);
  delete def.forceCreateDuplicate;
  delete def.createDuplicate;
  delete def.forceNew;
  if (!def.id || !def.title || !def.data?.nodes || Object.keys(def.data.nodes || {}).length === 0) {
    return res.json({ success: false, message: "조사 JSON 형식이 올바르지 않습니다." });
  }

  try {
    const nodeIds = Object.keys(def.data.nodes || {});
    if (!def.data.start || !def.data.nodes[def.data.start]) def.data.start = nodeIds[0];
    if (forceCreateDuplicate) {
      def.id = makeUniquePublishedInvestigationId(def.id, def.title);
    }
    const publishedItem = upsertPublishedInvestigation(def);
    const persistedDef = serializeInvestigationForPersistence(publishedItem);

    const template = normalizeCustomTemplate({
      id: persistedDef.id,
      title: persistedDef.title,
      type: persistedDef.type || "group",
      json: persistedDef,
      published: true,
      runtimeDeleted: false,
    });

    customInvestigationsDB = [
      ...customInvestigationsDB.filter((item) => item.id !== template.id),
      template,
    ];
    writeCustomInvestigationsToFile(customInvestigationsDB);

    res.json({ success: true, investigationId: persistedDef.id, template });
  } catch (err) {
    console.error("publishInvestigation error", err);
    res.json({ success: false, message: "실제 조사 반영에 실패했습니다." });
  }
});
app.post("/admin/investigationCardImage", (req, res) => {
  try {
    const { investigationId, listImage, entryImage, listImageFrame, entryImageFrame } = req.body || {};
    const entryVisualType = investigationId === "__entry-daily" ? "daily" : investigationId === "__entry-group" ? "group" : "";
    if (entryVisualType) {
      const currentVisuals = readInvestigationCardVisuals();
      const current = normalizeInvestigationCardVisualPayload(currentVisuals[entryVisualType] || {});
      const nextListImage = listImage !== undefined ? String(listImage || "") : String(current.listImage || "");
      const nextEntryImage = entryImage !== undefined ? String(entryImage || "") : String(current.entryImage || current.listImage || nextListImage || "");
      const nextListImageFrame = listImageFrame !== undefined ? normalizeInvestigationImageFrame(listImageFrame) : normalizeInvestigationImageFrame(current.listImageFrame);
      const nextEntryImageFrame = entryImageFrame !== undefined ? normalizeInvestigationImageFrame(entryImageFrame) : normalizeInvestigationImageFrame(current.entryImageFrame || current.listImageFrame);
      const imageUpdatedAt = Date.now();
      const savedVisual = {
        listImage: nextListImage || nextEntryImage || "",
        entryImage: nextEntryImage || nextListImage || "",
        listImageFrame: nextListImageFrame,
        entryImageFrame: nextEntryImageFrame,
        imageUpdatedAt,
      };
      currentVisuals[entryVisualType] = savedVisual;
      writeInvestigationCardVisuals(currentVisuals);
      return res.json({
        success: true,
        item: {
          id: investigationId,
          title: entryVisualType === "group" ? "단체조사" : "일일조사",
          type: entryVisualType,
          ...savedVisual,
        },
      });
    }

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
    rememberInvestigationCardVisual(item);
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
    hiddenSdQuotes: Array.isArray(character.hiddenSdQuotes) ? character.hiddenSdQuotes : [],
    profileBgm: character.profileBgm || "",
    profileBgmVolume: Number.isFinite(Number(character.profileBgmVolume)) ? Math.max(0, Math.min(1, Number(character.profileBgmVolume))) : 1,
    mainImageFrame: character.mainImageFrame || undefined,
    dailyAttemptsLeft: Number(character.dailyAttemptsLeft ?? DAILY_INVESTIGATION_ATTEMPTS_PER_DAY),
    dailyAttemptsResetDate: String(character.dailyAttemptsResetDate || getSeoulDateKey()),
    gambleCountLeft: Number(character.gambleCountLeft ?? DAILY_GAMBLE_COUNT_PER_DAY),
    gambleCountResetDate: String(character.gambleCountResetDate || getSeoulDateKey()),
    updatedAt: Number(character.updatedAt || character.assetVersion || 0),
    assetVersion: Number(character.assetVersion || character.updatedAt || 0),
  };
}

function resolveCharacterDataImageValue(character, value, seen = new Set()) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (isResolvableAssetValue(raw)) return raw;
  if (!isGeneratedCharacterAssetUrl(raw)) return "";
  const refPath = getGeneratedCharacterAssetPath(raw);
  if (!refPath || seen.has(refPath)) return "";
  seen.add(refPath);
  return resolveCharacterDataImageValue(character, getValueByPath(character, refPath), seen);
}

function getCharacterDataImageByPath(character, pathKey = "") {
  const key = String(pathKey || "").trim();
  if (!key) return "";
  return resolveCharacterDataImageValue(character, getValueByPath(character, key), new Set([key]));
}

function pickCharacterDataAssetPath(character, candidates = []) {
  const list = Array.isArray(candidates) ? candidates : [candidates];
  for (const key of list) {
    if (getCharacterDataImageByPath(character, key)) return key;
  }
  return "";
}

function sanitizeIncomingCharacterImageValue(character, value) {
  if (value === undefined) return undefined;
  const text = String(value || "").trim();
  if (!text) return value;
  if (isAssetFileUrl(text)) return text;
  if (!isGeneratedCharacterAssetUrl(text)) return value;
  const refPath = getGeneratedCharacterAssetPath(text);
  const resolved = refPath ? getCharacterDataImageByPath(character, refPath) : "";
  return resolved || undefined;
}

function pickCharacterAssetPath(character, candidates = []) {
  const list = Array.isArray(candidates) ? candidates : [candidates];
  for (const key of list) {
    const value = character?.[key];
    if (isResolvableImageValue(value)) return key;
  }
  for (const key of list) {
    const value = character?.[key];
    if (typeof value === "string" && value.trim() && !isGeneratedCharacterAssetUrl(value)) return key;
  }
  for (const key of list) {
    if (getCharacterDataImageByPath(character, key)) return key;
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
    if (isDataAsset(rawValue)) return toCharacterAssetUrl(characterId, pathKey, version);
    return typeof rawValue === "string" && rawValue.trim() ? rawValue : (fallbackValue || "");
  };

  const profileImage = profilePath ? toUrl(profilePath, summary.profileImage) : summary.profileImage;
  const mainImage = mainPath ? toUrl(mainPath, summary.mainImage) : summary.mainImage;
  const investigationImage = spritePath ? toUrl(spritePath, summary.investigationImage) : summary.investigationImage;
  const profileBgm = summary.profileBgm ? toUrl("profileBgm", summary.profileBgm) : "";

  return {
    ...summary,
    profileBgm,
    image: profileImage,
    profileImage,
    mainImage,
    cardImage: mainImage || profileImage || summary.cardImage,
    investigationImage,
    spriteImage: investigationImage || mainImage || profileImage || summary.spriteImage,
  };
}

let publicCharacterSummaryCache = null;
refreshDailyUseLimitsForAllCharacters({ save: true });

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
    JSON.stringify(character?.hiddenSdQuotes || []),
    Number(character?.corrosion || 0),
    Number(character?.dailyAttemptsLeft ?? DAILY_INVESTIGATION_ATTEMPTS_PER_DAY),
    String(character?.dailyAttemptsResetDate || ""),
    Number(character?.gambleCountLeft ?? DAILY_GAMBLE_COUNT_PER_DAY),
    String(character?.gambleCountResetDate || ""),
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
  return mapDesignAssets(detailed, (pathKey) => toCharacterAssetUrl(character.id || character.name || "unknown", pathKey, version));
}

function buildPublicDesignShellConfig(config) {
  const source = config && typeof config === "object" ? config : {};
  const nextSiteContent = { ...(source.siteContent || {}) };
  delete nextSiteContent.maps;
  return mapDesignAssets({
    ...source,
    siteContent: nextSiteContent,
  }, (pathKey) => toDesignAssetUrl(pathKey));
}

function normalizePublicMapCollections(collections = [], fallbackPresets = []) {
  const source = Array.isArray(collections) && collections.length > 0
    ? collections
    : [{ id: "default", title: "기본 맵", presets: Array.isArray(fallbackPresets) ? fallbackPresets : [] }];
  const seen = new Set();
  return source.filter((collection, index) => {
    const id = String(collection?.id || `collection-${index}`);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  }).map((collection, index) => ({
    id: collection?.id || `collection-${index}`,
    title: collection?.title || `맵 탭 ${index + 1}`,
    presets: Array.isArray(collection?.presets) ? collection.presets : [],
  }));
}

function getAppliedDesignMapsRoot(config) {
  const mapRoot = (config && config.siteContent && config.siteContent.maps) ? config.siteContent.maps : {};
  const appliedCollections = normalizePublicMapCollections(
    Array.isArray(mapRoot.appliedCollections) ? mapRoot.appliedCollections : mapRoot.collections,
    Array.isArray(mapRoot.appliedPresets) ? mapRoot.appliedPresets : mapRoot.presets
  );
  const activeCollectionId = mapRoot.appliedCollectionId || mapRoot.activeCollectionId || appliedCollections[0]?.id || "";
  const activeCollection = appliedCollections.find((collection) => String(collection.id) === String(activeCollectionId)) || appliedCollections[0] || null;
  const presets = Array.isArray(activeCollection?.presets) ? activeCollection.presets : [];
  return {
    collections: appliedCollections,
    activeCollectionId: activeCollection?.id || activeCollectionId,
    presets,
  };
}

function buildPublicDesignMapsConfig(config) {
  return mapDataImages(getAppliedDesignMapsRoot(config), (pathKey) => toDesignAssetUrl(`siteContent.maps.${pathKey}`));
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
  const mapRoot = getAppliedDesignMapsRoot(designConfig);
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
    unlockedTokens: item.unlockedTokens || [],
    unlockedNodeIds: item.unlockedNodeIds || [],
    currentNodeLock: getCurrentInvestigationNodeLockInfo(item),
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
  refreshDailyUseLimitsForAllCharacters({ save: true });
  const character = charactersDB.find((item) => String(item.id) === String(req.params.id));
  if (!character) return res.status(404).json({ success: false, message: "캐릭터를 찾지 못했습니다." });
  res.json({ success: true, character: buildPublicCharacter(character) });
});

app.get("/character-public/:id", (req, res) => {
  refreshDailyUseLimitsForAllCharacters({ save: true });
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
  refreshDailyUseLimitsForAllCharacters({ save: true });
  res.json(charactersDB.filter((c) => String(c.ownerId) === String(req.params.ownerId)).map(summarizeCharacter));
});

app.get("/characters-lite", (req, res) => {
  refreshCharactersFromDiskIfNeeded();
  refreshDailyUseLimitsForAllCharacters({ save: true });
  res.set("Cache-Control", "public, max-age=2, stale-while-revalidate=30");
  res.json(charactersDB.map(summarizeCharacter));
});

app.get("/characters-public/:ownerId", (req, res) => {
  refreshDailyUseLimitsForAllCharacters({ save: true });
  const rows = getPublicCharacterSummaries().filter((c) => String(c.ownerId) === String(req.params.ownerId));
  res.set("Cache-Control", "public, max-age=2, stale-while-revalidate=30");
  res.json(rows);
});

app.get("/characters-public", (req, res) => {
  refreshDailyUseLimitsForAllCharacters({ save: true });
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


function isGeneratedShopAssetUrl(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  try {
    const parsed = new URL(text, "http://local.invalid");
    return parsed.pathname.startsWith("/asset/shop/");
  } catch {
    return /\/asset\/shop\//.test(text);
  }
}

function getGeneratedShopAssetPath(value) {
  const text = String(value || "").trim();
  if (!text || !isGeneratedShopAssetUrl(text)) return "";
  try {
    const parsed = new URL(text, "http://local.invalid");
    return parsed.searchParams.get("path") || "image";
  } catch {
    const match = text.match(/[?&]path=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : "image";
  }
}

function sanitizeIncomingShopItemImageValue(previousItem, value) {
  if (value === undefined) return undefined;
  const text = String(value || "").trim();
  if (!text) return value;
  if (isAssetFileUrl(text) || isDataImage(text)) return text;
  if (!isGeneratedShopAssetUrl(text)) return value;
  const pathKey = getGeneratedShopAssetPath(text) || "image";
  const previous = getValueByPath(previousItem || {}, pathKey);
  return previous || undefined;
}

function buildPublicShopItem(item = {}) {
  const normalized = normalizeShopItem(item);
  const version = normalized.updatedAt || normalized.assetVersion || "";
  if (isDataImage(normalized.image)) {
    normalized.image = toShopAssetUrl(normalized.id, "image", version);
  }
  return normalized;
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

function hasShopItemImage(item) {
  if (!item || typeof item !== "object") return false;
  return [item.image, item.imageUrl, item.icon, item.thumbnail, item.asset, item.assetUrl].some((value) => String(value || "").trim());
}

function isAutoGeneratedInvestigationShopItem(item) {
  const id = String(item?.id || "");
  const description = String(item?.description || "");
  return /^auto-/i.test(id) && !hasShopItemImage(item) && /자동 등록된 아이템/.test(description);
}

function cleanupAutoGeneratedInvestigationShopItems() {
  const before = Array.isArray(shopItemsDB) ? shopItemsDB.length : 0;
  shopItemsDB = (Array.isArray(shopItemsDB) ? shopItemsDB : []).filter((item) => !isAutoGeneratedInvestigationShopItem(item));
  if (shopItemsDB.length !== before) {
    writeJsonFileSafe(shopItemsPath, shopItemsDB.map(normalizeShopItem));
    return true;
  }
  return false;
}

function syncShopItemsWithKnownItems() {
  // 조사 보상/단서 이름을 상점 아이템으로 자동 등록하면 운영자가 만든 아이템 목록과
  // 계정 선택 색인이 오염될 수 있어, 기존 자동 생성 항목만 정리하고 새로 추가하지 않습니다.
  cleanupAutoGeneratedInvestigationShopItems();
}

app.get("/shopItems", (req, res) => {
  syncShopItemsWithKnownItems();
  res.json(shopItemsDB.map(buildPublicShopItem));
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
  res.json({ success: true, items: shopItemsDB.map(buildPublicShopItem) });
});
app.post("/shopItems", (req, res) => {
  syncShopItemsWithKnownItems();
  const rawPayload = req.body || {};
  const id = rawPayload.id || `item-${Date.now()}`;
  const target = shopItemsDB.find((item) => String(item.id) === String(id));
  const payload = normalizeShopItem({
    ...rawPayload,
    id,
    image: sanitizeIncomingShopItemImageValue(target, rawPayload.image ?? rawPayload.icon),
    updatedAt: Date.now(),
  });
  if (target) Object.assign(target, normalizeShopItem({ ...target, ...payload, id }));
  else shopItemsDB.push(normalizeShopItem({ ...payload, id }));
  writeJsonFileSafe(shopItemsPath, shopItemsDB.map(normalizeShopItem));
  syncShopItemsWithKnownItems();
  res.json({ success: true, items: shopItemsDB.map(buildPublicShopItem) });
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
  return res.json({ success: true, character: buildPublicCharacter(char), item: buildPublicShopItem(item) });
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
  return res.json({ success: true, character: buildPublicCharacter(char), item: buildPublicShopItem(item) });
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

  const ownedKey = getInventoryItemKey(char.items[index]);
  const item = findShopItemByLooseId(ownedKey) || findShopItemByLooseId(key) || normalizeShopItem({ name: ownedKey || key });
  const normalized = normalizeShopItem(item);
  const useType = String(normalized.useType || "none").toLowerCase();
  const useValue = Number(normalized.useValue || 0);
  const usableTypes = new Set(["heal", "hp", "corrosion", "corrosiondown", "reducecorrosion", "corrosionheal", "corrosionup", "increasecorrosion", "corrosionincrease", "addcorrosion", "coin", "coins", "stat", "statboost", "statpoint", "skill"]);
  if (!usableTypes.has(useType)) {
    return res.json({ success: false, message: "사용 효과가 설정되지 않은 아이템입니다." });
  }
  const [removed] = char.items.splice(index, 1);

  if (useType === "heal" || useType === "hp") {
    const maxHp = getCharacterMaxHp(char?.stats?.hp);
    const currentHp = Number.isFinite(Number(char.currentHp)) ? Number(char.currentHp) : maxHp;
    const hpDelta = Number.isFinite(useValue) && useValue !== 0 ? useValue : 10;
    char.currentHp = Math.max(0, Math.min(maxHp, currentHp + hpDelta));
  }

  if (useType === "corrosion" || useType === "corrosiondown" || useType === "reducecorrosion" || useType === "corrosionheal") {
    char.corrosion = Math.max(0, Number(char.corrosion || 0) - Math.max(0, useValue || 5));
  }

  if (useType === "corrosionup" || useType === "increasecorrosion" || useType === "corrosionincrease" || useType === "addcorrosion") {
    char.corrosion = Math.max(0, Math.min(100, Number(char.corrosion || 0) + Math.max(0, useValue || 5)));
  }

  if (useType === "coin" || useType === "coins") {
    char.coins = Math.max(0, Number(char.coins || 0) + useValue);
  }

  if (useType === "stat" || useType === "statboost") {
    const statTarget = String(normalized.statTarget || normalized.stat || normalized.target || "").trim();
    if (statTarget) {
      char.stats = normalizeCharacterStats(char.stats || {});
      char.stats[statTarget] = Number(char.stats?.[statTarget] || 0) + useValue;
    }
  }

  if (useType === "statpoint") {
    char.statPoints = Math.max(0, Number(char.statPoints || 0) + useValue);
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

function getMailCharacterSummary(characterId) {
  const char = charactersDB.find((item) => String(item?.id) === String(characterId));
  if (!char) return { name: "", image: "" };
  return {
    name: String(char.name || char.id || ""),
    image: String(char.image || char.profileImage || char.mainImage || char.investigationImage || ""),
  };
}

function enrichMailForBox(mail, mailbox = "inbox") {
  const from = getMailCharacterSummary(mail?.fromCharacterId);
  const to = getMailCharacterSummary(mail?.toCharacterId);
  return {
    ...mail,
    mailbox,
    fromName: String(mail?.fromName || from.name || "알 수 없음"),
    fromImage: String(mail?.fromImage || from.image || ""),
    toName: String(mail?.toName || to.name || "알 수 없음"),
    toImage: String(mail?.toImage || to.image || ""),
  };
}

app.get("/mails/unreadCount/:characterId", (req, res) => {
  const count = mailsDB.filter((mail) => String(mail.toCharacterId) === String(req.params.characterId) && !mail.read).length;
  res.json({ count });
});
app.get("/mails/sent/:characterId", (req, res) => {
  res.json(mailsDB
    .filter((mail) => String(mail.fromCharacterId) === String(req.params.characterId))
    .map((mail) => enrichMailForBox(mail, "sent"))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
});
app.get("/mails/:characterId", (req, res) => {
  res.json(mailsDB
    .filter((mail) => String(mail.toCharacterId) === String(req.params.characterId))
    .map((mail) => enrichMailForBox(mail, "inbox"))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
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
  char.updatedAt = Date.now();
  char.assetVersion = char.updatedAt;
  target.received = true;
  target.read = true;
  writeRuntimeArray("characters.json", charactersDB);
  writeJsonFileSafe(mailsPath, mailsDB);
  res.json({ success: true, character: char });
});


app.post("/deleteInvestigation", (req, res) => {
  const { id } = req.body || {};
  const safeId = String(id || "").trim();
  if (!safeId) return res.json({ success: false, message: "삭제할 조사를 찾지 못했습니다." });
  const beforeRuntimeCount = investigationsDB.length;
  investigationsDB = investigationsDB.filter((v) => String(v?.id || "") !== safeId);
  const templateMarked = markCustomTemplateRuntimeDeleted(safeId, true);
  if (investigationsDB.length === beforeRuntimeCount && !templateMarked) {
    return res.json({ success: false, message: "조사를 찾지 못했습니다." });
  }
  delete roomChats[safeId];
  saveInvestigationsRuntimeState();
  if (templateMarked) writeCustomInvestigationsToFile(customInvestigationsDB);
  emitParticipantsUpdated();
  emitInvestigationState(safeId);
  res.json({ success: true, templatePreserved: templateMarked });
});

app.post("/admin/resetEndedInvestigation", (req, res) => {
  const { id } = req.body || {};
  const safeId = String(id || "").trim();
  if (!safeId) return res.json({ success: false, message: "초기화할 조사를 찾지 못했습니다." });
  const item = investigationsDB.find((v) => String(v?.id || "") === safeId);
  if (!item) return res.json({ success: false, message: "조사를 찾지 못했습니다." });
  if (!item.ended) return res.json({ success: false, message: "종료된 조사만 초기화할 수 있습니다." });

  const wasDailyRuntimeInstance = isDailyRuntimeInstance(item);
  const dailySourceId = item.dailySourceId;
  const wasHidden = !!item.hidden;
  resetInvestigationProgress(item);
  item.started = false;
  item.ended = false;
  item.endedAt = "";
  item.endedReason = "";
  item.resultSummary = "";
  item.readyToEnd = false;
  item.endNoticeDismissed = false;
  item.endConfirmations = [];
  if (wasDailyRuntimeInstance) {
    item.dailyRuntimeInstance = true;
    item.dailySourceId = dailySourceId;
    item.hidden = wasHidden;
  }
  roomChats[safeId] = [];
  saveInvestigationsRuntimeState();
  emitParticipantsUpdated();
  emitInvestigationState(safeId);
  res.json({ success: true, item: getInvestigationSummary(item) });
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
  syncInvestigationParticipantHpToCharacters(item);
  applyInvestigationEndCorrosion(item);
  saveInvestigationsRuntimeState();
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
  const shouldRunAssetCompact = process.env.PLC_ENABLE_ASSET_COMPACT === "1";
  if (shouldRunAssetCompact) {
    const assetCompactDelayMs = Number(process.env.PLC_ASSET_COMPACT_DELAY_MS || (process.env.RENDER ? 600000 : 3000));
    setTimeout(runAssetCompactChildProcess, assetCompactDelayMs);
  }
}

function loadMastodonEnvIfPresent() {
  const envPaths = [
    path.join(__dirname, ".env"),
    path.join(__dirname, "mastodon-bot", ".env"),
  ];
  envPaths.forEach((envPath) => {
    try {
      if (!fs.existsSync(envPath)) return;
      const lines = fs.readFileSync(envPath, "utf-8").split(/\r?\n/);
      lines.forEach((raw) => {
        const line = String(raw || "").trim();
        if (!line || line.startsWith("#") || !line.includes("=")) return;
        const eqIndex = line.indexOf("=");
        const key = line.slice(0, eqIndex).trim();
        const value = line.slice(eqIndex + 1).trim().replace(/^['"]|['"]$/g, "");
        if (key && process.env[key] === undefined) process.env[key] = value;
      });
    } catch (error) {
      console.error("[mastodon-bot] .env 읽기 실패:", error.message);
    }
  });
}

try {
  loadMastodonEnvIfPresent();
  let mastodonModule = null;
  let mastodonLoadError = null;
  for (const modulePath of ["./mastodon-bot", "./mastodon-bot/mastodonBot"]) {
    try {
      mastodonModule = require(modulePath);
      break;
    } catch (error) {
      mastodonLoadError = error;
    }
  }

  if (!mastodonModule?.startMastodonBot) {
    throw mastodonLoadError || new Error("startMastodonBot 함수를 찾을 수 없습니다.");
  }

  if (process.env.MASTODON_ACCESS_TOKEN && process.env.MASTODON_BASE_URL) {
    mastodonModule.startMastodonBot();
    console.log("[mastodon-bot] 봇 실행을 시작했습니다.");
  } else {
    console.log("[mastodon-bot] 환경변수가 없어 봇을 실행하지 않았습니다.");
  }
} catch (error) {
  console.error("[mastodon-bot] 봇 실행 실패:", error);
}
