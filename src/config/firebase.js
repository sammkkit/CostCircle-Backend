import admin from "firebase-admin";
import fs from "fs";

let serviceAccount;

// 1. Check if we have the JSON string in Environment Variables (Render/Production)
if (process.env.FIREBASE_CREDENTIALS) {
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
    console.log("Firebase loaded from Environment Variable");
  } catch (err) {
    console.error("Failed to parse FIREBASE_CREDENTIALS env var:", err);
  }
} 
// 2. Fallback: Check if the file exists locally (Local Development)
else {
  try {
    const filePath = new URL("../serviceAccountKey.json", import.meta.url);
    if (fs.existsSync(filePath)) {
      serviceAccount = JSON.parse(fs.readFileSync(filePath));
      console.log("Firebase loaded from local JSON file");
    }
  } catch (err) {
    console.error("Failed to load local Firebase file:", err);
  }
}

// 3. Initialize
if (serviceAccount) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
} else {
  console.error("CRITICAL: Firebase Service Account not found. Notifications will fail.");
}

export const messaging = admin.messaging();