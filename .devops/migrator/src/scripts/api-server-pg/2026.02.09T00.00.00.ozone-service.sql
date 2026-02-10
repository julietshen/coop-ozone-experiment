-- Ozone integration: credential storage
CREATE TABLE IF NOT EXISTS signal_auth_service.ozone_configs (
  org_id TEXT PRIMARY KEY,
  service_url TEXT NOT NULL,
  did TEXT NOT NULL,
  signing_key TEXT NOT NULL,
  handle TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ozone service schema
CREATE SCHEMA IF NOT EXISTS ozone_service;

-- Tracks polling cursor per org for inbound event sync
CREATE TABLE ozone_service.event_sync_state (
  org_id TEXT PRIMARY KEY,
  last_synced_cursor TEXT,
  last_synced_at TIMESTAMPTZ,
  sync_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Configurable bidirectional mapping between Coop policies and Ozone labels
CREATE TABLE ozone_service.label_mappings (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id TEXT NOT NULL,
  coop_policy_type TEXT NOT NULL,
  ozone_label_value TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'BOTH',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, coop_policy_type, ozone_label_value)
);

-- Audit log for outbound Ozone events emitted by Coop
CREATE TABLE ozone_service.emitted_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id TEXT NOT NULL,
  ozone_event_type TEXT NOT NULL,
  subject_did TEXT,
  subject_uri TEXT,
  coop_action_id TEXT,
  coop_correlation_id TEXT,
  ozone_response JSONB,
  status TEXT NOT NULL DEFAULT 'PENDING',
  error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ozone_emitted_events_org_status
  ON ozone_service.emitted_events(org_id, status);
