import { type ColumnType } from 'kysely';

export type SignalAuthServicePg = {
  'signal_auth_service.open_ai_configs': {
    org_id: string;
    api_key: string;
    created_at: ColumnType<Date, never, never>;
    updated_at: ColumnType<Date, never, never>;
  };
  'signal_auth_service.ozone_configs': {
    org_id: string;
    service_url: string;
    did: string;
    signing_key: string;
    handle: string | null;
    created_at: ColumnType<Date, never, never>;
    updated_at: ColumnType<Date, never, never>;
  };
};
