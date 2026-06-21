import { Action, ActionPanel, Color, Icon, List } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useMemo, useState } from "react";
import {
  formatDate,
  type BrightspaceClient,
  type Course,
  type DiscussionForum,
  type DiscussionPost,
  type DiscussionTopic,
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

interface DiscussionRecord {
  forum: DiscussionForum;
  topic: DiscussionTopic;
}

interface DiscussionData {
  client: BrightspaceClient;
  course: Course;
  records: DiscussionRecord[];
}

export default function Command() {
  return (
    <AuthenticatedCommand>
      <DiscussionsCommand />
    </AuthenticatedCommand>
  );
}

function DiscussionsCommand() {
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
    <DiscussionsView
      course={selectedCourse}
      courses={courses ?? []}
      selectedCourseId={selectedCourseId}
      onSelectedCourseIdChange={setSelectedCourseId}
      isLoadingCourses={isLoadingCourses}
      showCoursePicker
    />
  );
}

export function CourseDiscussions({ course }: { course: Course }) {
  return (
    <DiscussionsView course={course} selectedCourseId={String(course.id)} />
  );
}

function DiscussionsView({
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
      return loadDiscussions(client, course);
    },
    [selectedCourseId, course?.id],
    { execute: Boolean(selectedCourseId && course) },
  );
  const grouped = useMemo(() => groupByForum(data?.records ?? []), [data]);

  return (
    <List
      isLoading={isLoadingCourses || isLoading}
      isShowingDetail
      navigationTitle={course?.name ?? "Discussions"}
      searchBarPlaceholder="Search discussions"
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
          icon={Icon.SpeechBubble}
          title="No Discussions"
          description="No visible discussion topics were returned for this course."
        />
      ) : null}
      {grouped.map((group) => (
        <List.Section
          key={group.forum.ForumId}
          title={group.forum.Name}
          subtitle={
            group.records.length ? `${group.records.length} topics` : ""
          }
        >
          {group.records.map((record) => (
            <DiscussionTopicItem
              key={`${record.forum.ForumId}-${record.topic.TopicId}`}
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

function DiscussionTopicItem({
  course,
  client,
  record,
}: {
  course?: Course;
  client?: BrightspaceClient;
  record: DiscussionRecord;
}) {
  const topicUrl =
    course && client
      ? discussionTopicUrl(
          client,
          course.id,
          record.forum.ForumId,
          record.topic.TopicId,
        )
      : undefined;

  return (
    <List.Item
      icon={topicIcon(record.topic)}
      title={record.topic.Name}
      subtitle={record.forum.Name}
      accessories={topicAccessories(record)}
      detail={
        <DiscussionTopicDetail
          course={course}
          client={client}
          record={record}
        />
      }
      actions={
        <ActionPanel>
          {topicUrl ? (
            <Action.OpenInBrowser title="Open Topic" url={topicUrl} />
          ) : null}
          {course?.url ? (
            <Action.OpenInBrowser title="Open Course" url={course.url} />
          ) : null}
          <Action.CopyToClipboard
            title="Copy Topic ID"
            content={String(record.topic.TopicId)}
          />
          <Action.CopyToClipboard
            title="Copy Forum ID"
            content={String(record.forum.ForumId)}
          />
        </ActionPanel>
      }
    />
  );
}

function DiscussionTopicDetail({
  course,
  client,
  record,
}: {
  course?: Course;
  client?: BrightspaceClient;
  record: DiscussionRecord;
}) {
  const { data: posts, isLoading } = usePromise(
    async (
      courseId?: number,
      forumId?: number,
      topicId?: number,
    ): Promise<DiscussionPost[]> => {
      if (!client || !courseId || !forumId || !topicId) {
        return [];
      }

      return client
        .getDiscussionPosts(courseId, forumId, topicId, {
          pageSize: 50,
          pageNumber: 1,
          sort: "-creationdate",
        })
        .catch(() => []);
    },
    [course?.id, record.forum.ForumId, record.topic.TopicId],
    { execute: Boolean(client && course) },
  );

  return (
    <List.Item.Detail
      isLoading={isLoading}
      markdown={topicMarkdown(record, posts ?? [], course?.url)}
    />
  );
}

async function loadDiscussions(
  client: BrightspaceClient,
  course: Course,
): Promise<DiscussionData> {
  const forums = await client.getDiscussionForums(course.id).catch(() => []);
  const topicGroups = await Promise.all(
    forums
      .filter((forum) => !forum.IsHidden)
      .map(async (forum) => ({
        forum,
        topics: await client
          .getDiscussionTopics(course.id, forum.ForumId)
          .catch(() => []),
      })),
  );
  const records = topicGroups.flatMap(({ forum, topics }) =>
    topics
      .filter((topic) => !topic.IsHidden)
      .map((topic) => ({ forum, topic })),
  );

  return {
    client,
    course,
    records: records.sort(compareDiscussionRecords),
  };
}

function groupByForum(records: DiscussionRecord[]): Array<{
  forum: DiscussionForum;
  records: DiscussionRecord[];
}> {
  const groups = new Map<
    number,
    { forum: DiscussionForum; records: DiscussionRecord[] }
  >();

  for (const record of records) {
    const current = groups.get(record.forum.ForumId) ?? {
      forum: record.forum,
      records: [],
    };
    current.records.push(record);
    groups.set(record.forum.ForumId, current);
  }

  return [...groups.values()];
}

function topicAccessories(record: DiscussionRecord): List.Item.Accessory[] {
  const { topic } = record;
  const accessories: List.Item.Accessory[] = [];

  if (topic.DueDate) {
    accessories.push({
      tag: {
        value: `Due ${compactDate(topic.DueDate)}`,
        color: dueColor(topic.DueDate),
      },
    });
  }

  if (topic.MustPostToParticipate) {
    accessories.push({ tag: { value: "Post First", color: Color.Yellow } });
  }

  if (topic.ScoreOutOf) {
    accessories.push({
      tag: {
        value: `${formatNumber(topic.ScoreOutOf)} pts`,
        color: Color.Blue,
      },
    });
  }

  if (topic.PinnedPostCount) {
    accessories.push({
      tag: {
        value: `${topic.PinnedPostCount} pinned`,
        color: Color.SecondaryText,
      },
    });
  }

  if (topic.RatingsCount) {
    accessories.push({ text: `${topic.RatingsCount} ratings` });
  }

  return accessories;
}

function topicMarkdown(
  record: DiscussionRecord,
  posts: DiscussionPost[],
  courseUrl?: string,
): string {
  const { forum, topic } = record;
  const description = richTextMarkdown(topic.Description, courseUrl);
  const forumDescription =
    forum.ShowDescriptionInTopics && forum.Description
      ? richTextMarkdown(forum.Description, courseUrl)
      : "";
  const visiblePosts = posts.filter((post) => !post.IsDeleted);

  return [
    topicPills(record, visiblePosts),
    "",
    `## ${escapeMarkdown(topic.Name)}`,
    "",
    `Forum: ${escapeMarkdown(forum.Name)}`,
    topic.DueDate
      ? `Due: ${escapeMarkdown(formatDate(topic.DueDate) ?? topic.DueDate)}`
      : "",
    topic.StartDate
      ? `Starts: ${escapeMarkdown(formatDate(topic.StartDate) ?? topic.StartDate)}`
      : "",
    topic.EndDate
      ? `Ends: ${escapeMarkdown(formatDate(topic.EndDate) ?? topic.EndDate)}`
      : "",
    topic.ScoreOutOf ? `Score: ${formatNumber(topic.ScoreOutOf)} pts` : "",
    forumDescription ? `### Forum Description\n\n${forumDescription}` : "",
    description ? `### Topic Description\n\n${description}` : "",
    visiblePosts.length
      ? postsMarkdown(visiblePosts, courseUrl)
      : "### Posts\n\nNo posts returned by Brightspace.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function topicPills(record: DiscussionRecord, posts: DiscussionPost[]): string {
  const unreadCount = posts.filter((post) => post.IsRead === false).length;

  return [
    unreadCount ? `${unreadCount} unread` : "",
    record.topic.MustPostToParticipate ? "Must post first" : "",
    record.topic.RequiresApproval ? "Approval required" : "",
    record.topic.AllowAnonymousPosts ? "Anonymous allowed" : "",
  ]
    .filter(Boolean)
    .map((value) => `\`${escapeMarkdown(value)}\``)
    .join(" ");
}

function postsMarkdown(posts: DiscussionPost[], courseUrl?: string): string {
  return [
    "### Recent Posts",
    "",
    ...posts.slice(0, 25).map((post) => postMarkdown(post, courseUrl)),
  ].join("\n\n");
}

function postMarkdown(post: DiscussionPost, courseUrl?: string): string {
  const author = post.PostingUserDisplayName || "Unknown author";
  const posted = post.DatePosted ? formatDate(post.DatePosted) : undefined;
  const message =
    richTextMarkdown(post.Message, courseUrl) || "_No message body._";
  const replyPrefix = post.ParentPostId ? "Reply" : "Thread";

  return [
    `#### ${escapeMarkdown(post.Subject || replyPrefix)}`,
    "",
    [replyPrefix, author, posted]
      .filter(Boolean)
      .map(escapeMarkdown)
      .join(" · "),
    "",
    message,
    post.AttachmentCount ? `Attachments: ${post.AttachmentCount}` : "",
    post.IsRead === false ? "`Unread`" : "",
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

function discussionTopicUrl(
  client: BrightspaceClient,
  courseId: number | string,
  forumId: number | string,
  topicId: number | string,
): string {
  return client.resolveUrl(
    `/d2l/le/${courseId}/discussions/topics/${topicId}/View?forumId=${forumId}`,
  );
}

function topicIcon(topic: DiscussionTopic): Icon {
  if (topic.MustPostToParticipate) {
    return Icon.Lock;
  }

  if (topic.DueDate) {
    return Icon.Calendar;
  }

  return Icon.SpeechBubble;
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

function compareDiscussionRecords(
  a: DiscussionRecord,
  b: DiscussionRecord,
): number {
  return (
    compareDates(a.topic.DueDate, b.topic.DueDate) ||
    a.forum.Name.localeCompare(b.forum.Name) ||
    a.topic.Name.localeCompare(b.topic.Name)
  );
}

function compareDates(a?: string | null, b?: string | null): number {
  const aTime = a ? new Date(a).getTime() : Number.POSITIVE_INFINITY;
  const bTime = b ? new Date(b).getTime() : Number.POSITIVE_INFINITY;
  return aTime - bTime;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
