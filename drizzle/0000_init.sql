CREATE TYPE "public"."account_kind" AS ENUM('checking', 'savings', 'credit_card', 'loan', 'brokerage', 'retirement', 'real_estate', 'vehicle', 'other_asset');--> statement-breakpoint
CREATE TYPE "public"."cadence" AS ENUM('weekly', 'biweekly', 'semimonthly', 'monthly', 'quarterly', 'annual');--> statement-breakpoint
CREATE TYPE "public"."category_kind" AS ENUM('expense', 'income', 'transfer', 'card_payment', 'excluded');--> statement-breakpoint
CREATE TYPE "public"."goal_kind" AS ENUM('save', 'debt');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."scope" AS ENUM('household', 'business', 'trust');--> statement-breakpoint
CREATE TYPE "public"."source" AS ENUM('import', 'manual');--> statement-breakpoint
CREATE TABLE "audit_event" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"actor_id" text,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_account" (
	"userId" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"providerAccountId" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "auth_account_provider_providerAccountId_pk" PRIMARY KEY("provider","providerAccountId")
);
--> statement-breakpoint
CREATE TABLE "bank_transaction" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"account_id" text NOT NULL,
	"external_id" text NOT NULL,
	"posted_at" date NOT NULL,
	"amount_cents" bigint NOT NULL,
	"merchant_raw" text NOT NULL,
	"pending" boolean DEFAULT false NOT NULL,
	"payload" jsonb NOT NULL,
	"import_batch_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "category" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"group" text NOT NULL,
	"name" text NOT NULL,
	"kind" "category_kind" DEFAULT 'expense' NOT NULL,
	"monthly_limit_cents" bigint,
	"rollover" boolean DEFAULT false NOT NULL,
	"proposed" boolean DEFAULT false NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fin_account" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"name" text NOT NULL,
	"mask_last4" text,
	"kind" "account_kind" NOT NULL,
	"scope" "scope" DEFAULT 'household' NOT NULL,
	"business_unit" text,
	"source" "source" DEFAULT 'manual' NOT NULL,
	"balance_cents" bigint,
	"available_balance_cents" bigint,
	"balance_as_of" timestamp with time zone,
	"stale_after_hours" integer DEFAULT 72 NOT NULL,
	"is_sweep" boolean DEFAULT false NOT NULL,
	"include_in_household_overview" boolean DEFAULT false NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goal" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"kind" "goal_kind" NOT NULL,
	"title" text NOT NULL,
	"target_amount_cents" bigint NOT NULL,
	"target_date" date,
	"linked_account_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"funded_amount_cents" bigint,
	"baseline_cents" bigint,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "household_member" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "member_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "household" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_batch" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"adapter" text NOT NULL,
	"file_name" text,
	"checksum" text NOT NULL,
	"actor_id" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"stats" jsonb
);
--> statement-breakpoint
CREATE TABLE "income_expectation" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"label" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"cadence" "cadence" DEFAULT 'monthly' NOT NULL,
	"scope" "scope" DEFAULT 'household' NOT NULL,
	"category_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invite" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invite_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "ledger_override" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"bank_tx_id" text,
	"category_id" text,
	"memo" text,
	"split_group" text NOT NULL,
	"split_amount_cents" bigint,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manual_transaction" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"account_id" text,
	"scope" "scope" DEFAULT 'household' NOT NULL,
	"amount_cents" bigint NOT NULL,
	"merchant" text NOT NULL,
	"category_id" text,
	"memo" text,
	"occurred_at" date NOT NULL,
	"actor_id" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchant_rule" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"pattern" text NOT NULL,
	"category_id" text NOT NULL,
	"suggested_by" text NOT NULL,
	"confirmed_by" text,
	"confirmed_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "net_worth_manual_asset" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"label" text NOT NULL,
	"amount_cents" bigint,
	"notes" text,
	"system_key" text,
	"as_of" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pending_link" (
	"pending_tx_id" text PRIMARY KEY NOT NULL,
	"posted_tx_id" text NOT NULL,
	"rule" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_bill" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"label" text NOT NULL,
	"amount_min_cents" bigint NOT NULL,
	"amount_max_cents" bigint NOT NULL,
	"match_rules" jsonb NOT NULL,
	"verified_by_tx_id" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_session" (
	"sessionToken" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"expires" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_pref" (
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_pref_user_id_key_pk" PRIMARY KEY("user_id","key")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text,
	"emailVerified" timestamp,
	"image" text,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "auth_verification_token" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp NOT NULL,
	CONSTRAINT "auth_verification_token_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_account" ADD CONSTRAINT "auth_account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_account_id_fin_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."fin_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_import_batch_id_import_batch_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_account" ADD CONSTRAINT "fin_account_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal" ADD CONSTRAINT "goal_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_member" ADD CONSTRAINT "household_member_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_member" ADD CONSTRAINT "household_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_expectation" ADD CONSTRAINT "income_expectation_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_expectation" ADD CONSTRAINT "income_expectation_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_override" ADD CONSTRAINT "ledger_override_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_override" ADD CONSTRAINT "ledger_override_bank_tx_id_bank_transaction_id_fk" FOREIGN KEY ("bank_tx_id") REFERENCES "public"."bank_transaction"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_override" ADD CONSTRAINT "ledger_override_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_override" ADD CONSTRAINT "ledger_override_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_transaction" ADD CONSTRAINT "manual_transaction_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_transaction" ADD CONSTRAINT "manual_transaction_account_id_fin_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."fin_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_transaction" ADD CONSTRAINT "manual_transaction_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_transaction" ADD CONSTRAINT "manual_transaction_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_rule" ADD CONSTRAINT "merchant_rule_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_rule" ADD CONSTRAINT "merchant_rule_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_rule" ADD CONSTRAINT "merchant_rule_suggested_by_user_id_fk" FOREIGN KEY ("suggested_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_rule" ADD CONSTRAINT "merchant_rule_confirmed_by_user_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "net_worth_manual_asset" ADD CONSTRAINT "net_worth_manual_asset_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_link" ADD CONSTRAINT "pending_link_pending_tx_id_bank_transaction_id_fk" FOREIGN KEY ("pending_tx_id") REFERENCES "public"."bank_transaction"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_link" ADD CONSTRAINT "pending_link_posted_tx_id_bank_transaction_id_fk" FOREIGN KEY ("posted_tx_id") REFERENCES "public"."bank_transaction"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_bill" ADD CONSTRAINT "recurring_bill_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_pref" ADD CONSTRAINT "user_pref_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_event" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "audit_at_idx" ON "audit_event" USING btree ("household_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_tx_external_uq" ON "bank_transaction" USING btree ("account_id","external_id");--> statement-breakpoint
CREATE INDEX "bank_tx_posted_idx" ON "bank_transaction" USING btree ("household_id","posted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "category_name_uq" ON "category" USING btree ("household_id","group","name");--> statement-breakpoint
CREATE UNIQUE INDEX "fin_account_name_uq" ON "fin_account" USING btree ("household_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "household_member_user_uq" ON "household_member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "import_batch_checksum_uq" ON "import_batch" USING btree ("household_id","checksum");--> statement-breakpoint
CREATE INDEX "override_tx_idx" ON "ledger_override" USING btree ("bank_tx_id","created_at");--> statement-breakpoint
CREATE INDEX "manual_tx_occurred_idx" ON "manual_transaction" USING btree ("household_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "nw_asset_system_key_uq" ON "net_worth_manual_asset" USING btree ("household_id","system_key") WHERE "net_worth_manual_asset"."system_key" is not null;