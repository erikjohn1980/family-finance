# CSV column map (phase-1 import)

The importer works out the file type from its header row. Column names are case-insensitive. Files must be UTF-8; a BOM is optional.

## 1. Transactions file

| Column | Required | Format | Notes |
| --- | --- | --- | --- |
| `external_id` | yes | text | Stable id from the source. `(account, external_id)` is unique: a re-import skips the row and never updates it. |
| `account` | yes | text | Account display name. If no account has this name, an `import` account is created in **household** scope. |
| `posted_at` | yes | `YYYY-MM-DD` | For pending rows, this is the authorization date. |
| `amount` | yes | `-12.34` | Negative is money out, positive is money in. `$`, `,` and `(12.34)` are accepted. |
| `merchant` | yes | text | The raw merchant string. It is stored unchanged. |
| `pending` | no | `true`/`false` | Bank-pending flag. |
| `pending_id` | no | text | On a posted row, the `external_id` of its pending twin. This gives an exact pending→posted match. |
| `category` | no | category name | Applied as an override, and only when the row is new. Unknown names are reported and the row stays uncategorized. |
| `memo` | no | text | |
| `sweep_type` | no | `purchase` / `redemption` | Marks overnight sweep events for the sweep cash rule. |
| `account_kind` | no | `checking`, `savings`, `credit_card`, `loan`, `brokerage`, `retirement` | Used only when the account is created. Default is `checking`. |
| `mask_last4` | no | 4 digits | Only the last four digits are kept. |
| `scope` | no | `household` / `business` / `trust` | Used only when the account is created. |

Example:

```csv
external_id,account,posted_at,amount,merchant,pending,pending_id
A-1001,Demo Checking,2026-10-01,-42.10,SAMPLE BAKERY 12,false,
A-1002,Demo Checking,2026-10-03,-60.00,SAMPLE FUEL 9,true,
A-1003,Demo Checking,2026-10-05,-60.00,SAMPLE FUEL #9,false,A-1002
```

## 2. Balances file

| Column | Required | Notes |
| --- | --- | --- |
| `account` | yes | The account is created if it does not exist. |
| `kind` | yes | Same values as `account_kind`, plus `real_estate`, `vehicle`, `other_asset`. |
| `balance` | yes | Liabilities may be signed either way and are **stored positive**. |
| `as_of` | yes | `YYYY-MM-DD`. Drives the freshness badge. |
| `available_balance` | no | Used by the sweep cash rule. |
| `mask_last4`, `scope`, `is_sweep` | no | |

## Policy filters

- Any row whose account or merchant contains "Katapult" is excluded and counted as `excludedByPolicy`.
- Re-uploading an identical file (same SHA-256) is a no-op.

## Export

`Export CSV` downloads exactly the rows the current filters show. The file is UTF-8 with a BOM and RFC 4180 quoting. Any cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage return gets a `'` prefix, so negative amounts appear as `'-12.34`. The importer strips that prefix again, so exports can be re-imported.
