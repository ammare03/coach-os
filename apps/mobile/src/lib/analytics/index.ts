// The analytics surface, in full. Anything not re-exported here is not
// part of the contract — in particular, the PostHog client itself is not
// exported from any module in this folder, so `posthog.capture()` is not
// reachable from a feature (`ANALYTICS.md` AN§1, and the task's own Risks
// section: a raw client is the single easiest way this guardrail erodes).

export { AnalyticsProvider } from './AnalyticsProvider.tsx';
export { trackEvent } from './track-event.ts';
export { setAnalyticsIdentity, setAnalyticsOptOut } from './posthog.ts';
export { asProcedureName, asUuid } from './events.ts';

export type {
  AnalyticsEventName,
  AnalyticsProperties,
  AnalyticsPropertyValue,
  AnalyticsRole,
  ProcedureName,
  Uuid,
} from './events.ts';
export type { AnalyticsConsent } from './posthog.ts';
