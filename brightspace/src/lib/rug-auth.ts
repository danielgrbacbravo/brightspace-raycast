import { LocalStorage } from "@raycast/api";
import {
  BrightspaceClient,
  normalizeTenantUrl,
  type User,
} from "./brightspace";
import {
  KeychainUnavailableError,
  readPassword,
  savePassword,
} from "./keychain";
import { generateTotp, normalizeTotpSecret } from "./totp";

const SESSION_KEY = "rug.session";
const USERNAME_KEY = "rug.username";
const KEYCHAIN_SERVICE = "brightspace-raycast-rug";
const TOTP_KEYCHAIN_SERVICE = "brightspace-raycast-rug-totp";
const MAX_AUTH_STEPS = 40;
const DEFAULT_TENANT_URL = "https://brightspace.rug.nl";

const USERNAME_FIELDS = new Set([
  "ecom_user_id",
  "username",
  "user",
  "userid",
  "user_id",
  "j_username",
  "idtoken1",
  "identifier",
]);

const PASSWORD_FIELDS = new Set([
  "ecom_password",
  "password",
  "pass",
  "passwd",
  "j_password",
  "idtoken2",
]);
const MFA_FIELDS = new Set([
  "nffc",
  "totp",
  "otp",
  "token",
  "passcode",
  "code",
  "idtoken3",
]);

interface HtmlForm {
  action: string;
  method: string;
  id: string;
  name: string;
  inputs: Record<string, string>;
}

export interface RugCredentials {
  username: string;
  password: string;
  totpSecret?: string;
}

export interface RugSession {
  tenantUrl: string;
  cookieHeader: string;
  createdAt: string;
  user?: User;
}

interface LoginOptions extends RugCredentials {
  tenantUrl?: string;
  totp?: string;
}

export async function getSavedRugCredentials(): Promise<
  RugCredentials | undefined
> {
  const username = await LocalStorage.getItem<string>(USERNAME_KEY);
  if (!username) {
    return undefined;
  }

  const [password, totpSecret] = await Promise.all([
    readSavedPassword(username),
    readSavedTotpSecret(username),
  ]);
  return { username, password: password ?? "", totpSecret };
}

export async function saveRugCredentials(
  credentials: RugCredentials,
): Promise<void> {
  await LocalStorage.setItem(USERNAME_KEY, credentials.username);
  await savePassword(
    KEYCHAIN_SERVICE,
    credentials.username,
    credentials.password,
  );

  if (credentials.totpSecret?.trim()) {
    await savePassword(
      TOTP_KEYCHAIN_SERVICE,
      credentials.username,
      normalizeTotpSecret(credentials.totpSecret),
    );
  }
}

export async function isRugPasswordSaved(username: string): Promise<boolean> {
  return Boolean(await readSavedPassword(username));
}

export async function isRugTotpSecretSaved(username: string): Promise<boolean> {
  return Boolean(await readSavedTotpSecret(username));
}

async function readSavedPassword(
  username: string,
): Promise<string | undefined> {
  try {
    return await readPassword(KEYCHAIN_SERVICE, username);
  } catch (error) {
    if (error instanceof KeychainUnavailableError) {
      return undefined;
    }

    throw error;
  }
}

async function readSavedTotpSecret(
  username: string,
): Promise<string | undefined> {
  try {
    return await readPassword(TOTP_KEYCHAIN_SERVICE, username);
  } catch (error) {
    if (error instanceof KeychainUnavailableError) {
      return undefined;
    }

    throw error;
  }
}

export async function getSavedRugSession(): Promise<RugSession | undefined> {
  const raw = await LocalStorage.getItem<string>(SESSION_KEY);
  return raw ? (JSON.parse(raw) as RugSession) : undefined;
}

export async function saveRugSession(session: RugSession): Promise<void> {
  await LocalStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export async function clearSavedRugSession(): Promise<void> {
  await LocalStorage.removeItem(SESSION_KEY);
}

export async function validateSavedRugSession(): Promise<
  RugSession | undefined
> {
  const session = await getSavedRugSession();
  if (!session?.cookieHeader) {
    return undefined;
  }

  try {
    const client = new BrightspaceClient({
      tenantUrl: session.tenantUrl,
      cookieHeader: session.cookieHeader,
    });
    const user = await client.whoAmI();
    return { ...session, user };
  } catch {
    await clearSavedRugSession();
    return undefined;
  }
}

export async function performRugLogin(
  options: LoginOptions,
): Promise<RugSession> {
  const tenantUrl = normalizeTenantUrl(options.tenantUrl || DEFAULT_TENANT_URL);
  const jar = new CookieJar();
  let currentUrl = new URL("/d2l/login", tenantUrl).toString();
  let referer = "";
  let usedTotp = Boolean(options.totp?.trim());
  let pendingResponse: AuthResponse | undefined;
  let lastRelaySignature = "";
  let repeatedRelay = 0;
  let lastCredentialSignature = "";
  let repeatedCredentials = 0;

  for (let step = 0; step < MAX_AUTH_STEPS; step += 1) {
    const response =
      pendingResponse ?? (await requestAuth(currentUrl, jar, { referer }));
    pendingResponse = undefined;

    if (isRedirect(response.status)) {
      const location = response.headers.get("location");
      if (!location) {
        throw new Error("RUG auth redirected without a Location header.");
      }

      referer = response.url;
      currentUrl = resolveUrl(response.url, location);
      continue;
    }

    if (response.status >= 400) {
      throw new Error(`RUG auth failed with HTTP ${response.status}.`);
    }

    const nextUrl = fallbackRedirect(response.body, response.url);
    if (nextUrl) {
      referer = response.url;
      currentUrl = nextUrl;
      continue;
    }

    const forms = parseForms(response.body);
    const form = selectForm(forms);
    if (!form) {
      return validateLoggedInSession(tenantUrl, jar);
    }

    const targetUrl = form.action
      ? resolveUrl(response.url, form.action)
      : response.url;
    const method: "GET" | "POST" =
      form.method.toUpperCase() === "GET" ? "GET" : "POST";
    const inputs = { ...form.inputs };
    let stage: "relay" | "credentials" | "mfa" = "relay";
    const usernameFields = findFields(inputs, USERNAME_FIELDS);
    const passwordFields = findFields(inputs, PASSWORD_FIELDS);
    const mfaFields = findFields(inputs, MFA_FIELDS);

    if (usernameFields.length > 0 && passwordFields.length > 0) {
      for (const field of usernameFields) {
        inputs[field] = options.username;
      }
      for (const field of passwordFields) {
        inputs[field] = options.password;
      }
      inputs.option = "credential";
      stage = "credentials";
    } else if (mfaFields.length > 0) {
      const totp = options.totp?.trim() || generatedTotp(options.totpSecret);
      if (!totp) {
        throw new TotpRequiredError();
      }

      for (const field of mfaFields) {
        inputs[field] = totp;
      }
      inputs.option = "credential";
      stage = "mfa";
      usedTotp = true;
    }

    const signature = `${method} ${targetUrl} ${Object.keys(inputs).sort().join(",")}`;
    if (stage === "relay") {
      repeatedRelay = signature === lastRelaySignature ? repeatedRelay + 1 : 0;
      lastRelaySignature = signature;
      if (repeatedRelay >= 3) {
        throw new Error("RUG auth looped on the same relay form.");
      }
    }

    if (stage === "credentials") {
      repeatedCredentials =
        signature === lastCredentialSignature ? repeatedCredentials + 1 : 0;
      lastCredentialSignature = signature;
      if (repeatedCredentials >= 3) {
        if (!usedTotp && !options.totp?.trim() && !options.totpSecret?.trim()) {
          throw new TotpRequiredError();
        }

        throw new Error(
          "RUG auth looped on the credential form. Username, password, or MFA state is likely invalid.",
        );
      }
    }

    if (method === "GET") {
      currentUrl = appendQuery(targetUrl, inputs);
      referer = response.url;
      continue;
    }

    const postResponse = await requestAuth(targetUrl, jar, {
      method: "POST",
      referer: response.url,
      form: inputs,
    });

    if (isRedirect(postResponse.status)) {
      const location = postResponse.headers.get("location");
      if (!location) {
        throw new Error("RUG auth redirected without a Location header.");
      }

      referer = targetUrl;
      currentUrl = resolveUrl(targetUrl, location);
      continue;
    }

    const postRedirect = fallbackRedirect(postResponse.body, targetUrl);
    if (postRedirect) {
      referer = targetUrl;
      currentUrl = postRedirect;
      continue;
    }

    try {
      return await validateLoggedInSession(tenantUrl, jar);
    } catch {
      pendingResponse = postResponse;
      referer = targetUrl;
    }
  }

  throw new Error("RUG login sequence did not complete.");
}

function generatedTotp(secret: string | undefined): string {
  return secret?.trim() ? generateTotp(secret) : "";
}

async function validateLoggedInSession(
  tenantUrl: string,
  jar: CookieJar,
): Promise<RugSession> {
  const cookieHeader = jar.header();
  const client = new BrightspaceClient({ tenantUrl, cookieHeader });
  const user = await client.whoAmI();
  const session = {
    tenantUrl,
    cookieHeader,
    createdAt: new Date().toISOString(),
    user,
  };
  await saveRugSession(session);
  return session;
}

interface AuthResponse {
  status: number;
  headers: Headers;
  body: string;
  url: string;
}

async function requestAuth(
  url: string,
  jar: CookieJar,
  options: {
    method?: "GET" | "POST";
    referer?: string;
    form?: Record<string, string>;
  } = {},
): Promise<AuthResponse> {
  const headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:141.0) Gecko/20100101 Firefox/141.0",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    "Upgrade-Insecure-Requests": "1",
  };

  const cookieHeader = jar.header();
  if (cookieHeader) {
    headers.Cookie = cookieHeader;
  }
  if (options.referer) {
    headers.Referer = options.referer;
    const origin = originFromUrl(options.referer);
    if (origin) {
      headers.Origin = origin;
    }
  }

  const body = options.form
    ? new URLSearchParams(options.form).toString()
    : undefined;
  if (body) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  }

  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers,
    body,
    redirect: "manual",
  });
  jar.store(response.headers);

  return {
    status: response.status,
    headers: response.headers,
    body: await response.text(),
    url,
  };
}

class CookieJar {
  private readonly cookies = new Map<string, string>();

  store(headers: Headers): void {
    for (const cookie of getSetCookies(headers)) {
      const firstPart = cookie.split(";")[0];
      const separatorIndex = firstPart.indexOf("=");
      if (separatorIndex <= 0) {
        continue;
      }

      const name = firstPart.slice(0, separatorIndex).trim();
      const value = firstPart.slice(separatorIndex + 1).trim();
      if (value) {
        this.cookies.set(name, value);
      } else {
        this.cookies.delete(name);
      }
    }
  }

  header(): string {
    return [...this.cookies]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }
}

function getSetCookies(headers: Headers): string[] {
  const withGetSetCookie = headers as Headers & {
    getSetCookie?: () => string[];
  };
  const values = withGetSetCookie.getSetCookie?.();
  if (values?.length) {
    return values;
  }

  const combined = headers.get("set-cookie");
  return combined ? combined.split(/,(?=\s*[^;,]+=)/) : [];
}

export class TotpRequiredError extends Error {
  constructor() {
    super("TOTP is required to complete RUG login.");
    this.name = "TotpRequiredError";
  }
}

function parseForms(html: string): HtmlForm[] {
  const forms: HtmlForm[] = [];
  const formPattern = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  let formMatch: RegExpExecArray | null;

  while ((formMatch = formPattern.exec(html))) {
    const attrs = parseAttributes(formMatch[1] ?? "");
    const body = formMatch[2] ?? "";
    const inputs: Record<string, string> = {};
    const inputPattern = /<(input|button)\b([^>]*)>/gi;
    let inputMatch: RegExpExecArray | null;

    while ((inputMatch = inputPattern.exec(body))) {
      const inputAttrs = parseAttributes(inputMatch[2] ?? "");
      const name = inputAttrs.name?.trim();
      if (name) {
        inputs[name] = inputAttrs.value ?? "";
      }
    }

    forms.push({
      action: decodeHtml(attrs.action ?? ""),
      method: attrs.method ?? "GET",
      id: attrs.id ?? "",
      name: attrs.name ?? "",
      inputs,
    });
  }

  return forms;
}

function parseAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrPattern =
    /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null;

  while ((match = attrPattern.exec(raw))) {
    attrs[match[1].toLowerCase()] = decodeHtml(
      match[2] ?? match[3] ?? match[4] ?? "",
    );
  }

  return attrs;
}

function selectForm(forms: HtmlForm[]): HtmlForm | undefined {
  for (const form of forms) {
    const formId = normalizeFieldName(form.id);
    const formName = normalizeFieldName(form.name);
    if (formId === "idplogin" || formName === "idplogin") {
      return form;
    }
    if ("Ecom_User_ID" in form.inputs && "Ecom_Password" in form.inputs) {
      return form;
    }
  }

  for (const form of forms) {
    if (
      findFields(form.inputs, USERNAME_FIELDS).length > 0 ||
      findFields(form.inputs, PASSWORD_FIELDS).length > 0 ||
      findFields(form.inputs, MFA_FIELDS).length > 0
    ) {
      return form;
    }
  }

  return forms[0];
}

function findFields(
  inputs: Record<string, string>,
  candidates: Set<string>,
): string[] {
  const exact: string[] = [];
  const fuzzy: string[] = [];

  for (const key of Object.keys(inputs)) {
    const normalized = normalizeFieldName(key);
    if (candidates.has(normalized)) {
      exact.push(key);
    } else if (
      [...candidates].some((candidate) => normalized.includes(candidate))
    ) {
      fuzzy.push(key);
    }
  }

  return exact.length > 0 ? exact : fuzzy;
}

function normalizeFieldName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function fallbackRedirect(body: string, currentUrl: string): string {
  const patterns = [
    /<meta[^>]+http-equiv=["']refresh["'][^>]+content=["']\d+;\s*url=([^"']+)["']/i,
    /content=["']\d+;\s*url=([^"']+)["'][^>]+http-equiv=["']refresh["']/i,
    /window\.location(?:\.href)?\s*=\s*["']([^"']+)["']/i,
    /href=["'](https?:[^"']*SAMLRequest=[^"']+)["']/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(body);
    if (match?.[1]) {
      return resolveUrl(currentUrl, decodeHtml(match[1]));
    }
  }

  return "";
}

function appendQuery(url: string, values: Record<string, string>): string {
  const parsed = new URL(url);
  for (const [key, value] of Object.entries(values)) {
    parsed.searchParams.set(key, value);
  }
  return parsed.toString();
}

function resolveUrl(currentUrl: string, location: string): string {
  return new URL(decodeHtml(location.trim()), currentUrl).toString();
}

function originFromUrl(url: string): string {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}`;
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
