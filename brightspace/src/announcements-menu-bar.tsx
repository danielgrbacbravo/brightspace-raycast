import {
  Icon,
  type Image,
  LaunchType,
  LocalStorage,
  MenuBarExtra,
  Toast,
  environment,
  getPreferenceValues,
  launchCommand,
  open,
  openCommandPreferences,
  showToast,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import {
  type GradeValue,
  type NewsItem,
  formatDate,
  formatGrade,
} from "./lib/brightspace";
import { createAuthenticatedBrightspaceClient } from "./lib/client-factory";
import {
  decorateCourses,
  getCourseSettings,
  type DecoratedCourse,
} from "./lib/course-settings";
import { stripHtml } from "./lib/markdown";
import { useEffect, useState } from "react";

const ANNOUNCEMENT_LOOKBACK_DAYS = 14;
const MAX_MENU_ITEMS = 12;
const STATE_KEY = "announcements.menu-bar.state";
const PREFERENCES_KEY = "announcements.menu-bar.preferences";
const MINUTE_IN_MS = 60 * 1000;
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const FEED_GROUP_ORDER = [
  "Today",
  "Yesterday",
  "This Week",
  "Last Week",
  "This Month",
  "Last Month",
  "Older",
];

type AnnouncementTitleMode =
  | "unread-count"
  | "latest-title"
  | "course-latest-title"
  | "count-latest-title"
  | "icon-only";

type AnnouncementNotificationMode = "toast" | "silent";
type AnnouncementIconMode =
  | "newspaper"
  | "rug-logo"
  | "extension-icon"
  | "bell";
type AnnouncementBellMode = "badge" | "unread" | "never" | "always";
type GradeValueMode = "show" | "hide";

interface AnnouncementMenuPreferences {
  announcementRefreshInterval: string;
  announcementTitleMode: AnnouncementTitleMode;
  announcementNotificationMode: AnnouncementNotificationMode;
  announcementIconMode: AnnouncementIconMode;
  announcementBellMode: AnnouncementBellMode;
  showCourseAnnouncements: boolean;
  showPinnedAnnouncements: boolean;
  showGlobalAnnouncements: boolean;
  showAttachmentAnnouncements: boolean;
  showGradeUpdates: boolean;
  gradeValueMode: GradeValueMode;
}

type StoredAnnouncementMenuPreferences = Partial<AnnouncementMenuPreferences>;

interface AnnouncementFeedBase {
  key: string;
  course: DecoratedCourse;
  date?: string;
}

interface AnnouncementMenuItem extends AnnouncementFeedBase {
  type: "announcement";
  announcement: NewsItem;
}

interface GradeMenuItem extends AnnouncementFeedBase {
  type: "grade";
  grade: GradeValue;
}

type AnnouncementFeedItem = AnnouncementMenuItem | GradeMenuItem;

interface CachedAnnouncementMenuItem {
  key: string;
  type?: "announcement";
  course: DecoratedCourse;
  announcement: NewsItem;
  date?: string;
}

type CachedAnnouncementFeedItem = CachedAnnouncementMenuItem | GradeMenuItem;

interface AnnouncementMenuData {
  items: AnnouncementFeedItem[];
  unreadKeys: string[];
  error?: string;
}

interface FeedGroup {
  title: string;
  items: AnnouncementFeedItem[];
}

interface AnnouncementMenuState {
  knownKeys: string[];
  visibleKeys: string[];
  unreadKeys: string[];
  lastRefreshAt?: number;
  forceRefresh?: boolean;
  cachedItems?: CachedAnnouncementFeedItem[];
}

export default function Command() {
  const { data, isLoading, revalidate } = usePromise(loadAnnouncementMenuData);
  const unreadCount = data?.unreadKeys.length ?? 0;
  const { preferences, signature, setPreference } =
    useLiveAnnouncementMenuPreferences();

  useEffect(() => {
    revalidate();
  }, [revalidate, signature]);

  return (
    <MenuBarExtra
      icon={menuBarIcon(unreadCount, preferences)}
      isLoading={isLoading}
      title={menuBarTitle(data, preferences)}
      tooltip={tooltip(data, isLoading)}
    >
      {data?.error ? (
        <MenuBarExtra.Item icon={Icon.Warning} title={data.error} />
      ) : null}
      {!data?.error && data?.items.length === 0 ? (
        <MenuBarExtra.Item title="No Recent Updates" />
      ) : null}
      {!data?.error ? (
        <>
          {groupFeedItems((data?.items ?? []).slice(0, MAX_MENU_ITEMS)).map(
            (group) => (
              <MenuBarExtra.Section key={group.title} title={group.title}>
                {group.items.map((item) => (
                  <MenuBarExtra.Item
                    key={item.key}
                    icon={itemIcon(item)}
                    title={itemTitle(item)}
                    subtitle={itemSubtitle(item, preferences)}
                    tooltip={itemTooltip(item, preferences)}
                    onAction={
                      item.course.url
                        ? () => open(item.course.url as string)
                        : undefined
                    }
                  />
                ))}
              </MenuBarExtra.Section>
            ),
          )}
        </>
      ) : null}
      <MenuBarExtra.Section>
        <MenuBarExtra.Item
          icon={Icon.CheckCircle}
          title="Mark All Read"
          onAction={async () => {
            await markAllRead();
            revalidate();
          }}
        />
        <MenuBarExtra.Item
          icon={Icon.ArrowClockwise}
          title="Refresh"
          onAction={async () => {
            await clearRefreshThrottle();
            revalidate();
          }}
        />
        <MenuBarExtra.Submenu icon={Icon.Gear} title="Menu Bar Display">
          <MenuBarExtra.Submenu title="Icon">
            <PreferenceItem
              current={preferences.announcementIconMode}
              title="University of Groningen Icon"
              value="rug-logo"
              onChange={(value) => setPreference("announcementIconMode", value)}
            />
            <PreferenceItem
              current={preferences.announcementIconMode}
              title="Bell"
              value="bell"
              onChange={(value) => setPreference("announcementIconMode", value)}
            />
            <PreferenceItem
              current={preferences.announcementIconMode}
              title="Newspaper"
              value="newspaper"
              onChange={(value) => setPreference("announcementIconMode", value)}
            />
            <PreferenceItem
              current={preferences.announcementIconMode}
              title="Brightspace Extension Icon"
              value="extension-icon"
              onChange={(value) => setPreference("announcementIconMode", value)}
            />
          </MenuBarExtra.Submenu>
          <MenuBarExtra.Submenu title="Unread Icon">
            <PreferenceItem
              current={preferences.announcementBellMode}
              title="Badge Selected Icon"
              value="badge"
              onChange={(value) => setPreference("announcementBellMode", value)}
            />
            <PreferenceItem
              current={preferences.announcementBellMode}
              title="Show Bell"
              value="unread"
              onChange={(value) => setPreference("announcementBellMode", value)}
            />
            <PreferenceItem
              current={preferences.announcementBellMode}
              title="Always Selected Icon"
              value="never"
              onChange={(value) => setPreference("announcementBellMode", value)}
            />
            <PreferenceItem
              current={preferences.announcementBellMode}
              title="Always Bell"
              value="always"
              onChange={(value) => setPreference("announcementBellMode", value)}
            />
          </MenuBarExtra.Submenu>
          <MenuBarExtra.Submenu title="Title">
            <PreferenceItem
              current={preferences.announcementTitleMode}
              title="Unread Count"
              value="unread-count"
              onChange={(value) =>
                setPreference("announcementTitleMode", value)
              }
            />
            <PreferenceItem
              current={preferences.announcementTitleMode}
              title="Latest Title"
              value="latest-title"
              onChange={(value) =>
                setPreference("announcementTitleMode", value)
              }
            />
            <PreferenceItem
              current={preferences.announcementTitleMode}
              title="Course and Latest Title"
              value="course-latest-title"
              onChange={(value) =>
                setPreference("announcementTitleMode", value)
              }
            />
            <PreferenceItem
              current={preferences.announcementTitleMode}
              title="Count and Latest Title"
              value="count-latest-title"
              onChange={(value) =>
                setPreference("announcementTitleMode", value)
              }
            />
            <PreferenceItem
              current={preferences.announcementTitleMode}
              title="Icon Only"
              value="icon-only"
              onChange={(value) =>
                setPreference("announcementTitleMode", value)
              }
            />
          </MenuBarExtra.Submenu>
        </MenuBarExtra.Submenu>
        <MenuBarExtra.Item
          icon={Icon.List}
          title="Open Announcements"
          onAction={() =>
            launchCommand({
              name: "announcements",
              type: LaunchType.UserInitiated,
            })
          }
        />
        <MenuBarExtra.Item
          icon={Icon.Gear}
          title="Configure"
          onAction={openCommandPreferences}
        />
      </MenuBarExtra.Section>
    </MenuBarExtra>
  );
}

function PreferenceItem<T extends string>({
  current,
  title,
  value,
  onChange,
}: {
  current: T;
  title: string;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <MenuBarExtra.Item
      icon={current === value ? Icon.CheckCircle : Icon.Circle}
      title={title}
      onAction={() => onChange(value)}
    />
  );
}

async function loadAnnouncementMenuData(): Promise<AnnouncementMenuData> {
  try {
    const preferences = await getEffectiveAnnouncementMenuPreferences();
    const previousState = await loadState();
    const cachedItems = normalizeCachedFeedItems(
      previousState.cachedItems ?? [],
    );
    const shouldFetch =
      cachedItems.length === 0 ||
      previousState.forceRefresh === true ||
      (environment.launchType === LaunchType.Background &&
        isRefreshDue(previousState, preferences));
    const fetchedItems = shouldFetch
      ? await loadRecentFeedItemsWithFallback(cachedItems)
      : undefined;
    const didUseFetchedItems =
      Boolean(fetchedItems?.length) || cachedItems.length === 0;
    const allItems = didUseFetchedItems ? (fetchedItems ?? []) : cachedItems;
    const items = allItems.filter((item) =>
      shouldShowFeedItem(item, preferences),
    );
    const currentKnownKeys = allItems.map((item) => item.key);
    const currentVisibleKeys = items.map((item) => item.key);
    const currentVisibleKeySet = new Set(currentVisibleKeys);
    const knownKeySet = new Set(previousState.knownKeys);
    const newItems = items.filter((item) => !knownKeySet.has(item.key));
    const unreadKeys = [
      ...new Set([
        ...previousState.unreadKeys.filter((key) =>
          currentVisibleKeySet.has(key),
        ),
        ...newItems.map((item) => item.key),
      ]),
    ];

    await saveState({
      knownKeys: currentKnownKeys,
      visibleKeys: currentVisibleKeys,
      unreadKeys,
      lastRefreshAt: shouldFetch
        ? new Date().getTime()
        : previousState.lastRefreshAt,
      forceRefresh: false,
      cachedItems: allItems,
    });

    if (
      preferences.announcementNotificationMode === "toast" &&
      shouldFetch &&
      environment.launchType === LaunchType.Background &&
      previousState.knownKeys.length > 0 &&
      newItems.length > 0
    ) {
      await showToast({
        style: Toast.Style.Success,
        title:
          newItems.length === 1
            ? "New Brightspace announcement"
            : "New Brightspace updates",
        message:
          newItems.length === 1
            ? itemNotificationText(newItems[0], preferences)
            : `${newItems.length} new updates`,
      });
    }

    return { items, unreadKeys };
  } catch (error) {
    return {
      items: [],
      unreadKeys: [],
      error:
        error instanceof Error ? error.message : "Failed to load announcements",
    };
  }
}

async function loadRecentFeedItems(): Promise<AnnouncementFeedItem[]> {
  const client = await createAuthenticatedBrightspaceClient();
  const [rawCourses, settings] = await Promise.all([
    client.listCourses(),
    getCourseSettings(),
  ]);
  const courses = decorateCourses(rawCourses, settings);
  const [announcements, grades] = await Promise.all([
    loadRecentAnnouncements(client, courses),
    loadRecentGradeUpdates(client, courses),
  ]);

  return [...announcements, ...grades].sort(
    (a, b) => timestamp(b.date) - timestamp(a.date),
  );
}

async function loadRecentFeedItemsWithFallback(
  cachedItems: AnnouncementFeedItem[],
): Promise<AnnouncementFeedItem[]> {
  try {
    return await loadRecentFeedItems();
  } catch (error) {
    if (cachedItems.length > 0) {
      return [];
    }

    throw error;
  }
}

async function loadRecentAnnouncements(
  client: Awaited<ReturnType<typeof createAuthenticatedBrightspaceClient>>,
  courses: DecoratedCourse[],
): Promise<AnnouncementMenuItem[]> {
  const since = relativeIsoDate(-ANNOUNCEMENT_LOOKBACK_DAYS);
  const entries = await Promise.all(
    courses.map(async (course) => {
      try {
        const announcements = await client.getCourseNews(course.id, { since });
        return announcements
          .filter(
            (announcement) =>
              !announcement.IsHidden && announcement.IsPublished !== false,
          )
          .map((announcement) => ({
            type: "announcement" as const,
            key: announcementKey(course, announcement),
            course,
            announcement,
            date: announcementDate(announcement),
          }));
      } catch {
        return [];
      }
    }),
  );

  return entries.flat().sort((a, b) => timestamp(b.date) - timestamp(a.date));
}

async function loadRecentGradeUpdates(
  client: Awaited<ReturnType<typeof createAuthenticatedBrightspaceClient>>,
  courses: DecoratedCourse[],
): Promise<GradeMenuItem[]> {
  const since = relativeIsoDate(-ANNOUNCEMENT_LOOKBACK_DAYS);
  const sinceTime = new Date(since).getTime();
  const entries = await Promise.all(
    courses.map(async (course) => {
      try {
        const grades = await client.getMyGradeValues(course.id);
        return grades.flatMap((grade) => {
          const date = gradeUpdateDate(grade);
          const time = date ? new Date(date).getTime() : 0;
          return time >= sinceTime && hasVisibleGrade(grade)
            ? [
                {
                  type: "grade" as const,
                  key: gradeUpdateKey(course, grade),
                  course,
                  grade,
                  date,
                },
              ]
            : [];
        });
      } catch {
        return [];
      }
    }),
  );

  return entries.flat();
}

async function loadState(): Promise<AnnouncementMenuState> {
  const raw = await LocalStorage.getItem<string>(STATE_KEY);
  if (!raw) {
    return { knownKeys: [], visibleKeys: [], unreadKeys: [] };
  }

  try {
    const state = JSON.parse(raw) as Partial<AnnouncementMenuState>;
    return {
      knownKeys: Array.isArray(state.knownKeys) ? state.knownKeys : [],
      visibleKeys: Array.isArray(state.visibleKeys) ? state.visibleKeys : [],
      unreadKeys: Array.isArray(state.unreadKeys) ? state.unreadKeys : [],
      forceRefresh: state.forceRefresh === true,
      lastRefreshAt:
        typeof state.lastRefreshAt === "number"
          ? state.lastRefreshAt
          : undefined,
      cachedItems: Array.isArray(state.cachedItems) ? state.cachedItems : [],
    };
  } catch {
    return { knownKeys: [], visibleKeys: [], unreadKeys: [] };
  }
}

async function saveState(state: AnnouncementMenuState): Promise<void> {
  await LocalStorage.setItem(STATE_KEY, JSON.stringify(state));
}

async function markAllRead(): Promise<void> {
  const state = await loadState();
  await saveState({ ...state, unreadKeys: [] });
}

async function clearRefreshThrottle(): Promise<void> {
  const state = await loadState();
  await saveState({ ...state, lastRefreshAt: undefined, forceRefresh: true });
}

function getAnnouncementMenuPreferences(): AnnouncementMenuPreferences {
  const values = getPreferenceValues<Partial<AnnouncementMenuPreferences>>();

  return {
    announcementRefreshInterval: values.announcementRefreshInterval ?? "5",
    announcementTitleMode: values.announcementTitleMode ?? "unread-count",
    announcementNotificationMode:
      values.announcementNotificationMode ?? "toast",
    announcementIconMode: values.announcementIconMode ?? "newspaper",
    announcementBellMode: values.announcementBellMode ?? "badge",
    showCourseAnnouncements: values.showCourseAnnouncements ?? true,
    showPinnedAnnouncements: values.showPinnedAnnouncements ?? true,
    showGlobalAnnouncements: values.showGlobalAnnouncements ?? true,
    showAttachmentAnnouncements: values.showAttachmentAnnouncements ?? true,
    showGradeUpdates: values.showGradeUpdates ?? true,
    gradeValueMode: values.gradeValueMode ?? "show",
  };
}

async function getEffectiveAnnouncementMenuPreferences(): Promise<AnnouncementMenuPreferences> {
  return mergeAnnouncementMenuPreferences(
    getAnnouncementMenuPreferences(),
    await getStoredAnnouncementMenuPreferences(),
  );
}

async function getStoredAnnouncementMenuPreferences(): Promise<StoredAnnouncementMenuPreferences> {
  const raw = await LocalStorage.getItem<string>(PREFERENCES_KEY);
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw) as StoredAnnouncementMenuPreferences;
  } catch {
    return {};
  }
}

async function saveStoredAnnouncementMenuPreferences(
  preferences: StoredAnnouncementMenuPreferences,
): Promise<void> {
  await LocalStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
}

function mergeAnnouncementMenuPreferences(
  base: AnnouncementMenuPreferences,
  stored: StoredAnnouncementMenuPreferences,
): AnnouncementMenuPreferences {
  return {
    ...base,
    ...stored,
  };
}

function useLiveAnnouncementMenuPreferences(): {
  preferences: AnnouncementMenuPreferences;
  signature: string;
  setPreference: <K extends keyof AnnouncementMenuPreferences>(
    key: K,
    value: AnnouncementMenuPreferences[K],
  ) => Promise<void>;
} {
  const [preferences, setPreferences] = useState(
    getAnnouncementMenuPreferences,
  );
  const signature = preferencesSignature(preferences);

  useEffect(() => {
    void getEffectiveAnnouncementMenuPreferences().then(setPreferences);

    const interval = setInterval(() => {
      void getEffectiveAnnouncementMenuPreferences().then((nextPreferences) => {
        setPreferences((currentPreferences) =>
          preferencesSignature(currentPreferences) ===
          preferencesSignature(nextPreferences)
            ? currentPreferences
            : nextPreferences,
        );
      });
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  async function setPreference<K extends keyof AnnouncementMenuPreferences>(
    key: K,
    value: AnnouncementMenuPreferences[K],
  ): Promise<void> {
    const stored = await getStoredAnnouncementMenuPreferences();
    const nextStored = { ...stored, [key]: value };
    const nextPreferences = mergeAnnouncementMenuPreferences(
      getAnnouncementMenuPreferences(),
      nextStored,
    );

    await saveStoredAnnouncementMenuPreferences(nextStored);
    setPreferences(nextPreferences);
  }

  return { preferences, signature, setPreference };
}

function preferencesSignature(
  preferences: AnnouncementMenuPreferences,
): string {
  return JSON.stringify(preferences);
}

function isRefreshDue(
  state: AnnouncementMenuState,
  preferences: AnnouncementMenuPreferences,
): boolean {
  const lastRefreshAt = state.lastRefreshAt ?? 0;
  const intervalMinutes =
    Number.parseInt(preferences.announcementRefreshInterval, 10) || 5;

  return new Date().getTime() - lastRefreshAt >= intervalMinutes * MINUTE_IN_MS;
}

function shouldShowFeedItem(
  item: AnnouncementFeedItem,
  preferences: AnnouncementMenuPreferences,
): boolean {
  if (item.type === "grade") {
    return preferences.showGradeUpdates;
  }

  const { announcement } = item;

  if (announcement.IsPinned) {
    return preferences.showPinnedAnnouncements;
  }

  if (announcement.IsGlobal) {
    return preferences.showGlobalAnnouncements;
  }

  if (announcement.Attachments?.length) {
    return preferences.showAttachmentAnnouncements;
  }

  return preferences.showCourseAnnouncements;
}

function menuBarIcon(
  unreadCount: number,
  preferences: AnnouncementMenuPreferences,
): Image.ImageLike {
  if (
    unreadCount > 0 &&
    preferences.announcementIconMode === "rug-logo" &&
    (preferences.announcementBellMode === "badge" ||
      preferences.announcementBellMode === "unread")
  ) {
    return "rug-icon-white-badged.png";
  }

  if (preferences.announcementBellMode === "badge" && unreadCount > 0) {
    return badgedMenuBarIcon(preferences);
  }

  if (
    preferences.announcementBellMode === "always" ||
    (preferences.announcementBellMode === "unread" && unreadCount > 0)
  ) {
    return Icon.Bell;
  }

  if (preferences.announcementIconMode === "rug-logo") {
    return "rug-icon-white.png";
  }

  if (preferences.announcementIconMode === "extension-icon") {
    return "extension-icon.png";
  }

  if (preferences.announcementIconMode === "bell") {
    return Icon.Bell;
  }

  return Icon.Newspaper;
}

function badgedMenuBarIcon(
  preferences: AnnouncementMenuPreferences,
): Image.ImageLike {
  if (preferences.announcementIconMode === "rug-logo") {
    return "rug-icon-white-badged.png";
  }

  if (preferences.announcementIconMode === "bell") {
    return Icon.Bell;
  }

  return Icon.Bell;
}

function menuBarTitle(
  data: AnnouncementMenuData | undefined,
  preferences: AnnouncementMenuPreferences,
): string | undefined {
  const unreadCount = data?.unreadKeys.length ?? 0;
  const latestItem = data?.items[0];
  const latestTitle = latestItem ? shortTitle(itemTitle(latestItem)) : "";

  if (preferences.announcementTitleMode === "icon-only") {
    return undefined;
  }

  if (preferences.announcementTitleMode === "latest-title") {
    return latestTitle || undefined;
  }

  if (preferences.announcementTitleMode === "course-latest-title") {
    return latestItem
      ? `${latestItem.course.courseAcronym}: ${latestTitle}`
      : undefined;
  }

  if (preferences.announcementTitleMode === "count-latest-title") {
    if (unreadCount > 0 && latestTitle) {
      return `${unreadCount} ${latestTitle}`;
    }

    return latestTitle || undefined;
  }

  return unreadCount > 0 ? String(unreadCount) : undefined;
}

function tooltip(data: AnnouncementMenuData | undefined, isLoading: boolean) {
  if (isLoading) {
    return "Loading Brightspace updates";
  }

  if (data?.error) {
    return data.error;
  }

  const count = data?.unreadKeys.length ?? 0;
  return count === 1
    ? "1 unread Brightspace update"
    : `${count} unread Brightspace updates`;
}

function groupFeedItems(items: AnnouncementFeedItem[]): FeedGroup[] {
  const groups = new Map<string, AnnouncementFeedItem[]>();

  for (const item of items) {
    const title = feedGroupTitle(item);
    groups.set(title, [...(groups.get(title) ?? []), item]);
  }

  return FEED_GROUP_ORDER.flatMap((title) => {
    const groupItems = groups.get(title);
    return groupItems?.length ? [{ title, items: groupItems }] : [];
  });
}

function feedGroupTitle(item: AnnouncementFeedItem): string {
  if (!item.date) {
    return "Older";
  }

  const date = new Date(item.date);
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

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function shortTitle(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 36 ? `${normalized.slice(0, 35)}...` : normalized;
}

function itemIcon(item: AnnouncementFeedItem): Image.ImageLike {
  return item.type === "grade" ? Icon.BarChart : Icon.Newspaper;
}

function itemTitle(item: AnnouncementFeedItem): string {
  if (item.type === "announcement") {
    return item.announcement.Title;
  }

  const name = item.grade.GradeObjectName ?? "Unnamed grade item";
  return `${name} updated`;
}

function itemSubtitle(
  item: AnnouncementFeedItem,
  preferences: AnnouncementMenuPreferences,
): string {
  if (item.type === "grade" && preferences.gradeValueMode === "show") {
    return `${item.course.courseAcronym} | ${formatGrade(item.grade)}`;
  }

  if (item.type === "grade") {
    return `${item.course.courseAcronym} | Grade updated`;
  }

  return item.course.courseAcronym;
}

function itemNotificationText(
  item: AnnouncementFeedItem,
  preferences: AnnouncementMenuPreferences,
): string {
  return `${item.course.courseAcronym}: ${itemTitle(item)}${
    item.type === "grade" && preferences.gradeValueMode === "show"
      ? ` (${formatGrade(item.grade)})`
      : ""
  }`;
}

function itemTooltip(
  item: AnnouncementFeedItem,
  preferences: AnnouncementMenuPreferences,
): string {
  if (item.type === "grade") {
    return gradeTooltip(item, preferences);
  }

  return announcementTooltip(item);
}

function announcementTooltip(item: AnnouncementMenuItem): string {
  return [
    item.course.name,
    formatDate(item.date),
    stripHtml(
      item.announcement.Body?.Html ?? item.announcement.Body?.Text ?? "",
    )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 240),
  ]
    .filter(Boolean)
    .join("\n");
}

function gradeTooltip(
  item: GradeMenuItem,
  preferences: AnnouncementMenuPreferences,
): string {
  return [
    item.course.name,
    formatDate(item.date),
    item.grade.GradeObjectName,
    preferences.gradeValueMode === "show"
      ? `Grade: ${formatGrade(item.grade)}`
      : "Grade updated",
  ]
    .filter(Boolean)
    .join("\n");
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

function announcementKey(course: DecoratedCourse, item: NewsItem): string {
  return `${course.id}:${item.Id}`;
}

function gradeUpdateKey(course: DecoratedCourse, grade: GradeValue): string {
  return `grade:${course.id}:${String(grade.GradeObjectIdentifier ?? grade.GradeObjectName ?? "unknown")}`;
}

function gradeUpdateDate(grade: GradeValue): string | undefined {
  return grade.ReleasedDate ?? grade.LastModified ?? undefined;
}

function hasVisibleGrade(grade: GradeValue): boolean {
  return (
    Boolean(grade.DisplayedGrade) ||
    typeof grade.PointsNumerator === "number" ||
    typeof grade.WeightedNumerator === "number"
  );
}

function normalizeCachedFeedItems(
  items: CachedAnnouncementFeedItem[],
): AnnouncementFeedItem[] {
  return items.flatMap((item) => {
    if (item.type === "grade") {
      return [item];
    }

    if (item.announcement) {
      return [{ ...item, type: "announcement" as const }];
    }

    return [];
  });
}

function relativeIsoDate(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function timestamp(value?: string): number {
  return value ? new Date(value).getTime() || 0 : 0;
}
