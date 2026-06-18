import { BrightspaceClient } from "./brightspace";
import { getBrightspacePreferences } from "./preferences";
import { validateSavedRugSession } from "./rug-auth";

export async function createAuthenticatedBrightspaceClient(): Promise<BrightspaceClient> {
  const preferences = getBrightspacePreferences();
  const savedSession = await validateSavedRugSession();

  return new BrightspaceClient({
    ...preferences,
    tenantUrl: savedSession?.tenantUrl ?? preferences.tenantUrl,
    cookieHeader: savedSession?.cookieHeader ?? preferences.cookieHeader,
  });
}
