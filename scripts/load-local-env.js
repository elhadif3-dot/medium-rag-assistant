import fs from "node:fs";
import path from "node:path";

export function loadLocalEnv() {
  const envFiles = ["API.env", ".env.local", ".env"];

  for (const fileName of envFiles) {
    const envPath = path.join(process.cwd(), fileName);
    if (!fs.existsSync(envPath)) {
      continue;
    }

    const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const eq = trimmed.indexOf("=");
      if (eq === -1) {
        continue;
      }

      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      const current = process.env[key] || "";

      if (key && value && (!current || isPlaceholder(current) || !isPlaceholder(value))) {
        process.env[key] = value;
      }
    }
  }
}

function isPlaceholder(value) {
  return /^your_|^PASTE_/i.test(value || "");
}
