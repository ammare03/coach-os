// providers-and-gates/02's fourth acceptance criterion, as a test: a
// zero-argument `invalidateQueries()` must fail lint, and the same call with
// a key from the factory must pass.
'use strict';

const { Linter, RuleTester } = require('eslint');

const reactNativeConfig = require('../../eslint.react-native.js');
const rule = require('../no-bare-invalidate-queries.js');

const ruleTester = new RuleTester();

ruleTester.run('no-bare-invalidate-queries', rule, {
  valid: [
    // The shape the rule exists to force: a key from
    // apps/mobile/src/lib/query/keys.ts.
    'queryClient.invalidateQueries({ queryKey: keys.clients.detail(clientId) });',
    'queryClient.invalidateQueries({ queryKey: keys.sessions.detail(sessionId) });',
    // A deliberately broad prefix is still a decision someone made and can
    // defend in review — the rule bans the absence of a key, not breadth.
    'queryClient.invalidateQueries({ queryKey: keys.clients.list() });',
    // Destructured from useQueryClient(), with a key.
    'invalidateQueries({ queryKey: keys.media.detail(assetId) });',
    // A filters object held in a variable — the rule cannot see inside it
    // and must not guess.
    'queryClient.invalidateQueries(filters);',
    // Spread: not a zero-argument call, and its contents are unknowable.
    'queryClient.invalidateQueries(...args);',
    // Neighbouring cache methods are out of scope.
    'queryClient.removeQueries();',
    'queryClient.resetQueries();',
    // Name must match exactly.
    'queryClient.invalidateQueriesLater();',
    'invalidateQueriesForClient();',
    // A computed member access is a different expression, not this one.
    'queryClient[method]();',
  ],
  invalid: [
    {
      code: 'queryClient.invalidateQueries();',
      errors: [{ messageId: 'bareInvalidate' }],
    },
    {
      // Any receiver, not just one called `queryClient`.
      code: 'qc.invalidateQueries();',
      errors: [{ messageId: 'bareInvalidate' }],
    },
    {
      code: 'useQueryClient().invalidateQueries();',
      errors: [{ messageId: 'bareInvalidate' }],
    },
    {
      // The direct-import / destructured form.
      code: 'const { invalidateQueries } = useQueryClient(); invalidateQueries();',
      errors: [{ messageId: 'bareInvalidate' }],
    },
    {
      code: 'async function f() { await queryClient.invalidateQueries(); }',
      errors: [{ messageId: 'bareInvalidate' }],
    },
    {
      // Empty filters match every query — the same instruction, retyped.
      code: 'queryClient.invalidateQueries({});',
      errors: [{ messageId: 'emptyFilters' }],
    },
    {
      // The onSettled position the `offline-sync` skill §6 puts every
      // optimistic mutation's invalidation in — the exact call site this
      // rule is guarding.
      code: 'const opts = { onSettled: () => queryClient.invalidateQueries() };',
      errors: [{ messageId: 'bareInvalidate' }],
    },
  ],
});

// The rule firing in isolation is only half of it — a rule registered under
// the wrong plugin name, or at the wrong severity, is a rule that never runs
// on real code. This asserts the wiring in eslint.react-native.js itself.
describe('the eslint.react-native.js wiring', () => {
  const RULE_ID = 'query/no-bare-invalidate-queries';
  // The `files` glob above is why this matters: lint a `<input>` and the
  // entry never matches, the rule never runs, and the test passes for the
  // wrong reason.
  const FILENAME = 'src/features/workouts/api.ts';

  const entry = reactNativeConfig.find((config) => config.rules?.[RULE_ID] !== undefined);

  it('registers the rule at error severity', () => {
    expect(entry).toBeDefined();
    expect(entry.rules[RULE_ID]).toBe('error');
  });

  it('applies to the TypeScript files the app is written in', () => {
    expect(entry.files).toEqual(['**/*.{ts,tsx}']);
  });

  it('reports a bare invalidateQueries() through that registration', () => {
    const messages = new Linter().verify('queryClient.invalidateQueries();', [entry], FILENAME);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ ruleId: RULE_ID, severity: 2 });
  });

  it('reports nothing when the call carries a key from the factory', () => {
    const messages = new Linter().verify(
      'queryClient.invalidateQueries({ queryKey: keys.clients.detail(id) });',
      [entry],
      FILENAME,
    );

    expect(messages).toEqual([]);
  });
});
