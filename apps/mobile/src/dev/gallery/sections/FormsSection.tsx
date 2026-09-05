import { FormField, Input, NumberStepper, type InputState } from '@coachos/ui';
import { useState } from 'react';
import { View } from 'react-native';

import { GallerySection } from '../GallerySection.tsx';
import { Specimen } from '../Specimen.tsx';

const INPUT_STATES: readonly InputState[] = ['default', 'error', 'disabled'];

export function FormsSection() {
  // Local UI state, not business state — these are controlled components and
  // an uncontrolled specimen would prove nothing about them.
  const [text, setText] = useState('Priya');
  const [notes, setNotes] = useState('Felt strong. Left knee a little tight on the last set.');
  const [weightKg, setWeightKg] = useState(72.5);
  const [reps, setReps] = useState(8);
  const [rpe, setRpe] = useState(7.5);
  const [caloriesKcal, setCaloriesKcal] = useState(2100);

  return (
    <GallerySection
      title="Forms"
      note="Input carries no label of its own — FormField owns the label, hint, and error."
    >
      <Specimen label="Input · every state, coach density" layout="column">
        {INPUT_STATES.map((state) => (
          <Input
            key={state}
            value={text}
            onChangeText={setText}
            state={state}
            density="coach"
            accessibilityLabel={`Name, ${state}`}
          />
        ))}
      </Specimen>

      <Specimen label="Input · every state, client density" layout="column">
        {INPUT_STATES.map((state) => (
          <Input
            key={state}
            value={text}
            onChangeText={setText}
            state={state}
            density="client"
            accessibilityLabel={`Name, ${state}, client density`}
          />
        ))}
      </Specimen>

      <Specimen label="Input · placeholder, secure, numeric, multiline" layout="column">
        <Input
          value=""
          onChangeText={setText}
          placeholder="Search exercises"
          accessibilityLabel="Search exercises"
        />
        <Input
          value="hunter2"
          onChangeText={setText}
          secureTextEntry
          textContentType="password"
          accessibilityLabel="Password"
        />
        <Input
          value="72.5"
          onChangeText={setText}
          keyboardType="decimal-pad"
          accessibilityLabel="Body weight in kilograms"
        />
        <Input
          value={notes}
          onChangeText={setNotes}
          multiline
          maxLength={280}
          accessibilityLabel="Session notes"
        />
      </Specimen>

      <Specimen label="FormField · plain, hint, error, required" layout="column">
        <FormField label="Full name">
          <Input value={text} onChangeText={setText} />
        </FormField>
        <FormField label="Email" hint="We only use this to send your invite.">
          <Input value="priya@example.com" onChangeText={setText} autoCapitalize="none" />
        </FormField>
        <FormField label="Email" error="Enter an email address.">
          <Input value="priya@" onChangeText={setText} state="error" autoCapitalize="none" />
        </FormField>
        <FormField label="Date of birth" isRequired hint="You need to be 13 or older.">
          <Input value="1998-04-12" onChangeText={setText} keyboardType="numbers-and-punctuation" />
        </FormField>
        <FormField label="Coach code" density="client" isRequired>
          <Input value="" onChangeText={setText} density="client" placeholder="6 characters" />
        </FormField>
      </Specimen>

      <Specimen label="NumberStepper · one step size per instance" layout="column">
        <View className="gap-16">
          <NumberStepper
            value={weightKg}
            onChange={setWeightKg}
            step={2.5}
            max={500}
            unit="kg"
            unitLabel="kilograms"
            accessibilityLabel="weight"
          />
          <NumberStepper
            value={reps}
            onChange={setReps}
            step={1}
            max={50}
            accessibilityLabel="reps"
          />
          <NumberStepper
            value={rpe}
            onChange={setRpe}
            step={0.5}
            min={1}
            max={10}
            accessibilityLabel="RPE"
          />
          <NumberStepper
            value={caloriesKcal}
            onChange={setCaloriesKcal}
            step={10}
            max={9000}
            unit="kcal"
            unitLabel="kilocalories"
            accessibilityLabel="calories"
          />
        </View>
      </Specimen>

      <Specimen label="NumberStepper · at min, at max, disabled, coach density" layout="column">
        <View className="gap-16">
          <NumberStepper value={0} onChange={setReps} step={1} max={50} accessibilityLabel="reps" />
          <NumberStepper
            value={50}
            onChange={setReps}
            step={1}
            max={50}
            accessibilityLabel="reps"
          />
          <NumberStepper
            value={reps}
            onChange={setReps}
            step={1}
            max={50}
            isDisabled
            accessibilityLabel="reps"
          />
          <NumberStepper
            value={weightKg}
            onChange={setWeightKg}
            step={2.5}
            max={500}
            unit="kg"
            density="coach"
            accessibilityLabel="weight"
          />
        </View>
      </Specimen>
    </GallerySection>
  );
}
