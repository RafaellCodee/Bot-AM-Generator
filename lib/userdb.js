import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const databaseDir = path.resolve(__dirname, '../database');
const databaseFile = path.join(databaseDir, 'users.json');

export const REGISTER_LIMIT = 5;
export const LIMIT_RESET_TIMEZONE = 'Asia/Jakarta';

function getHourlyLimitWindow(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: LIMIT_RESET_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );

  return `${values.year}-${values.month}-${values.day}T${values.hour}:00`;
}

function applyHourlyLimitReset(user, date = new Date()) {
  if (!user?.registered) return false;

  const currentWindow = getHourlyLimitWindow(date);
  if (user.limitResetWindow === currentWindow) return false;

  user.limit = REGISTER_LIMIT;
  user.limitResetWindow = currentWindow;
  user.limitResetAt = date.toISOString();
  user.updatedAt = date.toISOString();
  return true;
}

export function resetAllHourlyLimits(date = new Date()) {
  const data = readDatabase();
  let changed = false;
  let resetCount = 0;

  for (const user of Object.values(data.users)) {
    if (applyHourlyLimitReset(user, date)) {
      changed = true;
      resetCount += 1;
    }
  }

  if (changed) writeDatabase(data);

  return {
    resetCount,
    window: getHourlyLimitWindow(date)
  };
}

function emptyDatabase() {
  return {
    version: 1,
    users: {},
    aliases: {}
  };
}

function ensureDatabase() {
  if (!fs.existsSync(databaseDir)) {
    fs.mkdirSync(databaseDir, { recursive: true });
  }

  if (!fs.existsSync(databaseFile)) {
    fs.writeFileSync(databaseFile, JSON.stringify(emptyDatabase(), null, 2));
  }
}

function readDatabase() {
  ensureDatabase();

  try {
    const data = JSON.parse(fs.readFileSync(databaseFile, 'utf8'));
    data.users ??= {};
    data.aliases ??= {};
    return data;
  } catch (error) {
    const backupFile = `${databaseFile}.broken-${Date.now()}`;
    try {
      fs.copyFileSync(databaseFile, backupFile);
    } catch {}

    const data = emptyDatabase();
    writeDatabase(data);
    return data;
  }
}

function writeDatabase(data) {
  ensureDatabase();
  const temporaryFile = `${databaseFile}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(data, null, 2));
  fs.renameSync(temporaryFile, databaseFile);
}

export function normalizeUserJid(value = '') {
  if (typeof value !== 'string') return '';
  const jid = value.trim();
  if (!jid.includes('@')) return '';

  const [rawUser, server] = jid.split('@');
  if (!rawUser || !server) return '';

  const user = rawUser.replace(/:\d+$/, '');
  return `${user}@${server}`;
}

function isLid(jid) {
  return typeof jid === 'string' && jid.endsWith('@lid');
}

function isPhoneJid(jid) {
  return typeof jid === 'string' && jid.endsWith('@s.whatsapp.net');
}

function uniqueUserJids(values) {
  return [...new Set(
    values
      .map(normalizeUserJid)
      .filter((jid) => isLid(jid) || isPhoneJid(jid))
  )];
}

export async function resolveUserIdentity(Rafael, m) {
  const key = m?.key || {};
  const contextInfo = m?.msg?.contextInfo || {};

  const candidates = uniqueUserJids([
    m?.sender,
    m?.senderAlt,
    key.participant,
    key.participantAlt,
    key.participantPn,
    key.senderPn,
    key.remoteJid,
    key.remoteJidAlt,
    contextInfo.participant,
    contextInfo.participantAlt,
    contextInfo.participantPn
  ]);

  let lid = candidates.find(isLid) || '';
  const jid = candidates.find(isPhoneJid) || '';

  if (!lid && jid && typeof Rafael?.jidToLid === 'function') {
    try {
      const mapped = normalizeUserJid(await Rafael.jidToLid(jid));
      if (isLid(mapped)) lid = mapped;
    } catch {}
  }

  if (!lid && jid) {
    try {
      const getLIDForPN = Rafael?.signalRepository?.lidMapping?.getLIDForPN;
      if (typeof getLIDForPN === 'function') {
        const mapped = normalizeUserJid(
          await getLIDForPN.call(Rafael.signalRepository.lidMapping, jid)
        );
        if (isLid(mapped)) lid = mapped;
      }
    } catch {}
  }

  return {
    key: lid || jid || normalizeUserJid(m?.sender) || '',
    lid: lid || null,
    jid: jid || null
  };
}

function findUserKey(data, identity) {
  const candidates = [identity?.lid, identity?.jid, identity?.key]
    .map(normalizeUserJid)
    .filter(Boolean);

  for (const candidate of candidates) {
    if (data.users[candidate]) return candidate;
    if (data.aliases[candidate] && data.users[data.aliases[candidate]]) {
      return data.aliases[candidate];
    }
  }

  return null;
}

function mergeUserRecords(primary, secondary) {
  if (!primary) return secondary;
  if (!secondary) return primary;

  return {
    ...secondary,
    ...primary,
    limit: Math.max(Number(primary.limit) || 0, Number(secondary.limit) || 0),
    ampremUsed: Math.max(Number(primary.ampremUsed) || 0, Number(secondary.ampremUsed) || 0),
    registeredAt: primary.registeredAt || secondary.registeredAt,
    name: primary.name || secondary.name,
    jid: primary.jid || secondary.jid,
    lid: primary.lid || secondary.lid
  };
}

function syncIdentity(data, identity) {
  const lid = normalizeUserJid(identity?.lid);
  const jid = normalizeUserJid(identity?.jid);
  let currentKey = findUserKey(data, identity);
  let changed = false;

  if (lid && currentKey && currentKey !== lid) {
    data.users[lid] = mergeUserRecords(data.users[lid], data.users[currentKey]);
    delete data.users[currentKey];

    for (const [alias, target] of Object.entries(data.aliases)) {
      if (target === currentKey) data.aliases[alias] = lid;
    }

    currentKey = lid;
    changed = true;
  }

  const canonicalKey = lid || currentKey || jid || normalizeUserJid(identity?.key);

  if (canonicalKey) {
    for (const alias of [lid, jid, normalizeUserJid(identity?.key)].filter(Boolean)) {
      if (data.aliases[alias] !== canonicalKey) {
        data.aliases[alias] = canonicalKey;
        changed = true;
      }
    }
  }

  if (currentKey && data.users[currentKey]) {
    const user = data.users[currentKey];
    if (user.id !== currentKey) {
      user.id = currentKey;
      changed = true;
    }
    if (lid && user.lid !== lid) {
      user.lid = lid;
      changed = true;
    }
    if (jid && user.jid !== jid) {
      user.jid = jid;
      changed = true;
    }
  }

  return {
    key: canonicalKey,
    user: canonicalKey ? data.users[canonicalKey] || null : null,
    changed
  };
}

export function registerUser(identity, name = '') {
  const cleanName = String(name).replace(/\s+/g, ' ').trim();
  const data = readDatabase();
  const synced = syncIdentity(data, identity);

  if (!synced.key) {
    return { ok: false, reason: 'IDENTITY_NOT_FOUND' };
  }

  if (synced.user?.registered) {
    const limitReset = applyHourlyLimitReset(synced.user);
    if (synced.changed || limitReset) writeDatabase(data);
    return {
      ok: false,
      reason: 'ALREADY_REGISTERED',
      user: synced.user,
      key: synced.key
    };
  }

  const now = new Date().toISOString();
  const user = {
    id: synced.key,
    lid: normalizeUserJid(identity?.lid) || null,
    jid: normalizeUserJid(identity?.jid) || null,
    name: cleanName,
    registered: true,
    registeredAt: now,
    updatedAt: now,
    limit: REGISTER_LIMIT,
    ampremUsed: 0,
    limitResetWindow: getHourlyLimitWindow(),
    limitResetAt: now
  };

  data.users[synced.key] = user;
  data.aliases[synced.key] = synced.key;
  if (user.lid) data.aliases[user.lid] = synced.key;
  if (user.jid) data.aliases[user.jid] = synced.key;
  writeDatabase(data);

  return { ok: true, user, key: synced.key };
}

export function getRegisteredUser(identity) {
  const data = readDatabase();
  const synced = syncIdentity(data, identity);
  const limitReset = applyHourlyLimitReset(synced.user);
  if (synced.changed || limitReset) writeDatabase(data);

  if (!synced.user?.registered) return null;
  return { ...synced.user, id: synced.key };
}

export function consumeAmpremLimit(identity, amount = 1) {
  const data = readDatabase();
  const synced = syncIdentity(data, identity);
  const user = synced.user;

  if (!user?.registered) {
    if (synced.changed) writeDatabase(data);
    return { ok: false, reason: 'NOT_REGISTERED' };
  }

  const limitReset = applyHourlyLimitReset(user);
  const currentLimit = Number(user.limit) || 0;
  if (currentLimit < amount) {
    if (synced.changed || limitReset) writeDatabase(data);
    return { ok: false, reason: 'LIMIT_EXHAUSTED', user };
  }

  user.limit = currentLimit - amount;
  user.ampremUsed = (Number(user.ampremUsed) || 0) + amount;
  user.updatedAt = new Date().toISOString();
  writeDatabase(data);

  return { ok: true, user };
}
