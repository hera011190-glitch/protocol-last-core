/*
  Mastodon Dice / Daily Fortune / Magic Radio Bot for Node.js

  홈페이지 Node.js 서버(server.js) 안에서 같이 실행하기 위한 버전입니다.
  외부 npm 패키지 없이 Node 18+ 기본 fetch/fs만 사용합니다.
*/

const fs = require('fs');
const path = require('path');

const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, 'data');
const STATE_PATH = path.join(DATA_DIR, 'state.json');
const FORTUNES_PATH = path.join(DATA_DIR, 'fortunes.json');
const FORTUNE_USAGE_PATH = path.join(DATA_DIR, 'fortune_usage.json');
const DRONE_USAGE_PATH = path.join(DATA_DIR, 'drone_usage.json');
const INVENTORY_PATH = path.join(DATA_DIR, 'inventory.json');
const ENV_PATH = path.join(ROOT_DIR, '.env');

let runningBot = null;

function loadLocalEnv() {
  if (!fs.existsSync(ENV_PATH)) return;
  const lines = fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const eqIndex = line.indexOf('=');
    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    value = value.replace(/^['"]|['"]$/g, '');
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    const backupPath = `${filePath}.broken-${Date.now()}`;
    try { fs.renameSync(filePath, backupPath); } catch (_) {}
    console.error(`[마스토돈 봇 경고] JSON 파일을 읽지 못해 백업했습니다: ${backupPath}`);
    return fallback;
  }
}

function writeJson(filePath, data) {
  ensureDataDir();
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tempPath, filePath);
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>|<\/div>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function toBool(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  return String(value).toLowerCase() === 'true';
}

function getConfig() {
  loadLocalEnv();

  const baseUrl = String(process.env.MASTODON_BASE_URL || '').trim().replace(/\/$/, '');
  const accessToken = String(process.env.MASTODON_ACCESS_TOKEN || '').trim();
  const visibility = String(process.env.BOT_VISIBILITY || 'unlisted').trim();
  const pollIntervalSeconds = Number(process.env.POLL_INTERVAL_SECONDS || 1);
  const timezone = String(process.env.TIMEZONE || 'Asia/Seoul').trim() || 'Asia/Seoul';
  const replyOnUnknown = toBool(process.env.REPLY_ON_UNKNOWN, false);
  const startupCatchesOldMentions = toBool(process.env.STARTUP_CATCHES_OLD_MENTIONS, false);

  if (!baseUrl || !accessToken) {
    throw new Error('MASTODON_BASE_URL과 MASTODON_ACCESS_TOKEN 환경변수를 먼저 설정해 주세요.');
  }

  if (!['public', 'unlisted', 'private', 'direct'].includes(visibility)) {
    throw new Error('BOT_VISIBILITY는 public / unlisted / private / direct 중 하나여야 합니다.');
  }

  return {
    baseUrl,
    accessToken,
    visibility,
    pollIntervalSeconds: Number.isFinite(pollIntervalSeconds) && pollIntervalSeconds > 0 ? pollIntervalSeconds : 1,
    timezone,
    replyOnUnknown,
    startupCatchesOldMentions,
  };
}

function todayKey(timezone) {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(new Date());
  } catch (_) {
    const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return now.toISOString().slice(0, 10);
  }
}

function loadFortunes() {
  const data = readJson(FORTUNES_PATH, { fortunes: [] });
  const rawFortunes = Array.isArray(data.fortunes) ? data.fortunes : [];
  const fortunes = rawFortunes
    .map((item) => {
      if (typeof item === 'string') return { title: '오늘의 운세', text: item };
      if (item && typeof item === 'object' && String(item.text || '').trim()) return item;
      return null;
    })
    .filter(Boolean);

  if (fortunes.length === 0) {
    throw new Error('mastodon-bot/data/fortunes.json에 운세 문구를 1개 이상 넣어 주세요.');
  }

  return fortunes;
}

function normalizeCommandText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/／/g, '/')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeAcct(acct) {
  return String(acct || '')
    .toLowerCase()
    .replace(/^@+/, '')
    .trim();
}

function extractMushroomTransferAcct(text) {
  const normalized = normalizeCommandText(text);
  const match = normalized.match(/(?:^|\s)(?:\/\s*버섯\s*양도|버섯\s*양도)\s+@?([a-z0-9_][a-z0-9_.-]*(?:@[a-z0-9.-]+)?)/i);
  return match ? normalizeAcct(match[1]) : '';
}

function detectCommand(text) {
  const normalized = normalizeCommandText(text);
  if (/(\/\s*드론\s*수색|드론\s*수색)/.test(normalized)) return 'droneSearch';
  if (/(\/\s*버섯\s*양도|버섯\s*양도)/.test(normalized)) return 'mushroomTransfer';
  if (/(?:^|\s)(?:\/\s*버섯|버섯\s*(먹기|사용))(?:\s|$)/.test(normalized)) return 'mushroom';
  if (/(오늘\s*의\s*운세|오늘운세|운세)/.test(normalized)) return 'fortune';
  if (/(마법\s*의\s*라디오|마법라디오|y\s*\/\s*n|yes\s*or\s*no|예스\s*노)/.test(normalized)) return 'radio';
  if (/(다이스|dice|주사위)/.test(normalized)) return 'dice';
  return null;
}

function randomChoice(items) {
  return items[Math.floor(Math.random() * items.length)];
}

class MastodonBot {
  constructor(config) {
    this.config = config;
    this.state = readJson(STATE_PATH, {});
    this.fortuneUsage = readJson(FORTUNE_USAGE_PATH, {});
    this.droneUsage = readJson(DRONE_USAGE_PATH, {});
    this.inventory = readJson(INVENTORY_PATH, {});
    this.fortunes = loadFortunes();
    this.timer = null;
    this.isTicking = false;
    this.homeTimelineEnabled = true;
    this.homeTimelineDisabledLogged = false;
  }

  async apiRequest(method, apiPath, { query, form } = {}) {
    const url = new URL(`${this.config.baseUrl}${apiPath}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (Array.isArray(value)) {
          for (const item of value) url.searchParams.append(key, String(item));
        } else if (value !== undefined && value !== null && value !== '') {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const headers = {
      Authorization: `Bearer ${this.config.accessToken}`,
      'User-Agent': 'dice-fortune-radio-bot-node/1.0',
    };

    let body;
    if (form) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(form)) params.set(key, String(value));
      body = params;
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }

    const response = await fetch(url, { method, headers, body });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`API 오류 ${response.status}: ${text}`);
    }
    if (!text) return null;
    return JSON.parse(text);
  }

  isScopeError(error) {
    return /API 오류 403|authorized scopes/i.test(String(error && error.message ? error.message : error));
  }

  disableHomeTimeline(reason) {
    this.homeTimelineEnabled = false;
    if (!this.homeTimelineDisabledLogged) {
      console.error(`[마스토돈 봇 경고] 홈 타임라인 감지를 끕니다. ${reason} / 멘션 명령어는 계속 작동합니다.`);
      this.homeTimelineDisabledLogged = true;
    }
  }

  async fetchMentions() {
    const query = { limit: 40, 'types[]': ['mention'] };
    if (this.state.last_notification_id) query.since_id = String(this.state.last_notification_id);
    const mentions = await this.apiRequest('GET', '/api/v1/notifications', { query });
    return Array.isArray(mentions) ? mentions : [];
  }

  async fetchHomeTimeline() {
    const query = { limit: 40 };
    if (this.state.last_home_status_id) query.since_id = String(this.state.last_home_status_id);
    const statuses = await this.apiRequest('GET', '/api/v1/timelines/home', { query });
    return Array.isArray(statuses) ? statuses : [];
  }

  async postReply(statusId, acct, message) {
    await this.apiRequest('POST', '/api/v1/statuses', {
      form: {
        status: `@${acct} ${message}`.trim(),
        in_reply_to_id: statusId,
        visibility: this.config.visibility,
        language: 'ko',
      },
    });
  }

  makeDiceReply() {
    return `🎲 [${Math.floor(Math.random() * 99) + 1}] `;
  }

  makeRadioReply() {
    return randomChoice(['📻 YES.', '📻 NO.']);
  }

  makeFortuneReply(accountId) {
    const today = todayKey(this.config.timezone);
    const record = this.fortuneUsage[accountId];
    if (record && record.date === today) {
      return '🔮 오늘의 운세는 이미 확인하셨습니다. 내일 다시 불러 주세요.';
    }

    const fortune = randomChoice(this.fortunes);
    const parts = [
      `🔮 ${String(fortune.title || '오늘의 운세').trim()}`,
      String(fortune.text || '').trim(),
    ];

    if (fortune.lucky_item) parts.push(`행운의 물건: ${String(fortune.lucky_item).trim()}`);
    if (fortune.lucky_color) parts.push(`행운의 색: ${String(fortune.lucky_color).trim()}`);
    if (fortune.score) parts.push(`운세 점수: ${String(fortune.score).trim()}`);

    this.fortuneUsage[accountId] = { date: today, fortune };
    writeJson(FORTUNE_USAGE_PATH, this.fortuneUsage);
    return parts.join('\n');
  }


  getInventoryRecord(accountId) {
    const key = String(accountId || 'unknown');
    const record = this.inventory[key] && typeof this.inventory[key] === 'object'
      ? this.inventory[key]
      : {};
    record.mushroom = Number.isFinite(Number(record.mushroom)) ? Math.max(0, Math.floor(Number(record.mushroom))) : 0;
    this.inventory[key] = record;
    return record;
  }

  addMushroom(accountId, amount = 1) {
    const record = this.getInventoryRecord(accountId);
    record.mushroom += Math.max(0, Math.floor(Number(amount) || 0));
    writeJson(INVENTORY_PATH, this.inventory);
    return record.mushroom;
  }

  consumeMushroom(accountId) {
    const record = this.getInventoryRecord(accountId);
    if (record.mushroom <= 0) return { ok: false, remaining: 0 };
    record.mushroom -= 1;
    writeJson(INVENTORY_PATH, this.inventory);
    return { ok: true, remaining: record.mushroom };
  }

  transferMushroom(fromAccountId, toAccountId) {
    const fromRecord = this.getInventoryRecord(fromAccountId);
    const toRecord = this.getInventoryRecord(toAccountId);

    if (String(fromAccountId || '') === String(toAccountId || '')) {
      return { ok: false, reason: 'self', remaining: fromRecord.mushroom };
    }

    if (fromRecord.mushroom <= 0) {
      return { ok: false, reason: 'empty', remaining: 0 };
    }

    fromRecord.mushroom -= 1;
    toRecord.mushroom += 1;
    writeJson(INVENTORY_PATH, this.inventory);
    return { ok: true, remaining: fromRecord.mushroom, targetTotal: toRecord.mushroom };
  }

  findMushroomTransferTarget(status, actorAccountId) {
    const text = stripHtml(status && status.content ? status.content : '');
    const requestedAcct = extractMushroomTransferAcct(text);
    const mentions = Array.isArray(status && status.mentions) ? status.mentions : [];

    if (!requestedAcct) return null;

    return mentions.find((mention) => {
      const mentionId = String(mention && mention.id ? mention.id : '');
      if (!mentionId || mentionId === String(actorAccountId || '')) return false;

      const acct = normalizeAcct(mention.acct || '');
      const username = normalizeAcct(mention.username || '');
      return acct === requestedAcct
        || username === requestedAcct
        || acct.split('@')[0] === requestedAcct;
    }) || null;
  }

  makeDroneSearchReply(accountId) {
    const today = todayKey(this.config.timezone);
    const record = this.droneUsage[accountId];
    if (record && record.date === today) {
      return '🛰️ 드론 수색은 하루에 한 번만 가능합니다. 내일 다시 시도해 주세요.';
    }

    const droneSearchResults = [
      '[부숴진 드론의 잔해]를 찾았다.',
      '[버섯]을 찾았다.',
      '[밧줄]을 찾았다.',
      '[버려진 양말]을 찾았다.',
      '[청테이프]를 찾았다.',
      '[빈 물병]을 찾았다.',
      '[건전지]를 찾았다.',
      '[콜라]를 찾았다.',
      '[낡은 손전등]을 찾았다.',
      '[과자 봉지]를 찾았다.',
      '[콘돔]을 찾았다.',
      '[책]을 찾았다.',
      '[낚싯줄]을 찾았다.',
      '[선글라스]를 찾았다.',
      '[부숴진 드론의 프로펠러]를 찾았다.',
      '[부숴진 드론의 카메라 모듈]을 찾았다.',
      '[러브레터]를 찾았다.',
      '[코인]을 찾았다.',
      '[곰팡이 핀 빵]을 찾았다.',
      '[아무것도 찾지 못했다.]',
      '[수상한 소리]를 들었다.',
      '[수상한 발자국]을 발견했다.',
      '[정체불명의 점액]을 발견했다.',
      '[이비스트의 흔적]을 발견했다.',
      '[피 묻은 천 조각]을 발견했다.',
      '[누군가의 학생증]을 발견했다.',
      '[손상된 무전기]를 발견했다.',
    ];

    const mushroomResultText = '[버섯]을 찾았다.';
    const nonMushroomResults = droneSearchResults.filter((item) => item !== mushroomResultText);
    const resultText = Math.random() < 0.6 ? mushroomResultText : randomChoice(nonMushroomResults);
    if (resultText === mushroomResultText) {
      this.addMushroom(accountId, 1);
    }

    this.droneUsage[accountId] = { date: today };
    writeJson(DRONE_USAGE_PATH, this.droneUsage);
    return resultText;
  }

  makeMushroomReply(accountId) {
    const consumed = this.consumeMushroom(accountId);
    if (!consumed.ok) {
      return '🍄 보유한 버섯이 없습니다. /드론수색으로 버섯을 획득한 뒤 사용할 수 있습니다.';
    }

    const mushroomEffects = [
      '...몸이 서서히 달아오른다. 숨결도 평소보다 뜨겁다. 상태 이상 [흥분] 획득',
      '...환각이 보인다. 분명 방금 누군가 있었던 것 같은데, 착각이었을까? 상태 이상 [환각] 획득',
      '...숨이 가빠진다. 주변의 모든 것이 위협적으로 느껴진다. 상태 이상 [불안] 획득',
      '...무언가를 부수고 싶어진다. 이유 없는 분노가 치민다. 상태 이상 [폭력성] 획득',
      '...머리가 몽롱하다. 기분이 이상할 정도로 좋아진다. 자꾸만 웃음이 새어 나온다. 상태 이상 [고양] 획득',
      '...감각이 예민해진다. 멀리서 들리는 작은 소리도 유난히 크게 들린다. 상태 이상 [감각 과민] 획득',
      '...어쩐지 거짓말을 하기 싫어진다. 마음속 이야기가 자연스럽게 내뱉어진다. 상태 이상 [솔직함] 획득',
      '...자꾸만 주변을 두리번거리게 된다. 누군가 자신을 지켜보는 것만 같다. 상태 이상 [편집증] 획득',
      '...사소한 소리에도 움찔하게 된다. 신경이 극도로 곤두서 있다. 상태 이상 [경계] 획득',
      '...자꾸만 누군가와 이야기하고 싶어진다. 혼자 있는 것이 견디기 어렵다. 상태 이상 [의존] 획득',
    ];

    return [
      randomChoice(mushroomEffects),
      `남은 버섯: ${consumed.remaining}개`,
    ].join('\n');
  }

  makeMushroomTransferReply(fromAccountId, status) {
    const target = this.findMushroomTransferTarget(status, fromAccountId);
    if (!target || !target.id || !target.acct) {
      return '🍄 버섯을 양도할 캐릭터 아이디를 태그해 주세요. 예: /버섯양도 @아이디';
    }

    const transferred = this.transferMushroom(fromAccountId, target.id);
    if (!transferred.ok && transferred.reason === 'self') {
      return '🍄 자기 자신에게는 버섯을 양도할 수 없습니다.';
    }
    if (!transferred.ok) {
      return '🍄 보유한 버섯이 없습니다. /드론수색으로 버섯을 획득한 뒤 양도할 수 있습니다.';
    }

    return [
      `🍄 @${target.acct} 님에게 버섯 1개를 양도했습니다.`,
      `남은 버섯: ${transferred.remaining}개`,
    ].join('\n');
  }

  makeUnknownReply() {
    return [
      '사용 가능한 명령어는 다음과 같습니다.',
      '🎲 다이스: 1~99 랜덤 숫자',
      '🔮 오늘의운세: 계정당 하루 1회',
      '📻 마법의라디오: YES / NO',
      '🛰️ /드론수색: 계정당 하루 1회 수색',
      '🍄 /버섯: 보유한 버섯 1개 사용',
      '🍄 /버섯양도 @아이디: 보유한 버섯 1개 양도',
    ].join('\n');
  }

  updateLastNotification(notificationId) {
    const current = Number(this.state.last_notification_id || 0);
    const next = Number(notificationId || 0);
    if (Number.isFinite(next) && next > current) this.state.last_notification_id = String(notificationId);
    writeJson(STATE_PATH, this.state);
  }

  updateLastHomeStatus(statusId) {
    const current = Number(this.state.last_home_status_id || 0);
    const next = Number(statusId || 0);
    if (Number.isFinite(next) && next > current) this.state.last_home_status_id = String(statusId);
    writeJson(STATE_PATH, this.state);
  }

  isExplicitSlashCommand(text) {
    const normalized = normalizeCommandText(text);
    return /(^|\s)\/\s*(드론\s*수색|버섯|버섯\s*양도)(\s|$)/.test(normalized);
  }

  markStatusProcessed(statusId) {
    const processedStatuses = new Set((this.state.processed_status_ids || []).map(String));
    processedStatuses.add(String(statusId));
    this.state.processed_status_ids = Array.from(processedStatuses)
      .sort((a, b) => Number(a) - Number(b))
      .slice(-500);
    writeJson(STATE_PATH, this.state);
  }

  hasProcessedStatus(statusId) {
    return new Set((this.state.processed_status_ids || []).map(String)).has(String(statusId));
  }

  async handleMention(notification) {
    const notificationId = String(notification.id || '');
    const status = notification.status || {};
    const account = notification.account || {};
    const statusId = String(status.id || '');
    const accountId = String(account.id || '');
    const acct = String(account.acct || '').trim();

    if (!notificationId || !statusId || !accountId || !acct) return;

    const processed = new Set((this.state.processed_notification_ids || []).map(String));
    if (processed.has(notificationId) || this.hasProcessedStatus(statusId)) return;

    const text = stripHtml(status.content || '');
    const command = detectCommand(text);
    let reply = '';

    if (command === 'dice') reply = this.makeDiceReply();
    else if (command === 'fortune') reply = this.makeFortuneReply(accountId);
    else if (command === 'radio') reply = this.makeRadioReply();
    else if (command === 'droneSearch') reply = this.makeDroneSearchReply(accountId);
    else if (command === 'mushroomTransfer') reply = this.makeMushroomTransferReply(accountId, status);
    else if (command === 'mushroom') reply = this.makeMushroomReply(accountId);
    else if (this.config.replyOnUnknown) reply = this.makeUnknownReply();

    if (reply) {
      await this.postReply(statusId, acct, reply);
      console.log(`[마스토돈 봇 응답 완료] @${acct} / ${command || 'unknown'}`);
    }

    processed.add(notificationId);
    this.state.processed_notification_ids = Array.from(processed)
      .sort((a, b) => Number(a) - Number(b))
      .slice(-300);
    this.markStatusProcessed(statusId);
    this.updateLastNotification(notificationId);
  }

  async handleHomeStatus(status) {
    const statusId = String(status.id || '');
    const account = status.account || {};
    const accountId = String(account.id || '');
    const acct = String(account.acct || '').trim();

    if (!statusId || !accountId || !acct) return;
    if (this.hasProcessedStatus(statusId)) return;

    const text = stripHtml(status.content || '');
    if (!this.isExplicitSlashCommand(text)) return;

    const command = detectCommand(text);
    let reply = '';

    if (command === 'droneSearch') reply = this.makeDroneSearchReply(accountId);
    else if (command === 'mushroomTransfer') reply = this.makeMushroomTransferReply(accountId, status);
    else if (command === 'mushroom') reply = this.makeMushroomReply(accountId);

    if (reply) {
      await this.postReply(statusId, acct, reply);
      this.markStatusProcessed(statusId);
      console.log(`[마스토돈 봇 응답 완료] @${acct} / home / ${command}`);
    }
  }

  async initializeLastHomeStatusId() {
    if (!this.homeTimelineEnabled || this.state.last_home_status_id) return;

    let statuses = [];
    try {
      statuses = await this.fetchHomeTimeline();
    } catch (error) {
      if (this.isScopeError(error)) {
        this.disableHomeTimeline('현재 MASTODON_ACCESS_TOKEN에 홈 타임라인 읽기 권한(read:statuses 또는 read)이 없습니다.');
        return;
      }
      console.error(`[마스토돈 봇 경고] 홈 타임라인 초기화 실패: ${error.message}`);
      return;
    }

    if (!statuses.length) return;
    const newestId = statuses
      .map((item) => String(item.id || '0'))
      .sort((a, b) => Number(b) - Number(a))[0];
    this.state.last_home_status_id = newestId;
    writeJson(STATE_PATH, this.state);
    console.log('[마스토돈 봇 초기화] 기존 홈 타임라인 글은 건너뛰고, 새 /드론수색·/버섯·/버섯양도 글부터 응답합니다.');
  }

  async initializeLastNotificationId() {
    if (this.config.startupCatchesOldMentions || this.state.last_notification_id) return;
    const mentions = await this.fetchMentions();
    if (!mentions.length) return;
    const newestId = mentions
      .map((item) => String(item.id || '0'))
      .sort((a, b) => Number(b) - Number(a))[0];
    this.state.last_notification_id = newestId;
    this.state.processed_notification_ids = [];
    writeJson(STATE_PATH, this.state);
    console.log('[마스토돈 봇 초기화] 기존 멘션은 건너뛰고, 새 멘션부터 응답합니다.');
  }

  async tick() {
    if (this.isTicking) return;
    this.isTicking = true;
    try {
      const mentions = await this.fetchMentions();
      mentions.sort((a, b) => Number(a.id || 0) - Number(b.id || 0));
      for (const notification of mentions) {
        try {
          await this.handleMention(notification);
        } catch (error) {
          console.error(`[마스토돈 봇 오류] 멘션 처리 실패: ${error.message}`);
          if (notification && notification.id) this.updateLastNotification(String(notification.id));
        }
      }

      if (this.homeTimelineEnabled) {
        let statuses = [];
        try {
          statuses = await this.fetchHomeTimeline();
        } catch (error) {
          if (this.isScopeError(error)) {
            this.disableHomeTimeline('현재 MASTODON_ACCESS_TOKEN에 홈 타임라인 읽기 권한(read:statuses 또는 read)이 없습니다.');
            statuses = [];
          } else {
            console.error(`[마스토돈 봇 오류] 홈 타임라인 조회 실패: ${error.message}`);
            statuses = [];
          }
        }

        statuses.sort((a, b) => Number(a.id || 0) - Number(b.id || 0));
        for (const status of statuses) {
          try {
            await this.handleHomeStatus(status);
          } catch (error) {
            console.error(`[마스토돈 봇 오류] 홈 타임라인 처리 실패: ${error.message}`);
          } finally {
            if (status && status.id) this.updateLastHomeStatus(String(status.id));
          }
        }
      }
    } catch (error) {
      console.error(`[마스토돈 봇 오류] ${error.message}`);
    } finally {
      this.isTicking = false;
    }
  }

  async start() {
    console.log('[마스토돈 봇 시작]');
    console.log(`[마스토돈 봇 서버] ${this.config.baseUrl}`);
    console.log(`[마스토돈 봇 확인 주기] ${this.config.pollIntervalSeconds}초`);

    await this.initializeLastNotificationId();
    await this.initializeLastHomeStatusId();
    await this.tick();
    this.timer = setInterval(() => this.tick(), this.config.pollIntervalSeconds * 1000);
    return this;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

async function startMastodonBot() {
  if (runningBot) return runningBot;
  const config = getConfig();
  const bot = new MastodonBot(config);
  runningBot = bot;
  await bot.start();
  return bot;
}

module.exports = { startMastodonBot };

if (require.main === module) {
  startMastodonBot().catch((error) => {
    console.error(`[마스토돈 봇 실행 실패] ${error.message}`);
    process.exit(1);
  });
}
