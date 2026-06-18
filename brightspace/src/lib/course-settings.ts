import { LocalStorage } from "@raycast/api";
import type { Course } from "./brightspace";

const SETTINGS_KEY = "course.settings";

export interface CourseSettings {
  pinnedCourseIds: string[];
  currentSemesterKey?: string;
  courseAcronyms?: Record<string, string>;
}

export interface DecoratedCourse extends Course {
  isPinned: boolean;
  isCurrentSemester: boolean;
  semesterKey?: string;
  courseAcronym: string;
  automaticCourseAcronym: string;
}

export async function getCourseSettings(): Promise<CourseSettings> {
  const raw = await LocalStorage.getItem<string>(SETTINGS_KEY);
  if (!raw) {
    return { pinnedCourseIds: [] };
  }

  return JSON.parse(raw) as CourseSettings;
}

export async function saveCourseSettings(
  settings: CourseSettings,
): Promise<void> {
  await LocalStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export async function togglePinnedCourse(
  courseId: number | string,
): Promise<void> {
  const settings = await getCourseSettings();
  const id = String(courseId);
  const isPinned = settings.pinnedCourseIds.includes(id);

  await saveCourseSettings({
    ...settings,
    pinnedCourseIds: isPinned
      ? settings.pinnedCourseIds.filter((pinnedId) => pinnedId !== id)
      : [...settings.pinnedCourseIds, id],
  });
}

export async function pinSemesterCourses(
  courses: Course[],
  semesterKey: string,
): Promise<void> {
  const settings = await getCourseSettings();
  const ids = new Set(settings.pinnedCourseIds);

  for (const course of courses) {
    if (deriveSemesterKey(course) === semesterKey) {
      ids.add(String(course.id));
    }
  }

  await saveCourseSettings({
    ...settings,
    pinnedCourseIds: [...ids],
    currentSemesterKey: semesterKey,
  });
}

export async function setCurrentSemester(semesterKey: string): Promise<void> {
  const settings = await getCourseSettings();
  await saveCourseSettings({ ...settings, currentSemesterKey: semesterKey });
}

export async function setCourseAcronym(
  courseId: number | string,
  acronym: string,
): Promise<void> {
  const settings = await getCourseSettings();
  const id = String(courseId);
  const trimmed = acronym.trim();
  const courseAcronyms = { ...(settings.courseAcronyms ?? {}) };

  if (trimmed) {
    courseAcronyms[id] = trimmed;
  } else {
    delete courseAcronyms[id];
  }

  await saveCourseSettings({ ...settings, courseAcronyms });
}

export async function clearCourseAcronym(
  courseId: number | string,
): Promise<void> {
  await setCourseAcronym(courseId, "");
}

export function decorateCourses(
  courses: Course[],
  settings: CourseSettings,
): DecoratedCourse[] {
  const pinnedIds = new Set(settings.pinnedCourseIds);

  return courses.map((course) => {
    const semesterKey = deriveSemesterKey(course);
    const automaticCourseAcronym = deriveCourseAcronym(course);

    return {
      ...course,
      semesterKey,
      automaticCourseAcronym,
      courseAcronym:
        settings.courseAcronyms?.[String(course.id)] ?? automaticCourseAcronym,
      isPinned: pinnedIds.has(String(course.id)),
      isCurrentSemester: Boolean(
        semesterKey && semesterKey === settings.currentSemesterKey,
      ),
    };
  });
}

export function deriveCourseAcronym(course: Course): string {
  const fromName = acronymFromText(course.name);
  if (fromName) {
    return fromName;
  }

  const fromCode = acronymFromText(course.code ?? "");
  return fromCode || String(course.id);
}

export function deriveSemesterKey(course: Course): string | undefined {
  const value = `${course.code ?? ""} ${course.name}`.trim();
  const academicYear = findAcademicYear(value);
  const semester = findSemester(value);
  const block = findBlock(value);

  if (academicYear && semester) {
    return `${academicYear} S${semester}`;
  }

  if (academicYear && block) {
    return `${academicYear} Block ${block}`;
  }

  return academicYear;
}

export function listSemesterKeys(courses: Course[]): string[] {
  return [
    ...new Set(courses.map(deriveSemesterKey).filter(Boolean) as string[]),
  ]
    .sort()
    .reverse();
}

function findAcademicYear(value: string): string | undefined {
  const fullYear = /\b(20\d{2})\s*[-/]\s*(20\d{2})\b/.exec(value);
  if (fullYear) {
    return `${fullYear[1]}-${fullYear[2]}`;
  }

  const shortYear = /\b(20\d{2})\s*[-/]\s*(\d{2})\b/.exec(value);
  if (shortYear) {
    return `${shortYear[1]}-20${shortYear[2]}`;
  }

  const singleYear = /\b(20\d{2})\b/.exec(value);
  return singleYear?.[1];
}

function findSemester(value: string): string | undefined {
  const match = /\b(?:semester|sem|s)\s*([12])\b/i.exec(value);
  return match?.[1];
}

function findBlock(value: string): string | undefined {
  const match = /\b(?:block|blok|period)\s*([1-4])\b/i.exec(value);
  return match?.[1];
}

function acronymFromText(value: string): string {
  const cleaned = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b20\d{2}\s*[-/]\s*(?:20)?\d{2}\b/g, " ")
    .replace(/\b20\d{2}\b/g, " ")
    .replace(/\b(?:semester|sem|block|blok|period)\s*[1-4]\b/gi, " ")
    .replace(/\b[A-Z]{2,}\d+[A-Z0-9.-]*\b/g, " ");
  const tokens = cleaned
    .split(/[^A-Za-z0-9]+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !/^\d+$/.test(token))
    .filter((token) => !COURSE_ACRONYM_STOP_WORDS.has(token.toLowerCase()));

  if (tokens.length === 0) {
    return "";
  }

  const explicitAcronym = tokens.find((token) => /^[A-Z]{2,6}$/.test(token));
  if (explicitAcronym) {
    return explicitAcronym;
  }

  return tokens
    .slice(0, 6)
    .map((token) => token[0]?.toUpperCase() ?? "")
    .join("");
}

const COURSE_ACRONYM_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "by",
  "course",
  "de",
  "der",
  "een",
  "en",
  "for",
  "het",
  "in",
  "la",
  "of",
  "on",
  "the",
  "to",
  "van",
  "voor",
  "with",
]);
