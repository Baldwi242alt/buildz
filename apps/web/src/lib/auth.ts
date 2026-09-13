import { createClient } from "@supabase/supabase-js";
import { config } from "./config";

// Supabase is used only for Auth. Business data uses the generated BuildZ SDK.
export const auth =
  config.authUrl && config.authPublishableKey
    ? createClient(config.authUrl, config.authPublishableKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      }).auth
    : null;
