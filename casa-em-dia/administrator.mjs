export const ADMIN_USER_ID = 'admin';

// Opt-in bootstrap material contains only a salted password digest. Once the
// account exists, its current password, contact details and active flag win.
export function provisionAdministrator(db, credential) {
  if (credential === undefined || credential === null || credential === '') return false;
  let parsed;
  try { parsed = JSON.parse(credential); }
  catch { throw new Error('CASA_ADMIN_BOOTSTRAP deve conter um JSON válido com salt e digest.'); }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object' ||
      typeof parsed.salt !== 'string' || !/^[a-f0-9]{32}$/i.test(parsed.salt) ||
      typeof parsed.digest !== 'string' || !/^[a-f0-9]{128}$/i.test(parsed.digest)) {
    throw new Error('CASA_ADMIN_BOOTSTRAP deve conter salt com 32 e digest com 128 caracteres hexadecimais.');
  }

  // Initial house configuration still requires the private setup flow.
  if (!db.prepare('SELECT id FROM settings WHERE id=1').get()) return false;
  const existing = db.prepare('SELECT role FROM users WHERE id=?').get(ADMIN_USER_ID);
  if (existing) {
    if (existing.role !== 'admin') throw new Error('O identificador reservado admin já pertence a uma conta sem permissão de administração.');
    return false;
  }

  db.prepare('INSERT INTO users(id,name,email,phone,role,active,password_hash,password_salt) VALUES(?,?,?,?,?,?,?,?)')
    .run(ADMIN_USER_ID, 'Administrador', 'admin@casa-em-dia.invalid', '', 'admin', 1, parsed.digest, parsed.salt);
  return true;
}
