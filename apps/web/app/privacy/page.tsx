// ⚠️ PLACEHOLDER. This is not the CoachOS privacy policy — CLAUDE.md §21.3
// ("get a lawyer before launch") is unresolved and COMPLIANCE.md CO§7 gap 9
// owns the real document. `./content` carries the full note and the sourcing
// rule; read it before editing a word of this page.
//
// It exists because `/guardian-consent/[token]` links to `/privacy` at the
// moment it asks a parent for consent, and a 404 there is worse than an
// honest holding page.

import type { Metadata } from 'next';

import { PrivacyContent } from './content';
import './styles.css';

// The layout already sets `noindex` app-wide; repeated here so a future
// marketing site relaxing that one does not silently publish a placeholder
// policy as if it were the real one.
export const metadata: Metadata = {
  title: 'Privacy · CoachOS',
  robots: { index: false, follow: false },
};

export default function PrivacyPage() {
  return <PrivacyContent />;
}
