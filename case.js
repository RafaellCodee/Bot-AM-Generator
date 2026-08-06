import './lib/config.js';
import fs from 'fs';
import util from 'util';
import axios from 'axios';
import path from "path";
import { exec } from 'child_process';
import { fileURLToPath } from 'url';
import ffmpeg from "fluent-ffmpeg";
import os from "os";
import { ZipArchive } from "archiver";
import { generateWAMessageFromContent, proto, generateWAMessageContent } from '@whiskeysockets/baileys';
import {
  REGISTER_LIMIT,
  consumeAmpremLimit,
  getRegisteredUser,
  registerUser,
  resolveUserIdentity
} from './lib/userdb.js';
import {
  checkRequiredGroupMembership,
  requiredGroupMessage
} from './lib/group-access.js';


async function sendRequiredGroupButton(Rafael, m, prefix = '.', command = 'menu', membership = {}) {
  const groupLink = typeof global.requiredGroupLink === 'string'
    ? global.requiredGroupLink.trim()
    : '';

  if (!groupLink || membership.reason !== 'NOT_A_MEMBER') {
    return m.reply(requiredGroupMessage(prefix, command, membership));
  }

  const groupName = membership.groupName
    ? ` *${membership.groupName}*`
    : '';

  const message = generateWAMessageFromContent(
    m.chat,
    {
      viewOnceMessage: {
        message: {
          interactiveMessage: {
            header: {
              title: 'AKSES GRUP WAJIB',
              hasMediaAttachment: false
            },
            body: {
              text:
`❌ Fitur ini hanya dapat digunakan oleh anggota grup${groupName}.

Silakan bergabung ke grup WhatsApp dan Channel Whatsapp terlebih dahulu melalui tombol di bawah.

Setelah bergabung, ulangi perintah *${prefix}${command}*.`
            },
            footer: {
              text: 'Kyvora Bot'
            },
            nativeFlowMessage: {
              buttons: [
                {
                  name: 'cta_url',
                  buttonParamsJson: JSON.stringify({
                    display_text: 'Gabung Grup WhatsApp',
                    url: groupLink,
                    merchant_url: groupLink
                  })
                }
              ]
            }
          }
        }
      }
    },
    { quoted: m }
  );

  return Rafael.relayMessage(m.chat, message.message, {
    messageId: message.key.id
  });
}

export default async function caseHandler(Rafael, m) {
  try {
  if (m.key.fromMe) return;
    const body =
      (m.mtype === 'conversation' && m.message.conversation) ||
      (m.mtype === 'imageMessage' && m.message.imageMessage.caption) ||
      (m.mtype === 'documentMessage' && m.message.documentMessage.caption) ||
      (m.mtype === 'videoMessage' && m.message.videoMessage.caption) ||
      (m.mtype === 'extendedTextMessage' && m.message.extendedTextMessage.text) ||
      (m.mtype === 'buttonsResponseMessage' && m.message.buttonsResponseMessage.selectedButtonId) ||
      (m.mtype === 'templateButtonReplyMessage' && m.message.templateButtonReplyMessage.selectedId) ||
      (m.mtype === 'interactiveResponseMessage' && JSON.parse(m.message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson).id) ||
      '';

    const budy = typeof m.text === 'string' ? m.text : '';
    const prefixRegex = /^[°zZ#$@*+,.?=''():√%!¢£¥€π¤ΠΦ_&><`™©®Δ^βα~¦|/\\©^]/;
    const prefix = prefixRegex.test(body) ? body.match(prefixRegex)[0] : '.';
    const isCmd = body.startsWith(prefix);
    const command = isCmd ? body.slice(prefix.length).trim().split(' ').shift().toLowerCase() : '';
    const args = body.trim().split(/ +/).slice(1);
    const q = args.join(' ');
    const text = q;
    const sender = m.key.fromMe
      ? (Rafael.user.id.split(':')[0] + '@s.whatsapp.net' || Rafael.user.id)
      : (m.key.participant || m.key.remoteJid);
    const botNumber = await Rafael.decodeJid(Rafael.user.id);
    const senderNumber = sender.split('@')[0];
    const isCreator = (m && m.sender && [botNumber, ...global.owner].map((v) => v.replace(/[^0-9]/g, '') + '@s.whatsapp.net').includes(m.sender)) || false;
    const pushname = m.pushName || `${senderNumber}`;
    const isBot = botNumber.includes(senderNumber);
    const quoted = m.quoted ? m.quoted : m;
    const userIdentity = await resolveUserIdentity(Rafael, m);
    const userKey = userIdentity.key || m.sender;
  
const API_URL = 'https://alightfree.my.id/api/v1';
const API_KEY = global.apikeyam || '';

const sessionAmprem = {};

async function sendMagicLink(email) {
    const res = await fetch(`${API_URL}/send-magiclink`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": API_KEY
        },
        body: JSON.stringify({ email })
    });

    return await res.json();
}

async function verifyAccount(email, rawLink) {
    const res = await fetch(`${API_URL}/verify-account`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": API_KEY
        },
        body: JSON.stringify({ email, rawLink })
    });

    return await res.json();
}

async function applyPremium(email, idToken) {
    const res = await fetch(`${API_URL}/apply-premium`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": API_KEY
        },
        body: JSON.stringify({ email, idToken })
    });

    return await res.json();
}    

function formatTanggal(date = new Date()) {
    return date.toLocaleString("id-ID", {
        timeZone: "Asia/Jakarta",
        day: "2-digit",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
    }) + " WIB";
}        
    
    global.amprem ??= {};

const ampremKeys = [...new Set([
    userIdentity.lid,
    userIdentity.jid,
    userKey,
    m.sender
].filter(Boolean))];
const ampremSessionKey = ampremKeys.find((key) => global.amprem[key]) || userKey;

if (global.amprem[ampremSessionKey]) {
    const session = global.amprem[ampremSessionKey];

    const membership = await checkRequiredGroupMembership(Rafael, m, session.identity || userIdentity);
    if (!membership.ok) {
        delete global.amprem[ampremSessionKey];
        return sendRequiredGroupButton(Rafael, m, prefix, 'amprem', membership);
    }

    try {

        if (session.step === "email") {

            const email = budy.trim();

            await m.reply("⏳ Mengirim Magic Link...");

            const result = await sendMagicLink(email);

            if (!result.success) {
                delete global.amprem[ampremSessionKey];
                return m.reply(JSON.stringify(result, null, 2));
            }

            session.step = "magic";
            session.email = email;

            return m.reply(
`✅ Magic Link berhasil dikirim.

Silakan buka email Anda lalu kirim Magic Link di chat ini.`
            );
        }

        if (session.step === "magic") {

            await m.reply("⏳ Memverifikasi akun...");

            const verify = await verifyAccount(
                session.email,
                budy.trim()
            );

            if (!verify.success) {
                delete global.amprem[ampremSessionKey];
                return m.reply(JSON.stringify(verify, null, 2));
            }

            const idToken =
                verify.idToken ||
                verify.data?.idToken ||
                verify.token;

            if (!idToken) {
                delete global.amprem[ampremSessionKey];
                return m.reply("idToken tidak ditemukan.");
            }

            await m.reply("⏳ Mengaktifkan Premium...");

            const premium = await applyPremium(
                session.email,
                idToken
            );

            const limitUsage = consumeAmpremLimit(
                session.identity || userIdentity
            );

            delete global.amprem[ampremSessionKey];

            if (!limitUsage.ok) {
                return m.reply(
                    limitUsage.reason === "NOT_REGISTERED"
                        ? `Anda belum terdaftar. Gunakan ${prefix}register NamaAnda.`
                        : `Limit amprem Anda sudah habis.`
                );
            }

            const data = premium.data || premium.result || premium;

const tanggalAktivasi = formatTanggal();
const sisaLimit = Number(limitUsage.user.limit) || 0;

return m.reply(
`✅ *Premium Berhasil Diaktifkan!*

*Informasi Akun*
📧 *Email:* ${session.email}
⏳ *Durasi:* 365 Days
📅 *Tanggal Aktivasi:* ${tanggalAktivasi}
🎟️ *Sisa Limit:* ${sisaLimit}

━━━━━━━━━━━━━━━━━━
*Created by RafaelXD*`
);
        }

    } catch (e) {
        delete global.amprem[ampremSessionKey];
        return m.reply(e.message);
    }
}



    switch (command) {

      case "menu":
      case "help": {
        const membership = await checkRequiredGroupMembership(Rafael, m, userIdentity);
        if (!membership.ok) {
          return sendRequiredGroupButton(Rafael, m, prefix, command, membership);
        }

        const mm = `
╭─── 『 *KYVORA BOT* 』
│
├  *User:* @${senderNumber}
├  *Prefix:* [ ${prefix} ]
│
├─── 『 *USER MENU* 』
│  ◦ ${prefix}register <nama>
│  ◦ ${prefix}limit
│  ◦ ${prefix}amprem
│
├─── 『 *TOOLS MENU* 』
│  ◦ ${prefix}get <url>
│  ◦ ${prefix}upch <link> _(reply audio)_
│
├─── 『 *OWNER MENU* 』
│  ◦ => _<eval>_
│  ◦ > _<eval>_
│  ◦ $ _<exec>_
│
╰───────────────────
`.trim();

        const imageMsg = await generateWAMessageContent(
          { image: { url: "https://rafaelxd.my.id/raw/pwl0aflg" } },
          { upload: Rafael.waUploadToServer }
        );

        const msg = generateWAMessageFromContent(m.chat, {
          viewOnceMessage: {
            message: {
              interactiveMessage: {
                body: { text: mm },
                footer: { text: 'Kyvora Bot' },
                header: {
                  hasMediaAttachment: true,
                  imageMessage: imageMsg.imageMessage
                },
                nativeFlowMessage: {
                  buttons: [
                    {
                      name: 'cta_url',
                      buttonParamsJson: JSON.stringify({
                        display_text: '📢 Saluran WA',
                        url: 'https://whatsapp.com/channel/0029VbAjoElLI8YVzXxn7H0j',
                        merchant_url: 'https://whatsapp.com/channel/0029VbAjoElLI8YVzXxn7H0j'
                      })
                    },
                    {
                      name: 'cta_url',
                      buttonParamsJson: JSON.stringify({
                        display_text: '💻 Source Code',
                        url: 'https://github.com/RafaellCodee/Bot-AM-Generator',
                        merchant_url: 'https://github.com/RafaellCodee/Bot-AM-Generator'
                      })
                    }
                  ]
                }
              }
            }
          }
        }, { quoted: m });

        await Rafael.relayMessage(m.chat, msg.message, {
          messageId: msg.key.id
        });
      }
      break;

      case "bratvid":
      case "bratvideo": {
        let outputPath = null;

        try {
          const content =
            text ||
            m.quoted?.text ||
            m.quoted?.caption ||
            m.quoted?.body ||
            m.quoted?.message?.conversation ||
            m.quoted?.message?.extendedTextMessage?.text;

          if (!content) {
            return m.reply(`Masukkan teks atau reply teks.\n\nContoh:\n${prefix + command} Just friend ygy 🤣`);
          }

          await m.reply("⏳ Sedang membuat sticker brat video...");
          outputPath = createTempPath("bratvid", "mp4");

          const buffer = await withTimeout(
            bratVid(content, {
              outputFormat: "mp4",
              fast_progress: true,
              lyric: {
                maxWordPerLayer: 5,
                frameDuration: 0.7,
                lastFrameDuration: 1.5
              },
              brat: { BLUR: 0 },
              onProgress: ({ current, total, text: progressText }) => {
                console.log(`[BRATVID] ${current}/${total} - ${progressText}`);
              }
            }),
            180000,
            "Pembuatan brat video melewati batas waktu."
          );

          await fs.promises.writeFile(outputPath, buffer);
          await Rafael.sendVideoAsSticker(m.chat, await fs.promises.readFile(outputPath), m, {
            packname: global.packname || "Sticker Bot",
            author: global.author || "RafaelXD"
          });
        } catch (error) {
          console.error("Error bratvid:", error);
          await m.reply(`❌ Gagal membuat sticker brat video: ${error.message}`);
        } finally {
          await safeUnlink(outputPath);
        }
      }
      break;
      
      case "s":
      case "sticker":
      case "stiker": {
        if (!quoted) return m.reply(`Reply atau kirim gambar/video dengan caption ${prefix + command}`);
        const mime = quoted.mimetype || quoted.msg?.mimetype || "";
        if (!/image|video/.test(mime)) return m.reply(`Reply atau kirim gambar/video dengan caption ${prefix + command}`);

        const tmpDir = path.join(process.cwd(), 'tmp');
        if (!fs.existsSync(tmpDir)) {
          fs.mkdirSync(tmpDir, { recursive: true });
        }

        let mediaPath;
        let outputPath;

        try {
          mediaPath = await Rafael.downloadAndSaveMediaMessage(quoted);
          outputPath = path.join(tmpDir, `${Date.now()}.webp`);

          const isVideo = mime.includes("video");
          const ff = ffmpeg(mediaPath);

          if (isVideo) {
            ff.outputOptions([
              "-vcodec", "libwebp",
              "-vf", "scale='min(320,iw)':min'(320,ih)':force_original_aspect_ratio=decrease,fps=15,pad=320:320:(320-iw)/2:(320-ih)/2:color=0x00000000",
              "-loop", "0",
              "-ss", "00:00:00",
              "-t", "00:00:10",
              "-preset", "default",
              "-an",
              "-vsync", "0"
            ]);
          } else {
            ff.outputOptions([
              "-vcodec", "libwebp",
              "-vf", "scale='min(320,iw)':min'(320,ih)':force_original_aspect_ratio=decrease,fps=15,pad=320:320:(320-iw)/2:(320-ih)/2:color=0x00000000"
            ]);
          }

          await new Promise((resolve, reject) => {
            ff.toFormat("webp")
              .on("end", resolve)
              .on("error", reject)
              .save(outputPath);
          });

          await Rafael.sendMessage(m.chat, { sticker: fs.readFileSync(outputPath) }, { quoted: m });
        } catch (err) {
          m.reply(`Error: ${err.message}`);
        } finally {
          if (mediaPath && fs.existsSync(mediaPath)) fs.unlinkSync(mediaPath);
          if (outputPath && fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        }
      }
      break;
      
      case "brat": {
        if (!text) return m.reply(`Contoh penggunaan:\n${prefix + command} teks brat`);
        try {
          const url = `https://brat.siputzx.my.id/image?text=${encodeURIComponent(text)}`;
          const res = await axios.get(url, {
            responseType: "arraybuffer",
            timeout: 60000,
            maxContentLength: 20 * 1024 * 1024
          });
          const buffer = Buffer.from(res.data);

          await Rafael.sendImageAsSticker(m.chat, buffer, m, {
            packname: global.packname || "Sticker Bot",
            author: global.author || "RafaelXD"
          });
        } catch (err) {
          console.error(err);
          m.reply("Gagal membuat sticker brat.");
        }
      }
      break;


            

      case "get": {
        if (!text) {
          return m.reply(`Contoh:\n${prefix + command} https://example.com/file`);
        }

        if (!/^https?:\/\//i.test(text)) {
          return m.reply("URL tidak valid.");
        }

        try {
          const res = await fetch(text, {
            headers: {
              "User-Agent": "Mozilla/5.0"
            }
          });

          if (!res.ok) {
            throw new Error(`${res.status} ${res.statusText}`);
          }

          const mimetype = (res.headers.get("content-type") || "").toLowerCase();
          const buffer = Buffer.from(await res.arrayBuffer());

          if (mimetype.includes("application/json")) {
            return m.reply(
              "```json\n" +
              JSON.stringify(JSON.parse(buffer.toString()), null, 2) +
              "\n```"
            );
          }

          if (mimetype.startsWith("text/")) {
            return m.reply(buffer.toString().slice(0, 4000));
          }

          const message = {
            mimetype
          };

          if (mimetype === "image/webp") {
            message.sticker = buffer;
          } else if (mimetype.startsWith("image/")) {
            message.image = buffer;
          } else if (mimetype.startsWith("video/")) {
            message.video = buffer;
          } else if (mimetype.startsWith("audio/")) {
            message.audio = buffer;
            message.ptt = false;
          } else {
            const ext = mimetype.split("/")[1]?.split(";")[0] || "bin";

            message.document = buffer;
            message.fileName = `file.${ext}`;
          }

          return Rafael.sendMessage(m.chat, message, {
            quoted: m
          });

        } catch (e) {
          return m.reply(`Error: ${e.message}`);
        }
      }
      break;

      case "upch": {
        if (!args[0]) {
          return m.reply(`Contoh:\n${prefix + command} https://whatsapp.com/channel/xxxxxxxxxxxxxxxx`);
        }

        if (!m.quoted) {
          return m.reply("Reply audio yang ingin dikirim.");
        }

        const mediaMessage = m.quoted;
        const mime = mediaMessage.mimetype || "";

        if (!mime.startsWith("audio/")) {
          return m.reply("Media harus berupa audio.");
        }

        const match = args[0].match(/(?:https?:\/\/)?(?:www\.)?whatsapp\.com\/channel\/([A-Za-z0-9]+)/i);

        if (!match) {
          return m.reply("Link saluran tidak valid.");
        }

        let mediaPath;
        let outputPath;

        try {
          const { id: channelJid } = await Rafael.newsletterMetadata("invite", match[1]);

          mediaPath = await Rafael.downloadAndSaveMediaMessage(mediaMessage);
          outputPath = createTempPath("upch", "ogg");

          await new Promise((resolve, reject) => {
            ffmpeg(mediaPath)
              .outputOptions([
                "-vn",
                "-c:a", "libopus",
                "-b:a", "128k",
                "-vbr", "on",
                "-ar", "48000",
                "-ac", "1"
              ])
              .format("ogg")
              .on("end", resolve)
              .on("error", reject)
              .save(outputPath);
          });

          await Rafael.sendMessage(channelJid, {
            audio: fs.readFileSync(outputPath),
            mimetype: "audio/ogg; codecs=opus",
            ptt: true
          });

          m.reply("Berhasil mengirim audio ke saluran.");
        } catch (err) {
          console.error(err);
          m.reply(`Error:\n${err.message}`);
        } finally {
          if (mediaPath && fs.existsSync(mediaPath)) {
            fs.unlinkSync(mediaPath);
          }

          if (outputPath && fs.existsSync(outputPath)) {
            fs.unlinkSync(outputPath);
          }
        }
      }
      break;       
      
case "register":
case "daftar": {
    const registrationName = q.replace(/\s+/g, " ").trim();

    if (!registrationName) {
        return m.reply(
`Masukkan nama saat mendaftar.

Contoh: *${prefix}register Rafael*`
        );
    }

    if (registrationName.length < 2 || registrationName.length > 40) {
        return m.reply("Nama harus terdiri dari 2 sampai 40 karakter.");
    }

    if (!/^[\p{L}\p{M}][\p{L}\p{M}\p{N} .,'’-]*$/u.test(registrationName)) {
        return m.reply(
            "Nama hanya boleh berisi huruf, angka, spasi, titik, koma, apostrof, atau tanda hubung."
        );
    }

    const result = registerUser(userIdentity, registrationName);

    if (!result.ok) {
        if (result.reason === "ALREADY_REGISTERED") {
            return m.reply(
`✅ Anda sudah terdaftar.

👤 *Nama:* ${result.user.name || "-"}
🆔 *ID:* ${result.key}
🎟️ *Sisa Limit Amprem:* ${Number(result.user.limit) || 0}`
            );
        }

        return m.reply("Identitas pengguna tidak ditemukan. Silakan kirim ulang perintah ini.");
    }

    return m.reply(
`✅ *Registrasi Berhasil!*

👤 *Nama:* ${result.user.name}
🆔 *ID:* ${result.key}
🎁 *Limit Amprem:* ${REGISTER_LIMIT}

Setiap penggunaan fitur amprem yang berhasil akan mengurangi 1 limit.
Limit kembali menjadi 5 setiap pergantian jam tepat pukul :00 WIB.`
    );
}
break;

case "limit":
case "ceklimit": {
    const user = getRegisteredUser(userIdentity);

    if (!user) {
        return m.reply(`Anda belum terdaftar. Gunakan ${prefix}register NamaAnda.`);
    }

    return m.reply(
`🎟️ *Informasi Limit*

👤 *Nama:* ${user.name || "-"}
🆔 *ID:* ${user.id}
📦 *Sisa Limit Amprem:* ${Number(user.limit) || 0}
✅ *Amprem Terpakai:* ${Number(user.ampremUsed) || 0}
♻️ *Reset Limit:* Setiap jam tepat :00 WIB`
    );
}
break;

case "amprem": {
    const membership = await checkRequiredGroupMembership(Rafael, m, userIdentity);
    if (!membership.ok) {
        return sendRequiredGroupButton(Rafael, m, prefix, command, membership);
    }

    const activeSessionKey = ampremKeys.find((key) => global.amprem?.[key]);

    if (activeSessionKey) {
        return m.reply("Masih ada proses yang belum selesai.");
    }

    const user = getRegisteredUser(userIdentity);

    if (!user) {
        return m.reply(`Anda belum terdaftar. Gunakan ${prefix}register NamaAnda terlebih dahulu.`);
    }

    if ((Number(user.limit) || 0) < 1) {
        return m.reply("Limit amprem Anda sudah habis. Limit akan kembali menjadi 5 pada pergantian jam berikutnya tepat :00 WIB.");
    }

    const sessionKey = user.id || userKey;
    global.amprem[sessionKey] = {
        step: "email",
        identity: {
            ...userIdentity,
            key: sessionKey
        }
    };

    m.reply(
`🎬 *Alight Motion Premium*

🎟️ *Sisa Limit:* ${Number(user.limit) || 0}

Silakan kirim email akun Alight Motion Anda.`
    );

}
break;

      default:
        if (budy.startsWith('=>')) {
          if (!isCreator) return;

          function Return(sul) {
            let sat = JSON.stringify(sul, null, 2);
            let bang = util.format(sat);
            if (sat === undefined) {
              bang = util.format(sul);
            }
            return m.reply(bang);
          }

          try {
            m.reply(util.format(
              await eval(`(async () => { return ${budy.slice(3)} })()`)
            ));
          } catch (e) {
            m.reply(String(e));
          }
        }

        if (budy.startsWith('>')) {
          if (!isCreator) return;
          const kode = budy.trim().split(/ +/)[0];
          let teks;
          try {
            teks = await eval(`(async () => { ${kode === '>>' ? 'return' : ''} ${q} })()`);
          } catch (e) {
            teks = e;
          } finally {
            await m.reply(util.format(teks));
          }
        }

        if (budy.startsWith('$')) {
          if (!isCreator) return;
          exec(budy.slice(2), (err, stdout) => {
            if (err) return m.reply(`${err}`);
            if (stdout) return m.reply(stdout);
          });
        }
    }
  } catch (err) {
    console.log(util.format(err));
  }
}

const __filename = fileURLToPath(import.meta.url);

fs.watchFile(__filename, () => {
  fs.unwatchFile(__filename);
  console.log(`Update ${__filename}`);
});
