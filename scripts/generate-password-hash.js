const crypto = require('crypto');
const password = process.argv[2];
if (!password) {
  console.error('Usage: node scripts/generate-password-hash.js "your-password"');
  process.exit(1);
}
const N = 32768, r = 8, p = 1, keylen = 32;
const salt = crypto.randomBytes(16);
const hash = crypto.scryptSync(password, salt, keylen, { N, r, p, maxmem: 64 * 1024 * 1024 });
console.log(`scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${hash.toString('base64url')}`);
