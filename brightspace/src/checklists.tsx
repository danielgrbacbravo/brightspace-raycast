import { Action, ActionPanel, Color, Icon, List } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useMemo, useState } from "react";
import {
  formatDate,
  type BrightspaceClient,
  type Checklist,
  type ChecklistCategory,
  type ChecklistItem,
  type Course,
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
import { AuthenticatedCommand } from "./lib/rug-login-view";

interface ChecklistRecord {
  checklist: Checklist;
  category?: ChecklistCategory;
  item?: ChecklistItem;
}

interface ChecklistData {
  client: BrightspaceClient;
  course: Course;
  records: ChecklistRecord[];
}

export default function Command() {
  return (
    <AuthenticatedCommand>
      <ChecklistsCommand />
    </AuthenticatedCommand>
  );
}

function ChecklistsCommand() {
  const [selectedCourseId, setSelectedCourseId] = useState<string>();

  const { data: courses, isLoading: isLoadingCourses } = usePromise(
    async () => {
      const client = await createAuthenticatedBrightspaceClient();
      const [rawCourses, settings] = await Promise.all([
        client.listCourses(),
        getCourseSettings(),
      ]);
      return decorateCourses(rawCourses, settings);
    },
    [],
    {
      onData: (data) =>
        setSelectedCourseId((current) => current ?? String(data[0]?.id ?? "")),
    },
  );
  const selectedCourse = courses?.find(
    (course) => String(course.id) === selectedCourseId,
  );

  return (
    <ChecklistsView
      course={selectedCourse}
      courses={courses ?? []}
      selectedCourseId={selectedCourseId}
      onSelectedCourseIdChange={setSelectedCourseId}
      isLoadingCourses={isLoadingCourses}
      showCoursePicker
    />
  );
}

export function CourseChecklists({ course }: { course: Course }) {
  return (
    <ChecklistsView course={course} selectedCourseId={String(course.id)} />
  );
}

function ChecklistsView({
  course,
  courses = [],
  selectedCourseId,
  onSelectedCourseIdChange,
  isLoadingCourses = false,
  showCoursePicker = false,
}: {
  course?: Course;
  courses?: DecoratedCourse[];
  selectedCourseId?: string;
  onSelectedCourseIdChange?: (value: string) => void;
  isLoadingCourses?: boolean;
  showCoursePicker?: boolean;
}) {
  const { data, isLoading } = usePromise(
    async (courseId?: string) => {
      if (!courseId || !course) {
        return undefined;
      }

      const client = await createAuthenticatedBrightspaceClient();
      return loadChecklists(client, course);
    },
    [selectedCourseId, course?.id],
    { execute: Boolean(selectedCourseId && course) },
  );
  const grouped = useMemo(() => groupByChecklist(data?.records ?? []), [data]);

  return (
    <List
      isLoading={isLoadingCourses || isLoading}
      isShowingDetail
      navigationTitle={course?.name ?? "Checklists"}
      searchBarPlaceholder="Search checklists"
      searchBarAccessory={
        showCoursePicker && onSelectedCourseIdChange ? (
          <List.Dropdown
            tooltip="Course"
            value={selectedCourseId}
            onChange={onSelectedCourseIdChange}
          >
            {courses.map((item) => (
              <List.Dropdown.Item
                key={item.id}
                title={item.name}
                value={String(item.id)}
              />
            ))}
          </List.Dropdown>
        ) : undefined
      }
    >
      {!isLoadingCourses && !isLoading && grouped.length === 0 ? (
        <List.EmptyView
          icon={Icon.CheckList}
          title="No Checklists"
          description="No visible checklists were returned for this course."
        />
      ) : null}
      {grouped.map((group) => (
        <List.Section
          key={group.checklist.Id}
          title={group.checklist.Name}
          subtitle={group.records.length ? `${group.records.length} items` : ""}
        >
          {group.records.map((record) => (
            <ChecklistListItem
              key={
                record.item
                  ? itemKey(record)
                  : `checklist-${record.checklist.Id}`
              }
              course={data?.course}
              client={data?.client}
              record={record}
            />
          ))}
        </List.Section>
      ))}
    </List>
  );
}

function ChecklistListItem({
  course,
  client,
  record,
}: {
  course?: Course;
  client?: BrightspaceClient;
  record: ChecklistRecord;
}) {
  const checklistUrl =
    course && client
      ? client.resolveUrl(`/d2l/le/checklist/${course.id}/Home`)
      : undefined;

  return (
    <List.Item
      icon={record.item ? Icon.Circle : Icon.CheckList}
      title={record.item?.Name ?? record.checklist.Name}
      subtitle={record.category?.Name}
      accessories={record.item ? itemAccessories(record.item) : []}
      detail={
        <List.Item.Detail markdown={recordMarkdown(record, course?.url)} />
      }
      actions={
        <ActionPanel>
          {checklistUrl ? (
            <Action.OpenInBrowser title="Open Checklists" url={checklistUrl} />
          ) : null}
          {course?.url ? (
            <Action.OpenInBrowser title="Open Course" url={course.url} />
          ) : null}
          <Action.CopyToClipboard
            title="Copy Checklist ID"
            content={String(record.checklist.Id)}
          />
          {record.item ? (
            <Action.CopyToClipboard
              title="Copy Checklist Item ID"
              content={String(record.item.ChecklistItemId)}
            />
          ) : null}
        </ActionPanel>
      }
    />
  );
}

async function loadChecklists(
  client: BrightspaceClient,
  course: Course,
): Promise<ChecklistData> {
  const checklists = await client.getChecklists(course.id).catch(() => []);
  const groups = await Promise.all(
    checklists.map(async (checklist) => {
      const [categories, items] = await Promise.all([
        client.getChecklistCategories(course.id, checklist.Id).catch(() => []),
        client.getChecklistItems(course.id, checklist.Id).catch(() => []),
      ]);
      return { checklist, categories, items };
    }),
  );
  const records = groups.flatMap(({ checklist, categories, items }) => {
    if (items.length === 0) {
      return [{ checklist }];
    }

    const categoriesById = new Map(
      categories.map((category) => [category.CategoryId, category]),
    );
    return items.map((item) => ({
      checklist,
      category: categoriesById.get(item.CategoryId),
      item,
    }));
  });

  return {
    client,
    course,
    records: records.sort(compareChecklistRecords),
  };
}

function groupByChecklist(records: ChecklistRecord[]): Array<{
  checklist: Checklist;
  records: ChecklistRecord[];
}> {
  const groups = new Map<
    number,
    { checklist: Checklist; records: ChecklistRecord[] }
  >();

  for (const record of records) {
    const current = groups.get(record.checklist.Id) ?? {
      checklist: record.checklist,
      records: [],
    };
    current.records.push(record);
    groups.set(record.checklist.Id, current);
  }

  return [...groups.values()];
}

function itemAccessories(item: ChecklistItem): List.Item.Accessory[] {
  const accessories: List.Item.Accessory[] = [];

  if (item.DueDate) {
    accessories.push({
      tag: {
        value: dueLabel(item.DueDate),
        color: dueColor(item.DueDate),
      },
    });
  }

  return accessories;
}

function recordMarkdown(record: ChecklistRecord, courseUrl?: string): string {
  const checklistDescription = richTextMarkdown(
    record.checklist.Description,
    courseUrl,
  );
  const categoryDescription = richTextMarkdown(
    record.category?.Description,
    courseUrl,
  );
  const itemDescription = richTextMarkdown(record.item?.Description, courseUrl);

  return [
    record.item?.DueDate
      ? `\`${escapeMarkdown(dueLabel(record.item.DueDate))}\``
      : "",
    "",
    `## ${escapeMarkdown(record.item?.Name ?? record.checklist.Name)}`,
    "",
    `Checklist: ${escapeMarkdown(record.checklist.Name)}`,
    record.category ? `Category: ${escapeMarkdown(record.category.Name)}` : "",
    record.item?.DueDate
      ? `Due: ${escapeMarkdown(formatDate(record.item.DueDate) ?? record.item.DueDate)}`
      : "",
    itemDescription ? `### Item Description\n\n${itemDescription}` : "",
    categoryDescription
      ? `### Category Description\n\n${categoryDescription}`
      : "",
    checklistDescription
      ? `### Checklist Description\n\n${checklistDescription}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
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

function dueLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  if (date.getTime() < Date.now()) {
    return "Overdue";
  }

  const today = startOfDay(new Date());
  const dueDay = startOfDay(date);
  const days = Math.floor((dueDay.getTime() - today.getTime()) / 86400000);

  if (days === 0) {
    return "Today";
  }

  if (days === 1) {
    return "Tomorrow";
  }

  return compactDate(value);
}

function dueColor(value: string): Color {
  const time = new Date(value).getTime();
  if (time < Date.now()) {
    return Color.Red;
  }

  if (time - Date.now() <= 7 * 24 * 60 * 60 * 1000) {
    return Color.Yellow;
  }

  return Color.Blue;
}

function compactDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date);
}

function compareChecklistRecords(
  a: ChecklistRecord,
  b: ChecklistRecord,
): number {
  return (
    a.checklist.Name.localeCompare(b.checklist.Name) ||
    compareCategory(a.category, b.category) ||
    compareDates(a.item?.DueDate, b.item?.DueDate) ||
    (a.item?.SortOrder ?? 0) - (b.item?.SortOrder ?? 0) ||
    (a.item?.Name ?? "").localeCompare(b.item?.Name ?? "")
  );
}

function compareCategory(a?: ChecklistCategory, b?: ChecklistCategory): number {
  return (
    (a?.SortOrder ?? Number.POSITIVE_INFINITY) -
      (b?.SortOrder ?? Number.POSITIVE_INFINITY) ||
    (a?.Name ?? "").localeCompare(b?.Name ?? "")
  );
}

function compareDates(a?: string | null, b?: string | null): number {
  const aTime = a ? new Date(a).getTime() : Number.POSITIVE_INFINITY;
  const bTime = b ? new Date(b).getTime() : Number.POSITIVE_INFINITY;
  return aTime - bTime;
}

function itemKey(record: ChecklistRecord): string {
  return `${record.checklist.Id}-${record.category?.CategoryId ?? "none"}-${record.item?.ChecklistItemId}`;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
