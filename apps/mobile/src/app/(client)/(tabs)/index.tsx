import { ClientTabPlaceholder } from '../../../features/navigation/client/ClientTabPlaceholder.tsx';

// Composition only (`CLAUDE.md` §9.2). Still a placeholder — P05 builds the
// shell, not the screens, and pre-building content here is work
// `phase-09-workout-logger/today-card/` would have to delete first
// (P05 README, "Risks").
export default function ClientTodayScreen() {
  return (
    <ClientTabPlaceholder
      title="Today"
      route="(client)/(tabs)/index"
      ownedBy="phase-09-workout-logger/today-card/"
    />
  );
}
