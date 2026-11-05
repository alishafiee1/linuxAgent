def edit(p,pairs):
    s=open(p,encoding='utf8',newline='').read()
    crlf='\r\n' in s
    for a,b in pairs:
        if crlf: a=a.replace('\n','\r\n'); b=b.replace('\n','\r\n')
        assert a in s,(p,a[:70]); s=s.replace(a,b,1)
    open(p,'w',encoding='utf8',newline='').write(s)

# --- icon
edit('apps/web/src/icons.tsx',[('export const IconGlobe = (p: IconProps) => (','''export const IconPaperclip = (p: IconProps) => (
  <Svg {...p}>
    <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </Svg>
);

export const IconGlobe = (p: IconProps) => (''')])

# --- chat: paperclip + growing textarea
edit('apps/web/src/Chat.tsx',[
('IconArrowUp, ','IconPaperclip, '),
('<IconArrowUp size={16} />','<IconPaperclip size={17} />'),
('  const bottom = useRef<HTMLDivElement>(null);','  const box = useRef<HTMLTextAreaElement>(null);\n  const bottom = useRef<HTMLDivElement>(null);'),
('<textarea rows={2} dir="auto"','<textarea ref={box} rows={2} dir="auto"'),
('  const [research, setResearch] = useState(false);','''  const [research, setResearch] = useState(false);
  // The text box grows with what is typed, up to a limit set in CSS; past that it scrolls.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);'''),
])

# --- markdown: links that stay inside the panel
edit('apps/web/src/Markdown.tsx',[
('(\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))/;','(\[[^\]\n]+\]\((?:https?:\/\/|#\/)[^\s)]+\))/;'),
('''      const link = /^\[([^\]]+)\]\((.+)\)$/.exec(token)!;
      out.push(
        <a key={key++} href={link[2]} target="_blank" rel="noopener noreferrer">
          {link[1]}
        </a>,
      );''','''      const link = /^\[([^\]]+)\]\((.+)\)$/.exec(token)!;
      const inside = panelHash(link[2]!);
      out.push(
        inside ? (
          <a key={key++} href={inside} className="panel-link">
            {link[1]}
          </a>
        ) : (
          <a key={key++} href={link[2]} target="_blank" rel="noopener noreferrer">
            {link[1]}
          </a>
        ),
      );'''),
('function inline(text: string): ReactNode[] {','''/** A link to a page of this panel ("#/settings", or the same address with the panel's own host) opens in place. */
function panelHash(href: string): string | null {
  if (href.startsWith("#/")) return href;
  const own = `${location.origin}/#/`;
  return href.startsWith(own) ? href.slice(location.origin.length + 1) : null;
}

function inline(text: string): ReactNode[] {'''),
])

# --- live browser
edit('apps/web/src/pagesExt.tsx',[
('''        <input dir="ltr" style={{ flex: 1 }} placeholder={status.url ?? "https://"} value={url} onChange={(e) => setUrl(e.target.value)} />''','''        <input dir="ltr" style={{ flex: 1 }} placeholder={shownUrl || t.browserAddressHint} value={url} onChange={(e) => setUrl(e.target.value)} enterKeyHint="go" autoCapitalize="off" autoCorrect="off" />'''),
('''      <div className="muted" dir="ltr" style={{ textAlign: "start", overflowWrap: "anywhere" }}>
        {status.title} — {status.url}
      </div>''','''      <Note msg={msg} />
      {shownUrl && (
        <div className="muted" dir="ltr" style={{ textAlign: "start", overflowWrap: "anywhere" }}>
          {status.title} — {shownUrl}
        </div>
      )}'''),
('  const running = status?.running ?? false;','  const running = status?.running ?? false;\n  // The start page is a "data:" address; it is long and means nothing to read.\n  const shownUrl = status?.url?.startsWith("data:") ? "" : (status?.url ?? "");'),
('          if (url.trim()) send({ type: "navigate", url: url.trim() });','          if (url.trim()) {\n            send({ type: "navigate", url: url.trim() });\n            setUrl("");\n          }'),
])
edit('apps/web/src/i18n.tsx',[
('  go: "برو",','  go: "برو",\n  browserAddressHint: "آدرس سایت یا عبارت جست‌وجو",'),
('  go: "Go",','  go: "Go",\n  browserAddressHint: "Site address or search words",'),
('  more: "بیشتر",','  more: "بیشتر",\n  navPages: "صفحه‌ها",'),
('  more: "More",','  more: "More",\n  navPages: "Pages",'),
])
