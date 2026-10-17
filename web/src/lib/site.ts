/**
 * Site identity. While DEMO is on (the default), every page is labelled as a demo, search engines are
 * asked not to index it, and the footer says it isn't the official website.
 *
 * To turn the label off later (for example once Surette Real Estate adopts the site), build with
 * NEXT_PUBLIC_SITE_DEMO=false — in Docker: SITE_DEMO=false in .env, then `docker compose up -d --build`.
 */
export const DEMO = process.env.NEXT_PUBLIC_SITE_DEMO !== "false";
export const BRAND = "Surette Real Estate";
export const SITE_NAME = DEMO ? `${BRAND} Demo` : BRAND;
