import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AVATAR_COUNT } from "../src/bots.js";

const dir = join(__dirname, "../../web/public/avatars");
const file = (n: number): string => (n <= 45 ? `a${String(n).padStart(2, "0")}.webp` : `b${String(n - 45).padStart(2, "0")}.webp`);

describe("avatar pictures", () => {
  it("has a picture file for every avatar number", () => {
    const missing = Array.from({ length: AVATAR_COUNT }, (_, i) => file(i + 1)).filter((f) => !existsSync(join(dir, f)));
    expect(missing).toEqual([]);
  });
});
