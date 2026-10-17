# Leads and deals

## Leads

Leads come from the contact page, showing requests, the AI assistant hand-off and Dual-Move "share with an
agent". Each requires the visitor's explicit consent to be contacted (stored in `consent_records`).

- **Routing:** listing agent → the customer's assigned agent → the team leader.
- **Duplicates:** the same email or phone about the same property within 24 hours adds a note to the
  existing lead instead of creating a new one.
- **Spam:** a hidden honeypot field and rate limits.
- In **Portal → Leads** staff can filter, assign, set follow-up dates, add notes and convert a lead to a deal.

## Deals (transaction coordinator)

**Portal → Deals** is a board by stage: Prospect, Showings, Offer, Under contract, Inspection,
Appraisal & financing, Clear to close, Closed (and Lost). Drag a card or use its stage menu.

- **Stage gates:** a deal can't enter "Under contract" without a contract date and price, can't reach
  "Clear to close"/"Closed" without a closing date, and "Lost" needs a reason.
- **Checklists:** a new deal gets the default template for its side (buyer, seller, dual, lease). Each
  milestone has a rule such as `contract+10:roll` (10 days after contract, moved off weekends). When the
  contract or closing date changes, rule-based dates are recalculated; manually rescheduled items are left alone.
- **Commission:** price × basis points, in integer cents, rounded half-up.
- **Documents:** upload PDF, JPEG, PNG or plain text (up to 25 MB). The type is checked from the file
  content, not its name. PDFs and text are scanned for purchase price, earnest money, effective date,
  closing date and inspection days. Each candidate shows the page and text it came from, and nothing is
  applied until a person verifies it. Images are stored but not read (no OCR).
- **Drafts:** status updates, deadline reminders and document requests are generated from the deal's
  data. They must be approved before they can be marked sent, and they're sent from your own email app
  (`mailto:`). Nothing is emailed automatically.
- **Client view:** customers signed in to `/account` see their deal's client-visible milestones.
- Every change is written to the append-only audit log and shown as the deal's activity.

Agents see only their own deals and leads; the owner sees the whole team.
