-- Expand the existing moderation queue; historical rows and decisions stay intact.
ALTER TABLE signal_complaints ALTER COLUMN company_id DROP NOT NULL;
ALTER TABLE signal_complaints DROP CONSTRAINT signal_complaints_object_type_check;
ALTER TABLE signal_complaints ADD CONSTRAINT signal_complaints_object_type_check CHECK (object_type IN ('company','job','invitation','service'));
ALTER TABLE signal_complaints DROP CONSTRAINT signal_complaints_category_check;
ALTER TABLE signal_complaints ADD CONSTRAINT signal_complaints_category_check CHECK (category IN ('spam','misleading','discrimination','inappropriate','privacy','other','question','technical'));
ALTER TABLE signal_complaints DROP CONSTRAINT signal_complaints_status_check;
ALTER TABLE signal_complaints ADD CONSTRAINT signal_complaints_status_check CHECK (status IN ('submitted','in_review','dismissed','upheld','resolved'));
ALTER TABLE signal_complaints ADD CONSTRAINT signal_complaints_service_context_check CHECK ((object_type='service' AND company_id IS NULL AND object_id=reporter_user_id) OR (object_type<>'service' AND company_id IS NOT NULL));
DROP INDEX signal_complaint_case_unique;
CREATE UNIQUE INDEX signal_complaint_case_unique ON signal_complaints(reporter_user_id,object_type,object_id,category) WHERE object_type<>'service';
