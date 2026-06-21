import { getPreferenceValues } from "@raycast/api";

export interface Preferences {
  tenantUrl: string;
  cookieHeader?: string;
  bearerToken?: string;
  lpVersion?: string;
  leVersion?: string;
  acronymCleanupRegex?: string;
}

export function getBrightspacePreferences(): Preferences {
  return getPreferenceValues<Preferences>();
}
