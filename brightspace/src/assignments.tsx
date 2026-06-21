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
import { readFile } from "fs/promises";
import { basename } from "path";
import { useState } from "react";
import {
  formatDate,
  formatGrade,
  type DropboxFolder,
  type EntityDropbox,
  type GradeValue,
  type RichText,
} from "./lib/brightspace";
import { createAuthenticatedBrightspaceClient } from "./lib/client-factory";
import {
  descriptionText,
  escapeMarkdown,
  htmlToMarkdown,
  stripHtml,
} from "./lib/markdown";
import { AuthenticatedCommand } from "./lib/rug-login-view";

interface AssignmentRecord {
  folder: DropboxFolder;
  entities: EntityDropbox[];
  grade?: GradeValue;
  renderedFeedback?: RenderedFeedback;
}

interface RenderedFeedback {
  markdown: string;
  url: string;
}

export default function Command() {
  return (
    <AuthenticatedCommand>
      <AssignmentsCommand />
    </AuthenticatedCommand>
  );
}

function AssignmentsCommand() {
  const [selectedCourseId, setSelectedCourseId] = useState<string>();

  const { data: courses, isLoading: isLoadingCourses } = usePromise(
    async () => {
      const client = await createAuthenticatedBrightspaceClient();
      return client.listCourses();
    },
    [],
    {
      onData: (data) =>
        setSelectedCourseId((current) => current ?? String(data[0]?.id ?? "")),
    },
  );

  const {
    data: assignments,
    isLoading: isLoadingAssignments,
    revalidate,
  } = usePromise(
    async (courseId?: string) => {
      if (!courseId) {
        return [];
      }

      const client = await createAuthenticatedBrightspaceClient();
      const [folders, grades] = await Promise.all([
        client.getDropboxFolders(courseId),
        client.getMyGradeValues(courseId).catch(() => []),
      ]);
      const gradeById = new Map(
        grades.map((grade) => [String(grade.GradeObjectIdentifier), grade]),
      );
      const records = await Promise.all(
        folders
          .filter((folder) => !folder.IsDeleted)
          .map(async (folder): Promise<AssignmentRecord> => {
            const entities = await client
              .getMyDropboxSubmissions(courseId, folder.Id)
              .catch(() => []);
            const apiFeedback = entities.find(
              (entity) => entity.Feedback,
            )?.Feedback;
            const grade = folder.GradeItemId
              ? gradeById.get(String(folder.GradeItemId))
              : undefined;
            const hasSubmission = entities.some(
              (entity) => (entity.Submissions?.length ?? 0) > 0,
            );
            const renderedFeedback =
              apiFeedback || (!grade && !hasSubmission)
                ? undefined
                : await loadRenderedFeedback(client, courseId, folder.Id);

            return {
              folder,
              entities,
              grade,
              renderedFeedback,
            };
          }),
      );

      return records.sort(compareAssignments);
    },
    [selectedCourseId],
    { execute: Boolean(selectedCourseId) },
  );

  return (
    <List
      isLoading={isLoadingCourses || isLoadingAssignments}
      isShowingDetail
      searchBarPlaceholder="Search assignments"
      searchBarAccessory={
        <List.Dropdown
          tooltip="Course"
          value={selectedCourseId}
          onChange={setSelectedCourseId}
        >
          {courses?.map((course) => (
            <List.Dropdown.Item
              key={course.id}
              title={course.name}
              value={String(course.id)}
            />
          ))}
        </List.Dropdown>
      }
    >
      {assignments?.map((record) => (
        <AssignmentItem
          key={record.folder.Id}
          record={record}
          courseId={selectedCourseId}
          courseUrl={
            courses?.find((course) => String(course.id) === selectedCourseId)
              ?.url
          }
          onUploaded={revalidate}
        />
      ))}
    </List>
  );
}

function AssignmentItem({
  record,
  courseId,
  courseUrl,
  onUploaded,
}: {
  record: AssignmentRecord;
  courseId?: string;
  courseUrl?: string;
  onUploaded: () => void;
}) {
  const { folder } = record;
  const feedback = assignmentFeedback(record);
  const copyFeedback = feedback
    ? richTextPlain(feedback.Feedback)
    : record.renderedFeedback?.markdown;

  return (
    <List.Item
      icon={assignmentIcon(record)}
      title={folder.Name}
      subtitle={assignmentSubtitle(folder)}
      accessories={assignmentAccessories(record)}
      detail={
        <List.Item.Detail markdown={assignmentMarkdown(record, courseUrl)} />
      }
      actions={
        <ActionPanel>
          {courseUrl ? (
            <Action.OpenInBrowser title="Open Course" url={courseUrl} />
          ) : null}
          {courseId && canSubmit(record) ? (
            <Action.Push
              title="Upload Submission"
              icon={Icon.Upload}
              target={
                <SubmissionForm
                  courseId={courseId}
                  folder={folder}
                  onUploaded={onUploaded}
                />
              }
            />
          ) : null}
          {copyFeedback ? (
            <Action.CopyToClipboard
              title="Copy Feedback"
              content={copyFeedback}
            />
          ) : null}
          {record.renderedFeedback ? (
            <Action.OpenInBrowser
              title="Open Feedback Page"
              url={record.renderedFeedback.url}
            />
          ) : null}
          {feedback?.Links?.map((link) =>
            link.Href ? (
              <Action.OpenInBrowser
                key={link.LinkId}
                title={`Open ${link.LinkName}`}
                url={link.Href}
              />
            ) : null,
          )}
          <Action.CopyToClipboard
            title="Copy Assignment ID"
            content={String(folder.Id)}
          />
        </ActionPanel>
      }
    />
  );
}

function assignmentIcon(record: AssignmentRecord): Icon {
  if (record.folder.IsHidden) {
    return Icon.EyeDisabled;
  }

  if (hasFeedback(record)) {
    return Icon.CheckCircle;
  }

  if (hasGrade(record)) {
    return Icon.BarChart;
  }

  if (isSubmitted(record)) {
    return Icon.Upload;
  }

  return Icon.Pencil;
}

function assignmentSubtitle(folder: DropboxFolder): string | undefined {
  const dueDate = formatDate(folder.DueDate);
  if (dueDate) {
    return `Due ${dueDate}`;
  }

  const endDate = formatDate(folder.Availability?.EndDate ?? folder.EndDate);
  return endDate ? `Closes ${endDate}` : undefined;
}

function assignmentAccessories(
  record: AssignmentRecord,
): List.Item.Accessory[] {
  const feedback = assignmentFeedback(record);
  const accessories: List.Item.Accessory[] = [];

  accessories.push(statusAccessory(record));

  if (hasFeedback(record)) {
    accessories.push({
      tag: { value: "Feedback", color: Color.Green },
    });
  }

  if (record.grade) {
    accessories.push({
      tag: { value: formatGrade(record.grade), color: Color.Blue },
    });
  } else if (typeof feedback?.Score === "number") {
    accessories.push({
      tag: { value: `${formatNumber(feedback.Score)} pts`, color: Color.Blue },
    });
  }

  if (record.folder.IsHidden) {
    accessories.push({ tag: { value: "Hidden", color: Color.Yellow } });
  }

  return accessories;
}

function statusAccessory(record: AssignmentRecord): List.Item.Accessory {
  const status = assignmentStatus(record);

  if (status === "Graded") {
    return { tag: { value: status, color: Color.Green } };
  }

  if (status === "Submitted") {
    return { tag: { value: status, color: Color.Blue } };
  }

  if (status === "Overdue") {
    return { tag: { value: status, color: Color.Red } };
  }

  if (status === "Closed") {
    return { tag: { value: status, color: Color.SecondaryText } };
  }

  return { tag: { value: status, color: Color.Yellow } };
}

function assignmentStatus(record: AssignmentRecord): string {
  if (hasFeedback(record) || hasGrade(record)) {
    return "Graded";
  }

  if (isSubmitted(record)) {
    return "Submitted";
  }

  const now = Date.now();
  const closeDate =
    record.folder.Availability?.EndDate ?? record.folder.EndDate;
  if (closeDate && new Date(closeDate).getTime() < now) {
    return "Closed";
  }

  if (
    record.folder.DueDate &&
    new Date(record.folder.DueDate).getTime() < now
  ) {
    return "Overdue";
  }

  return "Not Submitted";
}

function assignmentMarkdown(
  record: AssignmentRecord,
  courseUrl?: string,
): string {
  const { folder } = record;
  const feedback = assignmentFeedback(record);
  const submissions = assignmentSubmissions(record);
  const instructions = richTextMarkdown(folder.CustomInstructions, courseUrl);
  const feedbackText = richTextMarkdown(feedback?.Feedback, courseUrl);

  return [
    assignmentPills(record),
    "",
    `## ${escapeMarkdown(folder.Name)}`,
    "",
    assignmentDatesMarkdown(folder),
    gradeMarkdown(record),
    instructions ? `### Instructions\n\n${instructions}` : "",
    submissions.length
      ? submissionsMarkdown(submissions, courseUrl)
      : "### Submission\n\nNo submission found.",
    feedback
      ? feedbackMarkdown(feedback, folder, feedbackText)
      : renderedFeedbackMarkdown(record) || missingFeedbackMarkdown(record),
    attachmentsMarkdown("Assignment Files", folder.Attachments),
  ]
    .filter(Boolean)
    .join("\n\n");
}

function assignmentPills(record: AssignmentRecord): string {
  return [
    assignmentStatus(record),
    record.folder.SubmissionType
      ? submissionTypeLabel(record.folder.SubmissionType)
      : "",
    record.folder.DropboxType
      ? dropboxTypeLabel(record.folder.DropboxType)
      : "",
  ]
    .filter(Boolean)
    .map((value) => `\`${escapeMarkdown(value)}\``)
    .join(" ");
}

function assignmentDatesMarkdown(folder: DropboxFolder): string {
  return [
    folder.DueDate
      ? `Due: ${escapeMarkdown(formatDate(folder.DueDate) ?? folder.DueDate)}`
      : "",
    folder.Availability?.StartDate
      ? `Opens: ${escapeMarkdown(formatDate(folder.Availability.StartDate) ?? folder.Availability.StartDate)}`
      : "",
    folder.Availability?.EndDate
      ? `Closes: ${escapeMarkdown(formatDate(folder.Availability.EndDate) ?? folder.Availability.EndDate)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function gradeMarkdown(record: AssignmentRecord): string {
  const feedback = assignmentFeedback(record);
  const score =
    typeof feedback?.Score === "number" ? formatNumber(feedback.Score) : "";
  const denominator = record.folder.Assessment?.ScoreDenominator;

  return [
    record.grade ? `Grade: ${escapeMarkdown(formatGrade(record.grade))}` : "",
    score
      ? `Feedback score: ${escapeMarkdown(denominator ? `${score} / ${formatNumber(denominator)}` : score)}`
      : "",
    feedback?.GradedSymbol
      ? `Symbol: ${escapeMarkdown(feedback.GradedSymbol)}`
      : "",
    record.folder.GradeItemId ? `Grade item: ${record.folder.GradeItemId}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function submissionsMarkdown(
  submissions: EntityDropbox[],
  courseUrl?: string,
): string {
  return [
    "### Submission",
    "",
    ...submissions.flatMap((entity) =>
      (entity.Submissions ?? []).flatMap((submission) => [
        `- Submitted ${escapeMarkdown(formatDate(submission.SubmissionDate) ?? submission.SubmissionDate ?? "without date")}${
          submission.SubmittedBy?.DisplayName
            ? ` by ${escapeMarkdown(submission.SubmittedBy.DisplayName)}`
            : ""
        }`,
        richTextMarkdown(submission.Comment, courseUrl),
        attachmentsMarkdown("Submitted Files", submission.Files),
      ]),
    ),
  ]
    .filter(Boolean)
    .join("\n\n");
}

function feedbackMarkdown(
  feedback: NonNullable<EntityDropbox["Feedback"]>,
  folder: DropboxFolder,
  feedbackText: string,
): string {
  const denominator = folder.Assessment?.ScoreDenominator;

  return [
    "### Feedback",
    "",
    typeof feedback.Score === "number"
      ? `Score: ${escapeMarkdown(denominator ? `${formatNumber(feedback.Score)} / ${formatNumber(denominator)}` : formatNumber(feedback.Score))}`
      : "",
    feedback.GradedSymbol
      ? `Symbol: ${escapeMarkdown(feedback.GradedSymbol)}`
      : "",
    feedbackText || "_No feedback text returned._",
    attachmentsMarkdown("Returned Files", feedback.Files),
    feedback.Links?.length ? linksMarkdown(feedback.Links) : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function attachmentsMarkdown(
  title: string,
  files?: Array<{ FileName: string; Size?: number; FileSize?: number }>,
): string {
  if (!files?.length) {
    return "";
  }

  return [
    `### ${title}`,
    "",
    ...files.map(
      (file) => `- ${escapeMarkdown(file.FileName)}${fileSize(file)}`,
    ),
  ].join("\n");
}

function linksMarkdown(
  links: Array<{ LinkName: string; Href?: string | null }>,
): string {
  return [
    "### Feedback Links",
    "",
    ...links.map((link) =>
      link.Href
        ? `- [${escapeMarkdown(link.LinkName)}](${link.Href})`
        : `- ${escapeMarkdown(link.LinkName)}`,
    ),
  ].join("\n");
}

function assignmentFeedback(
  record: AssignmentRecord,
): EntityDropbox["Feedback"] | undefined {
  return (
    record.entities.find((entity) => entity.Feedback)?.Feedback ?? undefined
  );
}

function hasFeedback(record: AssignmentRecord): boolean {
  return Boolean(
    assignmentFeedback(record)?.IsGraded ||
    richTextPlain(assignmentFeedback(record)?.Feedback).trim() ||
    record.renderedFeedback?.markdown.trim(),
  );
}

function hasGrade(record: AssignmentRecord): boolean {
  return Boolean(
    record.grade?.DisplayedGrade ||
    typeof record.grade?.PointsNumerator === "number" ||
    typeof record.grade?.WeightedNumerator === "number",
  );
}

function missingFeedbackMarkdown(record: AssignmentRecord): string {
  if (hasGrade(record)) {
    return "### Feedback\n\nA grade is visible, but Brightspace did not return separate published Dropbox feedback for this assignment and the rendered feedback page could not be parsed.";
  }

  return "### Feedback\n\nNo published Dropbox feedback returned by Brightspace.";
}

function renderedFeedbackMarkdown(record: AssignmentRecord): string {
  if (!record.renderedFeedback?.markdown) {
    return "";
  }

  return [
    "### Feedback",
    "",
    record.renderedFeedback.markdown,
    "",
    `[Open feedback page](${record.renderedFeedback.url})`,
  ].join("\n");
}

function assignmentSubmissions(record: AssignmentRecord): EntityDropbox[] {
  return record.entities.filter(
    (entity) => (entity.Submissions?.length ?? 0) > 0,
  );
}

function isSubmitted(record: AssignmentRecord): boolean {
  return record.entities.some(
    (entity) =>
      String(entity.Status) === "1" ||
      String(entity.Status) === "3" ||
      Boolean(entity.CompletionDate) ||
      (entity.Submissions?.length ?? 0) > 0,
  );
}

function canSubmit(record: AssignmentRecord): boolean {
  if (record.folder.IsHidden || assignmentStatus(record) === "Graded") {
    return false;
  }

  const closeDate =
    record.folder.Availability?.EndDate ?? record.folder.EndDate;
  return !closeDate || new Date(closeDate).getTime() >= Date.now();
}

function SubmissionForm({
  courseId,
  folder,
  onUploaded,
}: {
  courseId: string;
  folder: DropboxFolder;
  onUploaded: () => void;
}) {
  const { pop } = useNavigation();

  return (
    <Form
      navigationTitle="Upload Submission"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Upload Submission"
            onSubmit={async (values: {
              files?: string[];
              description?: string;
            }) => {
              const filePath = values.files?.[0];
              if (!filePath) {
                await showToast({
                  style: Toast.Style.Failure,
                  title: "Select a file",
                });
                return;
              }

              const toast = await showToast({
                style: Toast.Style.Animated,
                title: "Uploading submission",
                message: folder.Name,
              });

              try {
                const client = await createAuthenticatedBrightspaceClient();
                await client.submitMyDropboxFile(courseId, folder.Id, {
                  fileName: basename(filePath),
                  fileBytes: await readFile(filePath),
                  description: values.description,
                });
                toast.style = Toast.Style.Success;
                toast.title = "Submission uploaded";
                toast.message = folder.Name;
                onUploaded();
                pop();
              } catch (error) {
                toast.style = Toast.Style.Failure;
                toast.title = "Upload failed";
                toast.message =
                  error instanceof Error ? error.message : String(error);
              }
            }}
          />
        </ActionPanel>
      }
    >
      <Form.Description title="Assignment" text={folder.Name} />
      <Form.FilePicker id="files" title="File" allowMultipleSelection={false} />
      <Form.TextArea
        id="description"
        title="Comment"
        placeholder="Optional submission comment"
      />
    </Form>
  );
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

function richTextPlain(body: RichText | null | undefined): string {
  return descriptionText(body) || stripHtml(body?.Html ?? "");
}

async function loadRenderedFeedback(
  client: Awaited<ReturnType<typeof createAuthenticatedBrightspaceClient>>,
  courseId: string,
  folderId: number,
): Promise<RenderedFeedback | undefined> {
  const path = `/d2l/lms/dropbox/user/folder_user_view_feedback.d2l?db=${folderId}&grpid=0&isprv=0&bp=0&ou=${courseId}`;
  const url = client.resolveUrl(path);

  try {
    const html = await client.fetchText(path);
    const markdown = cleanRenderedFeedback(
      htmlToMarkdown(extractRenderedFeedbackHtml(html), url).markdown,
    );

    return markdown ? { markdown, url } : undefined;
  } catch {
    return undefined;
  }
}

function extractRenderedFeedbackHtml(html: string): string {
  const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? html;
  const main =
    /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(body)?.[1] ??
    /<div\b[^>]*(?:id|class)=["'][^"']*(?:Content|content|main|Main)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(
      body,
    )?.[1] ??
    body;
  const start = feedbackContentStart(main);
  const sliced = start >= 0 ? main.slice(start) : main;
  const end = feedbackContentEnd(sliced);

  return end >= 0 ? sliced.slice(0, end) : sliced;
}

function feedbackContentStart(html: string): number {
  const markers = [
    /<h1\b[^>]*>[\s\S]*?Feedback\s+for[\s\S]*?<\/h1>/i,
    /Rubric\s+Name\s*:/i,
    /d2l[\w-]*rubric/i,
    /\brubric\b/i,
  ];

  for (const marker of markers) {
    const match = marker.exec(html);
    if (match?.index !== undefined) {
      return match.index;
    }
  }

  return -1;
}

function feedbackContentEnd(html: string): number {
  const markers = [/<footer\b/i, /<script\b/i, /<\/main>/i];
  const indexes = markers
    .map((marker) => marker.exec(html)?.index ?? -1)
    .filter((index) => index > 0);

  return indexes.length ? Math.min(...indexes) : -1;
}

function cleanRenderedFeedback(markdown: string): string {
  const lines = markdown
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !isRenderedFeedbackChrome(line))
    .filter((line) => !/^\[?Add to ePortfolio\]?/i.test(line))
    .filter((line) => !/^\[?Print\]?/i.test(line));

  return normalizeRenderedFeedbackTables(lines.join("\n")).trim();
}

function isRenderedFeedbackChrome(line: string): boolean {
  return /^(skip to main content|course home|content|announcements|assignments|grades|class progress|calendar|help|notifications|account settings|log out|logout|close|back|print|brightspace)$/i.test(
    line.replace(/^#+\s*/, ""),
  );
}

function normalizeRenderedFeedbackTables(markdown: string): string {
  return markdown
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\|\s*\[selected\]\s*\|/gi, "| **[selected]** |")
    .replace(
      /\|\s*(Achieved|Fully achieved|Partially achieved|Not achieved)(\s+\d+\s+points?)?\s*\|/gi,
      (_match, label: string, points: string) =>
        `| **${label}${points ?? ""}** |`,
    );
}

function compareAssignments(a: AssignmentRecord, b: AssignmentRecord): number {
  return (
    Number(a.folder.IsHidden ?? false) - Number(b.folder.IsHidden ?? false) ||
    compareDates(a.folder.DueDate, b.folder.DueDate) ||
    a.folder.Name.localeCompare(b.folder.Name)
  );
}

function compareDates(a?: string | null, b?: string | null): number {
  const aTime = a ? new Date(a).getTime() : Number.POSITIVE_INFINITY;
  const bTime = b ? new Date(b).getTime() : Number.POSITIVE_INFINITY;
  return aTime - bTime;
}

function submissionTypeLabel(value: string | number): string {
  const labels: Record<string, string> = {
    "0": "File",
    "1": "Text",
    "2": "On Paper",
    "3": "Observed",
    "4": "File or Text",
  };
  return labels[String(value)] ?? String(value);
}

function dropboxTypeLabel(value: string | number): string {
  const labels: Record<string, string> = {
    "1": "Group",
    "2": "Individual",
  };
  return labels[String(value)] ?? String(value);
}

function fileSize(file: { Size?: number; FileSize?: number }): string {
  const bytes = file.Size ?? file.FileSize;
  if (!bytes) {
    return "";
  }

  return ` (${formatBytes(bytes)})`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
