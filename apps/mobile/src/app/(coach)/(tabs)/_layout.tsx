import { Tabs } from 'expo-router';

// Bare passthrough. `router-skeleton/03` gives this its real configuration —
// Home · Clients · Programs · Inbox · More, with icons, labels and the glass
// tab bar. Nothing here is a design decision; it exists so the five tab
// routes below resolve as tabs rather than as loose stack screens.
export default function CoachTabsLayout() {
  return <Tabs />;
}
