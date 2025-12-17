import { createHmac } from "crypto";

export function validateWebAppData(initData: string, botToken: string) {
  const urlParams = new URLSearchParams(initData);
  const hash = urlParams.get("hash");

  if (!hash) {
    throw new Error("Missing hash in initData");
  }

  urlParams.delete("hash");
  const dataToCheck = Array.from(urlParams.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();

  const calculatedHash = createHmac("sha256", secretKey)
    .update(dataToCheck)
    .digest("hex");

  if (calculatedHash !== hash) {
    throw new Error("Invalid hash");
  }

  const userStr = urlParams.get("user");
  if (!userStr) {
      throw new Error("Missing user in initData");
  }

  return JSON.parse(userStr);
}
