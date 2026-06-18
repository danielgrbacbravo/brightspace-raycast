import { Action, ActionPanel, Color, Icon, List } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import {
  formatDate,
  type BrightspaceClient,
  type CalendarContentObject,
  type CalendarEvent,
  type ContentModule,
  type ContentTopic,
  type EntityDropbox,
} from "./lib/brightspace";
import { createAuthenticatedBrightspaceClient } from "./lib/client-factory";
import {
  decorateCourses,
  getCourseSettings,
  type DecoratedCourse,
} from "./lib/course-settings";

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const LOOKBACK_DAYS = 14;
const LOOKAHEAD_DAYS = 180;
const DUE_GROUP_ORDER = [
  "Overdue",
  "Today",
  "Tomorrow",
  "This Week",
  "Next Week",
  "Later",
  "Submitted",
];

interface DueItem {
  id: string;
  title: string;
  dueDate: string;
  course: DecoratedCourse;
  event: CalendarEvent;
  contentObject?: CalendarContentObject;
  rawTitle?: string;
  submission?: SubmissionStatus;
}

interface SubmissionStatus {
  isSubmitted: boolean;
  submissionDate?: string;
}

interface DueGroup {
  title: string;
  items: DueItem[];
}

export default function Command() {
  const { data, isLoading } = usePromise(loadDueItems);

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search due work">
      {!isLoading && (data?.length ?? 0) === 0 ? (
        <List.EmptyView
          icon={Icon.Calendar}
          title="Nothing Due"
          description="No due-date calendar events were found."
        />
      ) : null}
      {groupDueItems(data ?? []).map((group) => (
        <List.Section key={group.title} title={group.title}>
          {group.items.map((item) => (
            <DueListItem key={item.id} item={item} />
          ))}
        </List.Section>
      ))}
    </List>
  );
}

function DueListItem({ item }: { item: DueItem }) {
  return (
    <List.Item
      icon={Icon.Calendar}
      title={item.title}
      subtitle={item.rawTitle}
      accessories={dueAccessories(item)}
      actions={
        <ActionPanel>
          {item.course.url ? (
            <Action.OpenInBrowser title="Open Course" url={item.course.url} />
          ) : null}
          <Action.CopyToClipboard
            title="Copy Due Date"
            content={formatDate(item.dueDate) ?? item.dueDate}
          />
          <Action.CopyToClipboard
            title="Copy Course ID"
            content={String(item.course.id)}
          />
        </ActionPanel>
      }
    />
  );
}

async function loadDueItems(): Promise<DueItem[]> {
  const client = await createAuthenticatedBrightspaceClient();
  const [rawCourses, settings] = await Promise.all([
    client.listCourses(),
    getCourseSettings(),
  ]);
  const courses = decorateCourses(rawCourses, settings);
  const courseMap = new Map(courses.map((course) => [course.id, course]));
  const events = await client.getMyDueDateEvents({
    orgUnitIds: courses.map((course) => course.id),
    startDateTime: relativeIsoDate(-LOOKBACK_DAYS),
    endDateTime: relativeIsoDate(LOOKAHEAD_DAYS),
  });
  const submissionStatuses = await loadSubmissionStatuses(
    client,
    events,
    courseMap,
  );
  const contentTitles = await loadContentTitles(client, events, courseMap);

  return events
    .flatMap((event) =>
      dueItem(event, courseMap, submissionStatuses, contentTitles),
    )
    .sort(compareDueItems);
}

function dueItem(
  event: CalendarEvent,
  courseMap: Map<number, DecoratedCourse>,
  submissionStatuses: Map<string, SubmissionStatus>,
  contentTitles: Map<string, string>,
): DueItem[] {
  const dueDate = event.StartDateTime ?? event.EndDateTime ?? event.StartDay;
  const course = event.OrgUnitId ? courseMap.get(event.OrgUnitId) : undefined;

  if (!dueDate || !course || event.IsHidden) {
    return [];
  }

  const contentObject = eventContentObject(event);
  const title =
    contentObjectTitle(contentObject) ??
    contentTitles.get(contentKey(course.id, event)) ??
    event.Title;

  return [
    {
      id: `calendar:${course.id}:${event.CalendarEventId ?? event.Id ?? event.Title}`,
      title,
      dueDate,
      course,
      event,
      contentObject,
      rawTitle: title !== event.Title ? event.Title : undefined,
      submission: submissionStatuses.get(submissionKey(course.id, event)),
    },
  ];
}

async function loadContentTitles(
  client: BrightspaceClient,
  events: CalendarEvent[],
  courseMap: Map<number, DecoratedCourse>,
): Promise<Map<string, string>> {
  const courseIds = [
    ...new Set(
      events
        .filter(isContentEvent)
        .map((event) => event.OrgUnitId)
        .filter((id): id is number => Boolean(id && courseMap.has(id))),
    ),
  ];
  const entries = await Promise.all(
    courseIds.map(async (courseId) => {
      try {
        const toc = await client.getContentToc(courseId);
        return contentTitleEntries(courseId, toc.Modules ?? []);
      } catch {
        return [];
      }
    }),
  );

  return new Map(entries.flat());
}

function contentTitleEntries(
  courseId: number,
  modules: ContentModule[],
): Array<readonly [string, string]> {
  return modules.flatMap((module) => [
    [contentKeyFromId(courseId, module.Id), module.Title] as const,
    ...(module.Topics ?? []).map(
      (topic) =>
        [
          contentKeyFromId(courseId, topicContentId(topic)),
          topic.Title,
        ] as const,
    ),
    ...contentTitleEntries(courseId, module.Modules ?? []),
  ]);
}

function dueAccessories(item: DueItem): List.Item.Accessory[] {
  const accessories: List.Item.Accessory[] = [
    { text: item.course.courseAcronym, tooltip: item.course.name },
    { text: formatDate(item.dueDate) ?? item.dueDate },
  ];

  if (item.submission?.isSubmitted) {
    accessories.push({
      tag: { value: "Submitted", color: Color.Green },
    });
  } else if (isOverdue(item)) {
    accessories.push({ tag: { value: "Overdue", color: Color.Red } });
  }

  if (item.submission?.submissionDate) {
    accessories.push({
      text: `Submitted ${formatDate(item.submission.submissionDate)}`,
    });
  }

  const entityType = item.event.AssociatedEntity?.AssociatedEntityType;
  if (item.contentObject) {
    accessories.push({
      tag: { value: "Content", color: Color.Blue },
    });
  } else if (entityType) {
    accessories.push({
      tag: { value: compactEntityType(entityType), color: Color.SecondaryText },
    });
  }

  return accessories;
}

function groupDueItems(items: DueItem[]): DueGroup[] {
  const groups = new Map<string, DueItem[]>();

  for (const item of items) {
    const title = dueGroupTitle(item);
    groups.set(title, [...(groups.get(title) ?? []), item]);
  }

  return DUE_GROUP_ORDER.flatMap((title) => {
    const groupItems = groups.get(title);
    return groupItems?.length ? [{ title, items: groupItems }] : [];
  });
}

function dueGroupTitle(item: DueItem): string {
  if (item.submission?.isSubmitted) {
    return "Submitted";
  }

  const days = daysUntil(item.dueDate);

  if (days < 0) {
    return "Overdue";
  }

  if (days === 0) {
    return "Today";
  }

  if (days === 1) {
    return "Tomorrow";
  }

  if (days <= 7) {
    return "This Week";
  }

  if (days <= 14) {
    return "Next Week";
  }

  return "Later";
}

function compareDueItems(a: DueItem, b: DueItem): number {
  return (
    Number(a.submission?.isSubmitted ?? false) -
      Number(b.submission?.isSubmitted ?? false) ||
    new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime() ||
    a.course.name.localeCompare(b.course.name) ||
    a.title.localeCompare(b.title)
  );
}

function isOverdue(item: DueItem): boolean {
  return new Date(item.dueDate).getTime() < Date.now();
}

async function loadSubmissionStatuses(
  client: BrightspaceClient,
  events: CalendarEvent[],
  courseMap: Map<number, DecoratedCourse>,
): Promise<Map<string, SubmissionStatus>> {
  const candidates = events.flatMap((event) => {
    const course = event.OrgUnitId ? courseMap.get(event.OrgUnitId) : undefined;
    const folderId = dropboxFolderId(event);
    return course && folderId ? [{ course, event, folderId }] : [];
  });
  const entries = await Promise.all(
    candidates.map(async ({ course, event, folderId }) => {
      try {
        const submissions = await client.getMyDropboxSubmissions(
          course.id,
          folderId,
        );
        return [
          submissionKey(course.id, event),
          submissionStatus(submissions),
        ] as const;
      } catch {
        return [submissionKey(course.id, event), undefined] as const;
      }
    }),
  );

  return new Map(
    entries.filter(
      (entry): entry is readonly [string, SubmissionStatus] =>
        entry[1] !== undefined,
    ),
  );
}

function dropboxFolderId(event: CalendarEvent): string | undefined {
  const entityType = event.AssociatedEntity?.AssociatedEntityType ?? "";
  const entityId = event.AssociatedEntity?.AssociatedEntityId;

  if (!entityId) {
    return undefined;
  }

  if (
    entityType &&
    !/\b(dropbox|assignment|folder)\b/i.test(String(entityType))
  ) {
    return undefined;
  }

  return String(entityId);
}

function submissionStatus(submissions: EntityDropbox[]): SubmissionStatus {
  const submissionDates = submissions
    .flatMap((entity) => entity.Submissions ?? [])
    .map((submission) => submission.SubmissionDate)
    .filter((date): date is string => Boolean(date))
    .sort()
    .reverse();
  const isSubmitted = submissions.some(
    (entity) =>
      String(entity.Status) === "1" ||
      Boolean(entity.CompletionDate) ||
      (entity.Submissions?.length ?? 0) > 0,
  );

  return {
    isSubmitted,
    submissionDate: submissionDates[0],
  };
}

function submissionKey(
  courseId: number | string,
  event: CalendarEvent,
): string {
  return `${courseId}:${event.CalendarEventId ?? event.Id ?? event.Title}`;
}

function eventContentObject(
  event: CalendarEvent,
): CalendarContentObject | undefined {
  return (
    event.topicCO ??
    event.TopicCO ??
    event.ContentObject ??
    associatedEntityContentObject(event) ??
    findNestedContentObject(event)
  );
}

function associatedEntityContentObject(
  event: CalendarEvent,
): CalendarContentObject | undefined {
  const entity = event.AssociatedEntity;
  if (!entity) {
    return undefined;
  }

  const entityType = entity.AssociatedEntityType ?? "";
  if (!/contentobject|topicco/i.test(entityType) && !isContentObject(entity)) {
    return undefined;
  }

  return {
    Id: entity.AssociatedEntityId,
    Title: entity.Title,
    Name: entity.Name,
    Type: entityType,
    Url: entity.Url,
    Href: entity.Href,
  };
}

function findNestedContentObject(
  value: unknown,
): CalendarContentObject | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  for (const [key, nested] of Object.entries(record)) {
    if (/topicco|contentobject/i.test(key) && isContentObject(nested)) {
      return nested;
    }
  }

  for (const nested of Object.values(record)) {
    if (nested && typeof nested === "object") {
      const match = findNestedContentObject(nested);
      if (match) {
        return match;
      }
    }
  }

  return undefined;
}

function isContentObject(value: unknown): value is CalendarContentObject {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as CalendarContentObject;
  return Boolean(record.Title || record.Name);
}

function contentObjectTitle(
  contentObject?: CalendarContentObject,
): string | undefined {
  return contentObject?.Title ?? contentObject?.Name;
}

function isContentEvent(event: CalendarEvent): boolean {
  const entityType = event.AssociatedEntity?.AssociatedEntityType ?? "";
  return Boolean(
    eventContentObject(event) ||
    /contentobject|topicco/i.test(entityType) ||
    event.AssociatedEntity?.AssociatedEntityId,
  );
}

function contentKey(courseId: number | string, event: CalendarEvent): string {
  return contentKeyFromId(
    courseId,
    eventContentObject(event)?.Id ??
      event.AssociatedEntity?.AssociatedEntityId ??
      event.CalendarEventId ??
      event.Id ??
      event.Title,
  );
}

function contentKeyFromId(
  courseId: number | string,
  id: number | string | undefined,
): string {
  return `${courseId}:${String(id ?? "")}`;
}

function topicContentId(topic: ContentTopic): number | string {
  return topic.ToolItemId ?? topic.ActivityId ?? topic.Id;
}

function compactEntityType(entityType: string): string {
  return (
    entityType
      .split(".")
      .filter(Boolean)
      .at(-1)
      ?.replace(/([a-z])([A-Z])/g, "$1 $2") ?? entityType
  );
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
