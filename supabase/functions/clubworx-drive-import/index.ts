import { cloudDriveHandler } from "./shared/cloud-drive.js";
const url = Deno.env.get("SUPABASE_URL");
const key =
  JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default ||
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !key) throw Error("Server configuration unavailable");
const api = async (path, body?) => {
  const headers: Record<string, string> = {
    apikey: key,
    "Content-Type": "application/json",
  };
  if (!key.startsWith("sb_secret_")) headers.Authorization = "Bearer " + key;
  const response = await fetch(url + "/rest/v1/" + path, {
    method: body === undefined ? "GET" : "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => ({}));
    throw Error(
      failure.code === "40001"
        ? "Reports changed; reload context and retry later"
        : "Database request failed",
    );
  }
  return response.json();
};
Deno.serve(cloudDriveHandler(api));
