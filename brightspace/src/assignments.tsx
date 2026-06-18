import { Action, ActionPanel, Color, Icon, List } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useState } from "react";
import { formatDate } from "./lib/brightspace";
import { createAuthenticatedBrightspaceClient } from "./lib/client-factory";

export default function Command() {
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

  const { data: assignments, isLoading: isLoadingAssignments } = usePromise(
    async (courseId?: string) => {
      if (!courseId) {
        return [];
      }

      const client = await createAuthenticatedBrightspaceClient();
      return client.getDropboxFolders(courseId);
    },
    [selectedCourseId],
    { execute: Boolean(selectedCourseId) },
  );

  return (
    <List
      isLoading={isLoadingCourses || isLoadingAssignments}
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
      {assignments?.map((assignment) => (
        <List.Item
          key={assignment.Id}
          icon={Icon.Pencil}
          title={assignment.Name}
          subtitle={
            formatDate(assignment.DueDate)
              ? `Due ${formatDate(assignment.DueDate)}`
              : undefined
          }
          accessories={[
            assignment.IsHidden
              ? { tag: { value: "Hidden", color: Color.Yellow } }
              : { tag: { value: "Visible", color: Color.Green } },
          ]}
          actions={
            <ActionPanel>
              <Action.CopyToClipboard
                title="Copy Assignment ID"
                content={String(assignment.Id)}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
