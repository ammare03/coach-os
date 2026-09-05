import { Card, Text } from '@coachos/ui';
import { Component, type ReactNode } from 'react';
import { View } from 'react-native';

// The one place in this repo a class component is unavoidable: React exposes
// error boundaries only through `getDerivedStateFromError`, which has no hook
// equivalent (`code-conventions` §4's "function components only" assumes one
// exists). Kept local to the gallery — `phase-05-app-shell` owns the real
// screen-level boundary.
interface SectionBoundaryProps {
  name: string;
  children: ReactNode;
}

interface SectionBoundaryState {
  message: string | null;
}

/**
 * `screen-composition` §3 applied to the harness itself: one primitive that
 * throws must not take the other fourteen sections down with it, or the audit
 * stops at the first bug instead of finding all of them.
 */
export class SectionBoundary extends Component<SectionBoundaryProps, SectionBoundaryState> {
  override state: SectionBoundaryState = { message: null };

  static getDerivedStateFromError(error: unknown): SectionBoundaryState {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  override render(): ReactNode {
    const { message } = this.state;
    if (message === null) return this.props.children;

    return (
      <View className="px-20 py-24">
        <Card elevation="tinted" density="coach">
          <Text size="label">{this.props.name} failed to render</Text>
          <Text size="body-sm" tone="muted">
            {message}
          </Text>
        </Card>
      </View>
    );
  }
}
