import {
  Card,
  EmptyState,
  ForbiddenState,
  LoadingState,
  NotFoundState,
  colors,
  type LoadingShape,
} from '@coachos/ui';
import { Camera } from 'lucide-react-native';
import { View } from 'react-native';

import { GallerySection } from '../GallerySection.tsx';
import { Specimen } from '../Specimen.tsx';

const SHAPES: readonly LoadingShape[] = ['list', 'detail', 'card'];
const GLYPH_PX = 28;

function noop() {
  // Inert specimen.
}

export function ScreenStatesSection() {
  return (
    <GallerySection
      title="Screen states"
      note="Exactly one primary action on an empty state, and neither not-found nor forbidden may be a dead end."
    >
      <Specimen label="EmptyState · title and one action" layout="column">
        <Card elevation="raised" density="client">
          <EmptyState
            title="No clients yet"
            primaryAction={{ label: 'Invite your first client', onPress: noop }}
          />
        </Card>
      </Specimen>

      <Specimen label="EmptyState · with an explanation, and with an illustration" layout="column">
        <View className="gap-16">
          <Card elevation="raised" density="client">
            <EmptyState
              title="No progress photos"
              body="Photos stay on your account. Your coach sees them only when you share one."
              primaryAction={{ label: 'Take a photo', onPress: noop }}
            />
          </Card>
          <Card elevation="raised" density="client">
            <EmptyState
              icon={<Camera size={GLYPH_PX} color={colors.fg.subtle} />}
              title="No form checks this week"
              body="Record a set and your coach can comment on the exact rep."
              primaryAction={{ label: 'Record a set', onPress: noop }}
            />
          </Card>
          <Card elevation="raised" density="coach">
            <EmptyState
              title="Nothing to review"
              body="Every check-in this week has an answer."
              primaryAction={{ label: 'Go to clients', onPress: noop }}
              density="coach"
            />
          </Card>
        </View>
      </Specimen>

      <Specimen label="LoadingState · every shape (skeletons, never a spinner)" layout="column">
        <View className="gap-16">
          {SHAPES.map((shape) => (
            <Card key={shape} elevation="raised" density="coach">
              <LoadingState shape={shape} accessibilityLabel={`Loading ${shape}`} />
            </Card>
          ))}
        </View>
      </Specimen>

      <Specimen label="LoadingState · row count, and client density" layout="column">
        <View className="gap-16">
          <Card elevation="raised" density="coach">
            <LoadingState shape="list" rows={2} accessibilityLabel="Loading clients" />
          </Card>
          <Card elevation="raised" density="client">
            <LoadingState
              shape="list"
              rows={6}
              density="client"
              accessibilityLabel="Loading today's sessions"
            />
          </Card>
        </View>
      </Specimen>

      <Specimen label="NotFoundState · default copy, then overridden" layout="column">
        <View className="gap-16">
          <Card elevation="raised" density="client">
            <NotFoundState onRecover={noop} />
          </Card>
          <Card elevation="raised" density="client">
            <NotFoundState
              title="That session isn't here"
              body="It may have been deleted, or moved to another week."
              recoverLabel="Back to the week"
              onRecover={noop}
            />
          </Card>
        </View>
      </Specimen>

      <Specimen label="ForbiddenState · default copy, then a tier block" layout="column">
        <View className="gap-16">
          <Card elevation="raised" density="client">
            <ForbiddenState onRecover={noop} />
          </Card>
          <Card elevation="raised" density="coach">
            <ForbiddenState
              title="Group rooms are on Pro"
              body="Your plan covers one-to-one sessions. Whoever manages the account can change that."
              recoverLabel="See plans"
              density="coach"
              onRecover={noop}
            />
          </Card>
        </View>
      </Specimen>
    </GallerySection>
  );
}
