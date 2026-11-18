ALTER TABLE slots ADD COLUMN allocation_requested boolean NOT NULL DEFAULT false;
CREATE INDEX allocation_work ON slots(created_at) WHERE(allocation_requested AND state='available');
