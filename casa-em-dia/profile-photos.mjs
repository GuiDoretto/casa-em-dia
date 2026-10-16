import { randomBytes } from 'node:crypto';

const MAX_PHOTO_BYTES = 192 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function isPng(data) {
  if (data.length < 57 || !data.subarray(0, 8).equals(PNG_SIGNATURE) || data.readUInt32BE(8) !== 13 || data.toString('ascii', 12, 16) !== 'IHDR' || !data.readUInt32BE(16) || !data.readUInt32BE(20)) return false;
  let offset = 8, imageData = false;
  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset), end = offset + 12 + length;
    if (end > data.length) return false;
    const kind = data.toString('ascii', offset + 4, offset + 8);
    if (kind === 'IDAT' && length > 0) imageData = true;
    if (kind === 'IEND') return length === 0 && imageData && end === data.length;
    offset = end;
  }
  return false;
}
function isJpeg(data) {
  if (data.length < 20 || data[0] !== 0xff || data[1] !== 0xd8 || data[2] !== 0xff || data[data.length - 2] !== 0xff || data[data.length - 1] !== 0xd9) return false;
  let offset = 2, hasFrame = false;
  const frameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  while (offset < data.length - 2) {
    if (data[offset++] !== 0xff) return false;
    while (data[offset] === 0xff) offset++;
    const marker = data[offset++];
    if (offset + 2 > data.length) return false;
    const length = data.readUInt16BE(offset);
    if (length < 2 || offset + length > data.length - 2) return false;
    if (frameMarkers.has(marker)) {
      if (length < 8 || !data.readUInt16BE(offset + 3) || !data.readUInt16BE(offset + 5)) return false;
      hasFrame = true;
    }
    if (marker === 0xda) return hasFrame && length >= 6 && offset + length < data.length - 2;
    offset += length;
  }
  return false;
}
function isWebp(data) {
  if (data.length < 26 || data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WEBP' || data.readUInt32LE(4) + 8 !== data.length) return false;
  let offset = 12, hasImage = false;
  while (offset + 8 <= data.length) {
    const kind = data.toString('ascii', offset, offset + 4), length = data.readUInt32LE(offset + 4), start = offset + 8;
    const end = start + length;
    if (end > data.length) return false;
    if (kind === 'VP8 ' && length >= 10 && !(data[start] & 1) && data[start + 3] === 0x9d && data[start + 4] === 0x01 && data[start + 5] === 0x2a && (data.readUInt16LE(start + 6) & 0x3fff) && (data.readUInt16LE(start + 8) & 0x3fff)) hasImage = true;
    if (kind === 'VP8L' && length >= 5 && data[start] === 0x2f) hasImage = true;
    if (kind === 'ANMF' && length > 16) hasImage = true;
    offset = end + (length % 2);
  }
  return hasImage && offset === data.length;
}

export function createPhotoStore(db, fail) {
  db.exec('CREATE TABLE IF NOT EXISTS profile_photos (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,mime TEXT NOT NULL,data BLOB NOT NULL,version TEXT NOT NULL)');
  const findVersion = db.prepare('SELECT version FROM profile_photos WHERE user_id=?');
  const findPhoto = db.prepare('SELECT mime,data,version FROM profile_photos WHERE user_id=?');
  const removePhoto = db.prepare('DELETE FROM profile_photos WHERE user_id=?');
  const savePhoto = db.prepare('INSERT INTO profile_photos(user_id,mime,data,version) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET mime=excluded.mime,data=excluded.data,version=excluded.version');
  return {
    photoUrl(userId) {
      const row = findVersion.get(userId);
      return row ? '/api/profile-photo?id=' + encodeURIComponent(userId) + '&v=' + encodeURIComponent(row.version) : null;
    },
    save(userId, photo) {
      if (photo === null) { removePhoto.run(userId); return; }
      if (typeof photo !== 'string') return fail('Escolha uma foto JPEG, PNG ou WebP válida.', 400);
      if (photo.length > Math.ceil(MAX_PHOTO_BYTES / 3) * 4 + 32) return fail('A foto deve ter no máximo 192 KB depois de ajustada.', 413);
      const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(photo);
      if (!match || match[2].length % 4 !== 0) return fail('Envie uma foto JPEG, PNG ou WebP em base64 válido.', 400);
      const data = Buffer.from(match[2], 'base64');
      if (data.length > MAX_PHOTO_BYTES) return fail('A foto deve ter no máximo 192 KB depois de ajustada.', 413);
      if (!data.length || data.toString('base64') !== match[2]) return fail('O conteúdo da foto está inválido. Selecione o arquivo novamente.', 400);
      const mime = 'image/' + match[1];
      const valid = mime === 'image/jpeg' ? isJpeg(data) : mime === 'image/png' ? isPng(data) : isWebp(data);
      if (!valid) return fail('O arquivo não corresponde a uma foto JPEG, PNG ou WebP válida.', 400);
      savePhoto.run(userId, mime, data, randomBytes(16).toString('hex'));
    },
    read(userId) {
      const row = findPhoto.get(userId);
      return row ? { data: Buffer.from(row.data), mime: row.mime, version: row.version } : null;
    },
  };
}