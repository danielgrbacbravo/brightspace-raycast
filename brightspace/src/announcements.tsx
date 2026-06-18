import {
  Action,
  ActionPanel,
  Color,
  Form,
  List,
  Toast,
  showToast,
  useNavigation,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useMemo, useState } from "react";
import {
  type Course,
  type NewsItem,
  type RichText,
  type UserData,
} from "./lib/brightspace";
import { createAuthenticatedBrightspaceClient } from "./lib/client-factory";
import {
  clearCourseAcronym,
  decorateCourses,
  getCourseSettings,
  setCourseAcronym,
  type DecoratedCourse,
} from "./lib/course-settings";
import {
  descriptionText,
  escapeMarkdown,
  htmlToMarkdown,
  stripHtml,
} from "./lib/markdown";

const ALL_COURSES = "__all__";
const ANNOUNCEMENT_LOOKBACK_DAYS = 90;
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const ANNOUNCEMENT_GROUP_ORDER = [
  "Today",
  "Yesterday",
  "This Week",
  "Last Week",
  "This Month",
  "Last Month",
  "Older",
];

interface AnnouncementRecord {
  course: AnnouncementCourse;
  item: NewsItem;
  authorName?: string;
}

interface AnnouncementGroup {
  title: string;
  records: AnnouncementRecord[];
}

type AnnouncementCourse = Course & Partial<DecoratedCourse>;

interface AnnouncementAuthors {
  byUserId: Map<number, string>;
  byAnnouncement: Map<string, string>;
}

export default function Command() {
  const [selectedCourseId, setSelectedCourseId] = useState<string>(ALL_COURSES);
  const {
    data: courses,
    isLoading: isLoadingCourses,
    revalidate,
  } = usePromise(loadCourses);

  return (
    <AnnouncementsView
      courses={courses ?? []}
      isLoadingCourses={isLoadingCourses}
      selectedCourseId={selectedCourseId}
      onSelectedCourseIdChange={setSelectedCourseId}
      onCourseLabelsChanged={revalidate}
      showCoursePicker
    />
  );
}

export function CourseAnnouncements({ course }: { course: Course }) {
  const {
    data: courses,
    isLoading,
    revalidate,
  } = usePromise(async () => {
    const settings = await getCourseSettings();
    return decorateCourses([course], settings);
  }, [course.id]);

  return (
    <AnnouncementsView
      courses={courses ?? []}
      isLoadingCourses={isLoading}
      selectedCourseId={String(course.id)}
      onCourseLabelsChanged={revalidate}
    />
  );
}

function AnnouncementsView({
  courses,
  isLoadingCourses,
  selectedCourseId,
  onSelectedCourseIdChange,
  onCourseLabelsChanged,
  showCoursePicker = false,
}: {
  courses: AnnouncementCourse[];
  isLoadingCourses: boolean;
  selectedCourseId: string;
  onSelectedCourseIdChange?: (value: string) => void;
  onCourseLabelsChanged?: () => void;
  showCoursePicker?: boolean;
}) {
  const courseMap = useMemo(
    () => new Map(courses.map((course) => [String(course.id), course])),
    [courses],
  );

  const { data, isLoading } = usePromise(
    async (courseId: string, loadedCourses: Course[]) => {
      const client = await createAuthenticatedBrightspaceClient();
      const since = lookbackDate(ANNOUNCEMENT_LOOKBACK_DAYS);

      if (courseId !== ALL_COURSES) {
        const course = courseMap.get(courseId);
        if (!course) {
          return [];
        }

        const items = await client.getCourseNews(courseId, { since });
        const responses = [{ course, items }];
        const authors = await loadAnnouncementAuthors(client, responses);
        return normalizeAnnouncements(responses, authors);
      }

      const responses = await Promise.all(
        loadedCourses.map(async (course) => ({
          course,
          items: await client.getCourseNews(course.id, { since }),
        })),
      );
      const authors = await loadAnnouncementAuthors(client, responses);

      return normalizeAnnouncements(responses, authors);
    },
    [selectedCourseId, courses],
    { execute: courses.length > 0 },
  );

  return (
    <List
      isLoading={isLoadingCourses || isLoading}
      isShowingDetail
      searchBarPlaceholder="Search announcements"
      searchBarAccessory={
        showCoursePicker && onSelectedCourseIdChange ? (
          <List.Dropdown
            tooltip="Course"
            value={selectedCourseId}
            onChange={onSelectedCourseIdChange}
          >
            <List.Dropdown.Item title="All Courses" value={ALL_COURSES} />
            {courses.map((course) => (
              <List.Dropdown.Item
                key={course.id}
                title={course.name}
                value={String(course.id)}
              />
            ))}
          </List.Dropdown>
        ) : undefined
      }
    >
      {!isLoadingCourses && !isLoading && (data?.length ?? 0) === 0 ? (
        <List.EmptyView
          title="No Announcements"
          description="No announcements found in the selected window."
        />
      ) : null}
      {groupAnnouncements(data ?? []).map((group) => (
        <List.Section key={group.title} title={group.title}>
          {group.records.map((record) => (
            <AnnouncementItem
              key={`${record.course.id}-${record.item.Id}`}
              record={record}
              onCourseLabelChanged={onCourseLabelsChanged}
            />
          ))}
        </List.Section>
      ))}
    </List>
  );
}

function AnnouncementItem({
  record,
  onCourseLabelChanged,
}: {
  record: AnnouncementRecord;
  onCourseLabelChanged?: () => void;
}) {
  const { course, item } = record;
  const detail = announcementMarkdown(record);

  return (
    <List.Item
      title={item.Title}
      accessories={announcementAccessories(record)}
      detail={<List.Item.Detail markdown={detail} />}
      actions={
        <ActionPanel>
          {course.url ? (
            <Action.OpenInBrowser title="Open Course" url={course.url} />
          ) : null}
          <Action.Push
            title="Set Course Acronym"
            target={
              <CourseAcronymForm
                course={course}
                onSaved={onCourseLabelChanged}
              />
            }
          />
          <Action.CopyToClipboard
            title="Copy Announcement ID"
            content={String(item.Id)}
          />
        </ActionPanel>
      }
    />
  );
}

export function CourseAcronymForm({
  course,
  onSaved,
}: {
  course: AnnouncementCourse;
  onSaved?: () => void;
}) {
  const { pop } = useNavigation();
  const automatic = course.automaticCourseAcronym ?? courseLabel(course);

  return (
    <Form
      navigationTitle="Set Course Acronym"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Save Acronym"
            onSubmit={async (values: { acronym: string }) => {
              await setCourseAcronym(course.id, values.acronym);
              await showToast({
                style: Toast.Style.Success,
                title: "Course acronym saved",
                message: values.acronym.trim() || automatic,
              });
              onSaved?.();
              pop();
            }}
          />
          <Action
            title="Use Automatic Acronym"
            onAction={async () => {
              await clearCourseAcronym(course.id);
              await showToast({
                style: Toast.Style.Success,
                title: "Course acronym reset",
                message: automatic,
              });
              onSaved?.();
              pop();
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="acronym"
        title="Acronym"
        defaultValue={course.courseAcronym ?? automatic}
        placeholder={automatic}
      />
      <Form.Description title="Course" text={course.name} />
      <Form.Description title="Automatic" text={automatic} />
    </Form>
  );
}

async function loadCourses(): Promise<DecoratedCourse[]> {
  const client = await createAuthenticatedBrightspaceClient();
  const [rawCourses, settings] = await Promise.all([
    client.listCourses(),
    getCourseSettings(),
  ]);

  return decorateCourses(rawCourses, settings).sort(compareCourses);
}

function normalizeAnnouncements(
  responses: Array<{ course: AnnouncementCourse; items: NewsItem[] }>,
  authors: AnnouncementAuthors,
): AnnouncementRecord[] {
  const records: AnnouncementRecord[] = [];

  for (const { course, items } of responses) {
    for (const item of items) {
      if (item.IsHidden || item.IsPublished === false) {
        continue;
      }

      records.push({
        course,
        item,
        authorName: authorNameFor(course, item, authors),
      });
    }
  }

  return records.sort(compareAnnouncements);
}

function groupAnnouncements(
  records: AnnouncementRecord[],
): AnnouncementGroup[] {
  const groups = new Map<string, AnnouncementRecord[]>();

  for (const record of records) {
    const title = announcementGroupTitle(record.item);
    groups.set(title, [...(groups.get(title) ?? []), record]);
  }

  return ANNOUNCEMENT_GROUP_ORDER.flatMap((title) => {
    const groupRecords = groups.get(title);
    return groupRecords?.length ? [{ title, records: groupRecords }] : [];
  });
}

function announcementGroupTitle(item: NewsItem): string {
  const value = announcementDate(item);
  if (!value) {
    return "Older";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Older";
  }

  const today = startOfDay(new Date());
  const itemDay = startOfDay(date);
  const daysAgo = Math.floor((today.getTime() - itemDay.getTime()) / DAY_IN_MS);

  if (daysAgo <= 0) {
    return "Today";
  }

  if (daysAgo === 1) {
    return "Yesterday";
  }

  if (daysAgo <= 7) {
    return "This Week";
  }

  if (daysAgo <= 14) {
    return "Last Week";
  }

  if (daysAgo <= 31) {
    return "This Month";
  }

  if (daysAgo <= 62) {
    return "Last Month";
  }

  return "Older";
}

function announcementAccessories(
  record: AnnouncementRecord,
): List.Item.Accessory[] {
  const { course, item } = record;
  const accessories: List.Item.Accessory[] = [];

  accessories.push({ text: courseLabel(course), tooltip: course.name });

  if (item.IsPinned) {
    accessories.push({ tag: { value: "Pinned", color: Color.Yellow } });
  }

  if (item.IsGlobal) {
    accessories.push({ tag: { value: "Global", color: Color.Blue } });
  }

  if (item.Attachments?.length) {
    accessories.push({
      tag: {
        value: `${item.Attachments.length} files`,
        color: Color.SecondaryText,
      },
    });
  }

  return accessories;
}

function announcementMarkdown(record: AnnouncementRecord): string {
  const { course, item } = record;
  const body = announcementBodyMarkdown(item.Body, course.url);

  return [
    announcementInfoPills(record),
    "",
    `## ${escapeMarkdown(item.Title)}`,
    "",
    body || "_No announcement body returned by Brightspace._",
    item.Attachments?.length ? announcementAttachmentsMarkdown(item) : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function announcementInfoPills(record: AnnouncementRecord): string {
  const created = formatCompactDate(record.item.CreatedDate);
  const pills = [
    created ? `Created ${created}` : "",
    record.authorName ? `By ${record.authorName}` : "",
  ].filter(Boolean);

  return pills.map((pill) => `\`${escapeMarkdown(pill)}\``).join(" ");
}

function announcementBodyMarkdown(
  body: RichText | null | undefined,
  baseUrl?: string,
): string {
  const html = body?.Html?.trim();
  if (html && baseUrl) {
    const rendered = htmlToMarkdown(html, baseUrl);
    return rendered.markdown;
  }

  if (html) {
    return stripHtml(html);
  }

  return descriptionText(body);
}

function announcementAttachmentsMarkdown(item: NewsItem): string {
  return [
    "### Attachments",
    "",
    ...(item.Attachments ?? []).map(
      (attachment) => `- ${escapeMarkdown(attachment.FileName)}`,
    ),
  ].join("\n");
}

function announcementDate(item: NewsItem): string | undefined {
  return (
    item.StartDate ??
    item.PinnedDate ??
    item.LastModifiedDate ??
    item.CreatedDate ??
    undefined
  );
}

function formatCompactDate(value?: string | null): string | undefined {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function announcementTimestamp(item: NewsItem): number {
  const value = announcementDate(item);
  return value ? new Date(value).getTime() : 0;
}

function compareAnnouncements(
  a: AnnouncementRecord,
  b: AnnouncementRecord,
): number {
  return (
    Number(b.item.IsPinned) - Number(a.item.IsPinned) ||
    announcementTimestamp(b.item) - announcementTimestamp(a.item) ||
    a.item.Title.localeCompare(b.item.Title)
  );
}

function compareCourses(a: DecoratedCourse, b: DecoratedCourse): number {
  return (
    Number(b.isPinned) - Number(a.isPinned) ||
    compareDatesDesc(a.lastAccessed, b.lastAccessed) ||
    a.name.localeCompare(b.name)
  );
}

async function loadAnnouncementAuthors(
  client: Awaited<ReturnType<typeof createAuthenticatedBrightspaceClient>>,
  responses: Array<{ course: AnnouncementCourse; items: NewsItem[] }>,
): Promise<AnnouncementAuthors> {
  const items = responses.flatMap((response) => response.items);
  const authorIds = [
    ...new Set(
      items
        .map((item) => item.CreatedBy)
        .filter((id): id is number => typeof id === "number"),
    ),
  ];
  const entries = await Promise.all(
    authorIds.map(async (authorId) => {
      try {
        const user = await client.getUser(authorId);
        return [authorId, userDisplayName(user)] as const;
      } catch {
        return [authorId, undefined] as const;
      }
    }),
  );
  const byUserId = new Map(
    entries.filter((entry): entry is readonly [number, string] =>
      Boolean(entry[1]),
    ),
  );
  const byAnnouncement = await loadRenderedAnnouncementAuthors(
    client,
    responses.filter(({ items }) =>
      items.some((item) => !authorNameForUser(item, byUserId)),
    ),
  );

  return { byUserId, byAnnouncement };
}

async function loadRenderedAnnouncementAuthors(
  client: Awaited<ReturnType<typeof createAuthenticatedBrightspaceClient>>,
  responses: Array<{ course: AnnouncementCourse; items: NewsItem[] }>,
): Promise<Map<string, string>> {
  const entries = await Promise.all(
    responses.map(async ({ course, items }) => {
      try {
        const html = await fetchCourseNewsHtml(client, course);
        return parseRenderedAnnouncementAuthors(course, items, html);
      } catch {
        return [];
      }
    }),
  );

  return new Map(entries.flat());
}

function userDisplayName(user: UserData): string {
  return (
    user.DisplayName ||
    [user.FirstName, user.LastName].filter(Boolean).join(" ") ||
    user.UserName ||
    user.UniqueIdentifier ||
    ""
  );
}

async function fetchCourseNewsHtml(
  client: Awaited<ReturnType<typeof createAuthenticatedBrightspaceClient>>,
  course: AnnouncementCourse,
): Promise<string> {
  const urls = [
    `/d2l/lms/news/main.d2l?ou=${course.id}`,
    `/d2l/le/news/${course.id}/`,
    course.url,
  ].filter(Boolean) as string[];

  let lastError: unknown;
  for (const url of urls) {
    try {
      return await client.fetchText(url);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

function parseRenderedAnnouncementAuthors(
  course: AnnouncementCourse,
  items: NewsItem[],
  html: string,
): Array<readonly [string, string]> {
  const text = htmlToSearchText(html);
  return items.flatMap((item) => {
    const author = extractRenderedAuthor(text, item.Title);
    return author ? [[announcementKey(course, item), author] as const] : [];
  });
}

function extractRenderedAuthor(
  text: string,
  title: string,
): string | undefined {
  const normalizedTitle = normalizeSearchText(title);
  const index = text.indexOf(normalizedTitle);
  if (index === -1) {
    return undefined;
  }

  const window = text.slice(Math.max(0, index - 500), index + 1000);
  const patterns = [
    /\b(?:posted|published|created|written)\s+by\s+([A-Z][A-Za-z.' -]{1,80}?)(?=\s+(?:on|at|created|posted|published|updated|start|end|$))/i,
    /\bby\s+([A-Z][A-Za-z.' -]{1,80}?)(?=\s+(?:on|at|created|posted|published|updated|start|end|$))/i,
    /\b(?:author|instructor|posted by|created by)\s*:?\s*([A-Z][A-Za-z.' -]{1,80}?)(?=\s+(?:on|at|created|posted|published|updated|start|end|$))/i,
    /\b(?:geplaatst|gepubliceerd|geschreven)\s+door\s+([A-Z][A-Za-z.' -]{1,80}?)(?=\s+(?:op|om|gemaakt|geplaatst|gepubliceerd|bijgewerkt|$))/i,
    /\bdoor\s+([A-Z][A-Za-z.' -]{1,80}?)(?=\s+(?:op|om|gemaakt|geplaatst|gepubliceerd|bijgewerkt|$))/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(window);
    const author = cleanRenderedAuthor(match?.[1] ?? "");
    if (author) {
      return author;
    }
  }

  return undefined;
}

function authorNameFor(
  course: AnnouncementCourse,
  item: NewsItem,
  authors: AnnouncementAuthors,
): string | undefined {
  return (
    authorNameForUser(item, authors.byUserId) ??
    authors.byAnnouncement.get(announcementKey(course, item))
  );
}

function authorNameForUser(
  item: NewsItem,
  authorsByUserId: Map<number, string>,
): string | undefined {
  return typeof item.CreatedBy === "number"
    ? authorsByUserId.get(item.CreatedBy)
    : undefined;
}

function announcementKey(course: AnnouncementCourse, item: NewsItem): string {
  return `${course.id}:${item.Id}`;
}

function courseLabel(course: AnnouncementCourse): string {
  return course.courseAcronym ?? course.code ?? course.name;
}

function htmlToSearchText(html: string): string {
  return normalizeSearchText(
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );
}

function normalizeSearchText(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanRenderedAuthor(value: string): string | undefined {
  const author = value
    .replace(/\b(?:on|at|op|om)\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!author || /^(unknown|system|dear students?)$/i.test(author)) {
    return undefined;
  }

  return author;
}

function compareDatesDesc(a?: string, b?: string): number {
  const aTime = a ? new Date(a).getTime() : 0;
  const bTime = b ? new Date(b).getTime() : 0;
  return bTime - aTime;
}

function lookbackDate(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}
