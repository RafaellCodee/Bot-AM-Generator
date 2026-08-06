const GROUP_CACHE_TTL_MS = 15_000;
const metadataCache = new Map();

function normalizeJid(value = '') {
  if (typeof value !== 'string') return '';
  const jid = value.trim();
  if (!jid.includes('@')) return '';

  const [rawUser, server] = jid.split('@');
  if (!rawUser || !server) return '';

  return `${rawUser.replace(/:\d+$/, '')}@${server}`;
}

function normalizeGroupJid(value = '') {
  const jid = normalizeJid(value);
  return jid.endsWith('@g.us') ? jid : '';
}

function getInviteCode(link = '') {
  if (typeof link !== 'string') return '';
  return link.match(/(?:https?:\/\/)?chat\.whatsapp\.com\/([A-Za-z0-9_-]+)/i)?.[1] || '';
}

async function resolveRequiredGroupJid(Rafael) {
  const configuredJid = normalizeGroupJid(global.requiredGroupJid);
  if (configuredJid) return configuredJid;

  const inviteCode = getInviteCode(global.requiredGroupLink);
  if (!inviteCode || typeof Rafael?.groupGetInviteInfo !== 'function') return '';

  const info = await Rafael.groupGetInviteInfo(inviteCode);
  const resolvedJid = normalizeGroupJid(info?.id || info?.jid);

  if (resolvedJid) global.requiredGroupJid = resolvedJid;
  return resolvedJid;
}

async function getGroupMetadata(Rafael, groupJid, forceRefresh = false) {
  const now = Date.now();
  const cached = metadataCache.get(groupJid);

  if (!forceRefresh && cached && cached.expiresAt > now) {
    return { metadata: cached.metadata, fromCache: true };
  }

  const metadata = await Rafael.groupMetadata(groupJid);
  metadataCache.set(groupJid, {
    metadata,
    expiresAt: now + GROUP_CACHE_TTL_MS
  });

  return { metadata, fromCache: false };
}

function collectUserAliases(identity, m) {
  return new Set([
    identity?.key,
    identity?.lid,
    identity?.jid,
    m?.sender,
    m?.senderAlt,
    m?.key?.participant,
    m?.key?.participantAlt,
    m?.key?.participantPn,
    m?.key?.senderPn,
    m?.key?.remoteJidAlt,
    m?.msg?.contextInfo?.participant,
    m?.msg?.contextInfo?.participantAlt,
    m?.msg?.contextInfo?.participantPn
  ].map(normalizeJid).filter(Boolean));
}

function collectParticipantAliases(participant) {
  return [
    participant?.id,
    participant?.jid,
    participant?.lid,
    participant?.phoneNumber,
    participant?.pn
  ].map(normalizeJid).filter(Boolean);
}

function metadataContainsUser(metadata, userAliases) {
  const participants = Array.isArray(metadata?.participants)
    ? metadata.participants
    : [];

  return participants.some((participant) =>
    collectParticipantAliases(participant).some((alias) => userAliases.has(alias))
  );
}

export async function checkRequiredGroupMembership(Rafael, m, identity) {
  let groupJid;

  try {
    groupJid = await resolveRequiredGroupJid(Rafael);
  } catch (error) {
    return {
      ok: false,
      reason: 'GROUP_RESOLVE_FAILED',
      error
    };
  }

  if (!groupJid) {
    return {
      ok: false,
      reason: 'GROUP_NOT_CONFIGURED'
    };
  }

  const userAliases = collectUserAliases(identity, m);
  if (!userAliases.size) {
    return {
      ok: false,
      reason: 'USER_IDENTITY_NOT_FOUND',
      groupJid
    };
  }

  try {
    let result = await getGroupMetadata(Rafael, groupJid);
    let isMember = metadataContainsUser(result.metadata, userAliases);

    // Jika hasil cache mengatakan bukan anggota, cek sekali lagi secara langsung
    // agar pengguna yang baru masuk grup tidak perlu menunggu cache kedaluwarsa.
    if (!isMember && result.fromCache) {
      result = await getGroupMetadata(Rafael, groupJid, true);
      isMember = metadataContainsUser(result.metadata, userAliases);
    }

    return {
      ok: isMember,
      reason: isMember ? null : 'NOT_A_MEMBER',
      groupJid,
      groupName: result.metadata?.subject || ''
    };
  } catch (error) {
    return {
      ok: false,
      reason: 'GROUP_CHECK_FAILED',
      groupJid,
      error
    };
  }
}

export function requiredGroupMessage(prefix = '.', command = 'menu', result = {}) {
  const groupLink = typeof global.requiredGroupLink === 'string'
    ? global.requiredGroupLink.trim()
    : '';

  if (result.reason === 'GROUP_NOT_CONFIGURED') {
    return 'Grup wajib belum dikonfigurasi. Owner harus mengisi global.requiredGroupJid atau global.requiredGroupLink di lib/config.js.';
  }

  if (result.reason === 'GROUP_CHECK_FAILED' || result.reason === 'GROUP_RESOLVE_FAILED') {
    return 'Pengecekan keanggotaan grup gagal. Pastikan bot sudah berada di grup wajib, lalu coba lagi.';
  }

  const groupName = result.groupName ? ` *${result.groupName}*` : '';
  const joinSection = groupLink
    ? `\n\n🔗 ${groupLink}`
    : '\n\nHubungi owner untuk mendapatkan tautan grup.';

  return `❌ Fitur ini hanya dapat digunakan oleh anggota grup${groupName}.\n\nSilakan masuk ke grup terlebih dahulu.${joinSection}\n\nSetelah bergabung, ulangi perintah *${prefix}${command}*.`;
}
