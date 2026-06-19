import {
  Action,
  ActionPanel,
  Color,
  Keyboard,
  List,
  Toast,
  showToast,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useState } from "react";
import { formatDate, type Course } from "./lib/brightspace";
import { CourseAcronymForm, CourseAnnouncements } from "./announcements";
import { createAuthenticatedBrightspaceClient } from "./lib/client-factory";
import { AuthenticatedCommand } from "./lib/rug-login-view";
import { CourseContent } from "./course-content";
import {
  decorateCourses,
  getCourseSettings,
  listSemesterKeys,
  pinSemesterCourses,
  togglePinnedCourse,
  type DecoratedCourse,
} from "./lib/course-settings";

type CourseFilter = "focus" | "pinned" | "all" | `semester:${string}`;

interface CourseData {
  courses: DecoratedCourse[];
  rawCourses: Course[];
  semesterKeys: string[];
}

export function CoursesCommand() {
  const [filter, setFilter] = useState<CourseFilter>("focus");
  const { data, isLoading, revalidate } = usePromise(loadCourses);
  const visibleCourses = filterCourses(data?.courses ?? [], filter);

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Search courses"
      searchBarAccessory={
        <List.Dropdown
          tooltip="Course Filter"
          value={filter}
          onChange={(value) => setFilter(value as CourseFilter)}
        >
          <List.Dropdown.Item title="Focus" value="focus" />
          <List.Dropdown.Item title="Pinned" value="pinned" />
          <List.Dropdown.Item title="All Courses" value="all" />
          {data?.semesterKeys.length ? (
            <List.Dropdown.Section title="Detected Semesters">
              {data.semesterKeys.map((semesterKey) => (
                <List.Dropdown.Item
                  key={semesterKey}
                  title={semesterKey}
                  value={`semester:${semesterKey}`}
                />
              ))}
            </List.Dropdown.Section>
          ) : null}
        </List.Dropdown>
      }
    >
      {visibleCourses.length === 0 && !isLoading ? (
        <List.EmptyView
          icon={undefined}
          title="No Courses"
          description="No courses match this filter."
        />
      ) : null}
      {filter === "focus" ? (
        <>
          <CourseSection
            courses={visibleCourses.filter((course) => course.isPinned)}
            rawCourses={data?.rawCourses ?? []}
            revalidate={revalidate}
          />
          <CourseSection
            title="Recent"
            courses={visibleCourses.filter((course) => !course.isPinned)}
            rawCourses={data?.rawCourses ?? []}
            revalidate={revalidate}
          />
        </>
      ) : (
        <CourseSection
          courses={visibleCourses}
          rawCourses={data?.rawCourses ?? []}
          revalidate={revalidate}
        />
      )}
    </List>
  );
}

export default function Command() {
  return (
    <AuthenticatedCommand>
      <CoursesCommand />
    </AuthenticatedCommand>
  );
}

async function loadCourses(): Promise<CourseData> {
  const client = await createAuthenticatedBrightspaceClient();
  const [rawCourses, settings] = await Promise.all([
    client.listCourses(),
    getCourseSettings(),
  ]);

  return {
    rawCourses,
    courses: decorateCourses(rawCourses, settings),
    semesterKeys: listSemesterKeys(rawCourses),
  };
}

function CourseSection({
  title,
  courses,
  rawCourses,
  revalidate,
}: {
  title?: string;
  courses: DecoratedCourse[];
  rawCourses: Course[];
  revalidate: () => void;
}) {
  if (courses.length === 0) {
    return null;
  }

  const items = courses.map((course) => (
    <CourseItem
      key={course.id}
      course={course}
      rawCourses={rawCourses}
      revalidate={revalidate}
    />
  ));

  return title ? (
    <List.Section title={title}>{items}</List.Section>
  ) : (
    <>{items}</>
  );
}

function CourseItem({
  course,
  rawCourses,
  revalidate,
}: {
  course: DecoratedCourse;
  rawCourses: Course[];
  revalidate: () => void;
}) {
  return (
    <List.Item
      title={course.name}
      subtitle={course.code}
      accessories={courseAccessories(course)}
      actions={
        <ActionPanel>
          <Action.Push
            title="Browse Content"
            target={<CourseContent course={course} />}
          />
          {course.url ? (
            <Action.OpenInBrowser title="Open Course" url={course.url} />
          ) : null}
          <Action.Push
            title="Browse Announcements"
            shortcut={{ modifiers: ["cmd", "shift"], key: "a" }}
            target={<CourseAnnouncements course={course} />}
          />
          <Action.Push
            title="Set Course Acronym"
            target={<CourseAcronymForm course={course} onSaved={revalidate} />}
          />
          <Action
            title={course.isPinned ? "Unpin Course" : "Pin Course"}
            shortcut={Keyboard.Shortcut.Common.Pin}
            onAction={async () => {
              await togglePinnedCourse(course.id);
              await showToast({
                style: Toast.Style.Success,
                title: course.isPinned ? "Course unpinned" : "Course pinned",
              });
              revalidate();
            }}
          />
          {course.semesterKey ? (
            <Action
              title="Pin Detected Semester"
              shortcut={{ modifiers: ["cmd", "shift"], key: "p" }}
              onAction={async () => {
                await pinSemesterCourses(
                  rawCourses,
                  course.semesterKey as string,
                );
                await showToast({
                  style: Toast.Style.Success,
                  title: "Semester pinned",
                  message: course.semesterKey,
                });
                revalidate();
              }}
            />
          ) : null}
          <Action.CopyToClipboard
            title="Copy Course ID"
            content={String(course.id)}
          />
        </ActionPanel>
      }
    />
  );
}

function filterCourses(
  courses: DecoratedCourse[],
  filter: CourseFilter,
): DecoratedCourse[] {
  const sortedCourses = [...courses].sort(compareCourses);

  if (filter === "pinned") {
    return sortedCourses.filter((course) => course.isPinned);
  }

  if (filter.startsWith("semester:")) {
    return sortedCourses.filter(
      (course) => course.semesterKey === filter.slice("semester:".length),
    );
  }

  if (filter === "focus") {
    return sortedCourses.filter(
      (course, index) => course.isPinned || index < 8,
    );
  }

  return sortedCourses;
}

function courseAccessories(course: DecoratedCourse): List.Item.Accessory[] {
  const accessories: List.Item.Accessory[] = [];

  if (course.isPinned) {
    accessories.push({ tag: { value: "Pinned", color: Color.Yellow } });
  }

  accessories.push({ text: course.courseAcronym, tooltip: "Course acronym" });

  if (course.semesterKey) {
    accessories.push({ text: course.semesterKey });
  }

  accessories.push({
    text: formatDate(course.lastAccessed) ?? "Never accessed",
  });
  return accessories;
}

function compareCourses(a: DecoratedCourse, b: DecoratedCourse): number {
  return (
    Number(b.isPinned) - Number(a.isPinned) ||
    compareDatesDesc(a.lastAccessed, b.lastAccessed) ||
    a.name.localeCompare(b.name)
  );
}

function compareDatesDesc(a?: string, b?: string): number {
  if (!a && !b) {
    return 0;
  }

  if (!a) {
    return 1;
  }

  if (!b) {
    return -1;
  }

  return b.localeCompare(a);
}
