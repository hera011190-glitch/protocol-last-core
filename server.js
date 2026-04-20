const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const compression = require("compression");
const fs = require("fs");
const path = require("path");
const defaultDesign = require("./defaultDesign");

const app = express();
const REQUEST_BODY_LIMIT = "100mb";
const CLIENT_URL = process.env.CLIENT_URL || "";
const PORT = Number(process.env.PORT || 3001);
const LEGACY_DATA_DIR = __dirname;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "..", "protocol-last-core-data"));

fs.mkdirSync(DATA_DIR, { recursive: true });

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

function readJsonFromPath(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (error) {
    console.error("readJsonFromPath failed", filePath, error);
    return fallback;
  }
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

["users.json", "characters.json", "relationRequests.json", "relations.json", "mails.json", "investigations.json"].forEach((filename) => ensureRuntimeFile(filename, []));
["designConfig.json", "customInvestigations.json", "shopItems.json", "shopConfig.json"].forEach((filename) => ensureRuntimeFile(filename));

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

const server = http.createServer(app);
const io = new Server(server, { cors: corsOptions });

const pendingJsonWrites = new Map();

function scheduleJsonWrite(filePath, value, { delay = 12 } = {}) {
  const payload = JSON.stringify(value, null, 2);
  const existing = pendingJsonWrites.get(filePath);
  if (existing?.timer) clearTimeout(existing.timer);
  const timer = setTimeout(async () => {
    try {
      await fs.promises.writeFile(filePath, payload, "utf-8");
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
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error(`readRuntimeArray failed: ${filename}`, error);
    return [];
  }
}

function writeRuntimeArray(filename, value) {
  try {
    const filePath = resolveDataPath(filename);
    scheduleJsonWrite(filePath, Array.isArray(value) ? value : []);
  } catch (error) {
    console.error(`writeRuntimeArray failed: ${filename}`, error);
  }
}

let usersDB = readRuntimeArray("users.json");
let charactersDB = readRuntimeArray("characters.json");
let roomChats = {};
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

function sendDataImage(res, value) {
  const match = String(value || "").match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return res.status(404).end();
  const [, mime, payload] = match;
  res.set("Cache-Control", "public, max-age=31536000, immutable");
  res.type(mime);
  return res.send(Buffer.from(payload, "base64"));
}

function toCharacterAssetUrl(characterId, pathKey, version = "") {
  const base = `/asset/character/${encodeURIComponent(String(characterId || "unknown"))}?path=${encodeURIComponent(String(pathKey || ""))}`;
  return version ? `${base}&v=${encodeURIComponent(String(version))}` : base;
}

function toInvestigationAssetUrl(investigationId, pathKey) {
  return `/asset/investigation/${encodeURIComponent(String(investigationId || "unknown"))}?path=${encodeURIComponent(String(pathKey || ""))}`;
}

function toDesignAssetUrl(pathKey) {
  return `/asset/design?path=${encodeURIComponent(String(pathKey || ""))}`;
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

const savedDesign = readJsonFromPath(resolveDataPath("designConfig.json"), readJsonFromPath(resolveBundledPath("designConfig.json"), {}));
let designConfig = defaultDesign;
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

function getCharacterHpStat(rawHp) {
  const value = Number(rawHp || 0);
  if (value >= 100) return Math.max(0, Math.round((value - 100) / 10));
  return Math.max(0, value);
}

function getCharacterMaxHp(rawHp) {
  const value = Number(rawHp || 0);
  if (value >= 100) return Math.max(100, value);
  return 100 + Math.max(0, value) * 10;
}

function getCharacterCurrentHp(character) {
  const maxHp = getCharacterMaxHp(character?.stats?.hp);
  const current = Number(character?.currentHp);
  if (Number.isFinite(current)) return Math.max(0, Math.min(maxHp, current));
  return maxHp;
}

function baseParticipantState(character) {
  const maxHp = getCharacterMaxHp(character?.stats?.hp);
  const hp = getCharacterCurrentHp(character);
  return {
    name: character?.name || "알 수 없음",
    maxHp,
    hp,
    status: "정상",
    atk: Number(character?.stats?.atk || 5),
    def: Number(character?.stats?.def || 5),
    agi: Number(character?.stats?.agi || 5),
    image: character?.investigationImage || character?.image || "",
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

function normalizeBattle(battle) {
  if (!battle) return null;
  return {
    name: String(battle?.name || "E-Beast"),
    hp: Number(battle?.hp || 0),
    maxHp: Number(battle?.maxHp || battle?.hp || 0),
    atk: Number(battle?.atk || 0),
    def: Number(battle?.def || 0),
    agi: Number(battle?.agi || 0),
    aoe_chance: Number(battle?.aoe_chance || 0.3),
    finisher_chance: Number(battle?.finisher_chance || 0.05),
    finisherType: String(battle?.finisherType || "single"),
    rewardPoints: Number(battle?.rewardPoints || 0),
    rewardItem: String(battle?.rewardItem || ""),
    image: String(battle?.image || ""),
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
  const startNodeId = def.data.start;
  const startNode = normalizedNodes[startNodeId];

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
    opened: true,
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

function getInvestigationSummary(item) {
  syncInvestigationRoster(item);
  const participantsCount = Array.isArray(item.participants) ? item.participants.length : 0;
  const uniqueVisitedCount = Array.from(new Set((item.routeHistory || []).map((entry) => entry.nodeId))).length;
  const nodeCount = Object.keys(item.data?.nodes || {}).length || 1;
  const progressPercent = Math.min(100, Math.round((uniqueVisitedCount / Math.max(nodeCount, 1)) * 100));
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
  item.participantStates[character.name] = {
    ...current,
    maxHp: getCharacterMaxHp(character?.stats?.hp ?? current.maxHp ?? 100),
    atk: Number(character?.stats?.atk || current.atk || 5),
    def: Number(character?.stats?.def || current.def || 5),
    agi: Number(character?.stats?.agi || current.agi || 5),
    image: character?.investigationImage || character?.image || current.image || "",
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
  item.sharedLogs.push(createLogEntry(summary));
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

function getNpcSceneKey(item, nodeId = item?.currentNodeId) {
  const node = item?.data?.nodes?.[nodeId];
  if (!node?.npcScene?.lines?.length) return "";
  return String(node.npcScene.name || nodeId || "npc-scene");
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

function allParticipantsDown(item) {
  const states = Object.values(item.participantStates || {});
  return states.length > 0 && states.every((state) => state.hp <= 0);
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
  const [type, payload] = raw.split("::");
  return { type: type || "공격", payload: payload || "" };
}

function getSkillSpec(skillKey) {
  const key = String(skillKey || "").trim();
  const byCatalog = (shopItemsDB || []).find((item) => item?.useType === "skill" && [item.skillKey, item.useValue, item.skillName, item.name].map((v) => String(v || "").trim()).includes(key));
  if (byCatalog) {
    const effect = String(byCatalog.skillEffect || "damage");
    const mode = effect === "heal" ? "heal" : effect === "buff" ? "buff" : effect === "shield" ? "shield" : effect === "debuff" ? "debuff" : "damage";
    return {
      label: byCatalog.skillName || byCatalog.name || key || "스킬",
      mode,
      power: Number(byCatalog.skillPower || byCatalog.useValue || 0),
      heal: Number(byCatalog.skillPower || byCatalog.useValue || 0),
      buff: Number(byCatalog.skillPower || 3),
      shield: Number(byCatalog.skillPower || 6),
      cooldownTurns: Number(byCatalog.cooldownTurns || 0),
    };
  }
  if (key === "pierce") return { label: "관통", mode: "damage", power: 10, cooldownTurns: 0 };
  if (key === "drain") return { label: "흡수", mode: "drain", power: 7, heal: 6, cooldownTurns: 0 };
  if (key === "focus") return { label: "집중", mode: "buff", buff: 3, cooldownTurns: 0 };
  return { label: key || "기본 스킬", mode: "damage", power: 8, cooldownTurns: 0 };
}

function rollEvasion(attackerAgi, defenderAgi) {
  const chance = Math.max(0.03, Math.min(0.32, 0.06 + (Number(defenderAgi || 0) - Number(attackerAgi || 0)) * 0.015));
  return Math.random() < chance;
}

function rollCritical(agi) {
  const chance = Math.max(0.05, Math.min(0.3, 0.06 + Number(agi || 0) * 0.012));
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
    state.status = state.hp <= 0 ? "행동불능" : "후퇴 실패";
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
  if (typeof battle.maxHp !== "number") battle.maxHp = Number(battle.hp || 0);
  if (typeof battle.def !== "number") battle.def = 2;
  if (typeof battle.atk !== "number") battle.atk = 6;
  if (typeof battle.aoe_chance !== "number") battle.aoe_chance = 0.3;
  if (typeof battle.finisher_chance !== "number") battle.finisher_chance = 0.05;
  if (!battle.finisherType) battle.finisherType = "single";

  const aliveNames = (item.participants || [])
    .filter((participant) => !participant?.isAdmin && String(participant?.id || "") !== "admin" && String(participant?.ownerId || "") !== "admin" && participant?.name !== "운영자")
    .map((participant) => participant.name)
    .filter((name) => Number(item.participantStates?.[name]?.hp || 0) > 0);
  if (aliveNames.length === 0) return { success: false, message: "행동 가능한 인원이 없습니다." };

  const missing = aliveNames.filter((name) => !actions?.[name]);
  if (missing.length > 0) return { success: false, message: `아직 행동을 정하지 않은 인원: ${missing.join(", ")}` };

  if (!battle.__engaged) {
    const scale = Math.max(1, Math.min(2.2, 1 + Math.max(0, aliveNames.length - 1) * 0.42));
    battle.maxHp = Math.max(Number(battle.maxHp || battle.hp || 0), Math.round(Number(battle.maxHp || battle.hp || 0) * scale));
    battle.hp = Math.max(Number(battle.hp || 0), battle.maxHp);
    battle.atk = Math.max(1, Math.round(Number(battle.atk || 0) * (aliveNames.length >= 3 ? 0.92 : 1)));
    battle.__engaged = true;
    battle.turnsElapsed = 0;
  }

  item.pendingBattleActions = clone(actions);
  item.lastBattleRound = [];
  const roundLogs = [createBattleLogEntry("[아군 행동]", "allies", { isPhaseHeader: true })];
  const persistRoundLogsToShared = (entries) => {
    (Array.isArray(entries) ? entries : []).forEach((entry) => {
      if (!entry?.text) return;
      item.sharedLogs.push(createLogEntry(entry.text));
    });
    item.sharedLogs = item.sharedLogs.slice(-160);
  };
  const actingOrder = aliveNames.map((name) => ({ name, ...item.participantStates[name] }))
    .sort((a, b) => Number(b.agi || 0) - Number(a.agi || 0));

  actingOrder.forEach((actor) => {
    const state = item.participantStates[actor.name];
    if (!state || state.hp <= 0 || !node.battle) return;
    const parsed = parseBattleAction(actions[actor.name]);
    state.defending = false;

    const atkBuff = getBuffValue(state, "atkUp");
    const guardBuff = getBuffValue(state, "guardUp");

    if (parsed.type === "방어") {
      state.defending = true;
      addBuff(state, "guardUp", 1, 2);
      state.status = "방어 태세";
      roundLogs.push(createBattleLogEntry(`${actor.name}은(는) 방어 태세를 취했습니다.`, "allies", { actor: actor.name, effect: "guard", snapshot: { participantStates: cloneParticipantStates(item.participantStates), battleHp: Number(battle.hp || 0), battleMaxHp: Number(battle.maxHp || 0) } }));
      return;
    }

    if (parsed.type === "아이템") {
      const result = consumeBattleItem(item, state, parsed.payload);
      state.status = result.changed ? "회복" : "대기";
      roundLogs.push(createBattleLogEntry(result.text, "allies", { actor: actor.name, effect: "item", snapshot: { participantStates: cloneParticipantStates(item.participantStates), battleHp: Number(battle.hp || 0), battleMaxHp: Number(battle.maxHp || 0) } }));
      return;
    }

    if (parsed.type === "스킬") {
      const spec = getSkillSpec(parsed.payload);
      if (!state.skillCooldowns || typeof state.skillCooldowns !== "object") state.skillCooldowns = {};
      const cooldownLeft = Number(state.skillCooldowns[parsed.payload] || 0);
      if (cooldownLeft > 0) {
        roundLogs.push({ text: `${actor.name}은(는) ${spec.label}을 아직 사용할 수 없습니다. (${cooldownLeft}턴 남음)`, phase: "allies" });
        return;
      }
      if (Number(spec.cooldownTurns || 0) > 0) state.skillCooldowns[parsed.payload] = Number(spec.cooldownTurns || 0) + 1;
      if (spec.mode === "buff") {
        addBuff(state, "atkUp", 2, spec.buff || 3);
        state.status = "공격 강화";
        roundLogs.push(createBattleLogEntry(`${actor.name}은(는) ${spec.label}을 사용해 힘을 끌어올렸습니다.`, "allies", { actor: actor.name, effect: "skill", snapshot: { participantStates: cloneParticipantStates(item.participantStates), battleHp: Number(battle.hp || 0), battleMaxHp: Number(battle.maxHp || 0) } }));
        return;
      }
      if (spec.mode === "heal") {
        const heal = Math.max(1, Number(spec.heal || spec.power || 0));
        state.hp = Math.min(state.maxHp, Number(state.hp || 0) + heal);
        state.status = "회복";
        roundLogs.push(createBattleLogEntry(`${actor.name}의 ${spec.label}! HP ${heal} 회복`, "allies", { actor: actor.name, effect: "heal", snapshot: { participantStates: cloneParticipantStates(item.participantStates), battleHp: Number(battle.hp || 0), battleMaxHp: Number(battle.maxHp || 0) } }));
        return;
      }
      if (spec.mode === "shield") {
        addBuff(state, "guardUp", 2, spec.shield || 6);
        state.status = "방어 강화";
        roundLogs.push(createBattleLogEntry(`${actor.name}은(는) ${spec.label}로 방어막을 둘렀습니다.`, "allies", { actor: actor.name, effect: "shield", snapshot: { participantStates: cloneParticipantStates(item.participantStates), battleHp: Number(battle.hp || 0), battleMaxHp: Number(battle.maxHp || 0) } }));
        return;
      }
      if (spec.mode === "debuff") {
        addBuff(battle, "atkDown", 2, -(Math.abs(Number(spec.power || 2))));
        state.status = "약화 부여";
        roundLogs.push(createBattleLogEntry(`${actor.name}은(는) ${spec.label}로 ${battle.name}을 약화시켰습니다.`, "allies", { actor: actor.name, effect: "debuff", snapshot: { participantStates: cloneParticipantStates(item.participantStates), battleHp: Number(battle.hp || 0), battleMaxHp: Number(battle.maxHp || 0) } }));
        return;
      }
      if (rollEvasion(Number(state.agi || 0), Number(battle.agi || 0))) {
        roundLogs.push(createBattleLogEntry(`${battle.name}가 ${actor.name}의 ${spec.label}을(를) 피해냈습니다!`, "allies", { actor: actor.name, target: battle.name, effect: "evade", snapshot: { participantStates: cloneParticipantStates(item.participantStates), battleHp: Number(battle.hp || 0), battleMaxHp: Number(battle.maxHp || 0) } }));
        return;
      }
      let damage = Math.max(3, Number(state.atk || 0) + atkBuff + Number(spec.power || 8) - Math.floor((Number(battle.def || 0) + getBuffValue(battle, "atkDown")) / 2));
      const crit = rollCritical(state.agi);
      if (crit) damage += 5;
      battle.hp = Math.max(0, Number(battle.hp || 0) - damage);
      if (spec.mode === "drain") {
        const heal = Number(spec.heal || 6);
        state.hp = Math.min(state.maxHp, Number(state.hp || 0) + heal);
        roundLogs.push(createBattleLogEntry(`${actor.name}의 ${spec.label}! ${damage}데미지 / HP ${heal} 회복${crit ? " / 치명타" : ""}`, "allies", { actor: actor.name, target: battle.name, effect: "drain", snapshot: { participantStates: cloneParticipantStates(item.participantStates), battleHp: Number(battle.hp || 0), battleMaxHp: Number(battle.maxHp || 0) } }));
      } else {
        roundLogs.push(createBattleLogEntry(`${actor.name}의 ${spec.label}! ${damage}데미지${crit ? " / 치명타" : ""}`, "allies", { actor: actor.name, target: battle.name, effect: "skill", snapshot: { participantStates: cloneParticipantStates(item.participantStates), battleHp: Number(battle.hp || 0), battleMaxHp: Number(battle.maxHp || 0) } }));
      }
      state.status = spec.label;
      if (battle.hp <= 0) roundLogs.push(createBattleLogEntry(`${battle.name}가 쓰러졌습니다.`, "allies", { target: battle.name, effect: "defeat", snapshot: { participantStates: cloneParticipantStates(item.participantStates), battleHp: Number(battle.hp || 0), battleMaxHp: Number(battle.maxHp || 0) } }));
      return;
    }

    if (rollEvasion(Number(state.agi || 0), Number(battle.agi || 0))) {
      roundLogs.push(createBattleLogEntry(`${battle.name}가 ${actor.name}의 공격을 피해냈습니다!`, "allies", { actor: actor.name, target: battle.name, effect: "evade", snapshot: { participantStates: cloneParticipantStates(item.participantStates), battleHp: Number(battle.hp || 0), battleMaxHp: Number(battle.maxHp || 0) } }));
      state.status = "회피당함";
      return;
    }

    const crit = rollCritical(state.agi);
    let damage = Math.max(1, Number(state.atk || 0) + atkBuff + 1 - Math.floor(Number(battle.def || 0) / 2));
    if (crit) damage += 4;
    state.status = crit ? "치명타" : "공격";
    battle.hp = Math.max(0, Number(battle.hp || 0) - damage);
    roundLogs.push(createBattleLogEntry(`${actor.name}의 ${crit ? "치명타!" : "공격!"} ${damage}데미지`, "allies", { actor: actor.name, target: battle.name, effect: "attack", snapshot: { participantStates: cloneParticipantStates(item.participantStates), battleHp: Number(battle.hp || 0), battleMaxHp: Number(battle.maxHp || 0) } }));
    if (battle.hp <= 0) roundLogs.push(createBattleLogEntry(`${battle.name}가 쓰러졌습니다.`, "allies", { target: battle.name, effect: "defeat", snapshot: { participantStates: cloneParticipantStates(item.participantStates), battleHp: Number(battle.hp || 0), battleMaxHp: Number(battle.maxHp || 0) } }));
  });


  if (battle.hp <= 0) {
    Object.values(item.participantStates || {}).forEach((state) => {
      if (!state) return;
      state.defending = false;
      if (Array.isArray(state.buffs)) state.buffs = state.buffs.filter((buff) => buff?.type !== "guardUp");
    });
    node.battle = null;
    if (battle.rewardItem) {
      queueRewardAssignment(item, { type: "item", label: battle.rewardItem, value: battle.rewardItem });
      roundLogs.push(createBattleLogEntry(`[보상] ${battle.rewardItem} 획득`, "allies", { effect: "item", snapshot: { participantStates: cloneParticipantStates(item.participantStates), battleHp: 0, battleMaxHp: Number(battle.maxHp || 0) } }));
    }
    item.rewards.push(`${battle.name} 제압`);
    setEventBanner(item, "승리", "success", 2600);
    const victoryText = `[${node.name}] ${battle.name}를 제압했습니다.${battle.rewardItem ? ` ${battle.rewardItem} 획득` : ""}`;
    item.sharedLog = victoryText;
    persistRoundLogsToShared(roundLogs);
    item.sharedLogs.push(createLogEntry(victoryText));
    item.sharedLogs = item.sharedLogs.slice(-160);
    item.lastBattleRound = roundLogs;
    item.pendingBattleActions = {};
    item.battleTurn += 1;

    const expReward = 15 + Number(battle.rewardPoints || 0);
    item.participants.forEach((participant) => {
      const char = charactersDB.find((c) => c.id === participant.id);
      if (!char) return;
      char.exp = Number(char.exp || 0) + expReward;
      char.coins = Number(char.coins || 0) + Math.max(8, Math.floor(Number(battle.rewardPoints || 0) / 2));
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
  const aliveTargets = Object.values(item.participantStates).filter((state) => Number(state.hp || 0) > 0);
  const enemyAtkPenalty = getBuffValue(battle, "atkDown");
  const finisher = Math.random() < Number(battle.finisher_chance || 0.05);
  const aoe = !finisher && Math.random() < Number(battle.aoe_chance || 0.3);

  if (finisher) {
    if (String(battle.finisherType || "single") === "aoe") {
      aliveTargets.forEach((state) => {
        const defendBonus = state.defending ? 3 : 0;
        const guardBuff = getBuffValue(state, "guardUp");
        if (rollEvasion(Number(battle.agi || 0), Number(state.agi || 0))) {
          roundLogs.push(createBattleLogEntry(`${state.name}이(가) ${battle.name}의 필살기를 피했습니다!`, "enemy", { actor: battle.name, target: state.name, effect: "evade", snapshot: { participantStates: cloneParticipantStates(item.participantStates), battleHp: Number(battle.hp || 0), battleMaxHp: Number(battle.maxHp || 0) } }));
          state.defending = false;
          return;
        }
        const damage = Math.max(3, Number(battle.atk || 0) + enemyAtkPenalty + 6 - Math.floor((Number(state.def || 0) + defendBonus + guardBuff) / 2));
        state.hp = Math.max(0, Number(state.hp || 0) - damage);
        state.status = state.hp <= 0 ? "행동불능" : "필살기 피격";
        roundLogs.push(createBattleLogEntry(`${battle.name}의 필살기! ${state.name} 피해 ${damage}`, "enemy", { actor: battle.name, target: state.name, effect: "damage", snapshot: { participantStates: cloneParticipantStates(item.participantStates), battleHp: Number(battle.hp || 0), battleMaxHp: Number(battle.maxHp || 0) } }));
        state.defending = false;
      });
    } else if (aliveTargets.length > 0) {
      const target = aliveTargets.sort((a, b) => Number(b.atk || 0) - Number(a.atk || 0))[0];
      const defendBonus = target.defending ? 4 : 0;
      const guardBuff = getBuffValue(target, "guardUp");
      if (rollEvasion(Number(battle.agi || 0), Number(target.agi || 0))) {
        roundLogs.push(createBattleLogEntry(`${target.name}이(가) ${battle.name}의 필살기를 피했습니다!`, "enemy", { actor: battle.name, target: target.name, effect: "evade", snapshot: { participantStates: cloneParticipantStates(item.participantStates), battleHp: Number(battle.hp || 0), battleMaxHp: Number(battle.maxHp || 0) } }));
      } else {
        const damage = Math.max(4, Number(battle.atk || 0) + enemyAtkPenalty + 8 - Math.floor((Number(target.def || 0) + defendBonus + guardBuff) / 2));
        target.hp = Math.max(0, Number(target.hp || 0) - damage);
        target.status = target.hp <= 0 ? "행동불능" : "필살기 피격";
        roundLogs.push(createBattleLogEntry(`${battle.name}의 필살기! ${target.name} 피해 ${damage}`, "enemy", { actor: battle.name, target: target.name, effect: "damage", snapshot: { participantStates: cloneParticipantStates(item.participantStates), battleHp: Number(battle.hp || 0), battleMaxHp: Number(battle.maxHp || 0) } }));
      }
      target.defending = false;
    }
  } else if (aoe) {
    aliveTargets.forEach((state) => {
      const defendBonus = state.defending ? 3 : 0;
      const guardBuff = getBuffValue(state, "guardUp");
      if (rollEvasion(Number(battle.agi || 0), Number(state.agi || 0))) {
        roundLogs.push(createBattleLogEntry(`${state.name}이(가) ${battle.name}의 전체 공격을 피했습니다!`, "enemy", { actor: battle.name, target: state.name, effect: "evade", snapshot: { participantStates: cloneParticipantStates(item.participantStates), battleHp: Number(battle.hp || 0), battleMaxHp: Number(battle.maxHp || 0) } }));
        state.defending = false;
        return;
      }
      const damage = Math.max(1, Number(battle.atk || 0) + enemyAtkPenalty + 1 - Math.floor((Number(state.def || 0) + defendBonus + guardBuff) / 2));
      state.hp = Math.max(0, Number(state.hp || 0) - damage);
      state.status = state.hp <= 0 ? "행동불능" : "피격";
      roundLogs.push(createBattleLogEntry(`${battle.name}의 전체 공격! ${state.name} 피해 ${damage}`, "enemy", { actor: battle.name, target: state.name, effect: "damage", snapshot: { participantStates: cloneParticipantStates(item.participantStates), battleHp: Number(battle.hp || 0), battleMaxHp: Number(battle.maxHp || 0) } }));
      state.defending = false;
    });
  } else if (aliveTargets.length > 0) {
    const target = aliveTargets.sort((a, b) => Number(b.atk || 0) - Number(a.atk || 0))[0];
    const defendBonus = target.defending ? 4 : 0;
    const guardBuff = getBuffValue(target, "guardUp");
    if (rollEvasion(Number(battle.agi || 0), Number(target.agi || 0))) {
      roundLogs.push(createBattleLogEntry(`${target.name}이(가) ${battle.name}의 공격을 피했습니다!`, "enemy", { actor: battle.name, target: target.name, effect: "evade", snapshot: { participantStates: cloneParticipantStates(item.participantStates), battleHp: Number(battle.hp || 0), battleMaxHp: Number(battle.maxHp || 0) } }));
    } else {
      const damage = Math.max(1, Number(battle.atk || 0) + enemyAtkPenalty + 2 - Math.floor((Number(target.def || 0) + defendBonus + guardBuff) / 2));
      target.hp = Math.max(0, Number(target.hp || 0) - damage);
      target.status = target.hp <= 0 ? "행동불능" : "집중 공격";
      roundLogs.push(createBattleLogEntry(`${battle.name}의 단일 공격! ${target.name} 피해 ${damage}`, "enemy", { actor: battle.name, target: target.name, effect: "damage", snapshot: { participantStates: cloneParticipantStates(item.participantStates), battleHp: Number(battle.hp || 0), battleMaxHp: Number(battle.maxHp || 0) } }));
    }
    target.defending = false;
  }

  Object.values(item.participantStates || {}).forEach((state) => {
    if (!state) return;
    state.defending = false;
    if (Array.isArray(state.buffs)) {
      state.buffs = state.buffs.filter((buff) => buff?.type !== "guardUp");
    }
  });

  const endTurnChanges = [];
  Object.values(item.participantStates).forEach((state) => {
    if (!state) return;
    const changes = tickBuffs(state);
    changes.forEach((change) => endTurnChanges.push({ owner: state.name, ...change }));
  });
  tickBuffs(battle);
  if (endTurnChanges.length > 0) {
    roundLogs.push(createBattleLogEntry("[상태 변화]", "allies", { isPhaseHeader: true }));
    endTurnChanges.forEach((change) => {
      const label = change.type === "atkUp" ? "공격 강화" : change.type === "guardUp" ? "방어 강화" : change.type === "atkDown" ? "약화" : change.type;
      roundLogs.push(createBattleLogEntry(`${change.owner}의 ${label} 효과가 정리되었습니다.`, "allies", { actor: change.owner, effect: change.type === "guardUp" ? "shield" : change.type === "atkUp" ? "buff" : "debuff", snapshot: { participantStates: cloneParticipantStates(item.participantStates), battleHp: Number(battle.hp || 0), battleMaxHp: Number(battle.maxHp || 0) } }));
    });
  }

  battle.turnsElapsed = Number(battle.turnsElapsed || 0) + 1;
  item.lastBattleRound = roundLogs;
  item.sharedLog = `[턴 ${item.battleTurn}] ${battle.name} HP ${battle.hp}/${battle.maxHp}`;
  persistRoundLogsToShared(roundLogs);
  item.pendingBattleActions = {};
  item.battleTurn += 1;

  if (allParticipantsDown(item)) {
    finishInvestigation(item, "전멸", "패배하였습니다. 활동할 수 있는 인원이 없습니다. 조사가 종료됩니다.");
  }

  emitInvestigationState(item.id);
  return { success: true };
}


app.get("/designConfig", (req, res) => res.json(designConfig));

app.get("/designConfigPublic", (req, res) => res.json(getPublicDesignShellConfig()));

app.get("/designMapsPublic", (req, res) => res.json(getPublicDesignMapsConfig()));

app.get("/asset/design", (req, res) => {
  const value = getValueByPath(designConfig, req.query.path || "");
  if (!isDataImage(value)) return res.status(404).end();
  return sendDataImage(res, value);
});

app.get("/asset/character/:id", (req, res) => {
  const character = charactersDB.find((item) => String(item.id) === String(req.params.id));
  if (!character) return res.status(404).end();
  let pathKey = String(req.query.path || "");
  if (pathKey === "profileImage") pathKey = pickCharacterAssetPath(character, ["image"]);
  if (pathKey === "mainImage" || pathKey === "cardImage") pathKey = pickCharacterAssetPath(character, ["mainImage", "image"]);
  if (pathKey === "investigationImage" || pathKey === "spriteImage") pathKey = pickCharacterAssetPath(character, ["investigationImage", "mainImage", "image"]);
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
  const nextId = String(req.body?.id || "").trim();
  const nextPw = String(req.body?.pw || "").trim();
  const type = req.body?.type || "owner";

  if (!nextId || !nextPw) {
    return res.json({ success: false, message: "아이디와 비밀번호를 입력해 주세요." });
  }
  if (nextId === "PLC") return res.json({ success: false, message: "이 아이디는 사용할 수 없습니다." });
  const exists = usersDB.find((u) => String(u.id || "").toLowerCase() === nextId.toLowerCase() );
  if (exists) return res.json({ success: false, message: "이미 존재하는 아이디입니다." });
  usersDB.push({ id: nextId, pw: nextPw, type });
  writeRuntimeArray("users.json", usersDB);
  res.json({ success: true });
});

app.post("/login", (req, res) => {
  const nextId = String(req.body?.id || "").trim();
  const nextPw = String(req.body?.pw || "").trim();
  if (!nextId || !nextPw) {
    return res.json({ success: false, message: "아이디와 비밀번호를 입력해 주세요." });
  }
  if (nextId === "PLC" && nextPw === "1119") {
    return res.json({ success: true, user: { id: "PLC", pw: "1119", type: "owner", isAdmin: true } });
  }
  const user = usersDB.find((u) => String(u.id || "").toLowerCase() === nextId.toLowerCase() && String(u.pw || "") === nextPw);
  if (!user) return res.json({ success: false, message: "아이디 또는 비밀번호가 맞지 않습니다." });
  res.json({ success: true, user: { ...user, isAdmin: false } });
});

app.post("/createCharacter", (req, res) => {
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
    stats: { atk: 5, hp: 0, def: 5, agi: 5 },
    currentHp: 100,
    skills: [],
    items: ["기본 지도"],
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

app.post("/updateCharacter", (req, res) => {
  const {
    charId,
    id,
    image,
    mainImage,
    investigationImage,
    profile,
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
    profileBgmVolume,
    sdQuotes,
    dailyAttemptsLeft,
    gambleCountLeft,
    currentMap,
    x,
    y,
    currentHp,
    skills,
    approved,
    name,
    mainImageFrame,
  } = req.body;

  const char = charactersDB.find((c) => String(c.id) === String(charId ?? id));

  if (!char) {
    return res.json({ success: false, message: "캐릭터를 찾을 수 없습니다." });
  }

  if (name !== undefined) char.name = name;
  if (image !== undefined) char.image = image;
  if (mainImage !== undefined) char.mainImage = mainImage;
  if (investigationImage !== undefined) char.investigationImage = investigationImage;
  if (profileBgm !== undefined) char.profileBgm = profileBgm;
  if (profileBgmVolume !== undefined) char.profileBgmVolume = Math.max(0, Math.min(1, Number(profileBgmVolume) || 0));
  if (profile !== undefined) char.profile = profile;
  if (level !== undefined) char.level = Number(level);
  if (statPoints !== undefined) char.statPoints = Number(statPoints);
  if (corrosion !== undefined) char.corrosion = Number(corrosion);
  if (coins !== undefined) char.coins = Number(coins);
  if (exp !== undefined) char.exp = Number(exp);
  if (stats !== undefined) char.stats = stats;
  if (items !== undefined) char.items = items;
  if (age !== undefined) char.age = age;
  if (bodyInfo !== undefined) char.bodyInfo = bodyInfo;
  if (rank !== undefined) char.rank = rank;
  if (oneLine !== undefined) char.oneLine = oneLine;
  if (mainImageFrame !== undefined) {
    char.mainImageFrame = {
      x: Number(mainImageFrame?.x ?? char.mainImageFrame?.x ?? 50),
      y: Number(mainImageFrame?.y ?? char.mainImageFrame?.y ?? 26),
      scale: Number(mainImageFrame?.scale ?? char.mainImageFrame?.scale ?? 1.06),
    };
  }
  if (sdQuotes !== undefined) char.sdQuotes = Array.isArray(sdQuotes) ? sdQuotes : [];
  if (dailyAttemptsLeft !== undefined) char.dailyAttemptsLeft = Number(dailyAttemptsLeft);
  if (gambleCountLeft !== undefined) char.gambleCountLeft = Number(gambleCountLeft);
  if (currentMap !== undefined) char.currentMap = currentMap;
  if (x !== undefined) char.x = Number(x);
  if (y !== undefined) char.y = Number(y);
  if (currentHp !== undefined) char.currentHp = Number(currentHp);
  if (skills !== undefined) char.skills = Array.isArray(skills) ? skills : [];
  if (approved !== undefined) char.approved = !!approved;

  const nextMaxHp = getCharacterMaxHp(char?.stats?.hp);
  if (!Number.isFinite(Number(char.currentHp))) char.currentHp = nextMaxHp;
  char.currentHp = Math.max(0, Math.min(nextMaxHp, Number(char.currentHp)));
  if (!Array.isArray(char.skills)) char.skills = [];
  if (!char.mainImageFrame || typeof char.mainImageFrame !== "object") {
    char.mainImageFrame = { x: 50, y: 26, scale: 1.06 };
  }
  char.updatedAt = Date.now();
  char.assetVersion = char.updatedAt;

  writeRuntimeArray("characters.json", charactersDB);
  return res.json({ success: true, character: buildPublicCharacter(char) });
});

app.get("/characters/:ownerId", (req, res) => res.json(charactersDB.filter((c) => c.ownerId === req.params.ownerId).map(attachRelationsToCharacter)));
app.get("/characters", (req, res) => res.json(charactersDB.map(attachRelationsToCharacter)));
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

  res.json({ success: true, started: true, investigationId: item.id });
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
        return res.json({ success: false, message: "다른 캐릭터가 진행 중인 일일조사입니다." });
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
  if (nextNode?.battle) {
    addSharedLog(item, `[E-Beast 조우] ${nextNode.battle.name || "E-Beast"}와 맞닥뜨렸다! 전원 전투 태세!`);
    setEventBanner(item, "전투 시작!", "danger", 2600);
  }

  const uniqueVisited = Array.from(new Set((item.routeHistory || []).map((route) => route.nodeId)));
  const nodeCount = Object.keys(item.data?.nodes || {}).length;
  if (uniqueVisited.length >= nodeCount && !item.readyToEnd && !nextNode.battle) {
    item.readyToEnd = true;
    item.endNoticeDismissed = false;
  }

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
  emitInvestigationState(investigationId);
  res.json({ success: true, currentNodeId: item.currentNodeId, sharedLog: item.sharedLog });
});

app.post("/setBattleAction", (req, res) => {
  const { investigationId, characterName, actionName } = req.body;
  const item = investigationsDB.find((v) => v.id === investigationId);
  if (!item) return res.json({ success: false, message: "조사를 찾을 수 없습니다." });
  if (item.ended) return res.json({ success: false, message: "이미 종료된 조사입니다." });
  const node = item.data?.nodes?.[item.currentNodeId];
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
  if (!characterName) return res.json({ success: false, message: "캐릭터 이름이 필요해." });

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

app.get("/admin/users", (req, res) => {
  const safeUsers = usersDB.map((user) => ({
    id: user.id,
    type: user.type,
  }));
  res.json(safeUsers);
});

// ===== custom investigation publish routes =====
// Paste this whole block into server.js
// Place it AFTER buildInvestigation / investigationDefinitions / investigationsDB are defined
// and BEFORE server.listen(...)

const customInvestigationsPath = path.join(__dirname, "customInvestigations.json");

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
    if (!fs.existsSync(customInvestigationsPath)) return [];
    const raw = fs.readFileSync(customInvestigationsPath, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("readCustomInvestigationsFromFile error", err);
    return [];
  }
}

function writeCustomInvestigationsToFile(list) {
  try {
    fs.writeFileSync(customInvestigationsPath, JSON.stringify(list, null, 2), "utf-8");
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
  if (existingIndex >= 0) {
    investigationsDB[existingIndex] = built;
  } else {
    investigationsDB.push(built);
  }
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
  if (!def.id || !def.title || !def.data?.start || !def.data?.nodes) {
    return res.json({ success: false, message: "조사 JSON 형식이 올바르지 않습니다." });
  }

  try {
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
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("readJsonArraySafe error", filePath, err);
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
  const profileImage = character.image || "";
  const mainImage = character.mainImage || profileImage || "";
  const investigationImage = character.investigationImage || mainImage || profileImage || "";
  const cardImage = mainImage || profileImage || "";
  const spriteImage = investigationImage || cardImage || "";
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
  const profilePath = pickCharacterAssetPath(character, ["image", "mainImage", "investigationImage"]);
  const mainPath = pickCharacterAssetPath(character, ["mainImage", "image"]);
  const spritePath = pickCharacterAssetPath(character, ["investigationImage", "mainImage", "image"]);

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

function buildPublicCharacter(character) {
  if (!character) return character;
  const detailed = attachRelationsToCharacter(character);
  const version = detailed.assetVersion || detailed.updatedAt || character.assetVersion || character.updatedAt || "";
  const mapped = mapDataImages(detailed, (pathKey) => toCharacterAssetUrl(character.id || character.name || "unknown", pathKey, version));
  const summary = buildPublicCharacterSummary(character) || {};
  return {
    ...mapped,
    image: summary.image || mapped.image || "",
    profileImage: summary.profileImage || mapped.profileImage || mapped.image || "",
    mainImage: summary.mainImage || mapped.mainImage || mapped.image || "",
    cardImage: summary.cardImage || mapped.cardImage || summary.mainImage || summary.profileImage || mapped.mainImage || mapped.image || "",
    investigationImage: summary.investigationImage || mapped.investigationImage || summary.mainImage || summary.profileImage || mapped.mainImage || mapped.image || "",
    spriteImage: summary.spriteImage || mapped.spriteImage || summary.investigationImage || summary.mainImage || summary.profileImage || mapped.investigationImage || mapped.mainImage || mapped.image || "",
  };
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

function buildPublicInvestigationState(item) {
  if (!item) return null;
  syncInvestigationRoster(item);
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
  res.json(charactersDB.map(summarizeCharacter));
});

app.get("/characters-public/:ownerId", (req, res) => {
  res.json(charactersDB.filter((c) => String(c.ownerId) === String(req.params.ownerId)).map(buildPublicCharacterSummary));
});

app.get("/characters-public", (req, res) => {
  res.json(charactersDB.map(buildPublicCharacterSummary));
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
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
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
  app.get("*", (req, res) => {
    if (req.path.startsWith("/socket.io")) return res.status(404).end();
    res.sendFile(path.join(clientBuildPath, "index.html"));
  });
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`서버 실행됨: ${PORT}`);
});
