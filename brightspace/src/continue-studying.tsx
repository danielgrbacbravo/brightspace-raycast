import { Action, ActionPanel, Color, Icon, List } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import {
  formatDate,
  type BrightspaceClient,
  type ContentTopic,
} from "./lib/brightspace";
import { createAuthenticatedBrightspaceClient } from "./lib/client-factory";
import {
  decorateCourses,
  getCourseSettings,
  type DecoratedCourse,
} from "./lib/course-settings";
import { escapeMarkdown } from "./lib/markdown";
import { AuthenticatedCommand } from "./lib/rug-login-view";

const MAX_COURSES = 8;
const MAX_TOPICS_PER_COURSE = 8;

interface ContinueTopic {
  course: DecoratedCourse;
  topic: ContentTopic;
}

export default function Command() {
  return (
    <AuthenticatedCommand>
      <ContinueStudyingCommand />
    </AuthenticatedCommand>
  );
}

function ContinueStudyingCommand() {
  const { data, isLoading } = usePromise(loadContinueTopics);

  return (
    <List
      isLoading={isLoading}
      isShowingDetail
      searchBarPlaceholder="Search recent content"
    >
      {!isLoading && (data?.length ?? 0) === 0 ? (
        <List.EmptyView
          icon={Icon.Book}
          title="No Recent Content"
          description="No recently visited topics were returned by Brightspace."
        />
      ) : null}
      {data?.map((item) => (
        <List.Item
          key={`${item.course.id}-${item.topic.Id}`}
          icon={Icon.Book}
          title={item.topic.Title}
          subtitle={item.course.courseAcronym}
          accessories={topicAccessories(item)}
          detail={<List.Item.Detail markdown={topicMarkdown(item)} />}
          actions={
            <ActionPanel>
              {item.topic.Url ? (
                <Action.OpenInBrowser title="Open Topic" url={item.topic.Url} />
              ) : null}
              {item.course.url ? (
                <Action.OpenInBrowser
                  title="Open Course"
                  url={item.course.url}
                />
              ) : null}
              <Action.CopyToClipboard
                title="Copy Topic ID"
                content={String(item.topic.Id)}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}

async function loadContinueTopics(): Promise<ContinueTopic[]> {
  const client = await createAuthenticatedBrightspaceClient();
  const [rawCourses, settings] = await Promise.all([
    client.listCourses(),
    getCourseSettings(),
  ]);
  const courses = decorateCourses(rawCourses, settings).sort(compareCourses);
  const focusCourses = courses.filter((course) => course.isPinned).length
    ? courses.filter((course) => course.isPinned)
    : courses.slice(0, MAX_COURSES);
  const entries = await Promise.all(
    focusCourses.map(async (course) => {
      const topics = await client.getRecentContent(course.id).catch(() => []);
      return topics.slice(0, MAX_TOPICS_PER_COURSE).map((topic) => ({
        course,
        topic: normalizeTopicUrl(client, topic),
      }));
    }),
  );

  return entries.flat().sort(compareContinueTopics);
}

function normalizeTopicUrl(
  client: BrightspaceClient,
  topic: ContentTopic,
): ContentTopic {
  return topic.Url ? { ...topic, Url: client.resolveUrl(topic.Url) } : topic;
}

function topicAccessories(item: ContinueTopic): List.Item.Accessory[] {
  const accessories: List.Item.Accessory[] = [
    { text: item.course.courseAcronym, tooltip: item.course.name },
  ];

  if (item.topic.LastVisited ?? item.topic.LastAccessed) {
    accessories.push({
      text: formatDate(item.topic.LastVisited ?? item.topic.LastAccessed),
    });
  }

  if (item.topic.DateCompleted || item.topic.IsCompleted) {
    accessories.push({ tag: { value: "Completed", color: Color.Green } });
  } else if (isIncompleteTopic(item.topic)) {
    accessories.push({ tag: { value: "Incomplete", color: Color.Yellow } });
  }

  return accessories;
}

function topicMarkdown(item: ContinueTopic): string {
  return [
    `## ${escapeMarkdown(item.topic.Title)}`,
    "",
    `Course: ${escapeMarkdown(item.course.name)}`,
    item.topic.LastVisited
      ? `Last visited: ${escapeMarkdown(formatDate(item.topic.LastVisited) ?? item.topic.LastVisited)}`
      : "",
    item.topic.LastAccessed
      ? `Last accessed: ${escapeMarkdown(formatDate(item.topic.LastAccessed) ?? item.topic.LastAccessed)}`
      : "",
    item.topic.DueDate
      ? `Due: ${escapeMarkdown(formatDate(item.topic.DueDate) ?? item.topic.DueDate)}`
      : "",
    item.topic.DateCompleted
      ? `Completed: ${escapeMarkdown(formatDate(item.topic.DateCompleted) ?? item.topic.DateCompleted)}`
      : "",
    item.topic.Url ? `[Open topic](${item.topic.Url})` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function compareContinueTopics(a: ContinueTopic, b: ContinueTopic): number {
  return (
    dateTime(b.topic.LastVisited ?? b.topic.LastAccessed) -
      dateTime(a.topic.LastVisited ?? a.topic.LastAccessed) ||
    a.course.name.localeCompare(b.course.name) ||
    a.topic.Title.localeCompare(b.topic.Title)
  );
}

function compareCourses(a: DecoratedCourse, b: DecoratedCourse): number {
  return (
    Number(b.isPinned) - Number(a.isPinned) ||
    dateTime(b.lastAccessed) - dateTime(a.lastAccessed) ||
    a.name.localeCompare(b.name)
  );
}

function isIncompleteTopic(topic: ContentTopic): boolean {
  if (topic.IsExempt) {
    return false;
  }

  if (topic.IsCompleted === false) {
    return true;
  }

  return Boolean(
    typeof topic.CompletionType !== "undefined" &&
    topic.CompletionType !== null &&
    !topic.DateCompleted &&
    !topic.IsCompleted,
  );
}

function dateTime(value?: string | null): number {
  return value ? new Date(value).getTime() : 0;
}
