import admin from "firebase-admin";
import fs from "fs";

// Read the file manually to avoid ES Module import issues
const serviceAccount = JSON.parse(
  fs.readFileSync(new URL("../serviceAccountKey.json", import.meta.url))
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

export const messaging = admin.messaging();