import { SettingsScreen } from '../../../features/settings/screens/SettingsScreen.tsx';

/** The (coach) counterpart, and the same component. Rows are gated on role inside it, never by forking the screen. */
export default function ClientSettingsScreen() {
  return <SettingsScreen />;
}
