# Off-market alerts on another website (e.g. the team's Lofty site)

The off-market sign-up (`/off-market`) is also available on its own, without the site's header
and footer, at `/embed/off-market`. Any website that accepts HTML can show it in a frame, and
every sign-up arrives in the portal under **Leads** with the source **Off-market alert** and the
buyer's wish list (home styles, towns, budget, bedrooms, timeframe).

## The code to paste

```html
<iframe
  src="https://surette-demo.duckdns.org/embed/off-market"
  title="Off-market home alerts"
  style="width:100%;max-width:760px;height:1150px;border:0;"
  loading="lazy"></iframe>
```

Change the address if the site moves to a different domain. 1150 px tall fits the whole form on a
phone; use about 950 px if the page is wide.

## Adding it in Lofty

Lofty's page editor has an **Embed Block** for exactly this
([Lofty help: Embed Block](https://help.lofty.com/hc/en-us/articles/53174322595611-Embed-Block-Lofty-AOS)):

1. In Lofty's website editor, save a website version first (Lofty recommends this before adding custom code).
2. Open the page (or create a new one such as "Off-Market Homes").
3. Drag an **Embed** block onto the page, double-click it, and paste the code above.
4. Publish, then open the page and send yourself a test sign-up.
5. Check the portal's **Leads** page: the test appears as *Off-market alert*. Delete it afterwards.

## Security

Only `/embed/*` pages may be framed by other sites; every other page sends
`X-Frame-Options: SAMEORIGIN` and `frame-ancestors 'self'`, so it can't be framed by anyone else.
To allow only specific sites, set `EMBED_ALLOWED_ORIGINS` when building the image, for example
`EMBED_ALLOWED_ORIGINS="https://www.surette-realestate.com"`. Without it, any HTTPS site may frame
the form. That's harmless for a public sign-up form, but tighter is better.

The form asks for consent before anything is sent, has the same spam honeypot and rate limit as
the contact form, and never stores anything in the visitor's browser.

## Later: sending leads straight into Lofty

The Lofty CRM is where the team works its leads. A follow-up would push each off-market sign-up
into Lofty automatically, if their Lofty plan allows an integration (to be confirmed with the
team). It isn't set up yet.
