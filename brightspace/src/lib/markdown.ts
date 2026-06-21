export interface HtmlLink {
  text: string;
  href: string;
}

export interface HtmlRender {
  markdown: string;
  links: HtmlLink[];
}

export function htmlToMarkdown(html: string, baseUrl: string): HtmlRender {
  const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? html;
  const links = extractLinks(body, baseUrl);
  const markdown = body
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, (table) =>
      tableToMarkdown(table, baseUrl),
    )
    .replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, "\n### $1\n")
    .replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, "\n#### $1\n")
    .replace(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, "\n##### $1\n")
    .replace(/<h4\b[^>]*>([\s\S]*?)<\/h4>/gi, "\n###### $1\n")
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, "\n- $1")
    .replace(/<img\b([^>]*)>/gi, (_match, attrs: string) => imageText(attrs))
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(
      /<a\b([^>]*)>([\s\S]*?)<\/a>/gi,
      (_match, attrs: string, label: string) => {
        const href = /href=["']([^"']+)["']/i.exec(attrs)?.[1];
        const text = stripHtml(label).trim() || href || "link";
        if (!href) {
          return text;
        }

        return `[${escapeMarkdown(text)}](${resolveHtmlUrl(baseUrl, decodeHtml(href))})`;
      },
    )
    .replace(/^[\s\S]*$/, (value) => applyInlineFormatting(value))
    .replace(/<[^>]+>/g, "")
    .replace(/\*\*([^\S\n]*)([\s\S]*?)([^\S\n]*)\*\*/g, "$1**$2**$3")
    .replace(/_([^\S\n]*)([\s\S]*?)([^\S\n]*)_/g, "$1_$2_$3")
    .replace(/\*{4,}/g, "**")
    .replace(/_{2,}/g, "_")
    .split("\n")
    .map((line) => decodeHtml(line).trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { markdown, links };
}

export function descriptionText(description?: {
  Html?: string | null;
  Text?: string | null;
}): string {
  if (!description) {
    return "";
  }

  return stripHtml(description.Html ?? description.Text ?? "");
}

export function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

export function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_{}[\]()#+\-.!|>])/g, "\\$1");
}

function tableToMarkdown(tableHtml: string, baseUrl: string): string {
  const rows = [...tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((rowMatch) => parseTableRow(rowMatch[1] ?? "", baseUrl))
    .filter((row) => row.length > 0);

  if (rows.length === 0) {
    return "";
  }

  const width = Math.max(...rows.map((row) => row.length));
  const normalizedRows = rows.map((row) => [
    ...row,
    ...Array.from({ length: width - row.length }, () => ""),
  ]);
  const header = normalizedRows[0];
  const body = normalizedRows.slice(1);

  if (width === 1) {
    return ["", ...normalizedRows.map((row) => `- ${row[0]}`), ""].join("\n");
  }

  return [
    "",
    `| ${header.map(tableCell).join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...body.map((row) => `| ${row.map(tableCell).join(" | ")} |`),
    "",
  ].join("\n");
}

function parseTableRow(rowHtml: string, baseUrl: string): string[] {
  return [...rowHtml.matchAll(/<t[hd]\b([^>]*)>([\s\S]*?)<\/t[hd]>/gi)].flatMap(
    (cellMatch) => {
      const attrs = cellMatch[1] ?? "";
      const cell = cleanTableCell(cellMatch[2] ?? "", baseUrl);
      const colspan = Number(/colspan=["']?(\d+)/i.exec(attrs)?.[1] ?? "1");
      return Array.from({ length: Math.max(1, colspan) }, (_, index) =>
        index === 0 ? cell : "",
      );
    },
  );
}

function cleanTableCell(cellHtml: string, baseUrl: string): string {
  return cellHtml
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<\/div>/gi, " ")
    .replace(/<img\b([^>]*)>/gi, (_match, attrs: string) => imageText(attrs))
    .replace(
      /<a\b([^>]*)>([\s\S]*?)<\/a>/gi,
      (_match, attrs: string, label: string) => {
        const href = /href=["']([^"']+)["']/i.exec(attrs)?.[1];
        const text = stripHtml(label).trim() || href || "link";
        return href
          ? `[${escapeMarkdown(text)}](${resolveHtmlUrl(baseUrl, decodeHtml(href))})`
          : text;
      },
    )
    .replace(/^[\s\S]*$/, (value) => applyInlineFormatting(value))
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .replace(/\*\*([^\S\n]*)([\s\S]*?)([^\S\n]*)\*\*/g, "$1**$2**$3")
    .replace(/_([^\S\n]*)([\s\S]*?)([^\S\n]*)_/g, "$1_$2_$3")
    .replace(/\*{4,}/g, "**")
    .replace(/_{2,}/g, "_")
    .replace(decodeHtmlPattern, decodeHtmlEntity)
    .trim();
}

function tableCell(value: string): string {
  return decodeHtml(value).replace(/\|/g, "\\|").replace(/\n+/g, "<br>").trim();
}

function imageText(attrs: string): string {
  const alt = /alt=["']([^"']+)["']/i.exec(attrs)?.[1];
  const title = /title=["']([^"']+)["']/i.exec(attrs)?.[1];
  const text = decodeHtml(alt ?? title ?? "").trim();

  if (!text) {
    return "";
  }

  if (/check|selected|achieved|complete/i.test(text)) {
    return " [selected] ";
  }

  return ` ${text} `;
}

function applyInlineFormatting(html: string): string {
  let result = html;

  for (let index = 0; index < 10; index++) {
    const next = result.replace(
      /<(strong|b|em|i|span)\b([^>]*)>([\s\S]*?)<\/\1>/gi,
      (_match, tag: string, attrs: string, content: string) =>
        formatInlineHtml(tag, attrs, content),
    );

    if (next === result) {
      return next;
    }

    result = next;
  }

  return result;
}

function formatInlineHtml(tag: string, attrs: string, content: string): string {
  const leadingWhitespace = /^\s*/.exec(content)?.[0] ?? "";
  const trailingWhitespace = /\s*$/.exec(content)?.[0] ?? "";
  const text = content.trim();
  if (!text) {
    return content;
  }

  const normalizedTag = tag.toLowerCase();
  const isBold = ["strong", "b"].includes(normalizedTag) || hasBoldStyle(attrs);
  const isItalic = ["em", "i"].includes(normalizedTag) || hasItalicStyle(attrs);
  let formatted = text;

  if (isBold && !isMarkdownWrapped(formatted, "**")) {
    formatted = `**${formatted}**`;
  }

  if (isItalic && !isMarkdownWrapped(formatted, "_")) {
    formatted = `_${formatted}_`;
  }

  return `${leadingWhitespace}${formatted}${trailingWhitespace}`;
}

function hasBoldStyle(attrs: string): boolean {
  const style = styleAttribute(attrs);
  const weight = /font-weight\s*:\s*([^;"']+)/i.exec(style)?.[1]?.trim();
  if (!weight) {
    return false;
  }

  return /bold|bolder/i.test(weight) || Number(weight) >= 600;
}

function hasItalicStyle(attrs: string): boolean {
  return /font-style\s*:\s*italic/i.test(styleAttribute(attrs));
}

function styleAttribute(attrs: string): string {
  return (
    /style\s*=\s*"([^"]*)"/i.exec(attrs)?.[1] ??
    /style\s*=\s*'([^']*)'/i.exec(attrs)?.[1] ??
    ""
  );
}

function isMarkdownWrapped(value: string, wrapper: string): boolean {
  return value.startsWith(wrapper) && value.endsWith(wrapper);
}

function extractLinks(html: string, baseUrl: string): HtmlLink[] {
  const links: HtmlLink[] = [];
  const seen = new Set<string>();
  const pattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html))) {
    const href = /href=["']([^"']+)["']/i.exec(match[1])?.[1];
    if (!href || href.startsWith("#") || href.startsWith("mailto:")) {
      continue;
    }

    const resolved = resolveHtmlUrl(baseUrl, decodeHtml(href));
    if (seen.has(resolved)) {
      continue;
    }

    seen.add(resolved);
    links.push({
      text: stripHtml(match[2] ?? "").trim() || resolved,
      href: resolved,
    });
  }

  return links;
}

function resolveHtmlUrl(baseUrl: string, href: string): string {
  return new URL(href, baseUrl).toString();
}

function decodeHtml(value: string): string {
  return value.replace(decodeHtmlPattern, decodeHtmlEntity);
}

const decodeHtmlPattern = /&(nbsp|amp|lt|gt|quot|#39|#x27|apos);/gi;

function decodeHtmlEntity(entity: string): string {
  switch (entity.toLowerCase()) {
    case "&nbsp;":
      return " ";
    case "&amp;":
      return "&";
    case "&lt;":
      return "<";
    case "&gt;":
      return ">";
    case "&quot;":
      return '"';
    case "&#39;":
    case "&#x27;":
    case "&apos;":
      return "'";
    default:
      return entity;
  }
}
