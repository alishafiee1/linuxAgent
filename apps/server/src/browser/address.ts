const SEARCH = "https://duckduckgo.com/?q=";

/**
 * What the person typed in the address bar becomes a page to open:
 * a full http(s) address stays, "example.com/page" gets https, anything else is a web search.
 * Other kinds of address (file:, javascript:, data: ...) are never opened.
 */
export function toBrowserUrl(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) return text;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return null;
  const host = text.split(/[/?#]/)[0]!;
  const looksLikeAddress = !/\s/.test(text) && (/^localhost(:\d+)?$/i.test(host) || /^[^\s:@]+\.[a-z]{2,}(:\d+)?$/i.test(host) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(host));
  return looksLikeAddress ? `https://${text}` : `${SEARCH}${encodeURIComponent(text)}`;
}

const TILES: [string, string][] = [
  ["Google", "https://www.google.com"],
  ["DuckDuckGo", "https://duckduckgo.com"],
  ["Wikipedia", "https://fa.wikipedia.org"],
  ["GitHub", "https://github.com"],
  ["YouTube", "https://www.youtube.com"],
  ["Gmail", "https://mail.google.com"],
];

const START_HTML = `<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><title>صفحهٔ شروع</title>
<style>body{margin:0;min-height:100vh;display:grid;place-content:center;gap:28px;justify-items:center;font:16px system-ui,"DejaVu Sans",sans-serif;background:#eef1fb;color:#1b2240}
h1{margin:0;font-size:26px}p{margin:0;color:#5a6590}
.grid{display:grid;grid-template-columns:repeat(3,150px);gap:14px}
a{display:block;padding:18px 10px;text-align:center;text-decoration:none;color:#1b2240;background:#fff;border-radius:16px;box-shadow:0 6px 18px rgba(70,90,170,.15);font-weight:600}</style>
<h1>مرورگر زنده</h1><p>آدرس یا عبارت جست‌وجو را در نوار بالای پنل بنویسید، یا یکی از این‌ها را بزنید.</p>
<div class="grid">${TILES.map(([name, href]) => `<a href="${href}">${name}</a>`).join("")}</div></html>`;

/** A page of our own, so a freshly opened browser is not a white screen. */
export const START_PAGE_URL = `data:text/html;charset=utf-8,${encodeURIComponent(START_HTML)}`;
