/**
 * BankImportAdapter — READ-ONLY by design.
 * There are intentionally no methods to move money, pay bills, refund, or change bank settings.
 * Provider credentials live only in server-side environment/secret storage, never in the client or git.
 */
export type AdapterHealth = { status: "ok" | "degraded" | "not_configured"; checkedAt: Date; message?: string };

export type ImportedAccount = {
  externalAccountId: string;
  name: string;
  kind: "checking" | "savings" | "credit_card" | "loan" | "brokerage" | "retirement";
  maskLast4?: string | null;
  balanceCents: number | null; // liabilities positive
  availableBalanceCents?: number | null;
  asOf: Date | null;
};

export type ImportedTx = {
  externalId: string;
  accountName: string;
  postedAt: string;
  amountCents: number;
  merchantRaw: string;
  pending: boolean;
  pendingExternalId?: string | null;
  payload: Record<string, unknown>;
};

export type AdapterResult<T> = { ok: true; data: T } | { ok: false; status: "not_configured" | "error"; message: string };

export interface BankImportAdapter {
  readonly id: string;
  health(): Promise<AdapterHealth>;
  listAccounts(): Promise<AdapterResult<ImportedAccount[]>>;
  listTransactions(accountExternalId: string, since: Date): Promise<AdapterResult<ImportedTx[]>>;
}

/** Placeholder until the owner configures a documented provider outside the repo. Never throws. */
export const notConfiguredAdapter: BankImportAdapter = {
  id: "provider",
  async health() {
    return { status: "not_configured", checkedAt: new Date(), message: "No bank data provider is configured. CSV import is available." };
  },
  async listAccounts() {
    return { ok: false, status: "not_configured", message: "Provider not configured" };
  },
  async listTransactions() {
    return { ok: false, status: "not_configured", message: "Provider not configured" };
  },
};

export function getProviderAdapter(): BankImportAdapter {
  // Phase 6: return a real adapter here when the owner configures one via server env.
  return notConfiguredAdapter;
}
