import "./providers/register-builtins.js";
import { getApiProvider } from "./api-registry.js";
import { getEnvApiKey } from "./env-api-keys.js";
export { getEnvApiKey } from "./env-api-keys.js";
function hasExplicitApiKey(apiKey) {
    return typeof apiKey === "string" && apiKey.trim().length > 0;
}
function withEnvApiKey(model, options) {
    if (hasExplicitApiKey(options?.apiKey))
        return options;
    const apiKey = getEnvApiKey(model.provider, options?.env);
    if (!apiKey)
        return options;
    return { ...options, apiKey };
}
function resolveApiProvider(api) {
    const provider = getApiProvider(api);
    if (!provider) {
        throw new Error(`No API provider registered for api: ${api}`);
    }
    return provider;
}
export function stream(model, context, options) {
    const provider = resolveApiProvider(model.api);
    return provider.stream(model, context, withEnvApiKey(model, options));
}
export async function complete(model, context, options) {
    const s = stream(model, context, options);
    return s.result();
}
export function streamSimple(model, context, options) {
    const provider = resolveApiProvider(model.api);
    return provider.streamSimple(model, context, withEnvApiKey(model, options));
}
export async function completeSimple(model, context, options) {
    const s = streamSimple(model, context, options);
    return s.result();
}
//# sourceMappingURL=stream.js.map