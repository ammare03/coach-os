import { ClientTabPlaceholder } from '../../../features/navigation/client/ClientTabPlaceholder.tsx';

// Composition only (`CLAUDE.md` §9.2). Still a placeholder — P05 builds the
// shell, not the screens. Two phases share this tab: the conversation itself
// and the feedback inbox that hangs off it (P05 README, "Risks").
export default function ClientCoachScreen() {
  return (
    <ClientTabPlaceholder
      title="Coach"
      route="(client)/(tabs)/coach"
      ownedBy="phase-14-messaging-and-realtime/conversations/ and phase-12-feedback-comments/feedback-inbox/"
    />
  );
}
