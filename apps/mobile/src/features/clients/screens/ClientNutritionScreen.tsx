import { Text, createThemedStyles, createThemedValue, density, spacing } from '@coachos/ui';
import { skipToken, useQuery } from '@tanstack/react-query';
import { Utensils } from 'lucide-react-native';
import { ScrollView, StyleSheet, View } from 'react-native';

import { QUERY_CACHE_MAX_AGE_MS } from '../../../lib/query/persister.ts';
import { CLIENT_DETAIL_STALE_TIME_MS, clientDetailKeys } from '../api.ts';

// §8.3's Nutrition tab — the facet, its cache key, and one designed state.
//
// **The diary, the macro bars and the meal photos are not here, and that is
// the deliverable.** `phase-13-nutrition/coach-nutrition-review/` owns every
// byte of nutrition content and has not shipped at this point in the build
// order; it is a parallel track, not upstream of P10. What ships now is the
// permanent shape — so the tab exists, caches independently, and looks
// intentional from day one — plus the contract below, written precisely
// enough that P13 can build against it without redesigning this screen.
//
// Mock diary rows "so the tab looks finished" would be worse than nothing:
// P13's implementer could mistake placeholder UI for a working feature, and
// a demo would show a client eating food they never ate.

/**
 * **The contract `phase-13-nutrition/coach-nutrition-review/` implements.**
 *
 * One procedure, one round trip, exactly as `coach.clients.overview` does
 * for the Overview tab and for the same reason: the tab's premise is a
 * single glance at a client's day, and four awaited calls are four chances
 * to be slow (`screen-composition` §2).
 *
 * ```ts
 * // apps/api/src/routers/coach/clients.ts
 * nutrition: coachProcedure          // isAuthed → hasRole('coach') → ownsResource
 *   .input(z.object({
 *     clientId: z.uuid(),
 *     // The CLIENT's local calendar day, never the coach's device day: a
 *     // coach in Mumbai reviewing a client in Toronto must see the client's
 *     // Tuesday (`code-conventions` §6, `CLAUDE.md` §25.5). Omitted means
 *     // "today" resolved server-side in the client's `users.timezone`.
 *     date: z.iso.date().optional(),
 *   }))
 *   .query(...)
 *
 * // Output
 * {
 *   date: string;                    // 'yyyy-MM-dd', echoed back resolved
 *
 *   // The four target columns on `client_profiles`. `null` is "the coach
 *   // has set no target", which is NOT zero and must not render as 0 %
 *   // of anything — the same null-is-not-failure rule the adherence
 *   // figure follows (`adherence-engine/01`).
 *   targets: {
 *     kcal: number | null;
 *     proteinG: number | null;
 *     carbsG: number | null;
 *     fatG: number | null;
 *   };
 *
 *   // The day, summed server-side. Never summed on the device: the same
 *   // number appears on the client's own diary and the two must agree.
 *   totals: { kcal: number; proteinG: number; carbsG: number; fatG: number };
 *
 *   // Every entry the client logged that day, in logged order, already
 *   // render-complete — no per-row query (`screen-composition` §2).
 *   entries: readonly {
 *     entryId: string;
 *     mealSlot: 'breakfast' | 'lunch' | 'dinner' | 'snack';
 *     loggedAt: Date;                // a real Date over superjson
 *     foodName: string;              // SENSITIVE — see the note below
 *     servingLabel: string | null;   // '1 cup', '2 rotis'
 *     quantityG: number | null;
 *     kcal: number;
 *     proteinG: number;
 *     carbsG: number;
 *     fatG: number;
 *     // An ASSET ID, never a URL. A signed URL is a live credential with a
 *     // ≤1h life and is minted at render by the media layer, never
 *     // returned by a list procedure (`security-and-privacy` §4).
 *     photoAssetId: string | null;
 *   }[];
 *
 *   // §8.3's "weekly averages", over the seven days ending on `date`.
 *   week: {
 *     daysLogged: number;            // 0–7
 *     average: { kcal: number; proteinG: number; carbsG: number; fatG: number } | null;
 *   };
 * }
 * ```
 *
 * **The empty case is a success, not an error.** A client who logged
 * nothing returns `entries: []`, `totals` all zero, `week.daysLogged: 0`,
 * `week.average: null` — never a 404 and never a thrown error. That
 * response renders the state below, unchanged. An id that is not this
 * coach's client is the other case entirely and returns `NOT_FOUND`, never
 * `FORBIDDEN` (`ERRORS.md` ER§2.1) — P13 adds that branch when it adds the
 * query, alongside the loading and error branches this screen has no way to
 * reach today.
 *
 * **Food names, quantities and photo ids are Sensitive class**
 * (`CLAUDE.md` §21.1). They render on this screen and go nowhere else: not
 * into a log line, not into a PostHog property, not into an error message,
 * not into a Sentry breadcrumb. §20's guardrail is ids and counts only.
 */
function useClientNutritionSlot(clientId: string) {
  return useQuery({
    queryKey: clientDetailKeys.tab(clientId, 'nutrition'),
    // `skipToken`, not a stub that resolves to fake rows and not an enabled
    // query with no procedure behind it. It registers the cache entry and
    // never fetches, so the tab owns its key from day one and P13's diff is
    // one `queryFn` — not a new key, not a new hook, not a change to the
    // tab shell.
    //
    // An enabled query with nothing to call would sit in `isPending`
    // forever, which is the spinner-that-never-resolves this task exists to
    // avoid. `skipToken` puts `fetchStatus` at `'idle'` instead, and the
    // screen below renders the one state it actually has.
    queryFn: skipToken,
    // Both inherited rather than restated so this tab cannot drift from the
    // other five: the staleness window is the feature's, and `gcTime` is
    // tied to the persistence window by import — a `gcTime` below it evicts
    // the entry the persister just restored (`api.ts`).
    staleTime: CLIENT_DETAIL_STALE_TIME_MS,
    gcTime: QUERY_CACHE_MAX_AGE_MS,
  });
}

export interface ClientNutritionScreenProps {
  clientId: string;
}

/**
 * A **Detail read** (`UI-UX.md` §UX2) with exactly one state.
 *
 * `ui-conventions` §4 asks every data-loading screen for loading, empty,
 * error and forbidden. This screen loads nothing, so three of the four are
 * structurally unreachable rather than omitted — and the shell survives
 * regardless, because the facet bar and the back control live in
 * `_layout.tsx` (`screen-composition` §3). P13 adds the other three in the
 * same commit that adds the query.
 *
 * No analytics event fires here. §20 has no nutrition-tab event, and an
 * event is declared in `ANALYTICS.md` before it is sent, never the other
 * way round.
 */
export function ClientNutritionScreen({ clientId }: ClientNutritionScreenProps) {
  const themed = useThemedStyles();
  const iconColor = useMutedIconColor();

  // Reserves `['clients', clientId, 'nutrition']`. The return value is
  // deliberately unused: there is nothing to read until P13 supplies the
  // `queryFn`, and reading a value that is provably `undefined` would be
  // theatre.
  useClientNutritionSlot(clientId);

  return (
    <ScrollView
      style={[styles.flex, themed.screen]}
      // `flexGrow` + `justifyContent`, not a centred `View`: at 200 % text
      // the block grows past the frame and must scroll rather than clip
      // (`accessibility` §3).
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      testID="client-nutrition"
    >
      {/* The shared `EmptyState` is not used here, and the reason is worth
          writing down: its `primaryAction` is required and non-optional on
          purpose — one clear next step, enforced by the type
          (`ui-conventions` §4). This is the one screen that cannot honour
          it. A coach cannot log food for their client, because the data is
          the client's; and the two things they could do instead — message
          them, set a target — belong to phases that have not shipped, so
          either would be a button that does nothing, which the phase README
          rules out explicitly. So: the primitive's exact internals (52/20
          padding, the same gaps, the same 270px measure, the same roles),
          minus the button. When P13 gives this tab a real action, it
          deletes this block and uses the primitive. */}
      <View style={styles.block} testID="client-nutrition-empty">
        <View
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Utensils size={ICON_SIZE} color={iconColor} />
        </View>

        <View style={styles.words}>
          <Text size="h2" accessibilityRole="header" style={styles.centered}>
            No food logged yet.
          </Text>
          {/* States the fact and explains the slot; no apology, no
              exclamation mark, nothing that reads as a judgement about the
              person who has not logged (`product-copy` §1, §3). "No food
              logged yet", never "your client has missed 3 days". */}
          <Text size="body" tone="muted" style={styles.body}>
            Once your client logs a meal, their day shows here: what they ate, how it lands against
            their targets, and any photos they attached.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

/** The size `ClientOverviewScreen`'s own empty states draw a lucide glyph at. */
const ICON_SIZE = 22;

/** `DESIGN.md` §9 caps an empty state's explanation at ≤280px; the built prototypes draw 270. */
const BODY_MAX_WIDTH = 270;

const SECTION_GAP = density.coach.sectionGap;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: spacing(52),
    paddingHorizontal: spacing(20),
  },
  block: { alignItems: 'center', gap: SECTION_GAP },
  words: { alignItems: 'center', gap: spacing(12) },
  centered: { textAlign: 'center' },
  body: { textAlign: 'center', maxWidth: BODY_MAX_WIDTH },
});

const useThemedStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.colors.bg.DEFAULT },
}));

const useMutedIconColor = createThemedValue((t) => t.colors.fg.muted);
