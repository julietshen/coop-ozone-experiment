/**
 * Types for the Ozone moderation service integration.
 *
 * Ozone is Bluesky's AT Protocol labeling/moderation service. These types
 * model its API request/response shapes and moderation event vocabulary.
 */

// ---------------------------------------------------------------------------
// Ozone moderation event types
// ---------------------------------------------------------------------------

export type OzoneEventType =
  | '#modEventReport'
  | '#modEventTakedown'
  | '#modEventReverseTakedown'
  | '#modEventLabel'
  | '#modEventComment'
  | '#modEventAcknowledge'
  | '#modEventEscalate'
  | '#modEventMute'
  | '#modEventUnmute'
  | '#modEventResolveAppeal';

export type OzoneSubject =
  | { $type: 'com.atproto.admin.defs#repoRef'; did: string }
  | {
      $type: 'com.atproto.repo.strongRef';
      uri: string;
      cid: string;
    };

export type OzoneLabel = {
  src: string;
  uri: string;
  val: string;
  cts: string;
  cid?: string;
  exp?: string;
  neg?: boolean;
  sig?: string;
};

// ---------------------------------------------------------------------------
// emitEvent request/response
// ---------------------------------------------------------------------------

export type OzoneEmitEventInput = {
  event:
    | {
        $type: 'tools.ozone.moderation.defs#modEventLabel';
        createLabelVals: string[];
        negateLabelVals: string[];
        comment?: string;
      }
    | {
        $type: 'tools.ozone.moderation.defs#modEventTakedown';
        comment?: string;
        durationInHours?: number;
      }
    | {
        $type: 'tools.ozone.moderation.defs#modEventComment';
        comment: string;
        sticky?: boolean;
      }
    | {
        $type: 'tools.ozone.moderation.defs#modEventAcknowledge';
        comment?: string;
      }
    | {
        $type: 'tools.ozone.moderation.defs#modEventReverseTakedown';
        comment?: string;
      }
    | {
        $type: 'tools.ozone.moderation.defs#modEventEscalate';
        comment?: string;
      };
  subject: OzoneSubject;
  createdBy: string;
  subjectBlobCids?: string[];
};

export type OzoneEmitEventResponse = {
  id: number;
  event: Record<string, unknown>;
  subject: OzoneSubject;
  createdBy: string;
  createdAt: string;
};

// ---------------------------------------------------------------------------
// queryEvents request/response
// ---------------------------------------------------------------------------

export type OzoneQueryEventsParams = {
  cursor?: string;
  limit?: number;
  types?: string[];
  subject?: string;
  sortDirection?: 'asc' | 'desc';
  createdAfter?: string;
  createdBefore?: string;
};

export type OzoneModerationEvent = {
  id: number;
  event: {
    $type: string;
    comment?: string;
    createLabelVals?: string[];
    negateLabelVals?: string[];
    reportType?: string;
    [key: string]: unknown;
  };
  subject: OzoneSubject;
  subjectBlobCids: string[];
  createdBy: string;
  createdAt: string;
};

export type OzoneQueryEventsResponse = {
  cursor?: string;
  events: OzoneModerationEvent[];
};

// ---------------------------------------------------------------------------
// queryStatuses request/response
// ---------------------------------------------------------------------------

export type OzoneQueryStatusesParams = {
  cursor?: string;
  limit?: number;
  subject?: string;
  reviewState?: string;
};

export type OzoneSubjectStatus = {
  id: number;
  subject: OzoneSubject;
  reviewState: string;
  comment?: string;
  lastReviewedAt?: string;
  lastReportedAt?: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
};

export type OzoneQueryStatusesResponse = {
  cursor?: string;
  subjectStatuses: OzoneSubjectStatus[];
};

// ---------------------------------------------------------------------------
// Sync state (DB model)
// ---------------------------------------------------------------------------

export type OzoneSyncState = {
  orgId: string;
  lastSyncedCursor: string | null;
  lastSyncedAt: Date | null;
  syncEnabled: boolean;
};

// ---------------------------------------------------------------------------
// Simplified event type for Coop's internal use
// ---------------------------------------------------------------------------

export type CoopOzoneEventType =
  | 'label'
  | 'takedown'
  | 'reverseTakedown'
  | 'comment'
  | 'acknowledge'
  | 'escalate';

export function toOzoneEventDef(
  eventType: CoopOzoneEventType,
  options: {
    labels?: string[];
    negateLabels?: string[];
    comment?: string;
    durationInHours?: number;
  } = {},
): OzoneEmitEventInput['event'] {
  switch (eventType) {
    case 'label':
      return {
        $type: 'tools.ozone.moderation.defs#modEventLabel',
        createLabelVals: options.labels ?? [],
        negateLabelVals: options.negateLabels ?? [],
        comment: options.comment,
      };
    case 'takedown':
      return {
        $type: 'tools.ozone.moderation.defs#modEventTakedown',
        comment: options.comment,
        durationInHours: options.durationInHours,
      };
    case 'reverseTakedown':
      return {
        $type: 'tools.ozone.moderation.defs#modEventReverseTakedown',
        comment: options.comment,
      };
    case 'comment':
      return {
        $type: 'tools.ozone.moderation.defs#modEventComment',
        comment: options.comment ?? '',
        sticky: false,
      };
    case 'acknowledge':
      return {
        $type: 'tools.ozone.moderation.defs#modEventAcknowledge',
        comment: options.comment,
      };
    case 'escalate':
      return {
        $type: 'tools.ozone.moderation.defs#modEventEscalate',
        comment: options.comment,
      };
  }
}
