import {
  Action,
  ActionPanel,
  Detail,
  Form,
  Icon,
  Toast,
  showToast,
  useNavigation,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useState, type ReactNode } from "react";
import { getBrightspacePreferences } from "./preferences";
import {
  TotpRequiredError,
  getSavedRugCredentials,
  isRugPasswordSaved,
  isRugTotpSecretSaved,
  performRugLogin,
  saveRugCredentials,
  validateSavedRugSession,
  type RugCredentials,
} from "./rug-auth";

interface LoginFormValues {
  username: string;
  password: string;
  totp?: string;
  totpSecret?: string;
  saveCredentials: boolean;
}

export function AuthenticatedCommand({ children }: { children: ReactNode }) {
  const preferences = getBrightspacePreferences();
  const hasPreferenceAuth = Boolean(
    preferences.bearerToken?.trim() || preferences.cookieHeader?.trim(),
  );
  const {
    data: credentials,
    isLoading: isLoadingCredentials,
    revalidate: reloadCredentials,
  } = usePromise(getSavedRugCredentials);
  const {
    data: session,
    isLoading: isLoadingSession,
    revalidate: reloadSession,
  } = usePromise(validateSavedRugSession, [], {
    execute: !hasPreferenceAuth,
  });
  const {
    data: renewedSession,
    isLoading: isRenewingSession,
    revalidate: renewSession,
  } = usePromise(
    async (savedCredentials?: RugCredentials) => {
      if (
        hasPreferenceAuth ||
        session ||
        !savedCredentials?.username ||
        !savedCredentials.password ||
        !savedCredentials.totpSecret
      ) {
        return undefined;
      }

      return performRugLogin({
        tenantUrl: "https://brightspace.rug.nl",
        username: savedCredentials.username,
        password: savedCredentials.password,
        totpSecret: savedCredentials.totpSecret,
      });
    },
    [credentials],
    {
      execute: !hasPreferenceAuth && !session && Boolean(credentials),
      onError: () => undefined,
    },
  );

  if (hasPreferenceAuth || session || renewedSession) {
    return <>{children}</>;
  }

  if (isLoadingCredentials || isLoadingSession || isRenewingSession) {
    return <Detail isLoading markdown="" />;
  }

  return (
    <Detail
      markdown={[
        "# Brightspace Login Required",
        "",
        "No active RUG Brightspace session was found.",
        "",
        "Log in here to continue to this command.",
      ].join("\n")}
      actions={
        <ActionPanel>
          <Action.Push
            icon={Icon.Lock}
            title="Log in"
            target={
              <LoginForm
                credentials={credentials}
                onLoggedIn={() => {
                  reloadCredentials();
                  reloadSession();
                  renewSession();
                }}
              />
            }
          />
        </ActionPanel>
      }
    />
  );
}

export function RugLoginStatus() {
  const {
    data: credentials,
    isLoading: isLoadingCredentials,
    revalidate: reloadCredentials,
  } = usePromise(getSavedRugCredentials);
  const {
    data: session,
    isLoading: isLoadingSession,
    revalidate: reloadSession,
  } = usePromise(validateSavedRugSession);
  const { data: hasSavedPassword } = usePromise(
    async (username?: string) => {
      return username ? isRugPasswordSaved(username) : false;
    },
    [credentials?.username],
  );
  const { data: hasSavedTotpSecret } = usePromise(
    async (username?: string) => {
      return username ? isRugTotpSecretSaved(username) : false;
    },
    [credentials?.username],
  );

  const markdown = [
    "# University of Groningen Login",
    "",
    session
      ? `Signed in as **${displayUser(session.user)}**.`
      : "No valid Brightspace session is active.",
    "",
    credentials?.username
      ? `Saved username: **${credentials.username}**`
      : "No username saved.",
    hasSavedPassword
      ? "Password is saved in macOS Keychain."
      : "No Keychain password is saved.",
    hasSavedTotpSecret
      ? "2FA setup key is saved in macOS Keychain."
      : "No 2FA setup key is saved.",
    "",
    "With a saved password and 2FA setup key, the extension can renew the session in the background.",
  ].join("\n");

  return (
    <Detail
      isLoading={isLoadingCredentials || isLoadingSession}
      markdown={markdown}
      actions={
        <ActionPanel>
          <Action.Push
            icon={Icon.Lock}
            title={session ? "Renew Session" : "Log in"}
            target={
              <LoginForm
                credentials={credentials}
                onLoggedIn={() => {
                  reloadCredentials();
                  reloadSession();
                }}
              />
            }
          />
        </ActionPanel>
      }
    />
  );
}

export function LoginForm({
  credentials,
  onLoggedIn,
}: {
  credentials?: RugCredentials;
  onLoggedIn: () => void;
}) {
  const { pop } = useNavigation();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [totpError, setTotpError] = useState<string>();
  const [needsTotp, setNeedsTotp] = useState(false);

  async function submit(values: LoginFormValues): Promise<boolean> {
    setTotpError(undefined);
    setIsSubmitting(true);

    try {
      const loginSession = await performRugLogin({
        tenantUrl: "https://brightspace.rug.nl",
        username: values.username.trim(),
        password: values.password,
        totp: values.totp?.trim(),
        totpSecret: values.totpSecret?.trim() || credentials?.totpSecret,
      });

      if (values.saveCredentials) {
        await saveRugCredentials({
          username: values.username.trim(),
          password: values.password,
          totpSecret: values.totpSecret?.trim() || credentials?.totpSecret,
        });
      }

      onLoggedIn();
      await showToast({
        style: Toast.Style.Success,
        title: "Logged in to RUG Brightspace",
        message: displayUser(loginSession.user),
      });
      pop();
      return true;
    } catch (error) {
      if (error instanceof TotpRequiredError) {
        setNeedsTotp(true);
        setTotpError("Enter the current 2FA code.");
        await showToast({
          style: Toast.Style.Failure,
          title: "2FA code required",
          message: "Enter the current RUG authenticator code.",
        });
        return false;
      }

      await showToast({
        style: Toast.Style.Failure,
        title: "RUG login failed",
        message: error instanceof Error ? error.message : String(error),
      });
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Form
      isLoading={isSubmitting}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Log in" onSubmit={submit} />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="username"
        title="Username"
        defaultValue={credentials?.username}
        autoFocus={!credentials?.username}
      />
      <Form.PasswordField
        id="password"
        title="Password"
        defaultValue={credentials?.password}
      />
      <Form.TextField
        id="totp"
        title="2FA Code"
        placeholder={
          needsTotp ? "Required for this login" : "Optional manual code"
        }
        error={totpError}
      />
      <Form.PasswordField
        id="totpSecret"
        title="2FA Setup Key"
        placeholder={
          credentials?.totpSecret
            ? "Saved. Leave empty to keep it."
            : "Paste authenticator setup key"
        }
        info="Paste the base32 setup key or otpauth:// URI from your authenticator setup. The extension uses it to generate 2FA codes locally."
      />
      <Form.Checkbox
        id="saveCredentials"
        title="Credentials"
        label="Save password and 2FA setup key in macOS Keychain"
        defaultValue
      />
    </Form>
  );
}

function displayUser(
  user:
    | { FirstName?: string; LastName?: string; UniqueName?: string }
    | undefined,
): string {
  const name = [user?.FirstName, user?.LastName].filter(Boolean).join(" ");
  return name || user?.UniqueName || "Session validated";
}
