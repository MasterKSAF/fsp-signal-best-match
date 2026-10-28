CREATE TABLE signal_pdf_import_receipts (
 id uuid PRIMARY KEY,
 user_id integer NOT NULL REFERENCES signal_users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX signal_pdf_import_receipt_owner_idx ON signal_pdf_import_receipts(user_id,created_at);
--> statement-breakpoint
INSERT INTO signal_pdf_import_receipts(id,user_id,created_at)
 SELECT id,user_id,created_at FROM signal_pdf_import_drafts;
