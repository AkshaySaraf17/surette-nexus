-- The website's "Concierge" is now called the "AI assistant". Rename the stored values so
-- lead/showing sources and analytics events use the new name everywhere.
ALTER TYPE showing_source RENAME VALUE 'concierge' TO 'ai_assistant';
ALTER TYPE lead_source RENAME VALUE 'concierge' TO 'ai_assistant';
UPDATE analytics_events SET type = 'assistant_open' WHERE type = 'concierge_open';
UPDATE analytics_events SET type = 'assistant_message' WHERE type = 'concierge_message';
UPDATE search_history SET criteria = jsonb_set(criteria, '{source}', '"ai_assistant"') WHERE criteria->>'source' = 'concierge';
