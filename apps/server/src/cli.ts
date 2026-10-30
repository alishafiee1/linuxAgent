// Server-side CLI (spec R2). Usage: pnpm cwp user:init <username>
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { AuthService } from "./auth/service.js";
import { loadConfig, loadEnvFile } from "./config.js";
import { openDb } from "./db.js";

async function readHidden(prompt: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout, terminal: true });
  const out = rl as unknown as { _writeToOutput: (s: string) => void };
  const original = out._writeToOutput.bind(rl);
  out._writeToOutput = (s: string) => original(s.startsWith(prompt) ? prompt : "");
  const answer = await rl.question(prompt);
  rl.close();
  stdout.write("\n");
  return answer;
}

async function main(): Promise<void> {
  const [cmd, username] = process.argv.slice(2);
  if (cmd !== "user:init" || !username) {
    console.error("usage: cwp user:init <username>");
    process.exit(2);
  }
  loadEnvFile(process.env.CWP_ENV_FILE ?? "/etc/cwp/env");
  const config = loadConfig();
  const auth = new AuthService(openDb(config.dbPath), config.masterKey);
  const password = await readHidden("Password (12+ chars): ");
  if ((await readHidden("Repeat password: ")) !== password) throw new Error("passwords do not match");
  const { otpauthUrl, secret } = await auth.createUser(username, password);
  console.log("\nAdd this to your authenticator app (scan as QR or enter the key):");
  console.log(`  key: ${secret}`);
  console.log(`  url: ${otpauthUrl}`);
  console.log("\nThis is shown once. Clear your terminal scrollback afterwards.");
}

main().catch((e: unknown) => {
  console.error((e as Error).message);
  process.exit(1);
});
