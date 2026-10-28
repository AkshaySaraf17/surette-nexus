/**
 * Site identity. While DEMO is on (the default), every page is labelled as a demo, search engines are
 * asked not to index it, and the footer says it isn't the official website.
 *
 * To turn the label off later (for example once Surette Real Estate adopts the site), build with
 * NEXT_PUBLIC_SITE_DEMO=false — in Docker: SITE_DEMO=false in .env, then `docker compose up -d --build`.
 */
export const DEMO = process.env.NEXT_PUBLIC_SITE_DEMO !== "false";
export const BRAND = "Surette Real Estate";
/** The team's brokerage, shown with the name as on surette-realestate.com ("Surette Real Estate Team at eXp Realty"). */
export const BROKERAGE = "eXp Realty";
export const SITE_NAME = DEMO ? `${BRAND} Demo` : BRAND;
/** Accessible name of the logo link; it contains the visible wordmark text ("Surette Real Estate at eXp Realty Demo"). */
export const HOME_LABEL = `${BRAND} at ${BROKERAGE}${DEMO ? " Demo" : ""} home`;
