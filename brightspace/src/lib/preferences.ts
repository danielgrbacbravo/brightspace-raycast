import { getPreferenceValues } from "@raycast/api";

export interface Preferences {
  tenantUrl: string;
  cookieHeader?: string;
  bearerToken?: string;
  lpVersion?: string;
  leVersion?: string;
  acronymCleanupRegex?: string;
  showContentDueTags?: boolean;
  showContentCompletionTags?: boolean;
  showContentExemptionTags?: boolean;
  showContentAvailabilityTags?: boolean;
  showContentTypeTags?: boolean;
}

export function getBrightspacePreferences(): Preferences {
  return getPreferenceValues<Preferences>();
}
