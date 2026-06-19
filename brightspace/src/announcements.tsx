import {
  Action,
  ActionPanel,
  Color,
  Form,
  Icon,
  List,
  Toast,
  showToast,
  useNavigation,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useMemo, useState } from "react";
import {
  type Course,
  type GradeValue,
  type NewsItem,
  type RichText,
  type UserData,
  formatGrade,
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
import { AuthenticatedCommand } from "./lib/rug-login-view";

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
  type: "announcement";
  course: AnnouncementCourse;
  item: NewsItem;
  authorName?: string;
}

interface GradeUpdateRecord {
  type: "grade";
  course: AnnouncementCourse;
  grade: GradeValue;
}

type FeedRecord = AnnouncementRecord | GradeUpdateRecord;

interface AnnouncementGroup {
  title: string;
  records: FeedRecord[];
}

type AnnouncementCourse = Course & Partial<DecoratedCourse>;

interface AnnouncementAuthors {
  byUserId: Map<number, string>;
  byAnnouncement: Map<string, string>;
}

export default function Command() {
  return (
    <AuthenticatedCommand>
      <AnnouncementsCommand />
    </AuthenticatedCommand>
  );
}

function AnnouncementsCommand() {
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

        const [items, grades] = await Promise.all([
          client.getCourseNews(courseId, { since }),
          loadCourseGradeUpdates(client, course, since),
        ]);
        const responses = [{ course, items }];
        const authors = await loadAnnouncementAuthors(client, responses);
        return sortFeedRecords([
          ...normalizeAnnouncements(responses, authors),
          ...grades,
        ]);
      }

      const responses = await Promise.all(
        loadedCourses.map(async (course) => ({
          course,
          items: await client.getCourseNews(course.id, { since }),
        })),
      );
      const grades = (
        await Promise.all(
          loadedCourses.map((course) =>
            loadCourseGradeUpdates(client, course, since),
          ),
        )
      ).flat();
      const authors = await loadAnnouncementAuthors(client, responses);

      return sortFeedRecords([
        ...normalizeAnnouncements(responses, authors),
        ...grades,
      ]);
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
          {group.records.map((record) =>
            record.type === "announcement" ? (
              <AnnouncementItem
                key={`${record.course.id}-announcement-${record.item.Id}`}
                record={record}
                onCourseLabelChanged={onCourseLabelsChanged}
              />
            ) : (
              <GradeUpdateItem
                key={`${record.course.id}-grade-${String(record.grade.GradeObjectIdentifier)}`}
                record={record}
              />
            ),
          )}
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
      icon={Icon.Newspaper}
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

function GradeUpdateItem({ record }: { record: GradeUpdateRecord }) {
  const { course, grade } = record;
  const detail = gradeUpdateMarkdown(record);
  const gradeText = formatGrade(grade);
  const points = gradePoints(grade);

  return (
    <List.Item
      title={`${grade.GradeObjectName ?? "Unnamed grade item"} updated`}
      accessories={[
        { text: courseLabel(course), tooltip: course.name },
        { tag: { value: gradeText, color: gradeColor(grade) } },
      ]}
      detail={<List.Item.Detail markdown={detail} />}
      actions={
        <ActionPanel>
          {course.url ? (
            <Action.OpenInBrowser title="Open Course" url={course.url} />
          ) : null}
          <Action.CopyToClipboard
            title="Copy Grade"
            content={points ? `${gradeText} (${points})` : gradeText}
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
        type: "announcement",
        course,
        item,
        authorName: authorNameFor(course, item, authors),
      });
    }
  }

  return records.sort(compareAnnouncements);
}

async function loadCourseGradeUpdates(
  client: Awaited<ReturnType<typeof createAuthenticatedBrightspaceClient>>,
  course: AnnouncementCourse,
  since: string,
): Promise<GradeUpdateRecord[]> {
  try {
    const grades = await client.getMyGradeValues(course.id);
    const sinceTime = new Date(since).getTime();

    return grades
      .filter((grade) => {
        const date = gradeUpdateDate(grade);
        const time = date ? new Date(date).getTime() : 0;
        return time >= sinceTime && hasVisibleGrade(grade);
      })
      .map((grade) => ({ type: "grade", course, grade }));
  } catch {
    return [];
  }
}

function groupAnnouncements(records: FeedRecord[]): AnnouncementGroup[] {
  const groups = new Map<string, FeedRecord[]>();

  for (const record of records) {
    const title = feedRecordGroupTitle(record);
    groups.set(title, [...(groups.get(title) ?? []), record]);
  }

  return ANNOUNCEMENT_GROUP_ORDER.flatMap((title) => {
    const groupRecords = groups.get(title);
    return groupRecords?.length ? [{ title, records: groupRecords }] : [];
  });
}

function feedRecordGroupTitle(record: FeedRecord): string {
  const value = feedRecordDate(record);
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

function gradeUpdateMarkdown(record: GradeUpdateRecord): string {
  const { course, grade } = record;
  const updated = formatCompactDate(gradeUpdateDate(grade));
  const points = gradePoints(grade);
  const comments = announcementBodyMarkdown(grade.Comments, course.url);
  const privateComments = announcementBodyMarkdown(
    grade.PrivateComments,
    course.url,
  );

  return [
    [updated ? `Updated ${updated}` : "", `Grade ${formatGrade(grade)}`]
      .filter(Boolean)
      .map((pill) => `\`${escapeMarkdown(pill)}\``)
      .join(" "),
    "",
    `## ${escapeMarkdown(grade.GradeObjectName ?? "Unnamed grade item")}`,
    "",
    `Course: ${escapeMarkdown(course.name)}`,
    `Grade: ${escapeMarkdown(formatGrade(grade))}`,
    points ? `Points: ${escapeMarkdown(points)}` : "",
    grade.GradeObjectTypeName
      ? `Type: ${escapeMarkdown(grade.GradeObjectTypeName)}`
      : "",
    "",
    comments ? `### Comments\n\n${comments}` : "",
    privateComments ? `### Private Comments\n\n${privateComments}` : "",
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

function gradeUpdateDate(grade: GradeValue): string | undefined {
  return grade.ReleasedDate ?? grade.LastModified ?? undefined;
}

function feedRecordDate(record: FeedRecord): string | undefined {
  return record.type === "announcement"
    ? announcementDate(record.item)
    : gradeUpdateDate(record.grade);
}

function hasVisibleGrade(grade: GradeValue): boolean {
  return (
    Boolean(grade.DisplayedGrade) ||
    typeof grade.PointsNumerator === "number" ||
    typeof grade.WeightedNumerator === "number"
  );
}

function gradePoints(grade: GradeValue): string | undefined {
  if (
    typeof grade.PointsNumerator === "number" &&
    typeof grade.PointsDenominator === "number"
  ) {
    return `${formatNumber(grade.PointsNumerator)} / ${formatNumber(grade.PointsDenominator)} pts`;
  }

  if (
    typeof grade.WeightedNumerator === "number" &&
    typeof grade.WeightedDenominator === "number"
  ) {
    return `${formatNumber(grade.WeightedNumerator)} / ${formatNumber(grade.WeightedDenominator)} weighted`;
  }

  return undefined;
}

function gradeColor(grade: GradeValue): Color {
  const percent = gradePercent(grade);

  if (percent === undefined) {
    return Color.Blue;
  }

  if (percent >= 90) {
    return Color.Green;
  }

  if (percent >= 70) {
    return Color.Yellow;
  }

  return Color.Red;
}

function gradePercent(grade: GradeValue): number | undefined {
  if (
    typeof grade.PointsNumerator === "number" &&
    typeof grade.PointsDenominator === "number" &&
    grade.PointsDenominator > 0
  ) {
    return (grade.PointsNumerator / grade.PointsDenominator) * 100;
  }

  if (
    typeof grade.WeightedNumerator === "number" &&
    typeof grade.WeightedDenominator === "number" &&
    grade.WeightedDenominator > 0
  ) {
    return (grade.WeightedNumerator / grade.WeightedDenominator) * 100;
  }

  return undefined;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
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

function feedRecordTimestamp(record: FeedRecord): number {
  const value = feedRecordDate(record);
  return value ? new Date(value).getTime() : 0;
}

function sortFeedRecords(records: FeedRecord[]): FeedRecord[] {
  return records.sort(compareFeedRecords);
}

function compareFeedRecords(a: FeedRecord, b: FeedRecord): number {
  if (a.type === "announcement" && b.type === "announcement") {
    return compareAnnouncements(a, b);
  }

  return (
    feedRecordTimestamp(b) - feedRecordTimestamp(a) ||
    feedRecordTitle(a).localeCompare(feedRecordTitle(b))
  );
}

function compareAnnouncements(
  a: AnnouncementRecord,
  b: AnnouncementRecord,
): number {
  return (
    Number(b.item.IsPinned) - Number(a.item.IsPinned) ||
    feedRecordTimestamp(b) - feedRecordTimestamp(a) ||
    a.item.Title.localeCompare(b.item.Title)
  );
}

function feedRecordTitle(record: FeedRecord): string {
  return record.type === "announcement"
    ? record.item.Title
    : (record.grade.GradeObjectName ?? "Unnamed grade item");
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
