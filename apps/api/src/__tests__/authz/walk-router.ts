// The reflective walk (`04-authz-enumeration-test.md` Files table) —
// `appRouter._def.procedures` is the same flat, dotted-path map
// `router-registry.test.ts` already trusts (`api-scaffold/04`'s
// registration guarantee), reached two levels deep exactly as that test
// proves for `coach.clients.list`. This module adds nothing to that trust;
// it only extracts what the enumeration needs from each entry.
import type { AnyProcedure, AnyRouter } from '@trpc/server';
import type { z } from 'zod';

export interface WalkedProcedure {
  path: string;
  type: 'query' | 'mutation' | 'subscription';
  // The last `.input()` schema on the chain, or `undefined` for a
  // procedure with no input at all — `coach.clients.list` today, and every
  // procedure scoped entirely by `ctx.user` with no id in its payload.
  inputSchema: z.ZodType | undefined;
}

// tRPC v11's internal `ProcedureDef` shape isn't exported as a public type
// (`@trpc/server`'s public surface stops at `AnyProcedure`), so this reaches
// one level past it — the same trade `router-registry.test.ts` already
// makes by reading `appRouter._def.procedures` directly. A tRPC upgrade
// that moves this shape fails `router-registry.test.ts` first, by design
// (this task's own Risks section).
interface ProcedureInternals {
  type: 'query' | 'mutation' | 'subscription';
  inputs: z.ZodType[];
}

function internalsOf(procedure: AnyProcedure): ProcedureInternals {
  return (procedure as unknown as { _def: ProcedureInternals })._def;
}

export function walkRouter(router: AnyRouter): WalkedProcedure[] {
  const procedures = router._def.procedures as Record<string, AnyProcedure>;
  return Object.entries(procedures).map(([path, procedure]) => {
    const internals = internalsOf(procedure);
    return {
      path,
      type: internals.type,
      inputSchema: internals.inputs.at(-1),
    };
  });
}
