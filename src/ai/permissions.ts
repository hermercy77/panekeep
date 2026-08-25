import { AIConfigError } from "./errors";
import { getAppLanguage, translate } from "../i18n";

interface PermissionsLike {
  contains?: (details: { origins: string[] }) => Promise<boolean>;
  request?: (details: { origins: string[] }) => Promise<boolean>;
}

function getPermissions(): PermissionsLike | undefined {
  const scope = globalThis as typeof globalThis & {
    chrome?: { permissions?: PermissionsLike };
    browser?: { permissions?: PermissionsLike };
  };
  return scope.chrome?.permissions ?? scope.browser?.permissions;
}

/** Request only the configured AI origin, never a broad all-URL grant. */
export async function ensureAIOriginPermission(baseUrl: string): Promise<void> {
  let pattern: string;
  try {
    const url = new URL(baseUrl);
    // Chrome match patterns cover every port for a host and do not include an
    // explicit port component, including local model servers.
    pattern = `${url.protocol}//${url.hostname}/*`;
  } catch (error) {
    throw new AIConfigError(translate(getAppLanguage(), "ai.invalidBaseUrl"), error);
  }
  const permissions = getPermissions();
  if (!permissions?.contains || !permissions.request) return;
  if (await permissions.contains({ origins: [pattern] })) return;
  const granted = await permissions.request({ origins: [pattern] });
  if (!granted) throw new AIConfigError(translate(getAppLanguage(), "ai.permissionRequired"));
}
