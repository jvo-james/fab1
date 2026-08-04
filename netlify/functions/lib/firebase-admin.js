const admin = require('firebase-admin');

function getAdmin() {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON_MISSING');
    let credentials;
    try { credentials = JSON.parse(raw); } catch { throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON_INVALID'); }
    if (credentials.private_key) credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
    admin.initializeApp({ credential: admin.credential.cert(credentials) });
  }
  return admin;
}

module.exports = { getAdmin };
