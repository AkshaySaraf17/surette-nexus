# AI assistant and local AI

## Website AI assistant (customers)

Open with the **AI assistant** button. It understands requests like
"3 bed under 400k in Waterville with a garage", then:

- searches live listings, explaining why each matches, and relaxes the search step by step if nothing fits
  (and says what it relaxed);
- answers questions about schools, commute and walkability for a listing (labeled as estimates);
- quotes local market figures from the market data tables, with source and date;
- lets visitors save the search, request a showing (with consent) or hand off to an agent;
- for signed-in customers, reports the status of their own deal;
- declines fair-housing-sensitive requests (e.g. about the people in a neighbourhood) and explains why.

## Portal assistant (staff)

**Ask ops** in the portal answers questions such as "what's overdue?", "status of the Riley deal" or
"new leads this week" from the database, scoped to what the signed-in person may see.

## Local AI (optional)

AI is **local only**: set `OLLAMA_URL` (e.g. `http://localhost:11434`) and `OLLAMA_MODEL`
(default `llama3.2:3b`) to let Ollama phrase answers more naturally. Without it, built-in deterministic
answers are used and everything still works. No paid or hosted AI is ever called.

Guard-rails: AI text may only mention dollar amounts that already exist in the data
(`onlyKnownAmounts`); otherwise the deterministic text is used. Deal drafts polished by AI must keep every date.
