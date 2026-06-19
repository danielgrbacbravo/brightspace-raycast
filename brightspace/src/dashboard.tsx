import { Action, ActionPanel, Color, Icon, List } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import {
  formatDate,
  formatGrade,
  type BrightspaceClient,
  type CalendarEvent,
  type CourseUpdate,
  type GradeValue,
  type NewsItem,
  type RichText,
} from "./lib/brightspace";
import { createAuthenticatedBrightspaceClient } from "./lib/client-factory";
import {
  decorateCourses,
  getCourseSettings,
  type DecoratedCourse,
} from "./lib/course-settings";
import {
  descriptionText,
  escapeMarkdown,
  htmlToMarkdown,
  stripHtml,
} from "./lib/markdown";
import { CourseAnnouncements } from "./announcements";
import { CourseContent } from "./course-content";
import { AuthenticatedCommand } from "./lib/rug-login-view";

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const DUE_LOOKAHEAD_DAYS = 30;
const RECENT_LOOKBACK_DAYS = 14;
const MAX_FOCUS_COURSES = 8;
const MAX_SECTION_ITEMS = 8;

type DashboardItem =
  | AttentionItem
  | DueItem
  | GradeItem
  | AnnouncementItem
  | CourseShortcutItem;

interface AttentionItem {
  type: "attention";
  id: string;
  title: string;
  count: number;
  course?: DecoratedCourse;
  update: CourseUpdate;
}

interface DueItem {
  type: "due";
  id: string;
  title: string;
  dueDate: string;
  course: DecoratedCourse;
  event: CalendarEvent;
}

interface GradeItem {
  type: "grade";
  id: string;
  course: DecoratedCourse;
  grade: GradeValue;
  updatedAt: string;
}

interface AnnouncementItem {
  type: "announcement";
  id: string;
  course: DecoratedCourse;
  announcement: NewsItem;
  updatedAt: string;
}

interface CourseShortcutItem {
  type: "course";
  id: string;
  course: DecoratedCourse;
}

interface DashboardData {
  needsAttention: AttentionItem[];
  dueSoon: DueItem[];
  recentFeedback: GradeItem[];
  recentAnnouncements: AnnouncementItem[];
  courseShortcuts: CourseShortcutItem[];
}

export default function Command() {
  return (
    <AuthenticatedCommand>
      <DashboardCommand />
    </AuthenticatedCommand>
  );
}

function DashboardCommand() {
  const { data, isLoading } = usePromise(loadDashboard);

  return (
    <List
      isLoading={isLoading}
      isShowingDetail
      searchBarPlaceholder="Search dashboard"
    >
      {!isLoading && !hasDashboardItems(data) ? (
        <List.EmptyView
          icon={Icon.AppWindowGrid2x2}
          title="No Dashboard Items"
          description="No recent Brightspace activity was found."
        />
      ) : null}
      <DashboardSection
        title="Course Shortcuts"
        items={data?.courseShortcuts ?? []}
      />
      <DashboardSection
        title="Needs Attention"
        items={data?.needsAttention ?? []}
      />
      <DashboardSection title="Due Soon" items={data?.dueSoon ?? []} />
      <DashboardSection
        title="Recent Feedback"
        items={data?.recentFeedback ?? []}
      />
      <DashboardSection
        title="Recent Announcements"
        items={data?.recentAnnouncements ?? []}
      />
    </List>
  );
}

function DashboardSection({
  title,
  items,
}: {
  title: string;
  items: DashboardItem[];
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <List.Section title={title}>
      {items.map((item) => (
        <DashboardListItem key={item.id} item={item} />
      ))}
    </List.Section>
  );
}

function DashboardListItem({ item }: { item: DashboardItem }) {
  if (item.type === "attention") {
    return (
      <List.Item
        icon={Icon.ExclamationMark}
        title={item.title}
        accessories={attentionAccessories(item)}
        detail={<List.Item.Detail markdown={attentionMarkdown(item)} />}
        actions={<DashboardActions course={item.course} />}
      />
    );
  }

  if (item.type === "due") {
    return (
      <List.Item
        icon={Icon.Calendar}
        title={item.title}
        accessories={[
          { text: item.course.courseAcronym, tooltip: item.course.name },
          {
            tag: {
              value: dueLabel(item.dueDate),
              color: dueColor(item.dueDate),
            },
          },
        ]}
        detail={<List.Item.Detail markdown={dueMarkdown(item)} />}
        actions={
          <DashboardActions
            course={item.course}
            copyTitle="Copy Due Date"
            copyValue={formatDate(item.dueDate) ?? item.dueDate}
          />
        }
      />
    );
  }

  if (item.type === "grade") {
    return (
      <List.Item
        title={`${item.grade.GradeObjectName ?? "Unnamed grade item"} updated`}
        accessories={[
          { text: item.course.courseAcronym, tooltip: item.course.name },
          {
            tag: {
              value: formatGrade(item.grade),
              color: gradeColor(item.grade),
            },
          },
        ]}
        detail={<List.Item.Detail markdown={gradeMarkdown(item)} />}
        actions={
          <DashboardActions
            course={item.course}
            copyTitle="Copy Grade"
            copyValue={formatGrade(item.grade)}
          />
        }
      />
    );
  }

  if (item.type === "announcement") {
    return (
      <List.Item
        icon={Icon.Newspaper}
        title={item.announcement.Title}
        accessories={[
          { text: item.course.courseAcronym, tooltip: item.course.name },
          { text: formatCompactDate(item.updatedAt) ?? "" },
        ]}
        detail={<List.Item.Detail markdown={announcementMarkdown(item)} />}
        actions={
          <DashboardActions
            course={item.course}
            copyTitle="Copy Announcement ID"
            copyValue={String(item.announcement.Id)}
          />
        }
      />
    );
  }

  return (
    <List.Item
      icon={Icon.Book}
      title={item.course.name}
      subtitle={item.course.code}
      accessories={courseAccessories(item.course)}
      detail={<List.Item.Detail markdown={courseMarkdown(item)} />}
      actions={<DashboardActions course={item.course} />}
    />
  );
}

function DashboardActions({
  course,
  copyTitle,
  copyValue,
}: {
  course?: DecoratedCourse;
  copyTitle?: string;
  copyValue?: string;
}) {
  return (
    <ActionPanel>
      {course ? (
        <Action.Push
          title="Browse Content"
          target={<CourseContent course={course} />}
        />
      ) : null}
      {course ? (
        <Action.Push
          title="Browse Announcements"
          target={<CourseAnnouncements course={course} />}
        />
      ) : null}
      {course?.url ? (
        <Action.OpenInBrowser title="Open Course" url={course.url} />
      ) : null}
      {copyTitle && copyValue ? (
        <Action.CopyToClipboard title={copyTitle} content={copyValue} />
      ) : null}
      {course ? (
        <Action.CopyToClipboard
          title="Copy Course ID"
          content={String(course.id)}
        />
      ) : null}
    </ActionPanel>
  );
}

async function loadDashboard(): Promise<DashboardData> {
  const client = await createAuthenticatedBrightspaceClient();
  const [rawCourses, settings] = await Promise.all([
    client.listCourses(),
    getCourseSettings(),
  ]);
  const courses = decorateCourses(rawCourses, settings).sort(compareCourses);
  const courseMap = new Map(courses.map((course) => [course.id, course]));
  const focusCourses = courses.filter((course) => course.isPinned).length
    ? courses.filter((course) => course.isPinned)
    : courses.slice(0, MAX_FOCUS_COURSES);
  const since = relativeIsoDate(-RECENT_LOOKBACK_DAYS);

  const [updates, events, announcements, grades] = await Promise.all([
    loadUpdates(client),
    loadDueEvents(client, courses, courseMap),
    loadRecentAnnouncements(client, courses, since),
    loadRecentGrades(client, courses, since),
  ]);

  return {
    needsAttention: updates
      .flatMap((update, index) => attentionItem(update, index, courseMap))
      .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title))
      .slice(0, MAX_SECTION_ITEMS),
    dueSoon: events.slice(0, MAX_SECTION_ITEMS),
    recentFeedback: grades.slice(0, MAX_SECTION_ITEMS),
    recentAnnouncements: announcements.slice(0, MAX_SECTION_ITEMS),
    courseShortcuts: focusCourses.slice(0, MAX_SECTION_ITEMS).map((course) => ({
      type: "course",
      id: `course:${course.id}`,
      course,
    })),
  };
}

async function loadUpdates(client: BrightspaceClient): Promise<CourseUpdate[]> {
  try {
    return await client.getMyUpdates();
  } catch {
    return [];
  }
}

async function loadDueEvents(
  client: BrightspaceClient,
  courses: DecoratedCourse[],
  courseMap: Map<number, DecoratedCourse>,
): Promise<DueItem[]> {
  try {
    const events = await client.getMyDueDateEvents({
      orgUnitIds: courses.map((course) => course.id),
      startDateTime: new Date().toISOString(),
      endDateTime: relativeIsoDate(DUE_LOOKAHEAD_DAYS),
    });

    return events
      .flatMap((event) => dueItem(event, courseMap))
      .filter((item) => new Date(item.dueDate).getTime() >= Date.now())
      .sort(
        (a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime(),
      );
  } catch {
    return [];
  }
}

async function loadRecentAnnouncements(
  client: BrightspaceClient,
  courses: DecoratedCourse[],
  since: string,
): Promise<AnnouncementItem[]> {
  const entries = await Promise.all(
    courses.map(async (course) => {
      try {
        const items = await client.getCourseNews(course.id, { since });
        return items
          .filter(
            (announcement) =>
              !announcement.IsHidden && announcement.IsPublished !== false,
          )
          .flatMap((announcement) => {
            const updatedAt = announcementDate(announcement);
            return updatedAt
              ? [
                  {
                    type: "announcement" as const,
                    id: `announcement:${course.id}:${announcement.Id}`,
                    course,
                    announcement,
                    updatedAt,
                  },
                ]
              : [];
          });
      } catch {
        return [];
      }
    }),
  );

  return entries
    .flat()
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
}

async function loadRecentGrades(
  client: BrightspaceClient,
  courses: DecoratedCourse[],
  since: string,
): Promise<GradeItem[]> {
  const sinceTime = new Date(since).getTime();
  const entries = await Promise.all(
    courses.map(async (course) => {
      try {
        const grades = await client.getMyGradeValues(course.id);
        return grades.flatMap((grade) => {
          const updatedAt = gradeDate(grade);
          const updatedTime = updatedAt ? new Date(updatedAt).getTime() : 0;
          return updatedTime >= sinceTime && hasVisibleGrade(grade)
            ? [
                {
                  type: "grade" as const,
                  id: `grade:${course.id}:${String(grade.GradeObjectIdentifier)}`,
                  course,
                  grade,
                  updatedAt,
                },
              ]
            : [];
        });
      } catch {
        return [];
      }
    }),
  );

  return entries
    .flat()
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
}

function attentionItem(
  update: CourseUpdate,
  index: number,
  courseMap: Map<number, DecoratedCourse>,
): AttentionItem[] {
  const count = Number(update.Count ?? 0);
  if (count <= 0) {
    return [];
  }

  const course = update.OrgUnitId ? courseMap.get(update.OrgUnitId) : undefined;
  return [
    {
      type: "attention",
      id: `attention:${update.OrgUnitId ?? "global"}:${update.UpdateType ?? update.Name ?? index}`,
      title: updateTitle(update),
      count,
      course,
      update,
    },
  ];
}

function dueItem(
  event: CalendarEvent,
  courseMap: Map<number, DecoratedCourse>,
): DueItem[] {
  const dueDate = event.StartDateTime ?? event.EndDateTime ?? event.StartDay;
  const course = event.OrgUnitId ? courseMap.get(event.OrgUnitId) : undefined;

  if (!dueDate || !course || event.IsHidden) {
    return [];
  }

  return [
    {
      type: "due",
      id: `due:${course.id}:${event.CalendarEventId ?? event.Id ?? event.Title}`,
      title: eventTitle(event),
      dueDate,
      course,
      event,
    },
  ];
}

function attentionAccessories(item: AttentionItem): List.Item.Accessory[] {
  const accessories: List.Item.Accessory[] = [
    { tag: { value: String(item.count), color: Color.Red } },
  ];
  if (item.course) {
    accessories.unshift({
      text: item.course.courseAcronym,
      tooltip: item.course.name,
    });
  }
  return accessories;
}

function courseAccessories(course: DecoratedCourse): List.Item.Accessory[] {
  return [
    course.isPinned ? { tag: { value: "Pinned", color: Color.Yellow } } : {},
    course.lastAccessed
      ? { text: `Opened ${formatCompactDate(course.lastAccessed)}` }
      : {},
  ].filter(
    (accessory) => Object.keys(accessory).length > 0,
  ) as List.Item.Accessory[];
}

function attentionMarkdown(item: AttentionItem): string {
  return [
    `## ${escapeMarkdown(item.title)}`,
    "",
    item.course ? `Course: ${escapeMarkdown(item.course.name)}` : "",
    `Count: ${item.count}`,
    item.update.UpdateType
      ? `Type: ${escapeMarkdown(item.update.UpdateType)}`
      : "",
    updateDate(item.update)
      ? `Updated: ${escapeMarkdown(formatDate(updateDate(item.update)) ?? updateDate(item.update) ?? "")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function dueMarkdown(item: DueItem): string {
  return [
    `\`${escapeMarkdown(dueLabel(item.dueDate))}\` \`${escapeMarkdown(item.course.courseAcronym)}\``,
    "",
    `## ${escapeMarkdown(item.title)}`,
    "",
    `Course: ${escapeMarkdown(item.course.name)}`,
    `Due: ${escapeMarkdown(formatDate(item.dueDate) ?? item.dueDate)}`,
    item.event.AssociatedEntity?.AssociatedEntityType
      ? `Type: ${escapeMarkdown(compactEntityType(item.event.AssociatedEntity.AssociatedEntityType))}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function gradeMarkdown(item: GradeItem): string {
  const points = gradePoints(item.grade);
  const comments = richTextMarkdown(item.grade.Comments, item.course.url);

  return [
    `\`${escapeMarkdown(formatGrade(item.grade))}\` \`${escapeMarkdown(formatCompactDate(item.updatedAt) ?? item.updatedAt)}\``,
    "",
    `## ${escapeMarkdown(item.grade.GradeObjectName ?? "Unnamed grade item")}`,
    "",
    `Course: ${escapeMarkdown(item.course.name)}`,
    `Grade: ${escapeMarkdown(formatGrade(item.grade))}`,
    points ? `Points: ${escapeMarkdown(points)}` : "",
    item.grade.GradeObjectTypeName
      ? `Type: ${escapeMarkdown(item.grade.GradeObjectTypeName)}`
      : "",
    comments ? `### Comments\n\n${comments}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function announcementMarkdown(item: AnnouncementItem): string {
  const body = richTextMarkdown(item.announcement.Body, item.course.url);
  return [
    `\`${escapeMarkdown(formatCompactDate(item.updatedAt) ?? item.updatedAt)}\` \`${escapeMarkdown(item.course.courseAcronym)}\``,
    "",
    `## ${escapeMarkdown(item.announcement.Title)}`,
    "",
    body || "_No announcement body returned by Brightspace._",
  ].join("\n\n");
}

function courseMarkdown(item: CourseShortcutItem): string {
  return [
    `## ${escapeMarkdown(item.course.name)}`,
    "",
    item.course.code ? `Code: ${escapeMarkdown(item.course.code)}` : "",
    item.course.lastAccessed
      ? `Last opened: ${escapeMarkdown(formatDate(item.course.lastAccessed) ?? item.course.lastAccessed)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function updateTitle(update: CourseUpdate): string {
  const label =
    update.UpdateTypeName ??
    update.Name ??
    update.UpdateType ??
    "Brightspace update";
  return compactEntityType(label);
}

function updateDate(update: CourseUpdate): string | undefined {
  return update.LastModified ?? update.LastModifiedDate ?? undefined;
}

function eventTitle(event: CalendarEvent): string {
  return (
    event.topicCO?.Title ??
    event.TopicCO?.Title ??
    event.ContentObject?.Title ??
    event.AssociatedEntity?.Title ??
    event.AssociatedEntity?.Name ??
    event.Title
  );
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

function gradeDate(grade: GradeValue): string | undefined {
  return grade.ReleasedDate ?? grade.LastModified ?? undefined;
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

function dueLabel(value: string): string {
  const days = daysUntil(value);
  if (days < 0) {
    return "Overdue";
  }
  if (days === 0) {
    return "Today";
  }
  if (days === 1) {
    return "Tomorrow";
  }
  return formatCompactDate(value) ?? value;
}

function dueColor(value: string): Color {
  const days = daysUntil(value);
  if (days < 0) {
    return Color.Red;
  }
  if (days <= 1) {
    return Color.Yellow;
  }
  return Color.Blue;
}

function richTextMarkdown(
  body: RichText | null | undefined,
  baseUrl?: string,
): string {
  const html = body?.Html?.trim();
  if (html && baseUrl) {
    return htmlToMarkdown(html, baseUrl).markdown;
  }
  if (html) {
    return stripHtml(html);
  }
  return descriptionText(body);
}

function compactEntityType(value: string): string {
  return (
    value
      .split(".")
      .filter(Boolean)
      .at(-1)
      ?.replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/_/g, " ") ?? value
  );
}

function compareCourses(a: DecoratedCourse, b: DecoratedCourse): number {
  return (
    Number(b.isPinned) - Number(a.isPinned) ||
    compareDatesDesc(a.lastAccessed, b.lastAccessed) ||
    a.name.localeCompare(b.name)
  );
}

function compareDatesDesc(a?: string, b?: string): number {
  const aTime = a ? new Date(a).getTime() : 0;
  const bTime = b ? new Date(b).getTime() : 0;
  return bTime - aTime;
}

function daysUntil(value: string): number {
  const due = startOfDay(new Date(value));
  const today = startOfDay(new Date());
  return Math.floor((due.getTime() - today.getTime()) / DAY_IN_MS);
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function relativeIsoDate(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
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

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function hasDashboardItems(data?: DashboardData): boolean {
  return Boolean(
    data &&
    (data.needsAttention.length ||
      data.dueSoon.length ||
      data.recentFeedback.length ||
      data.recentAnnouncements.length ||
      data.courseShortcuts.length),
  );
}
