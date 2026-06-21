import { getBrightspacePreferences } from "./preferences";

const DEFAULT_LP_VERSION = "1.60";
const DEFAULT_LE_VERSION = "1.94";

export interface ApiVersion {
  ProductCode?: string;
  SupportedVersions?: string[];
  LatestVersion?: string;
  Version?: string;
}

export interface User {
  Identifier?: string;
  FirstName?: string;
  LastName?: string;
  UniqueName?: string;
  ProfileIdentifier?: string;
}

export interface UserData {
  OrgId?: number;
  UserId: number;
  FirstName?: string;
  MiddleName?: string | null;
  LastName?: string;
  UserName?: string;
  ExternalEmail?: string | null;
  OrgDefinedId?: string | null;
  UniqueIdentifier?: string;
  DisplayName?: string;
}

export interface Enrollment {
  OrgUnit: {
    Id: number;
    Name: string;
    Code?: string;
    HomeUrl?: string | null;
    Type?: {
      Code?: string;
      Name?: string;
    };
  };
  Access?: {
    CanAccess?: boolean;
    IsActive?: boolean;
    LastAccessed?: string | null;
  };
}

export interface Course {
  id: number;
  name: string;
  code?: string;
  url?: string;
  lastAccessed?: string;
}

export interface ContentTopic {
  Id: number;
  Title: string;
  Type?: number;
  Url?: string;
  Description?: RichText | string;
  ShortTitle?: string;
  ToolId?: number;
  ToolItemId?: number;
  ActivityId?: string;
  IsHidden?: boolean;
  IsLocked?: boolean;
  StartDate?: string | null;
  EndDate?: string | null;
  DueDate?: string | null;
  CompletionType?: string | number | null;
  DateCompleted?: string | null;
  IsCompleted?: boolean;
  IsRequired?: boolean;
  IsExempt?: boolean;
  LastVisited?: string | null;
  LastAccessed?: string | null;
}

export interface BrightspaceResource {
  url: string;
  contentType: string;
  fileName?: string;
  bytes: ArrayBuffer;
}

export interface RichText {
  Html?: string | null;
  Text?: string | null;
}

export interface ContentModule {
  Id: number;
  Title: string;
  Modules?: ContentModule[];
  Topics?: ContentTopic[];
}

export interface ContentToc {
  Modules?: ContentModule[];
}

export interface DropboxFolder {
  Id: number;
  Name: string;
  CustomInstructions?: RichText | null;
  Attachments?: FileAttachment[];
  Availability?: {
    StartDate?: string | null;
    EndDate?: string | null;
    StartDateAvailabilityType?: string | null;
    EndDateAvailabilityType?: string | null;
  } | null;
  Assessment?: {
    ScoreDenominator?: number | null;
  } | null;
  DueDate?: string | null;
  StartDate?: string | null;
  EndDate?: string | null;
  DisplayInCalendar?: boolean;
  IsHidden?: boolean;
  IsDeleted?: boolean;
  GradeItemId?: number | null;
  SubmissionType?: string | number | null;
  CompletionType?: string | number | null;
  DropboxType?: string | number | null;
}

export interface FileAttachment {
  FileId: number;
  FileName: string;
  Size?: number;
  FileSize?: number;
  isRead?: boolean;
  isFlagged?: boolean;
}

export interface LinkAttachment {
  Type?: string;
  LinkId: number;
  LinkName: string;
  Href?: string | null;
}

export interface DropboxSubmission {
  Id: number;
  SubmittedBy?: {
    Id?: string;
    DisplayName?: string;
  };
  SubmissionDate?: string | null;
  Comment?: RichText | null;
  Files?: FileAttachment[];
}

export interface EntityDropbox {
  Entity?: {
    EntityId?: number;
    EntityType?: string;
    DisplayName?: string;
    Name?: string;
  };
  Status?: string | number;
  Feedback?: {
    Score?: number | null;
    Feedback?: RichText | null;
    IsGraded?: boolean;
    Files?: FileAttachment[];
    Links?: LinkAttachment[];
    GradedSymbol?: string | null;
  } | null;
  Submissions?: DropboxSubmission[];
  CompletionDate?: string | null;
}

export interface Quiz {
  QuizId?: number;
  Id?: number;
  Name: string;
  DueDate?: string | null;
  StartDate?: string | null;
  EndDate?: string | null;
  IsActive?: boolean;
}

export interface GradeValue {
  GradeObjectIdentifier?: string | number;
  GradeObjectName?: string;
  GradeObjectType?: number;
  GradeObjectTypeName?: string | null;
  Comments?: RichText | null;
  PrivateComments?: RichText | null;
  LastModified?: string | null;
  LastModifiedBy?: string | number | null;
  ReleasedDate?: string | null;
  DisplayedGrade?: string;
  PointsNumerator?: number | null;
  PointsDenominator?: number | null;
  WeightedNumerator?: number | null;
  WeightedDenominator?: number | null;
}

export interface CalendarAssociatedEntity {
  AssociatedEntityId?: string | number;
  AssociatedEntityType?: string;
  Title?: string;
  Name?: string;
  Url?: string;
  Href?: string;
}

export interface CalendarContentObject {
  Id?: number | string;
  Title?: string;
  Name?: string;
  Type?: string | number;
  Url?: string;
  Href?: string;
}

export interface CalendarEvent {
  CalendarEventId?: string | number;
  Id?: string | number;
  OrgUnitId?: number;
  Title: string;
  Description?: string | RichText | null;
  StartDateTime?: string | null;
  EndDateTime?: string | null;
  StartDay?: string | null;
  EndDay?: string | null;
  Type?: number;
  AssociatedEntity?: CalendarAssociatedEntity | null;
  topicCO?: CalendarContentObject | null;
  TopicCO?: CalendarContentObject | null;
  ContentObject?: CalendarContentObject | null;
  IsHidden?: boolean;
}

export interface NewsAttachment {
  FileId: number;
  FileName: string;
  FileSize?: number;
}

export interface NewsItem {
  Id: number;
  IsHidden?: boolean;
  Attachments?: NewsAttachment[];
  Title: string;
  Body?: RichText | null;
  CreatedBy?: number | null;
  CreatedDate?: string | null;
  LastModifiedBy?: number | null;
  LastModifiedDate?: string | null;
  StartDate?: string | null;
  EndDate?: string | null;
  IsGlobal?: boolean;
  IsPublished?: boolean;
  ShowOnlyInCourseOfferings?: boolean;
  IsAuthorInfoShown?: boolean;
  IsPinned?: boolean;
  PinnedDate?: string | null;
  IsStartDateShown?: boolean;
  SortOrder?: number;
}

export interface CourseUpdate {
  OrgUnitId?: number;
  OrgUnitName?: string;
  UpdateType?: string;
  UpdateTypeName?: string;
  Name?: string;
  Count?: number;
  LastModified?: string | null;
  LastModifiedDate?: string | null;
}

export interface DiscussionForum {
  ForumId: number;
  StartDate?: string | null;
  EndDate?: string | null;
  Name: string;
  Description?: RichText | null;
  ShowDescriptionInTopics?: boolean | null;
  AllowAnonymous?: boolean;
  IsLocked?: boolean;
  IsHidden?: boolean;
  RequiresApproval?: boolean;
  DisplayInCalendar?: boolean;
  StartDateAvailabilityType?: string | null;
  EndDateAvailabilityType?: string | null;
}

export interface DiscussionTopic {
  ForumId: number;
  TopicId: number;
  Name: string;
  Description?: RichText | null;
  StartDate?: string | null;
  EndDate?: string | null;
  UnlockStartDate?: string | null;
  UnlockEndDate?: string | null;
  IsLocked?: boolean;
  AllowAnonymousPosts?: boolean;
  RequiresApproval?: boolean;
  UnApprovedPostCount?: number;
  PinnedPostCount?: number;
  ScoringType?: string | number | null;
  IsAutoScore?: boolean;
  ScoreOutOf?: number | null;
  IncludeNonScoredValues?: boolean;
  ScoredCount?: number;
  RatingsSum?: number;
  RatingsCount?: number;
  IsHidden?: boolean;
  MustPostToParticipate?: boolean;
  RatingType?: string | number | null;
  ActivityId?: string | null;
  GroupTypeId?: number | null;
  StartDateAvailabilityType?: string | null;
  EndDateAvailabilityType?: string | null;
  DueDate?: string | null;
}

export interface DiscussionPost {
  ForumId: number;
  PostId: number;
  TopicId: number;
  PostingUserId?: number | null;
  PostingUserDisplayName?: string;
  ThreadId?: number;
  ParentPostId?: number | null;
  Message?: RichText | null;
  Subject: string;
  DatePosted?: string | null;
  IsAnonymous?: boolean;
  RequiresApproval?: boolean;
  IsDeleted?: boolean;
  LastEditedDate?: string | null;
  LastEditedBy?: number | null;
  CanRate?: boolean;
  ReplyPostIds?: number[];
  WordCount?: number;
  AttachmentCount?: number;
  IsRead?: boolean;
}

export interface Checklist {
  Id: number;
  Name: string;
  Description?: RichText | null;
}

export interface ChecklistCategory {
  CategoryId: number;
  Name: string;
  Description?: RichText | null;
  SortOrder: number;
}

export interface ChecklistItem {
  ChecklistItemId: number;
  CategoryId: number;
  ChecklistId: number;
  Name: string;
  Description?: RichText | null;
  SortOrder: number;
  DueDate?: string | null;
}

interface Page<T> {
  Items?: T[];
  Objects?: T[];
}

export class BrightspaceError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "BrightspaceError";
  }
}

export class BrightspaceClient {
  readonly tenantUrl: string;
  private readonly cookieHeader?: string;
  private readonly bearerToken?: string;
  private lpVersion?: string;
  private leVersion?: string;

  constructor(options: {
    tenantUrl: string;
    cookieHeader?: string;
    bearerToken?: string;
    lpVersion?: string;
    leVersion?: string;
  }) {
    this.tenantUrl = normalizeTenantUrl(options.tenantUrl);
    this.cookieHeader = options.cookieHeader?.trim();
    this.bearerToken = options.bearerToken?.trim();
    this.lpVersion = options.lpVersion?.trim();
    this.leVersion = options.leVersion?.trim();
  }

  async getVersions(): Promise<ApiVersion[]> {
    return this.request<ApiVersion[]>("/d2l/api/versions/", {
      requiresAuth: false,
    });
  }

  async whoAmI(): Promise<User> {
    return this.request<User>(
      `/d2l/api/lp/${await this.getLpVersion()}/users/whoami`,
    );
  }

  async getUser(userId: number | string): Promise<UserData> {
    return this.request<UserData>(
      `/d2l/api/lp/${await this.getLpVersion()}/users/${userId}`,
    );
  }

  async myEnrollments(): Promise<Enrollment[]> {
    const page = await this.request<Page<Enrollment>>(
      `/d2l/api/lp/${await this.getLpVersion()}/enrollments/myenrollments/`,
    );
    return page.Items ?? [];
  }

  async listCourses(): Promise<Course[]> {
    const enrollments = await this.myEnrollments();

    return enrollments
      .filter((enrollment) => {
        return (
          enrollment.Access?.CanAccess === true &&
          enrollment.Access?.IsActive === true &&
          enrollment.OrgUnit.Type?.Code === "Course Offering" &&
          Boolean(enrollment.OrgUnit.HomeUrl)
        );
      })
      .map((enrollment) => ({
        id: enrollment.OrgUnit.Id,
        name: enrollment.OrgUnit.Name,
        code: enrollment.OrgUnit.Code,
        url: absoluteUrl(
          this.tenantUrl,
          enrollment.OrgUnit.HomeUrl ?? undefined,
        ),
        lastAccessed: enrollment.Access?.LastAccessed ?? undefined,
      }))
      .sort(
        (a, b) =>
          compareDatesDesc(a.lastAccessed, b.lastAccessed) ||
          a.name.localeCompare(b.name),
      );
  }

  async getContentToc(courseId: number | string): Promise<ContentToc> {
    return this.request<ContentToc>(
      `/d2l/api/le/${await this.getLeVersion()}/${courseId}/content/toc`,
    );
  }

  async getContentBookmarks(
    courseId: number | string,
  ): Promise<ContentTopic[]> {
    return this.request<ContentTopic[]>(
      `/d2l/api/le/${await this.getLeVersion()}/${courseId}/content/bookmarks`,
    );
  }

  async getRecentContent(courseId: number | string): Promise<ContentTopic[]> {
    return this.request<ContentTopic[]>(
      `/d2l/api/le/${await this.getLeVersion()}/${courseId}/content/recent`,
    );
  }

  async getDropboxFolders(courseId: number | string): Promise<DropboxFolder[]> {
    return this.request<DropboxFolder[]>(
      `/d2l/api/le/${await this.getLeVersion()}/${courseId}/dropbox/folders/`,
    );
  }

  async getMyDropboxSubmissions(
    courseId: number | string,
    folderId: number | string,
  ): Promise<EntityDropbox[]> {
    return this.request<EntityDropbox[]>(
      `/d2l/api/le/${await this.getLeVersion()}/${courseId}/dropbox/folders/${folderId}/submissions/mysubmissions/`,
    );
  }

  async submitMyDropboxFile(
    courseId: number | string,
    folderId: number | string,
    options: {
      fileName: string;
      fileBytes: Uint8Array;
      contentType?: string;
      description?: string;
    },
  ): Promise<void> {
    const boundary = `raycast-brightspace-${Date.now()}`;
    const body = multipartMixedBody(boundary, [
      {
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          Description: {
            Text: options.description ?? "",
            Html: options.description ?? "",
          },
        }),
      },
      {
        headers: {
          "Content-Type": options.contentType ?? "application/octet-stream",
          "Content-Disposition": `attachment; filename="${escapeHeaderValue(options.fileName)}"`,
        },
        body: options.fileBytes,
      },
    ]);
    const headers = this.requestHeaders("application/json");

    if (!headers.Authorization && !headers.Cookie) {
      throw new BrightspaceError(
        "Configure a Brightspace cookie header or bearer token in extension preferences.",
      );
    }

    const response = await fetch(
      `${this.tenantUrl}/d2l/api/le/${await this.getLeVersion()}/${courseId}/dropbox/folders/${folderId}/submissions/mysubmissions/`,
      {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": `multipart/mixed; boundary=${boundary}`,
        },
        body,
      },
    );

    if (!response.ok) {
      throw new BrightspaceError(await errorMessage(response), response.status);
    }
  }

  async getQuizzes(courseId: number | string): Promise<Quiz[]> {
    const page = await this.request<Page<Quiz>>(
      `/d2l/api/le/${await this.getLeVersion()}/${courseId}/quizzes/`,
    );
    return page.Objects ?? [];
  }

  async getMyGradeValues(courseId: number | string): Promise<GradeValue[]> {
    return this.request<GradeValue[]>(
      `/d2l/api/le/${await this.getLeVersion()}/${courseId}/grades/values/myGradeValues/`,
    );
  }

  async getMyUpdates(): Promise<CourseUpdate[]> {
    const response = await this.request<Page<CourseUpdate> | CourseUpdate[]>(
      `/d2l/api/le/${await this.getLeVersion()}/updates/myUpdates/`,
    );

    return Array.isArray(response)
      ? response
      : (response.Objects ?? response.Items ?? []);
  }

  async getDiscussionForums(
    courseId: number | string,
  ): Promise<DiscussionForum[]> {
    return this.request<DiscussionForum[]>(
      `/d2l/api/le/${await this.getLeVersion()}/${courseId}/discussions/forums/`,
    );
  }

  async getDiscussionTopics(
    courseId: number | string,
    forumId: number | string,
  ): Promise<DiscussionTopic[]> {
    return this.request<DiscussionTopic[]>(
      `/d2l/api/le/${await this.getLeVersion()}/${courseId}/discussions/forums/${forumId}/topics/`,
    );
  }

  async getDiscussionPosts(
    courseId: number | string,
    forumId: number | string,
    topicId: number | string,
    options?: {
      pageSize?: number;
      pageNumber?: number;
      threadsOnly?: boolean;
      sort?: string;
    },
  ): Promise<DiscussionPost[]> {
    const params = new URLSearchParams();

    if (options?.pageSize) {
      params.set("pageSize", String(options.pageSize));
    }
    if (options?.pageNumber) {
      params.set("pageNumber", String(options.pageNumber));
    }
    if (typeof options?.threadsOnly === "boolean") {
      params.set("threadsOnly", String(options.threadsOnly));
    }
    if (options?.sort) {
      params.set("sort", options.sort);
    }

    const query = params.size > 0 ? `?${params.toString()}` : "";

    return this.request<DiscussionPost[]>(
      `/d2l/api/le/${await this.getLeVersion()}/${courseId}/discussions/forums/${forumId}/topics/${topicId}/posts/${query}`,
    );
  }

  async getChecklists(courseId: number | string): Promise<Checklist[]> {
    const page = await this.request<Page<Checklist>>(
      `/d2l/api/le/${await this.getLeVersion()}/${courseId}/checklists/`,
    );

    return page.Objects ?? page.Items ?? [];
  }

  async getChecklistCategories(
    courseId: number | string,
    checklistId: number | string,
  ): Promise<ChecklistCategory[]> {
    const page = await this.request<Page<ChecklistCategory>>(
      `/d2l/api/le/${await this.getLeVersion()}/${courseId}/checklists/${checklistId}/categories/`,
    );

    return (page.Objects ?? page.Items ?? []).sort(
      (a, b) => a.SortOrder - b.SortOrder || a.Name.localeCompare(b.Name),
    );
  }

  async getChecklistItems(
    courseId: number | string,
    checklistId: number | string,
  ): Promise<ChecklistItem[]> {
    const page = await this.request<Page<ChecklistItem>>(
      `/d2l/api/le/${await this.getLeVersion()}/${courseId}/checklists/${checklistId}/items/`,
    );

    return (page.Objects ?? page.Items ?? []).sort(
      (a, b) => a.SortOrder - b.SortOrder || a.Name.localeCompare(b.Name),
    );
  }

  async getMyDueDateEvents(options: {
    orgUnitIds: Array<number | string>;
    startDateTime: string;
    endDateTime: string;
  }): Promise<CalendarEvent[]> {
    if (options.orgUnitIds.length === 0) {
      return [];
    }

    const params = new URLSearchParams({
      startDateTime: options.startDateTime,
      endDateTime: options.endDateTime,
      orgUnitIdsCSV: options.orgUnitIds.join(","),
      eventType: "6",
      association: "2",
    });
    const page = await this.request<Page<CalendarEvent>>(
      `/d2l/api/le/${await this.getLeVersion()}/calendar/events/myEvents/?${params.toString()}`,
    );

    return page.Objects ?? page.Items ?? [];
  }

  async getCourseNews(
    courseId: number | string,
    options?: { since?: string },
  ): Promise<NewsItem[]> {
    const params = new URLSearchParams();

    if (options?.since) {
      params.set("since", options.since);
    }

    const query = params.size > 0 ? `?${params.toString()}` : "";

    return this.request<NewsItem[]>(
      `/d2l/api/le/${await this.getLeVersion()}/${courseId}/news/${query}`,
    );
  }

  async resolveTopicType(
    inputUrl: string,
  ): Promise<{ url: string; contentType: string }> {
    const url = this.resolveUrl(inputUrl);
    try {
      const shouldResolveWithGet = /quicklink\.d2l|type=lti|\/lti\//i.test(url);
      let response = shouldResolveWithGet
        ? await fetch(url, {
            method: "GET",
            headers: this.requestHeaders(),
            redirect: "follow",
          })
        : await fetch(url, {
            method: "HEAD",
            headers: this.requestHeaders(),
            redirect: "follow",
          });

      if (!response.ok && !shouldResolveWithGet) {
        // Fallback to GET if HEAD is not supported or fails
        response = await fetch(url, {
          method: "GET",
          headers: this.requestHeaders(),
          redirect: "follow",
        });
      }

      return {
        url: response.url,
        contentType: response.headers.get("content-type") ?? "",
      };
    } catch {
      return { url, contentType: "" };
    }
  }

  async fetchResource(inputUrl: string): Promise<BrightspaceResource> {
    const response = await fetch(this.resolveUrl(inputUrl), {
      headers: this.requestHeaders(),
      redirect: "follow",
    });

    if (!response.ok) {
      throw new BrightspaceError(await errorMessage(response), response.status);
    }

    return {
      url: response.url,
      contentType: response.headers.get("content-type") ?? "",
      fileName: fileNameFromDisposition(
        response.headers.get("content-disposition"),
      ),
      bytes: await response.arrayBuffer(),
    };
  }

  async fetchText(inputUrl: string): Promise<string> {
    const response = await fetch(this.resolveUrl(inputUrl), {
      headers: this.requestHeaders("text/html,application/xhtml+xml,*/*"),
      redirect: "follow",
    });

    if (!response.ok) {
      throw new BrightspaceError(await errorMessage(response), response.status);
    }

    return response.text();
  }

  resolveUrl(inputUrl: string): string {
    return new URL(inputUrl, this.tenantUrl).toString();
  }

  private async getLpVersion(): Promise<string> {
    if (!this.lpVersion) {
      this.lpVersion = await this.resolveLatestVersion(
        "lp",
        DEFAULT_LP_VERSION,
      );
    }

    return this.lpVersion;
  }

  private async getLeVersion(): Promise<string> {
    if (!this.leVersion) {
      this.leVersion = await this.resolveLatestVersion(
        "le",
        DEFAULT_LE_VERSION,
      );
    }

    return this.leVersion;
  }

  private async resolveLatestVersion(
    productCode: string,
    fallback: string,
  ): Promise<string> {
    const versions = await this.getVersions();
    const match = versions.find(
      (version) => version.ProductCode?.toLowerCase() === productCode,
    );
    return (
      match?.LatestVersion ??
      match?.Version ??
      match?.SupportedVersions?.at(-1) ??
      fallback
    );
  }

  private async request<T>(
    path: string,
    options: { requiresAuth?: boolean } = {},
  ): Promise<T> {
    const headers = this.requestHeaders("application/json");

    if (
      !headers.Authorization &&
      !headers.Cookie &&
      options.requiresAuth !== false
    ) {
      throw new BrightspaceError(
        "Configure a Brightspace cookie header or bearer token in extension preferences.",
      );
    }

    const response = await fetch(`${this.tenantUrl}${path}`, { headers });

    if (!response.ok) {
      throw new BrightspaceError(await errorMessage(response), response.status);
    }

    return (await response.json()) as T;
  }

  private requestHeaders(accept = "*/*"): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: accept,
    };

    if (this.bearerToken) {
      headers.Authorization = `Bearer ${this.bearerToken}`;
    } else if (this.cookieHeader) {
      headers.Cookie = this.cookieHeader;
    }

    return headers;
  }
}

export function createBrightspaceClient(): BrightspaceClient {
  const preferences = getBrightspacePreferences();
  return new BrightspaceClient(preferences);
}

export function normalizeTenantUrl(input: string): string {
  const trimmed = input.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  const url = new URL(withProtocol);
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

export function formatDate(value?: string | null): string | undefined {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function flattenContentModules(
  modules: ContentModule[] = [],
  depth = 0,
): Array<ContentModule & { depth: number }> {
  return modules.flatMap((module) => [
    { ...module, depth },
    ...flattenContentModules(module.Modules ?? [], depth + 1),
  ]);
}

export function formatGrade(grade: GradeValue): string {
  if (grade.DisplayedGrade) {
    return grade.DisplayedGrade;
  }

  if (
    typeof grade.PointsNumerator === "number" &&
    typeof grade.PointsDenominator === "number"
  ) {
    return `${grade.PointsNumerator}/${grade.PointsDenominator}`;
  }

  if (
    typeof grade.WeightedNumerator === "number" &&
    typeof grade.WeightedDenominator === "number"
  ) {
    return `${grade.WeightedNumerator}/${grade.WeightedDenominator}`;
  }

  return "No visible grade";
}

function absoluteUrl(baseUrl: string, path?: string): string | undefined {
  if (!path) {
    return undefined;
  }

  return new URL(path, baseUrl).toString();
}

function compareDatesDesc(a?: string, b?: string): number {
  const aTime = a ? new Date(a).getTime() : 0;
  const bTime = b ? new Date(b).getTime() : 0;
  return bTime - aTime;
}

async function errorMessage(response: Response): Promise<string> {
  const text = await response.text();
  const suffix = text ? `: ${text.slice(0, 240)}` : "";
  return `Brightspace request failed with ${response.status} ${response.statusText} at ${response.url}${suffix}`;
}

function fileNameFromDisposition(
  disposition: string | null,
): string | undefined {
  if (!disposition) {
    return undefined;
  }

  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (encoded?.[1]) {
    return decodeURIComponent(encoded[1]);
  }

  const plain = /filename="?([^";]+)"?/i.exec(disposition);
  return plain?.[1];
}

function multipartMixedBody(
  boundary: string,
  parts: Array<{
    headers: Record<string, string>;
    body: string | Uint8Array;
  }>,
): Uint8Array {
  const chunks: Uint8Array[] = [];
  const encoder = new TextEncoder();

  for (const part of parts) {
    chunks.push(encoder.encode(`--${boundary}\r\n`));
    for (const [name, value] of Object.entries(part.headers)) {
      chunks.push(encoder.encode(`${name}: ${value}\r\n`));
    }
    chunks.push(encoder.encode("\r\n"));
    chunks.push(
      typeof part.body === "string" ? encoder.encode(part.body) : part.body,
    );
    chunks.push(encoder.encode("\r\n"));
  }

  chunks.push(encoder.encode(`--${boundary}--\r\n`));
  const totalLength = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const body = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }

  return body;
}

function escapeHeaderValue(value: string): string {
  return value.replace(/["\r\n]/g, "_");
}
