import { AIConfigError } from "./errors";

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
  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch (error) {
    throw new AIConfigError("Invalid AI base URL", error);
  }
  const permissions = getPermissions();
  if (!permissions?.contains || !permissions.request) return;
  const pattern = `${origin}/*`;
  if (await permissions.contains({ origins: [pattern] })) return;
  const granted = await permissions.request({ origins: [pattern] });
  if (!granted) throw new AIConfigError("需要允许访问已配置的 AI 服务地址");
}
