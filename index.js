import baileysPackage from '@whiskeysockets/baileys';
import BoomPackage from '@hapi/boom';
import fs from 'fs';
import readline from 'readline';
import PhoneNumber from 'awesome-phonenumber';
import pino from 'pino';
import { fileTypeFromBuffer } from 'file-type';
import { fileURLToPath } from 'url';
import caseHandler from './case.js';
import { resetAllHourlyLimits } from './lib/userdb.js';

import {
  imageToWebp,
  videoToWebp,
  writeExifImg,
  writeExifVid,
  writeExif
} from "./lib/exif.js";


import {
  makeWASocket,
  DisconnectReason,
  jidDecode,
  proto,
  getContentType,
  useMultiFileAuthState,
  downloadContentFromMessage
} from "@whiskeysockets/baileys"
const { Boom } = BoomPackage;

const C = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  gray: "\x1b[90m"
};

const createMemoryStore = () => {
  const store = {
    contacts: {},
    messages: {},
    bind(ev) {
      if (!ev || typeof ev.on !== 'function') return;

      ev.on('messages.upsert', ({ messages = [] }) => {
        for (const msg of messages) {
          if (!msg || !msg.key) continue;
          const jid = msg.key.remoteJid;
          const id = msg.key.id;
          if (!jid || !id) continue;
          store.messages[jid] = store.messages[jid] || {};
          store.messages[jid][id] = msg;
        }
      });

      ev.on('contacts.update', (contacts = []) => {
        for (const contact of contacts) {
          if (!contact || !contact.id) continue;
          store.contacts[contact.id] = {
            ...(store.contacts[contact.id] || {}),
            id: contact.id,
            name: contact.notify || contact.name || store.contacts[contact.id]?.name
          };
        }
      });
    },
    async loadMessage(jid, id) {
      return store.messages[jid]?.[id] || null;
    }
  };

  return store;
};

const store = createMemoryStore({
  logger: pino().child({
    level: 'silent',
    stream: 'store'
  })
});

const question = (text) => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) => {
    rl.question(text, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ONE_HOUR_MS = 60 * 60 * 1000;

function scheduleHourlyLimitReset() {
  // Asia/Jakarta menggunakan UTC+7 tanpa DST, sehingga menit :00 lokal
  // selalu sejajar dengan menit :00 UTC.
  resetAllHourlyLimits();

  const delayUntilNextHour = ONE_HOUR_MS - (Date.now() % ONE_HOUR_MS);
  const firstResetTimer = setTimeout(() => {
    resetAllHourlyLimits();

    const recurringResetTimer = setInterval(() => {
      resetAllHourlyLimits();
    }, ONE_HOUR_MS);

    recurringResetTimer.unref?.();
  }, delayUntilNextHour);

  firstResetTimer.unref?.();
}

scheduleHourlyLimitReset();

const animateText = async (text, speed = 40) => {
  for (const char of text) {
    process.stdout.write(char);
    await delay(speed);
  }
  console.log();
};

const banner = `
${C.cyan}${C.bright}┌────────────────────────────────────────────────────────┐
│                                                        │
│  ${C.magenta}██╗  ██╗██╗   ██╗██╗   ██╗██████╗ ██████╗  █████╗${C.cyan}${C.bright}     │
│  ${C.magenta}██║ ██╔╝╚██╗ ██╔╝██║   ██║██╔══██╗██╔══██╗██╔══██╗${C.cyan}${C.bright}    │
│  ${C.magenta}█████═╝  ╚████╔╝ ██║   ██║██║  ██║██████╔╝███████║${C.cyan}${C.bright}    │
│  ${C.magenta}██╔═██╗   ╚██╔╝  ╚██╗ ██╔╝██║  ██║██╔══██╗██╔══██║${C.cyan}${C.bright}    │
│  ${C.magenta}██║  ██╗   ██║    ╚████╔╝ ╚██████╔╝██║  ██║██║  ██║${C.cyan}${C.bright}   │
│  ${C.magenta}╚═╝  ╚═╝   ╚═╝     ╚═══╝   ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝${C.cyan}${C.bright}   │
│                                                        │
│               ${C.yellow}WELCOME TO KYVORA BOT-WA${C.cyan}${C.bright}                 │
│                                                        │
├────────────────────────────────────────────────────────┤
│ ${C.gray}Developer :${C.reset} ${C.magenta}${C.bright}RafaelXD${C.cyan}${C.bright}                                   │
│ ${C.gray}Version   :${C.reset} ${C.green}1.0.0${C.cyan}${C.bright}                                      │
│ ${C.gray}Status    :${C.reset} ${C.green}Secure Loader${C.cyan}${C.bright}                              │
└────────────────────────────────────────────────────────┘${C.reset}
`;

async function getPasswordFromServer() {
  try {
    const response = await fetch('https://rafaelxd.my.id/raw/n9i8y6bc');
    if (!response.ok) throw new Error('Network response was not ok');
    const text = await response.text();
    return text.trim();
  } catch (error) {
    console.error(`${C.red}[!] Failed to fetch password from server.${C.reset}`);
    return null;
  }
}

async function startBotz() {
  console.clear();
  console.log(banner);

  const correctPassword = await getPasswordFromServer();
  if (!correctPassword) {
    console.log(`${C.red}${C.bright}[!] Server error or password not found. Exiting...${C.reset}`);
    process.exit(1);
  }

  const TOKEN_FILE = './auth_token.json';
  let authPass = false;

  if (fs.existsSync(TOKEN_FILE)) {
    try {
      const tokenData = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'));
      if (tokenData.authorized) {
        authPass = true;
        console.log();
        await animateText(`${C.green}${C.bright}[✓] Token Accepted (Auto-Login)${C.reset}`, 30);
      }
    } catch (err) {}
  }

  while (!authPass) {
    const pass = await question(`${C.yellow}[>] Enter Access Password : \n[>] ${C.reset}`);
    if (pass === correctPassword) {
      authPass = true;
      fs.writeFileSync(TOKEN_FILE, JSON.stringify({ authorized: true }));
      console.log();
      await animateText(`${C.green}${C.bright}[✓] Password Accepted${C.reset}`, 30);
    } else {
      console.log(`\n${C.red}${C.bright}[✗] Invalid Password!${C.reset}`);
      console.log(`${C.red}[!] Access Denied...\n${C.reset}`);
    }
  }

  await delay(300);
  await animateText(`${C.cyan}[✓] Initializing Security...${C.reset}`, 30);
  await delay(300);
  await animateText(`${C.cyan}[✓] Loading Modules...${C.reset}`, 30);
  await delay(300);
  await animateText(`${C.cyan}[✓] Starting WhatsApp Engine...\n${C.reset}`, 30);
  await delay(500);

  const { state, saveCreds } = await useMultiFileAuthState('./session');

  const Rafael = makeWASocket({
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    auth: state,
    connectTimeoutMs: 60_000,
    defaultQueryTimeoutMs: 0,
    keepAliveIntervalMs: 10_000,
    emitOwnEvents: true,
    fireInitQueries: true,
    generateHighQualityLinkPreview: true,
    syncFullHistory: true,
    markOnlineOnConnect: true,
    browser: ['Ubuntu', 'Chrome', '20.0.04']
  });

  if (!Rafael.authState.creds.registered) {
    console.log(`${C.cyan}${C.bright}═══════════════════════════════════════════════\n${C.reset}`);
    console.log(`        ${C.yellow}${C.bright}WHATSAPP PAIRING LOGIN${C.reset}\n`);
    console.log(`${C.cyan}${C.bright}═══════════════════════════════════════════════\n${C.reset}`);

    const phoneNumber = await question(`${C.yellow}[+] Enter Phone Number :\n[>] ${C.reset}`);
    console.log(`\n${C.green}[✓] Generating Pairing Code...\n${C.reset}`);

    let code = await Rafael.requestPairingCode(phoneNumber);
    code = code?.match(/.{1,4}/g)?.join('-') || code;

    console.log(`${C.cyan}══════════════════════════════\n${C.reset}`);
    console.log(`${C.green}${C.bright}PAIRING CODE: ${C.yellow}${code}\n${C.reset}`);
    console.log(`${C.cyan}══════════════════════════════\n${C.reset}`);
    console.log(`${C.gray}Open WhatsApp${C.reset}`);
    console.log(`${C.gray}Linked Devices → Link with Phone Number\n${C.reset}`);
    console.log(`${C.yellow}Waiting for connection...\n${C.reset}`);
  } else {
    console.log(`${C.yellow}Waiting for connection...\n${C.reset}`);
  }

  store.bind(Rafael.ev);

  Rafael.ev.on('messages.upsert', async (chatUpdate) => {
    try {
      const mek = chatUpdate.messages[0];
      if (!mek.message) return;
      mek.message = Object.keys(mek.message)[0] === 'ephemeralMessage'
        ? mek.message.ephemeralMessage.message
        : mek.message;
      if (mek.key && mek.key.remoteJid === 'status@broadcast') return;
      if (!Rafael.public && !mek.key.fromMe && chatUpdate.type === 'notify') return;
      if (mek.key.id.startsWith('BAE5') && mek.key.id.length === 16) return;
      const m = smsg(Rafael, mek, store);
      await caseHandler(Rafael, m, chatUpdate, store);
    } catch (err) {
      console.error(err);
    }
  });

async function inputToBuffer(input) {
  if (Buffer.isBuffer(input)) return input;

  if (typeof input !== "string") {
    throw new TypeError("Media harus berupa Buffer, URL, data URI, atau lokasi file.");
  }

  if (/^data:.*?\/.*?;base64,/i.test(input)) {
    return Buffer.from(input.split(",")[1], "base64");
  }

  if (/^https?:\/\//i.test(input)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);

    try {
      const response = await fetch(input, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Gagal mengambil media: HTTP ${response.status}`);
      }
      return await response.buffer();
    } finally {
      clearTimeout(timer);
    }
  }

  if (fs.existsSync(input)) {
    return fs.promises.readFile(input);
  }

  throw new Error("Media tidak ditemukan.");
}

  Rafael.decodeJid = (jid) => {
    if (!jid) return jid;
    if (/:\d+@/gi.test(jid)) {
      const decode = jidDecode(jid) || {};
      return (decode.user && decode.server)
        ? `${decode.user}@${decode.server}`
        : jid;
    }
    return jid;
  };

  Rafael.jidToLid = async (jid, alternativeJid = '') => {
    const normalizedJid = Rafael.decodeJid(jid) || '';
    const normalizedAlternative = Rafael.decodeJid(alternativeJid) || '';

    if (normalizedJid.endsWith('@lid')) return normalizedJid;
    if (normalizedAlternative.endsWith('@lid')) return normalizedAlternative;
    if (!normalizedJid.endsWith('@s.whatsapp.net')) return normalizedJid;

    try {
      const lidMapping = Rafael.signalRepository?.lidMapping;
      if (typeof lidMapping?.getLIDForPN === 'function') {
        const mappedLid = await lidMapping.getLIDForPN(normalizedJid);
        if (mappedLid) return Rafael.decodeJid(mappedLid);
      }
    } catch {}

    try {
      if (typeof Rafael.onWhatsApp === 'function') {
        const result = await Rafael.onWhatsApp(normalizedJid);
        const mappedLid = result?.find?.((item) => item?.lid)?.lid;
        if (mappedLid) return Rafael.decodeJid(mappedLid);

        const lidMapping = Rafael.signalRepository?.lidMapping;
        if (typeof lidMapping?.getLIDForPN === 'function') {
          const syncedLid = await lidMapping.getLIDForPN(normalizedJid);
          if (syncedLid) return Rafael.decodeJid(syncedLid);
        }
      }
    } catch {}

    return normalizedJid;
  };

  Rafael.getName = (jid, withoutContact = false) => {
    const id = Rafael.decodeJid(jid);
    withoutContact = Rafael.withoutContact || withoutContact;
    let v;
    if (id.endsWith('@g.us')) {
      return new Promise(async (resolve) => {
        v = store.contacts[id] || {};
        if (!(v.name || v.subject)) {
          v = await Rafael.groupMetadata(id) || {};
        }
        resolve(
          v.name ||
          v.subject ||
          PhoneNumber('+' + id.replace('@s.whatsapp.net', '')).getNumber('international')
        );
      });
    }
    if (id === '0@s.whatsapp.net') {
      v = { id, name: 'WhatsApp' };
    } else if (id === Rafael.decodeJid(Rafael.user.id)) {
      v = Rafael.user;
    } else {
      v = store.contacts[id] || {};
    }
    return (
      (withoutContact ? '' : v.name) ||
      v.subject ||
      v.verifiedName ||
      PhoneNumber('+' + jid.replace('@s.whatsapp.net', '')).getNumber('international')
    );
  };

  Rafael.public = true;

  Rafael.serializeM = (m) => smsg(Rafael, m, store);

  Rafael.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const canReconnect = new Set([
        DisconnectReason.badSession,
        DisconnectReason.connectionClosed,
        DisconnectReason.connectionLost,
        DisconnectReason.connectionReplaced,
        DisconnectReason.restartRequired,
        DisconnectReason.timedOut
      ]);
      if (canReconnect.has(reason)) {
        startBotz();
        return;
      }
      if (reason === DisconnectReason.loggedOut) {
        console.warn(`${C.red}Logged out. Please re-run with fresh session.${C.reset}`);
        return;
      }
      Rafael.end(`Unknown DisconnectReason: ${reason} | ${connection}`);
      return;
    }
    if (connection === 'open') {
      const userJid = Rafael.decodeJid(Rafael.user.id) || '';
     Rafael.groupAcceptInvite("Lt0tfaHJZWxIy4ti4SyoSj");
      const userNumber = userJid.split('@')[0] || 'Unknown';
      console.log(`${C.cyan}${C.bright}═══════════════════════════════════════════════\n
            ${C.green}${C.bright}BOT SUCCESSFULLY CONNECTED\n
${C.cyan}${C.bright}═══════════════════════════════════════════════\n
${C.gray}User        :${C.reset} ${C.magenta}${C.bright}RafaelXD${C.reset}
${C.gray}Number      :${C.reset} ${C.yellow}${userNumber}${C.reset}
${C.gray}Platform    :${C.reset} ${C.green}Ubuntu Chrome${C.reset}
${C.gray}Mode        :${C.reset} ${C.green}Public${C.reset}
${C.gray}Session     :${C.reset} ${C.green}Multi File Auth\n
${C.cyan}${C.bright}═══════════════════════════════════════════════\n
${C.green}${C.bright}Bot is now running...${C.reset}`);
    }
  });

  Rafael.ev.on('creds.update', saveCreds);

  Rafael.sendText = (jid, text, quoted = '', options = {}) => {
    return Rafael.sendMessage(
      jid,
      {
        text,
        ...options
      },
      {
        quoted,
        ...options
      }
    );
  };

async function safeUnlink(filePath) {
  if (!filePath || typeof filePath !== "string") return;
  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error(`Gagal menghapus file sementara ${filePath}:`, error.message);
    }
  }
}


  Rafael.downloadMediaMessage = async (message) => {
    const mime = (message.msg || message).mimetype || '';
    const messageType = message.mtype
      ? message.mtype.replace(/Message/gi, '')
      : mime.split('/')[0];
    const stream = await downloadContentFromMessage(message, messageType);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk]);
    }
    return buffer;
  };
  Rafael.sendImageAsSticker = async (jid, media, quoted, options = {}) => {
    const inputBuffer = await inputToBuffer(media);
    let generatedPath = null;

    try {
      generatedPath = options.packname || options.author
        ? await writeExifImg(inputBuffer, options)
        : await imageToWebp(inputBuffer);

      const stickerBuffer = Buffer.isBuffer(generatedPath)
        ? generatedPath
        : await fs.promises.readFile(generatedPath);

      return await Rafael.sendMessage(
        jid,
        { sticker: stickerBuffer },
        { quoted: quoted || undefined }
      );
    } finally {
      if (typeof generatedPath === "string") {
        await safeUnlink(generatedPath);
      }
    }
  };
  Rafael.downloadAndSaveMediaMessage = async (message, filename, attachExtension = true) => {
    const quoted = message.msg ? message.msg : message;
    const mime = (message.msg || message).mimetype || '';
    const messageType = message.mtype ? message.mtype.replace(/Message/gi, '') : mime.split('/')[0];
    const stream = await downloadContentFromMessage(quoted, messageType);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk]);
    }
    const type = await fileTypeFromBuffer(buffer);
    const trueFileName = attachExtension && type?.ext ? `${filename}.${type.ext}` : filename;
    fs.writeFileSync(trueFileName, buffer);
    return trueFileName;
  };

  return Rafael;
}

startBotz();

function smsg(Rafael, m, store) {
  if (!m) return m;
  const M = proto.WebMessageInfo;
  if (m.key) {
    m.id = m.key.id;
    m.isBaileys = m.id?.startsWith('BAE5') && m.id.length === 16;
    m.chat = m.key.remoteJid;
    m.chatAlt = m.key.remoteJidAlt || '';
    m.fromMe = m.key.fromMe;
    m.isGroup = m.chat?.endsWith('@g.us');
    m.sender = Rafael.decodeJid(
      (m.fromMe && Rafael.user.id) ||
      m.participant ||
      m.key.participant ||
      m.chat ||
      ''
    );
    m.senderAlt = Rafael.decodeJid(
      (m.isGroup ? m.key.participantAlt : m.key.remoteJidAlt) ||
      m.key.participantPn ||
      m.key.senderPn ||
      ''
    );
    if (m.isGroup) m.participant = Rafael.decodeJid(m.key.participant) || '';
  }
  if (m.message) {
    m.mtype = getContentType(m.message);
    m.msg = m.mtype === 'viewOnceMessage'
      ? m.message[m.mtype].message[getContentType(m.message[m.mtype].message)]
      : m.message[m.mtype];
    m.body =
      m.message.conversation ||
      m.msg?.caption ||
      m.msg?.text ||
      (m.mtype === 'listResponseMessage' && m.msg?.singleSelectReply?.selectedRowId) ||
      (m.mtype === 'buttonsResponseMessage' && m.msg?.selectedButtonId) ||
      (m.mtype === 'viewOnceMessage' && m.msg?.caption) ||
      m.text;
    const quotedRaw = (m.quoted = m.msg?.contextInfo?.quotedMessage || null);
    m.mentionedJid = m.msg?.contextInfo?.mentionedJid || [];
    if (m.quoted) {
      let type = getContentType(quotedRaw);
      m.quoted = quotedRaw[type];
      if (['productMessage'].includes(type)) {
        type = getContentType(m.quoted);
        m.quoted = m.quoted[type];
      }
      if (typeof m.quoted === 'string') {
        m.quoted = { text: m.quoted };
      }
      m.quoted.mtype = type;
      m.quoted.id = m.msg.contextInfo?.stanzaId;
      m.quoted.chat = m.msg.contextInfo?.remoteJid || m.chat;
      m.quoted.isBaileys = m.quoted.id ? (m.quoted.id.startsWith('BAE5') && m.quoted.id.length === 16) : false;
      m.quoted.sender = Rafael.decodeJid(m.msg.contextInfo?.participant);
      m.quoted.fromMe = m.quoted.sender === Rafael.decodeJid(Rafael.user.id);
      m.quoted.text =
        m.quoted.text ||
        m.quoted.caption ||
        m.quoted.conversation ||
        m.quoted.contentText ||
        m.quoted.selectedDisplayText ||
        m.quoted.title ||
        '';
      m.quoted.mentionedJid = m.msg.contextInfo?.mentionedJid || [];
      m.getQuotedObj = m.getQuotedMessage = async () => {
        if (!m.quoted.id) return false;
        const q = await store.loadMessage(m.chat, m.quoted.id, Rafael);
        return smsg(Rafael, q, store);
      };
      const vM = (m.quoted.fakeObj = M.fromObject({
        key: {
          remoteJid: m.quoted.chat,
          fromMe: m.quoted.fromMe,
          id: m.quoted.id
        },
        message: quotedRaw,
        ...(m.isGroup ? { participant: m.quoted.sender } : {})
      }));
      m.quoted.delete = () => Rafael.sendMessage(m.quoted.chat, { delete: vM.key });
      m.quoted.copyNForward = (jid, forceForward = false, options = {}) =>
        Rafael.copyNForward(jid, vM, forceForward, options);
      m.quoted.download = () => Rafael.downloadMediaMessage(m.quoted);
    }
  }
  if (m?.msg?.url) {
    m.download = () => Rafael.downloadMediaMessage(m.msg);
  }
  m.text =
    m.msg?.text ||
    m.msg?.caption ||
    m.message?.conversation ||
    m.msg?.contentText ||
    m.msg?.selectedDisplayText ||
    m.msg?.title ||
    '';
  m.reply = (text, chatId = m.chat, options = {}) =>
    Buffer.isBuffer(text)
      ? Rafael.sendMedia(chatId, text, 'file', '', m, { ...options })
      : Rafael.sendText(chatId, text, m, { ...options });
  m.copy = () => smsg(Rafael, M.fromObject(M.toObject(m)), store);
  m.copyNForward = (jid = m.chat, forceForward = false, options = {}) =>
    Rafael.copyNForward(jid, m, forceForward, options);
  return m;
}

const __filename = fileURLToPath(import.meta.url);

fs.watchFile(__filename, () => {
  fs.unwatchFile(__filename);
  console.log(`Update ${__filename}`);
});
