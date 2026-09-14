ALTER TABLE vps_instances ADD COLUMN IF NOT EXISTS os_id VARCHAR(100);
ALTER TABLE vps_instances ADD COLUMN IF NOT EXISTS virtualization_mode VARCHAR(20) NOT NULL DEFAULT 'standard';
ALTER TABLE vps_instances ADD COLUMN IF NOT EXISTS failure_reason TEXT;
ALTER TABLE vps_instances DROP CONSTRAINT IF EXISTS vps_instances_virtualization_mode_check;
ALTER TABLE vps_instances ADD CONSTRAINT vps_instances_virtualization_mode_check
  CHECK (virtualization_mode IN ('standard', 'nested'));
