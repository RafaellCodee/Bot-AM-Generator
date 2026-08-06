import fs from 'fs';
import { fileURLToPath } from 'url';

global.owner = [
  '6283846147781'
];
global.saluran = '';
global.idsal = '';
global.apikeyam = ""
global.requiredGroupJid = process.env.REQUIRED_GROUP_JID || '';
global.requiredGroupLink = process.env.REQUIRED_GROUP_LINK || 'https://chat.whatsapp.com/Lt0tfaHJZWxIy4ti4SyoSj';

const __filename = fileURLToPath(import.meta.url);

fs.watchFile(__filename, () => {
  fs.unwatchFile(__filename);
  console.log(`Update ${__filename}`);
});
