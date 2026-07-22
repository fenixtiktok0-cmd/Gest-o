const admin = require('firebase-admin');

// Credenciais vêm 100% de variáveis de ambiente da Vercel.
// Nunca commitar o JSON da service account no repositório.
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Na Vercel, quebras de linha da private key viram literal "\n" —
      // por isso o replace abaixo.
      privateKey: process.env.FIREBASE_PRIVATE_KEY
        ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
        : undefined,
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
}

const db = admin.database();
const messaging = admin.messaging();

module.exports = { admin, db, messaging };
