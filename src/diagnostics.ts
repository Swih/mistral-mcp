import { defaultChatModel } from "./models.js";
import { toolsForProfile, type RuntimeConfig } from "./profile.js";

/** Local configuration only: discovery and rate-limit entitlement are different facts. */
export function configurationReport(runtime: RuntimeConfig, hasKey: boolean) {
  const url = new URL(runtime.baseUrl ?? "https://api.mistral.ai");
  return {
    profile: runtime.profile,
    endpoint: `${url.origin}${url.pathname}`,
    api_key_configured: hasKey,
    default_chat_model: defaultChatModel(),
    exposed_tools: toolsForProfile(runtime.profile),
    api_access: "not_probed",
    quota: "unknown",
    note: "No API calls were made. An exposed tool or a listed model does not prove account access, quota or free usage. Review your provider's account limits before live tests.",
  };
}
