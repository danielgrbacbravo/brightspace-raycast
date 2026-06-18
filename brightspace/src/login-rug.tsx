import {
  Action,
  ActionPanel,
  Detail,
  Form,
  Icon,
  Toast,
  showToast,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useState } from "react";
import {
  TotpRequiredError,
  getSavedRugCredentials,
  isRugPasswordSaved,
  performRugLogin,
  saveRugCredentials,
  validateSavedRugSession,
  type RugCredentials,
} from "./lib/rug-auth";

interface LoginFormValues {
  username: string;
  password: string;
  totp?: string;
  saveCredentials: boolean;
}

export default function Command() {
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
    "",
    "Use the login form when the session expires. TOTP is only needed when RUG asks for MFA.",
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

function LoginForm({
  credentials,
  onLoggedIn,
}: {
  credentials?: RugCredentials;
  onLoggedIn: () => void;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [totpError, setTotpError] = useState<string>();

  async function submit(values: LoginFormValues): Promise<boolean> {
    setTotpError(undefined);
    setIsSubmitting(true);

    try {
      const loginSession = await performRugLogin({
        tenantUrl: "https://brightspace.rug.nl",
        username: values.username.trim(),
        password: values.password,
        totp: values.totp?.trim(),
      });

      if (values.saveCredentials) {
        await saveRugCredentials({
          username: values.username.trim(),
          password: values.password,
        });
      }

      onLoggedIn();
      await showToast({
        style: Toast.Style.Success,
        title: "Logged in to RUG Brightspace",
        message: displayUser(loginSession.user),
      });
      return true;
    } catch (error) {
      if (error instanceof TotpRequiredError) {
        setTotpError("Enter the current TOTP code.");
        await showToast({
          style: Toast.Style.Failure,
          title: "TOTP required",
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
        title="TOTP"
        placeholder="Only needed for a fresh MFA challenge"
        error={totpError}
      />
      <Form.Checkbox
        id="saveCredentials"
        title="Credentials"
        label="Save password in macOS Keychain"
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
