import { ClientTabPlaceholder } from '../../../features/navigation/client/ClientTabPlaceholder.tsx';

// Composition only (`CLAUDE.md` §9.2). Still a placeholder — P05 builds the
// shell, not the screens, and pre-building content here is work
// `phase-18-habits-metrics-photos/` would have to delete first
// (P05 README, "Risks").
export default function ClientProgressScreen() {
  return (
    <ClientTabPlaceholder
      title="Progress"
      route="(client)/(tabs)/progress"
      ownedBy="phase-18-habits-metrics-photos/"
    />
  );
}
