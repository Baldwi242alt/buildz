import { createClient } from "@supabase/supabase-js";
import { config } from "./config";
import { authFetch } from "./authEmailFeedback";

// Supabase is used only for Auth. Business data uses the generated BuildZ SDK.
export const auth =
  config.authUrl && config.authPublishableKey
    ? createClient(config.authUrl, config.authPublishableKey, {
        global: { fetch: authFetch },
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      }).auth
    : null;
