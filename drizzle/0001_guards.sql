-- Imported bank rows are the immutable source of truth.
-- Categorization, memos and splits live in ledger_override; nothing may UPDATE or DELETE a bank row.
CREATE OR REPLACE FUNCTION bank_transaction_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'bank_transaction rows are immutable (attempted %)', TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER bank_transaction_no_update
  BEFORE UPDATE OR DELETE ON bank_transaction
  FOR EACH ROW EXECUTE FUNCTION bank_transaction_immutable();
--> statement-breakpoint
-- Audit events are append-only as well.
CREATE OR REPLACE FUNCTION audit_event_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_event rows are append-only (attempted %)', TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_event_no_update
  BEFORE UPDATE OR DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION audit_event_append_only();
--> statement-breakpoint
-- Liabilities and balances: a liability balance is stored positive.
ALTER TABLE fin_account ADD CONSTRAINT fin_account_liability_positive
  CHECK (kind NOT IN ('credit_card','loan') OR balance_cents IS NULL OR balance_cents >= 0);
--> statement-breakpoint
ALTER TABLE recurring_bill ADD CONSTRAINT recurring_bill_band CHECK (amount_min_cents <= amount_max_cents AND amount_min_cents >= 0);
--> statement-breakpoint
ALTER TABLE goal ADD CONSTRAINT goal_target_positive CHECK (target_amount_cents > 0);
--> statement-breakpoint
CREATE UNIQUE INDEX household_singleton ON household ((true));
