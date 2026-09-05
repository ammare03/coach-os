import { ClientTabPlaceholder } from '../../../features/navigation/client/ClientTabPlaceholder.tsx';

// Composition only (`CLAUDE.md` §9.2). Still a placeholder — P05 builds the
// shell, not the screens, and pre-building content here is work
// `phase-13-nutrition/diary/` would have to delete first (P05 README, "Risks").
export default function ClientNutritionScreen() {
  return (
    <ClientTabPlaceholder
      title="Nutrition"
      route="(client)/(tabs)/nutrition"
      ownedBy="phase-13-nutrition/diary/"
    />
  );
}
