import { describe, expect, it } from "vitest";
import { START_PAGE_URL, toBrowserUrl } from "../src/browser/address.js";
import { panelLinksPrompt } from "../src/panelLinks.js";

describe("browser address bar (R1, R2)", () => {
  it.each([
    ["https://example.com/a", "https://example.com/a"],
    ["example.com", "https://example.com"],
    ["  google.com/search?q=a  ", "https://google.com/search?q=a"],
    ["localhost:3000", "https://localhost:3000"],
    ["قیمت طلا", "https://duckduckgo.com/?q=%D9%82%DB%8C%D9%85%D8%AA%20%D8%B7%D9%84%D8%A7"],
    ["best email service", "https://duckduckgo.com/?q=best%20email%20service"],
    ["javascript:alert(1)", "https://duckduckgo.com/?q=javascript%3Aalert(1)"],
  ])("%s", (input, want) => expect(toBrowserUrl(input)).toBe(want));

  it("never opens other kinds of address", () => {
    expect(toBrowserUrl("file:///etc/passwd")).toBeNull();
    expect(toBrowserUrl("data://x")).toBeNull();
    expect(toBrowserUrl("   ")).toBeNull();
  });

  it("has a start page of its own", () => {
    expect(START_PAGE_URL.startsWith("data:text/html")).toBe(true);
    expect(decodeURIComponent(START_PAGE_URL)).toContain("github.com");
  });
});

describe("panel links for bots (R3)", () => {
  it("lists every page as a link that opens inside the panel", () => {
    const p = panelLinksPrompt();
    for (const page of ["chat", "routines", "connections", "knowledge", "browser", "vault", "pages", "usage", "files", "settings"]) expect(p).toContain(`(#/${page})`);
  });
});
