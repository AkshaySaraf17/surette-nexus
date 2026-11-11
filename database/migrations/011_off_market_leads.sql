-- Off-market alerts: visitors describe a home they want before it's listed, and the team
-- follows up when one comes up. These sign-ups are leads with their own source.
ALTER TYPE lead_source ADD VALUE IF NOT EXISTS 'off_market';
