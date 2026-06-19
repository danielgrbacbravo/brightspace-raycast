import { Action, ActionPanel, Icon, List } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useState } from "react";
import { formatGrade } from "./lib/brightspace";
import { createAuthenticatedBrightspaceClient } from "./lib/client-factory";
import { AuthenticatedCommand } from "./lib/rug-login-view";

export default function Command() {
  return (
    <AuthenticatedCommand>
      <GradesCommand />
    </AuthenticatedCommand>
  );
}

function GradesCommand() {
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

  const { data: grades, isLoading: isLoadingGrades } = usePromise(
    async (courseId?: string) => {
      if (!courseId) {
        return [];
      }

      const client = await createAuthenticatedBrightspaceClient();
      return client.getMyGradeValues(courseId);
    },
    [selectedCourseId],
    { execute: Boolean(selectedCourseId) },
  );

  return (
    <List
      isLoading={isLoadingCourses || isLoadingGrades}
      searchBarPlaceholder="Search grades"
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
      {grades?.map((grade) => (
        <List.Item
          key={String(grade.GradeObjectIdentifier)}
          icon={Icon.BarChart}
          title={grade.GradeObjectName ?? "Unnamed grade item"}
          accessories={[{ text: formatGrade(grade) }]}
          actions={
            <ActionPanel>
              <Action.CopyToClipboard
                title="Copy Grade"
                content={formatGrade(grade)}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
