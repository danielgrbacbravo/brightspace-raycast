import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import {
  Action,
  ActionPanel,
  Color,
  Detail,
  Icon,
  List,
  Toast,
  showInFinder,
  showToast,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import {
  formatDate,
  type BrightspaceClient,
  type BrightspaceResource,
  type ContentModule,
  type ContentTopic,
  type Course,
} from "./lib/brightspace";
import {
  descriptionText,
  escapeMarkdown,
  htmlToMarkdown,
  stripHtml,
} from "./lib/markdown";
import { createAuthenticatedBrightspaceClient } from "./lib/client-factory";
import { CoursesCommand } from "./my-courses";
import { AuthenticatedCommand } from "./lib/rug-login-view";

interface ContentSection {
  id: string;
  title: string;
  depth: number;
  parentTitles: string[];
  topics: ContentTopic[];
  module: ContentModule;
}

interface TopicKind {
  key: string;
  label: string;
  color: Color;
  canDownload: boolean;
}

export default function Command() {
  return (
    <AuthenticatedCommand>
      <CoursesCommand />
    </AuthenticatedCommand>
  );
}

export function CourseContent({ course }: { course: Course }) {
  const { data, isLoading } = usePromise(
    async (courseId: number) => {
      const client = await createAuthenticatedBrightspaceClient();
      const toc = await client.getContentToc(courseId);
      return { client, modules: toc.Modules ?? [] };
    },
    [course.id],
  );
  const sections = buildSections(data?.modules ?? []);

  return (
    <List
      isLoading={isLoading}
      isShowingDetail
      navigationTitle={course.name}
      searchBarPlaceholder="Search content"
    >
      {sections.map((section) => (
        <List.Section
          key={section.id}
          title={section.title}
          subtitle={
            section.parentTitles.length > 0
              ? section.parentTitles.join(" / ")
              : undefined
          }
        >
          {section.topics.map((topic) => (
            <TopicItem
              key={`topic-${topic.Id}`}
              topic={topic}
              parentTitles={[...section.parentTitles, section.title]}
              client={data?.client}
            />
          ))}
        </List.Section>
      ))}
    </List>
  );
}

function TopicItem({
  topic,
  parentTitles,
  client,
}: {
  topic: ContentTopic;
  parentTitles: string[];
  client?: BrightspaceClient;
}) {
  const topicUrl = topic.Url ? client?.resolveUrl(topic.Url) : undefined;

  // HEAD request to resolve content-type cheaply (no body download).
  // Drives the colored type badge; falls back to URL-based guessing until resolved.
  const { data: typeHint } = usePromise(
    async (url?: string) => {
      if (!client || !url) return undefined;
      return client.resolveTopicType(url);
    },
    [topic.Url],
    { execute: Boolean(client && topic.Url) },
  );

  const kind = topicKind(
    topic,
    typeHint?.url ?? topicUrl,
    typeHint?.contentType,
  );

  const fullDetail = (
    <FullTopicDetail
      topic={topic}
      parentTitles={parentTitles}
      client={client}
    />
  );

  return (
    <List.Item
      title={topic.Title}
      accessories={topicAccessories(topic, kind)}
      detail={
        <TopicDetail
          topic={topic}
          parentTitles={parentTitles}
          client={client}
        />
      }
      actions={
        <ActionPanel>
          <Action.Push
            icon={Icon.Maximize}
            title="View Full Width"
            target={fullDetail}
            shortcut={{ modifiers: ["cmd"], key: "f" }}
          />
          {topicUrl ? (
            <Action.OpenInBrowser title={`Open ${kind.label}`} url={topicUrl} />
          ) : null}
          {topicUrl && client && kind.canDownload ? (
            <Action
              icon={Icon.Download}
              title={`Download ${kind.label}`}
              onAction={async () => {
                const filePath = await downloadTopic(client, topic);
                await showToast({
                  style: Toast.Style.Success,
                  title: `Downloaded ${kind.label.toLowerCase()}`,
                  message: basename(filePath),
                });
                await showInFinder(filePath);
              }}
            />
          ) : null}
          <Action.Push
            icon={Icon.Sidebar}
            title="Show Sidebar Details"
            target={<Detail markdown={topicMarkdown(topic, parentTitles)} />}
          />
          <Action.CopyToClipboard
            title="Copy Topic ID"
            content={String(topic.Id)}
          />
          {topicUrl ? (
            <Action.CopyToClipboard title="Copy Topic URL" content={topicUrl} />
          ) : null}
        </ActionPanel>
      }
    />
  );
}

function TopicDetail({
  topic,
  parentTitles,
  client,
}: {
  topic: ContentTopic;
  parentTitles: string[];
  client?: BrightspaceClient;
}) {
  const {
    data: resource,
    isLoading,
    error,
  } = usePromise(
    async (url?: string) => {
      if (!client || !url) {
        return undefined;
      }

      return client.fetchResource(url);
    },
    [topic.Url],
    {
      execute: Boolean(client && topic.Url),
      onError: () => {
        /* Error is handled via the 'error' return value to avoid a global toast */
      },
    },
  );

  return (
    <List.Item.Detail
      isLoading={isLoading}
      markdown={
        error
          ? `### ⚠️ Could not load content\n\n${error.message}\n\n---\n\n${topicMarkdown(topic, parentTitles)}`
          : resourceMarkdown(topic, parentTitles, resource)
      }
    />
  );
}

function FullTopicDetail({
  topic,
  parentTitles,
  client,
}: {
  topic: ContentTopic;
  parentTitles: string[];
  client?: BrightspaceClient;
}) {
  const {
    data: resource,
    isLoading,
    error,
  } = usePromise(
    async (url?: string) => {
      if (!client || !url) {
        return undefined;
      }

      return client.fetchResource(url);
    },
    [topic.Url],
    {
      execute: Boolean(client && topic.Url),
      onError: () => {
        /* Error is handled via the 'error' return value to avoid a global toast */
      },
    },
  );

  const topicUrl = topic.Url ? client?.resolveUrl(topic.Url) : undefined;
  const kind = topicKind(topic, topicUrl, resource?.contentType);

  return (
    <Detail
      isLoading={isLoading}
      navigationTitle={topic.Title}
      markdown={
        error
          ? `### ⚠️ Could not load content\n\n${error.message}\n\n---\n\n${topicMarkdown(topic, parentTitles)}`
          : resourceMarkdown(topic, parentTitles, resource)
      }
      actions={
        <ActionPanel>
          {topicUrl ? (
            <Action.OpenInBrowser title={`Open ${kind.label}`} url={topicUrl} />
          ) : null}
          {topicUrl && client && kind.canDownload ? (
            <Action
              icon={Icon.Download}
              title={`Download ${kind.label}`}
              onAction={async () => {
                const filePath = await downloadTopic(client, topic);
                await showToast({
                  style: Toast.Style.Success,
                  title: `Downloaded ${kind.label.toLowerCase()}`,
                  message: basename(filePath),
                });
                await showInFinder(filePath);
              }}
            />
          ) : null}
        </ActionPanel>
      }
    />
  );
}

function buildSections(
  modules: ContentModule[],
  depth = 0,
  parentTitles: string[] = [],
): ContentSection[] {
  return modules.flatMap((module) => {
    const moduleParents = [...parentTitles, module.Title];
    const section: ContentSection = {
      id: `module-${module.Id}`,
      title: module.Title,
      depth,
      parentTitles,
      topics: module.Topics ?? [],
      module,
    };
    return [
      section,
      ...buildSections(module.Modules ?? [], depth + 1, moduleParents),
    ];
  });
}

function topicMarkdown(topic: ContentTopic, parentTitles: string[]): string {
  const description =
    typeof topic.Description === "string"
      ? stripHtml(topic.Description)
      : descriptionText(topic.Description);

  return [
    `## ${escapeMarkdown(topic.Title)}`,
    "",
    parentTitles.length
      ? `**Path:** ${parentTitles.map(escapeMarkdown).join(" / ")}`
      : "",
    topic.DueDate ? `**Due:** ${formatDate(topic.DueDate)}` : "",
    topic.StartDate ? `**Starts:** ${formatDate(topic.StartDate)}` : "",
    topic.EndDate ? `**Ends:** ${formatDate(topic.EndDate)}` : "",
    topic.Url ? `**URL:** ${topic.Url}` : "",
    "",
    description || "_No inline description returned by Brightspace._",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function resourceMarkdown(
  topic: ContentTopic,
  parentTitles: string[],
  resource?: BrightspaceResource,
): string {
  const kind = topicKind(topic, resource?.url, resource?.contentType);
  const meta = topicMetaMarkdown(topic, parentTitles, resource);

  if (!resource) {
    return topicMarkdown(topic, parentTitles);
  }

  if (kind.key === "video") {
    return [
      `## ${escapeMarkdown(topic.Title)}`,
      "",
      "This is a video lecture.",
      "",
      resource.url ? `[Open in Browser](${resource.url})` : "",
      "",
      meta,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  if (isQuickLink(kind)) {
    return [
      `## ${escapeMarkdown(topic.Title)}`,
      "",
      `This is a Brightspace ${kind.label.toLowerCase()} link.`,
      "",
      resource.url ? `[Open ${kind.label}](${resource.url})` : "",
      "",
      meta,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  if (isPdf(resource)) {
    return [
      `## ${escapeMarkdown(topic.Title)}`,
      "",
      "This topic is a PDF.",
      "",
      "Use `Open Topic` to view it in the browser or `Download Topic` to save it locally.",
      "",
      meta,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  if (isHtml(resource)) {
    const rendered = htmlToMarkdown(resourceText(resource), resource.url);

    return [
      `## ${escapeMarkdown(topic.Title)}`,
      "",
      rendered.markdown || "_No readable HTML content found._",
      "",
      meta,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  return [
    `## ${escapeMarkdown(topic.Title)}`,
    "",
    parentTitles.length
      ? `**Path:** ${parentTitles.map(escapeMarkdown).join(" / ")}`
      : "",
    "",
    `Brightspace returned \`${resource.contentType || "unknown content"}\`.`,
    "",
    "Use `Open Topic` or `Download Topic` for this file.",
    "",
    meta,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function topicAccessories(
  topic: ContentTopic,
  kind: TopicKind,
): List.Item.Accessory[] {
  const accessories: List.Item.Accessory[] = [];

  if (topic.DueDate) {
    accessories.push({ text: `Due ${formatDate(topic.DueDate)}` });
  }

  if (topic.IsHidden) {
    accessories.push({ tag: { value: "Hidden", color: Color.Yellow } });
  }

  if (topic.IsLocked) {
    accessories.push({ tag: { value: "Locked", color: Color.Red } });
  }

  accessories.push({ tag: { value: kind.label, color: kind.color } });

  return accessories;
}

async function downloadTopic(
  client: BrightspaceClient,
  topic: ContentTopic,
): Promise<string> {
  if (!topic.Url) {
    throw new Error("Topic has no downloadable URL.");
  }

  const resource = await client.fetchResource(topic.Url);
  const fileName = safeFileName(
    resource.fileName ??
      fileNameFromUrl(resource.url) ??
      `${topic.Title}${isPdf(resource) ? ".pdf" : ".html"}`,
  );
  const filePath = join(homedir(), "Downloads", fileName);
  await writeFile(filePath, Buffer.from(resource.bytes));
  return filePath;
}

function topicKind(
  topic: ContentTopic,
  resolvedUrl?: string,
  contentType?: string,
): TopicKind {
  const originalUrl = topic.Url ?? "";
  const resolved = resolvedUrl ?? "";
  const value = `${originalUrl} ${resolved} ${topic.Title}`.toLowerCase();
  const resolvedValue = `${resolved} ${topic.Title}`.toLowerCase();

  if (/\/quizzing\/|\/quiz|quiz/.test(value)) {
    return {
      key: "quiz",
      label: "Quiz",
      color: Color.Orange,
      canDownload: false,
    };
  }

  if (/\/dropbox\/|assignment|assignments|submission/.test(value)) {
    return {
      key: "assignment",
      label: "Assignment",
      color: Color.Yellow,
      canDownload: false,
    };
  }

  if (/\/discussions\/|discussion|forum/.test(value)) {
    return {
      key: "discussion",
      label: "Discussion",
      color: Color.Green,
      canDownload: false,
    };
  }

  if (/\/grades\/|grade/.test(value)) {
    return {
      key: "grade",
      label: "Grade",
      color: Color.Magenta,
      canDownload: false,
    };
  }

  if (/\/calendar\/|calendar|event/.test(value)) {
    return {
      key: "calendar",
      label: "Calendar",
      color: Color.Blue,
      canDownload: false,
    };
  }

  // Content-type from actual HTTP response — most accurate, populated after the
  // HEAD request in TopicItem resolves.
  if (contentType) {
    if (contentType.includes("application/pdf")) {
      return { key: "pdf", label: "PDF", color: Color.Red, canDownload: true };
    }
    const videoMime = /^video\/([\w-]+)/i.exec(contentType);
    if (videoMime) {
      const codec = videoMime[1].toLowerCase();
      const ext: Record<string, string> = {
        quicktime: "MOV",
        "x-msvideo": "AVI",
        webm: "WEBM",
        "x-matroska": "MKV",
        "x-flv": "FLV",
      };
      return {
        key: "video",
        label: ext[codec] ?? videoMime[1].toUpperCase(),
        color: Color.Purple,
        canDownload: true,
      };
    }
    const audioMime = /^audio\/([\w-]+)/i.exec(contentType);
    if (audioMime) {
      const codec = audioMime[1].toLowerCase();
      const ext: Record<string, string> = {
        mpeg: "MP3",
        "x-wav": "WAV",
        wav: "WAV",
        mp4: "M4A",
        ogg: "OGG",
        flac: "FLAC",
      };
      return {
        key: "audio",
        label: ext[codec] ?? audioMime[1].toUpperCase(),
        color: Color.Blue,
        canDownload: true,
      };
    }
    // text/html and other types fall through to URL-based detection below
  }

  // LTI tool links are Brightspace wrappers; classify from the resolved target
  // first so shared wrapper IDs do not make unrelated tools look like streams.
  if (
    /quicklink\.d2l[^\s]*type=lti|type=lti[^\s]*quicklink\.d2l|\/lti\//i.test(
      originalUrl,
    )
  ) {
    const isOcasys = /\bocasys\b|ocasys\.rug\.nl/i.test(resolvedValue);
    if (isOcasys) {
      return {
        key: "external",
        label: "Ocasys",
        color: Color.Blue,
        canDownload: false,
      };
    }

    const isVideoTool =
      /\bkaltura\b|mediaspace|video|recording|capture|stream/i.test(
        resolvedValue,
      );
    const titleSuggestsVideo =
      /\b(lecture|video|recording|stream|media|watch)\b/i.test(topic.Title);
    if (isVideoTool || titleSuggestsVideo) {
      return {
        key: "video",
        label: "Stream",
        color: Color.Purple,
        canDownload: false,
      };
    }
    return {
      key: "external",
      label: "External",
      color: Color.SecondaryText,
      canDownload: false,
    };
  }

  if (/\.pdf(?:$|[?#])/.test(value)) {
    return { key: "pdf", label: "PDF", color: Color.Red, canDownload: true };
  }

  const videoExt = /\.(mp4|mov|avi|webm|mkv|m4v|flv|wmv)(?:$|[?#])/i.exec(
    value,
  );
  if (videoExt) {
    return {
      key: "video",
      label: videoExt[1].toUpperCase(),
      color: Color.Purple,
      canDownload: true,
    };
  }

  const audioExt = /\.(mp3|wav|aac|ogg|flac|m4a)(?:$|[?#])/i.exec(value);
  if (audioExt) {
    return {
      key: "audio",
      label: audioExt[1].toUpperCase(),
      color: Color.Blue,
      canDownload: true,
    };
  }

  if (/\.pptx?(?:$|[?#])/i.test(value)) {
    return {
      key: "slides",
      label: "Slides",
      color: Color.Pink,
      canDownload: true,
    };
  }

  if (/\.docx?(?:$|[?#])/i.test(value)) {
    return { key: "doc", label: "Word", color: Color.Blue, canDownload: true };
  }

  if (/\.xlsx?(?:$|[?#])/i.test(value)) {
    return {
      key: "sheet",
      label: "Sheet",
      color: Color.Green,
      canDownload: true,
    };
  }

  if (/\.(jpe?g|png|gif|svg|webp|bmp)(?:$|[?#])/i.test(value)) {
    return {
      key: "image",
      label: "Image",
      color: Color.Yellow,
      canDownload: true,
    };
  }

  if (topic.Url) {
    return {
      key: "page",
      label: "Page",
      color: Color.SecondaryText,
      canDownload: true,
    };
  }

  return {
    key: "topic",
    label: "Topic",
    color: Color.SecondaryText,
    canDownload: false,
  };
}

function isQuickLink(kind: TopicKind): boolean {
  return [
    "quiz",
    "assignment",
    "discussion",
    "grade",
    "calendar",
    "video",
    "external",
  ].includes(kind.key);
}

function isPdf(resource: BrightspaceResource): boolean {
  return (
    resource.contentType.toLowerCase().includes("application/pdf") ||
    /\.pdf(?:$|[?#])/i.test(resource.url)
  );
}

function isHtml(resource: BrightspaceResource): boolean {
  const contentType = resource.contentType.toLowerCase();
  return (
    contentType.includes("text/html") ||
    contentType.includes("application/xhtml")
  );
}

function resourceText(resource: BrightspaceResource): string {
  return Buffer.from(resource.bytes).toString("utf8");
}

function topicMetaMarkdown(
  topic: ContentTopic,
  parentTitles: string[],
  resource?: BrightspaceResource,
): string {
  return [
    "---",
    "",
    "### Details",
    "",
    parentTitles.length
      ? `Path: ${parentTitles.map(escapeMarkdown).join(" / ")}`
      : "",
    topic.DueDate ? `Due: ${formatDate(topic.DueDate)}` : "",
    topic.StartDate ? `Starts: ${formatDate(topic.StartDate)}` : "",
    topic.EndDate ? `Ends: ${formatDate(topic.EndDate)}` : "",
    resource?.contentType ? `Content type: \`${resource.contentType}\`` : "",
    resource?.fileName ? `File: \`${escapeMarkdown(resource.fileName)}\`` : "",
    `Topic ID: \`${topic.Id}\``,
    topic.ToolId ? `Tool ID: \`${topic.ToolId}\`` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function fileNameFromUrl(url: string): string | undefined {
  const path = new URL(url).pathname;
  const name = basename(decodeURIComponent(path));
  return name && name !== "/" ? name : undefined;
}

function safeFileName(value: string): string {
  return value.replace(/[/:\\]/g, "-").trim() || "brightspace-topic";
}
