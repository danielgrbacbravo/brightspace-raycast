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

  const { data: quizzes, isLoading: isLoadingQuizzes } = usePromise(
    async (courseId?: string) => {
      if (!courseId) {
        return [];
      }

      const client = await createAuthenticatedBrightspaceClient();
      return client.getQuizzes(courseId);
    },
    [selectedCourseId],
    { execute: Boolean(selectedCourseId) },
  );

  return (
    <List
      isLoading={isLoadingCourses || isLoadingQuizzes}
      searchBarPlaceholder="Search quizzes"
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
      {quizzes?.map((quiz) => (
        <List.Item
          key={quiz.QuizId ?? quiz.Id}
          icon={Icon.QuestionMark}
          title={quiz.Name}
          subtitle={
            formatDate(quiz.DueDate)
              ? `Due ${formatDate(quiz.DueDate)}`
              : undefined
          }
          accessories={[
            quiz.IsActive === false
              ? { tag: { value: "Inactive", color: Color.SecondaryText } }
              : { tag: { value: "Active", color: Color.Green } },
          ]}
          actions={
            <ActionPanel>
              <Action.CopyToClipboard
                title="Copy Quiz ID"
                content={String(quiz.QuizId ?? quiz.Id)}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
