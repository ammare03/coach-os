// A single shared faker instance every seed module imports from here,
// never from `@faker-js/faker` directly — the determinism contract
// (`seed.ts`'s own top-of-file comment) depends on exactly one RNG stream
// seeded exactly once, at the very start of the run, before any module
// calls into it. A module that imported `@faker-js/faker` fresh would get
// its own unseeded instance and silently break determinism.
import { Faker, en } from '@faker-js/faker';

export const faker = new Faker({ locale: [en] });
