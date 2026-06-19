import {
  Action,
  ActionPanel,
  Color,
  Icon,
  Keyboard,
  List,
  Toast,
  showToast,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useState } from "react";
import { formatDate, type Course } from "./lib/brightspace";
import { createAuthenticatedBrightspaceClient } from "./lib/client-factory";
import { AuthenticatedCommand } from "./lib/rug-login-view";
import {
  decorateCourses,
  getCourseSettings,
  listSemesterKeys,
  pinSemesterCourses,
  setCurrentSemester,
  togglePinnedCourse,
  type DecoratedCourse,
} from "./lib/course-settings";

type CourseFilter =
  | "focus"
  | "pinned"
  | "current"
  | "all"
  | `semester:${string}`;

interface CourseData {
  courses: DecoratedCourse[];
  rawCourses: Course[];
  semesterKeys: string[];
}

export default function Command() {
  return (
    <AuthenticatedCommand>
      <CoursesView />
    </AuthenticatedCommand>
  );
}

function CoursesView() {
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
          <List.Dropdown.Item title="Current Semester" value="current" />
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
          icon={Icon.Book}
          title="No Courses"
          description="No courses match this filter."
        />
      ) : null}
      {filter === "focus" ? (
        <>
          <CourseSection
            title="Pinned"
            courses={visibleCourses.filter((course) => course.isPinned)}
            rawCourses={data?.rawCourses ?? []}
            revalidate={revalidate}
          />
          <CourseSection
            title="Current Semester"
            courses={visibleCourses.filter(
              (course) => !course.isPinned && course.isCurrentSemester,
            )}
            rawCourses={data?.rawCourses ?? []}
            revalidate={revalidate}
          />
          <CourseSection
            title="Recent"
            courses={visibleCourses.filter(
              (course) => !course.isPinned && !course.isCurrentSemester,
            )}
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
      icon={course.isPinned ? Icon.Pin : Icon.Book}
      title={course.name}
      subtitle={course.code}
      accessories={courseAccessories(course)}
      actions={
        <ActionPanel>
          {course.url ? (
            <Action.OpenInBrowser title="Open Course" url={course.url} />
          ) : null}
          <Action
            icon={course.isPinned ? Icon.PinDisabled : Icon.Pin}
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
              icon={Icon.Calendar}
              title="Set Current Semester"
              shortcut={{ modifiers: ["cmd", "shift"], key: "s" }}
              onAction={async () => {
                await setCurrentSemester(course.semesterKey as string);
                await showToast({
                  style: Toast.Style.Success,
                  title: "Current semester set",
                  message: course.semesterKey,
                });
                revalidate();
              }}
            />
          ) : null}
          {course.semesterKey ? (
            <Action
              icon={Icon.Pin}
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
  if (filter === "pinned") {
    return courses.filter((course) => course.isPinned);
  }

  if (filter === "current") {
    return courses.filter((course) => course.isCurrentSemester);
  }

  if (filter.startsWith("semester:")) {
    return courses.filter(
      (course) => course.semesterKey === filter.slice("semester:".length),
    );
  }

  if (filter === "focus") {
    return courses.filter(
      (course, index) =>
        course.isPinned || course.isCurrentSemester || index < 8,
    );
  }

  return courses;
}

function courseAccessories(course: DecoratedCourse): List.Item.Accessory[] {
  const accessories: List.Item.Accessory[] = [];

  if (course.isPinned) {
    accessories.push({ tag: { value: "Pinned", color: Color.Yellow } });
  }

  if (course.isCurrentSemester) {
    accessories.push({ tag: { value: "Current", color: Color.Green } });
  } else if (course.semesterKey) {
    accessories.push({ text: course.semesterKey });
  }

  accessories.push({
    text: formatDate(course.lastAccessed) ?? "Never accessed",
  });
  return accessories;
}
