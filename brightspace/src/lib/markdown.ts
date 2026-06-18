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
    .replace(/<strong\b[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**")
    .replace(/<b\b[^>]*>([\s\S]*?)<\/b>/gi, "**$1**")
    .replace(/<em\b[^>]*>([\s\S]*?)<\/em>/gi, "_$1_")
    .replace(/<i\b[^>]*>([\s\S]*?)<\/i>/gi, "_$1_")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .split("\n")
    .map((line) => line.trim())
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
  const hasHeader = /<th\b/i.test(rowsHtml(tableHtml)[0] ?? "");
  const header = hasHeader
    ? normalizedRows[0]
    : normalizedRows[0].map((_, index) => `Column ${index + 1}`);
  const body = hasHeader ? normalizedRows.slice(1) : normalizedRows;

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
    .replace(/<strong\b[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**")
    .replace(/<b\b[^>]*>([\s\S]*?)<\/b>/gi, "**$1**")
    .replace(/<em\b[^>]*>([\s\S]*?)<\/em>/gi, "_$1_")
    .replace(/<i\b[^>]*>([\s\S]*?)<\/i>/gi, "_$1_")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function rowsHtml(tableHtml: string): string[] {
  return [...tableHtml.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)].map(
    (match) => match[0],
  );
}

function tableCell(value: string): string {
  return decodeHtml(value).replace(/\|/g, "\\|").replace(/\n+/g, "<br>").trim();
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
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
