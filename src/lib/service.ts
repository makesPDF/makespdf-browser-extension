/** The makesPDF service this extension talks to. */
export const SERVICE_URL = "https://makespdf.com";

/** Where a user creates an account (anonymous renders need none). */
export const SIGNUP_URL = `${SERVICE_URL}/signup`;

/** Where a user mints an API key for keyed (untracked-limit) renders. */
export const API_KEYS_URL = `${SERVICE_URL}/settings/api-keys`;

/** The Markdown → PDF endpoint (`POST`, JSON in, PDF bytes out). */
export const MD_ENDPOINT = `${SERVICE_URL}/api/v1/md`;
