import type { ReactNode } from "react";

// A small Markdown subset for bot replies. It builds React nodes and never injects HTML,
// so a bot (or a page it read) cannot run script in the panel.

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+?\*\*|__[^_\n]+?__)|(\*[^*\s][^*\n]*?\*)|(\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))/;

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let key = 0;
  while (rest) {
    const m = INLINE.exec(rest);
    if (!m) {
      out.push(rest);
      break;
    }
    if (m.index > 0) out.push(rest.slice(0, m.index));
    const token = m[0];
    if (m[1]) out.push(<code key={key++} dir="ltr">{token.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={key++}>{inline(token.slice(2, -2))}</strong>);
    else if (m[3]) out.push(<em key={key++}>{inline(token.slice(1, -1))}</em>);
    else {
      const link = /^\[([^\]]+)\]\((.+)\)$/.exec(token)!;
      out.push(
        <a key={key++} href={link[2]} target="_blank" rel="noopener noreferrer">
          {link[1]}
        </a>,
      );
    }
    rest = rest.slice(m.index + token.length);
  }
  return out;
}

const BLOCK_START = /^(#{1,4}\s|```|\s*[-*]\s|\s*\d+[.)]\s|>\s?|\|)/;

/** Every block gets dir="auto" so each paragraph follows its own language, whatever the page direction is. */
export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const key = blocks.length;
    if (!line.trim()) {
      i++;
    } else if (line.startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith("```")) body.push(lines[i++]!);
      i++;
      blocks.push(
        <pre key={key} dir="ltr">
          <code>{body.join("\n")}</code>
        </pre>,
      );
    } else if (/^#{1,4}\s/.test(line)) {
      blocks.push(
        <div key={key} className="md-h" dir="auto">
          {inline(line.replace(/^#+\s+/, ""))}
        </div>,
      );
      i++;
    } else if (/^\s*[-*]\s/.test(line) || /^\s*\d+[.)]\s/.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const re = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/;
      const items: string[] = [];
      while (i < lines.length && re.test(lines[i]!)) items.push(lines[i++]!.replace(re, ""));
      const children = items.map((it, n) => (
        <li key={n} dir="auto">
          {inline(it)}
        </li>
      ));
      blocks.push(ordered ? <ol key={key}>{children}</ol> : <ul key={key}>{children}</ul>);
    } else if (/^>\s?/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]!)) quoted.push(lines[i++]!.replace(/^>\s?/, ""));
      blocks.push(
        <blockquote key={key} dir="auto">
          {inline(quoted.join(" "))}
        </blockquote>,
      );
    } else if (/^\|.*\|\s*$/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i]!)) {
        const cells = lines[i++]!.trim().slice(1, -1).split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-+:?$/.test(c))) rows.push(cells);
      }
      blocks.push(
        <div key={key} className="md-table">
          <table>
            <tbody>
              {rows.map((r, n) => (
                <tr key={n}>
                  {r.map((c, m) => (
                    <td key={m} dir="auto">
                      {inline(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
    } else {
      const para: string[] = [];
      while (i < lines.length && lines[i]!.trim() && !BLOCK_START.test(lines[i]!)) para.push(lines[i++]!);
      if (para.length === 0) para.push(lines[i++]!);
      blocks.push(
        <p key={key} dir="auto">
          {para.flatMap((p, n) => (n ? [<br key={`b${n}`} />, ...inline(p)] : inline(p)))}
        </p>,
      );
    }
  }
  return <div className="md">{blocks}</div>;
}
