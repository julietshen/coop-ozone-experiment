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

-- Add EMIT_OZONE_EVENT to the action_type enum
ALTER TYPE action_type ADD VALUE IF NOT EXISTS 'EMIT_OZONE_EVENT';

-- ============================================================================
-- Seed data for Test Org (e7c89ce7729) so Ozone features are tryable out of
-- the box, matching the pattern of the initial-test-data seed.
-- ============================================================================

-- Enable inbound event sync for the test org
INSERT INTO ozone_service.event_sync_state (org_id, sync_enabled)
VALUES ('e7c89ce7729', true)
ON CONFLICT (org_id) DO NOTHING;

-- Default bidirectional label mappings so Coop policies map to Ozone labels
INSERT INTO ozone_service.label_mappings (org_id, coop_policy_type, ozone_label_value, direction) VALUES
  ('e7c89ce7729', 'SPAM',          'spam',         'BOTH'),
  ('e7c89ce7729', 'HARASSMENT',    'harassment',   'BOTH'),
  ('e7c89ce7729', 'HATE_SPEECH',   'hate',         'BOTH'),
  ('e7c89ce7729', 'VIOLENCE',      'violence',     'BOTH'),
  ('e7c89ce7729', 'MISINFORMATION','misleading',   'BOTH'),
  ('e7c89ce7729', 'NSFW',          'sexual',       'BOTH'),
  ('e7c89ce7729', 'SELF_HARM',     'self-harm',    'BOTH')
ON CONFLICT (org_id, coop_policy_type, ozone_label_value) DO NOTHING;

-- An EMIT_OZONE_EVENT action so moderators can label content in Ozone from Coop
INSERT INTO public.actions (id, name, description, callback_url, org_id, penalty, action_type, applies_to_all_items_of_kind, apply_user_strikes, custom_mrt_api_params)
VALUES (
  'ozone_label_01',
  'Apply Ozone Label',
  'Emits a label event to the connected Ozone moderation service, marking content for AT Protocol-wide moderation.',
  NULL,
  'e7c89ce7729',
  'NONE',
  'EMIT_OZONE_EVENT',
  '{}',
  false,
  '{}'
)
ON CONFLICT (org_id, name) DO NOTHING;

-- Link the Ozone action to the Post content type
INSERT INTO public.actions_and_item_types (created_at, updated_at, action_id, item_type_id)
VALUES (NOW(), NOW(), 'ozone_label_01', 'a8481310e8c')
ON CONFLICT DO NOTHING;
