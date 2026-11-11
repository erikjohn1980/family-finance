-- Owner decision (Nov 2026): nothing Katapult-related belongs in Family Finance.
-- Remove the former "51% share of cleared Katapult cash" placeholder asset.
DELETE FROM net_worth_manual_asset WHERE system_key = 'katapult_51pct_cleared_cash';
