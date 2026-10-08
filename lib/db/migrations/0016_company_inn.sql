-- Optional company identifier: preserve every existing company and relation.
ALTER TABLE signal_companies ADD COLUMN inn text;
ALTER TABLE signal_companies ADD CONSTRAINT signal_companies_inn_format_check
  CHECK (inn IS NULL OR inn ~ '^(?:[0-9]{10}|[0-9]{12})$');
