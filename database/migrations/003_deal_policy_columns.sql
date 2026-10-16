-- =============================================================================
-- Migration 003 — evaluate deal visibility on the row's own columns.
--
-- The 002 policy called app_can_staff_deal(id), which re-queries transactions. A
-- function's sub-query can't see a row inserted by the *same* statement, so
-- INSERT … RETURNING on transactions was refused. Checking the row's columns
-- directly is equivalent for reads and works for RETURNING.
-- =============================================================================
DROP POLICY deals_read ON transactions;
CREATE POLICY deals_read ON transactions FOR SELECT TO surette_app USING (
  (app_is_staff_of(team_id) AND (app_role() = 'admin' OR agent_id = app_user_id()))
  OR client_user_id = app_user_id()
);

DROP POLICY deals_update ON transactions;
CREATE POLICY deals_update ON transactions FOR UPDATE TO surette_app
  USING (app_is_staff_of(team_id) AND (app_role() = 'admin' OR agent_id = app_user_id()))
  WITH CHECK (app_is_staff_of(team_id) AND (app_role() = 'admin' OR agent_id = app_user_id()));
