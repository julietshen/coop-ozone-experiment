import { type ColumnType, type GeneratedAlways } from 'kysely';

export type OzoneServicePg = {
  'ozone_service.event_sync_state': {
    org_id: string;
    last_synced_cursor: string | null;
    last_synced_at: Date | null;
    sync_enabled: boolean;
    created_at: ColumnType<Date, never, never>;
    updated_at: ColumnType<Date, Date | undefined, Date>;
  };
  'ozone_service.label_mappings': {
    id: GeneratedAlways<string>;
    org_id: string;
    coop_policy_type: string;
    ozone_label_value: string;
    direction: string;
    created_at: ColumnType<Date, never, never>;
  };
  'ozone_service.emitted_events': {
    id: GeneratedAlways<string>;
    org_id: string;
    ozone_event_type: string;
    subject_did: string | null;
    subject_uri: string | null;
    coop_action_id: string | null;
    coop_correlation_id: string | null;
    ozone_response: Record<string, unknown> | null;
    status: string;
    error: string | null;
    retry_count: number;
    created_at: ColumnType<Date, never, never>;
  };
};
