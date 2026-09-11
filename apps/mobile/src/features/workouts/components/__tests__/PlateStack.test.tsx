import { TextScaleProvider } from '@coachos/ui';
import { lbToKg, parseWeight } from '@coachos/utils';
import { fireEvent, render, screen } from '@testing-library/react-native';

import {
  NearestWeightLine,
  PlateStack,
  labelNearest,
  resolvePlateStack,
  PLATE_PIP_TEST_ID,
} from '../PlateStack.tsx';
import { toDisplayWeight } from '../SetEntryRow.tsx';

const BARBELL = 'Barbell';

// The pips are hidden from the accessibility tree — which is the point, and
// which is why they need `includeHiddenElements` to be counted at all.
function pips() {
  return screen.queryAllByTestId(PLATE_PIP_TEST_ID, { includeHiddenElements: true });
}

describe('PlateStack — a barbell exercise', () => {
  it('draws one pip per plate on each side of the bar, mirrored', () => {
    // 82.5 total on a 20 kg bar = 31.25 a side = 25 + 5 + 1.25. Three
    // plates, six pips: the per-side/total confusion this task's Risks
    // section names would show up here as three pips or twelve.
    render(<PlateStack equipment={BARBELL} weightKg={82.5} unit="kg" />);

    expect(pips()).toHaveLength(6);
  });

  it('reads as one image with the plates spelled out, not a dozen pips', () => {
    render(<PlateStack equipment={BARBELL} weightKg={82.5} unit="kg" />);

    const stack = screen.getByLabelText('Plates per side: 25, 5 and 1.25 kilograms');
    expect(stack.props.accessibilityRole).toBe('image');
    // Exactly one focusable element for the whole stack.
    expect(screen.getAllByRole('image')).toHaveLength(1);
  });

  it('names every physical plate, including a repeated one', () => {
    // 140 on a 20 kg bar = 60 a side = 25 + 25 + 10.
    render(<PlateStack equipment={BARBELL} weightKg={140} unit="kg" />);

    expect(screen.getByLabelText('Plates per side: 25, 25 and 10 kilograms')).toBeTruthy();
    expect(pips()).toHaveLength(6);
  });

  it('shows the bare bar, and says so, when nothing is loaded', () => {
    render(<PlateStack equipment={BARBELL} weightKg={20} unit="kg" />);

    expect(screen.getByLabelText('Just the bar')).toBeTruthy();
    expect(pips()).toHaveLength(0);
  });

  it('honours a bar that is not the 20 kg default', () => {
    // A 15 kg women's bar: 65 total = 25 a side = 25.
    render(<PlateStack equipment={BARBELL} weightKg={65} barbellWeightKg={15} unit="kg" />);

    expect(screen.getByLabelText('Plates per side: 25 kilograms')).toBeTruthy();
  });
});

describe('PlateStack — a client who reads pounds', () => {
  it('draws the imperial rack, not a metric one with translated numbers', () => {
    // 185 lb on a 45 lb bar = 70 a side = 45 + 25. Two plates, four pips.
    render(<PlateStack equipment={BARBELL} weightKg={lbToKg(185)} unit="lb" />);

    expect(screen.getByLabelText('Plates per side: 45 and 25 pounds')).toBeTruthy();
    expect(pips()).toHaveLength(4);
  });

  it('loads the 45 lb bar, never the 20 kg one converted', () => {
    // 45 lb is 20.41 kg. A bare imperial bar reads as bare; against the
    // metric default it would have shown a plate that is not on the rack.
    render(<PlateStack equipment={BARBELL} weightKg={lbToKg(45)} unit="lb" />);

    expect(screen.getByLabelText('Just the bar')).toBeTruthy();
    expect(pips()).toHaveLength(0);
  });

  it('names every physical plate in pounds, including a repeated one', () => {
    // 180 lb = 45 lb bar + 67.5 a side = 45 + 10 + 10 + 2.5.
    render(<PlateStack equipment={BARBELL} weightKg={lbToKg(180)} unit="lb" />);

    expect(screen.getByLabelText('Plates per side: 45, 10, 10 and 2.5 pounds')).toBeTruthy();
    expect(pips()).toHaveLength(8);
  });

  it('renders nothing at all below the weight of the bar itself', () => {
    render(<PlateStack equipment={BARBELL} weightKg={lbToKg(40)} unit="lb" />);

    expect(pips()).toHaveLength(0);
    expect(screen.queryByLabelText(/Plates per side/)).toBeNull();
    expect(screen.queryByLabelText('Just the bar')).toBeNull();
  });

  it('resolves a kg-prescribed weight onto the imperial rack', () => {
    // The coach programmed 82.5 kg; this client reads pounds. 82.5 kg shows
    // as 182 lb, and 180 lb is the nearest an imperial rack makes.
    expect(resolvePlateStack({ equipment: BARBELL, weightKg: 82.5, unit: 'lb' })).toMatchObject({
      kind: 'inexact',
      plates: [45, 10, 10, 2.5],
    });
  });
});

describe('PlateStack — when no plate breakdown applies', () => {
  it('renders no breakdown for a non-barbell exercise', () => {
    render(<PlateStack equipment="Dumbbell" weightKg={82.5} unit="kg" />);

    expect(pips()).toHaveLength(0);
    expect(screen.queryByLabelText(/Plates per side/)).toBeNull();
    expect(screen.queryAllByRole('image')).toHaveLength(0);
  });

  it.each(['Machine', 'Cable', 'Bodyweight', 'Trap Bar', 'EZ-Bar'])(
    'renders no breakdown for %s',
    (equipment) => {
      render(<PlateStack equipment={equipment} weightKg={82.5} unit="kg" />);

      expect(pips()).toHaveLength(0);
    },
  );

  it('renders no breakdown when the exercise records no equipment', () => {
    render(<PlateStack equipment={null} weightKg={82.5} unit="kg" />);

    expect(pips()).toHaveLength(0);
  });

  it('renders nothing at all below the weight of the bar itself', () => {
    // `resolvePlateLoad` returns a NEGATIVE remainder. That is not an "over"
    // rounding case — it means the ask is under the empty bar — and the
    // design suppresses the whole block rather than saying anything.
    render(<PlateStack equipment={BARBELL} weightKg={15} unit="kg" />);

    expect(pips()).toHaveLength(0);
    expect(screen.queryByLabelText(/Plates per side/)).toBeNull();
    expect(screen.queryByLabelText('Just the bar')).toBeNull();
    expect(screen.queryByText(/Nearest/)).toBeNull();
  });
});

describe('NearestWeightLine', () => {
  const onSelectNearest = jest.fn();

  beforeEach(() => {
    onSelectNearest.mockClear();
  });

  it('states the nearest makeable weight and how far under it falls', () => {
    // 83 on a 20 kg bar: plates make 82.5, so the load falls 0.5 short.
    render(
      <NearestWeightLine
        equipment={BARBELL}
        weightKg={83}
        unit="kg"
        onSelectNearest={onSelectNearest}
      />,
    );

    expect(screen.getByText('Nearest with these plates 82.5 kg')).toBeTruthy();
    expect(screen.getByText('· 0.5 kg under')).toBeTruthy();
  });

  it('sets the weight to the achievable load when tapped', () => {
    render(
      <NearestWeightLine
        equipment={BARBELL}
        weightKg={83}
        unit="kg"
        onSelectNearest={onSelectNearest}
      />,
    );

    fireEvent.press(
      screen.getByLabelText('Set weight to 82.5 kilograms, the nearest these plates make'),
    );

    expect(onSelectNearest).toHaveBeenCalledWith(82.5);
  });

  it('is a button, so it is reachable without the gesture', () => {
    render(
      <NearestWeightLine
        equipment={BARBELL}
        weightKg={83}
        unit="kg"
        onSelectNearest={onSelectNearest}
      />,
    );

    expect(screen.getByRole('button')).toBeTruthy();
  });

  it('is absent when the weight is exactly makeable', () => {
    render(
      <NearestWeightLine
        equipment={BARBELL}
        weightKg={82.5}
        unit="kg"
        onSelectNearest={onSelectNearest}
      />,
    );

    expect(screen.queryByText(/Nearest/)).toBeNull();
  });

  it('is absent for a non-barbell exercise', () => {
    render(
      <NearestWeightLine
        equipment="Machine"
        weightKg={83}
        unit="kg"
        onSelectNearest={onSelectNearest}
      />,
    );

    expect(screen.queryByText(/Nearest/)).toBeNull();
  });

  it('is absent below the weight of the bar', () => {
    render(
      <NearestWeightLine
        equipment={BARBELL}
        weightKg={15}
        unit="kg"
        onSelectNearest={onSelectNearest}
      />,
    );

    expect(screen.queryByText(/Nearest/)).toBeNull();
  });

  it('renders the whole sentence at 200% text, with nothing truncated', () => {
    render(
      <TextScaleProvider scale={2}>
        <NearestWeightLine
          equipment={BARBELL}
          weightKg={83}
          unit="kg"
          onSelectNearest={onSelectNearest}
        />
      </TextScaleProvider>,
    );

    const lead = screen.getByText('Nearest with these plates 82.5 kg');
    const delta = screen.getByText('· 0.5 kg under');

    // No `numberOfLines` anywhere: the line wraps rather than dropping the
    // weight a client is about to load (`accessibility` §3).
    expect(lead.props.numberOfLines).toBeUndefined();
    expect(delta.props.numberOfLines).toBeUndefined();
  });
});

describe('NearestWeightLine — a client who reads pounds', () => {
  const onSelectNearest = jest.fn();

  beforeEach(() => {
    onSelectNearest.mockClear();
  });

  it('states a whole-pound shortfall against the imperial rack', () => {
    // 183 lb: an imperial rack makes 180, so the load falls 3 lb short.
    // Never a hardcoded unit (`COPY.md`) — both come from `packages/utils`.
    render(
      <NearestWeightLine
        equipment={BARBELL}
        weightKg={lbToKg(183)}
        unit="lb"
        onSelectNearest={onSelectNearest}
      />,
    );

    expect(screen.getByText('Nearest with these plates 180 lb')).toBeTruthy();
    expect(screen.getByText('· 3 lb under')).toBeTruthy();
  });

  it('never offers a suggestion that is already the current weight', () => {
    // The defect, in its exact observed numbers: 185 lb rendered a line
    // reading "Nearest with these plates 182 lb · 0 lb under" that no tap
    // could clear. 185 lb is 45 + 25 a side on a 45 lb bar — makeable, so
    // there is nothing to suggest.
    render(
      <NearestWeightLine
        equipment={BARBELL}
        weightKg={lbToKg(185)}
        unit="lb"
        onSelectNearest={onSelectNearest}
      />,
    );

    expect(screen.queryByText(/Nearest/)).toBeNull();
    expect(screen.queryByText(/0 lb under/)).toBeNull();
  });

  it('clears itself in one tap — the loop that used to never terminate', () => {
    let nextKg = Number.NaN;
    const { rerender } = render(
      <NearestWeightLine
        equipment={BARBELL}
        weightKg={lbToKg(183)}
        unit="lb"
        onSelectNearest={(kg) => {
          nextKg = kg;
        }}
      />,
    );

    fireEvent.press(screen.getByRole('button'));

    // Exactly what the composer does with the suggestion: round it to the
    // pound the stepper shows, then convert back for storage. The old
    // metric breakdown could not survive this round trip.
    const settledKg = parseWeight(toDisplayWeight(nextKg, 'lb') ?? 0, 'lb');
    rerender(
      <NearestWeightLine
        equipment={BARBELL}
        weightKg={settledKg}
        unit="lb"
        onSelectNearest={onSelectNearest}
      />,
    );

    expect(screen.queryByText(/Nearest/)).toBeNull();
  });

  it('is absent below the weight of the 45 lb bar', () => {
    render(
      <NearestWeightLine
        equipment={BARBELL}
        weightKg={lbToKg(40)}
        unit="lb"
        onSelectNearest={onSelectNearest}
      />,
    );

    expect(screen.queryByText(/Nearest/)).toBeNull();
  });
});

describe('the plate stack grows with the type rather than clipping', () => {
  it('constrains its height with minHeight, never height', () => {
    render(<PlateStack equipment={BARBELL} weightKg={82.5} unit="kg" />);

    const stack = screen.getByLabelText('Plates per side: 25, 5 and 1.25 kilograms');
    const style = StyleSheetFlatten(stack.props.style);

    expect(style.height).toBeUndefined();
    expect(style.minHeight).toBeDefined();
  });
});

describe('labelNearest', () => {
  it('says "under" when the plates fall short of the ask', () => {
    expect(labelNearest(82.5, 0.5, 'kg')).toEqual({
      lead: 'Nearest with these plates 82.5 kg',
      delta: '· 0.5 kg under',
      spoken: 'Set weight to 82.5 kilograms, the nearest these plates make',
    });
  });

  it('says "over" when the plates overshoot it', () => {
    // Unreachable from the greedy loader, which only ever loads what fits —
    // stated by the design's copy table and covered so a different
    // inventory could not introduce a wrong word silently.
    expect(labelNearest(85, -2, 'kg').delta).toBe('· 2 kg over');
  });

  it('speaks a single kilogram in the singular', () => {
    expect(labelNearest(1, 0.5, 'kg').spoken).toBe(
      'Set weight to 1 kilogram, the nearest these plates make',
    );
  });

  it('speaks a pound client’s weight in pounds', () => {
    expect(labelNearest(lbToKg(180), lbToKg(3), 'lb').spoken).toBe(
      'Set weight to 180 pounds, the nearest these plates make',
    );
  });
});

describe('resolvePlateStack', () => {
  it('reports the achievable load, not the requested one', () => {
    expect(resolvePlateStack({ equipment: BARBELL, weightKg: 83, unit: 'kg' })).toEqual({
      kind: 'inexact',
      plates: [25, 5, 1.25],
      achievableKg: 82.5,
      deltaKg: 0.5,
    });
  });

  it('hides itself rather than throwing on a weight that is not a number', () => {
    expect(resolvePlateStack({ equipment: BARBELL, weightKg: Number.NaN, unit: 'kg' })).toEqual({
      kind: 'hidden',
    });
    expect(resolvePlateStack({ equipment: BARBELL, weightKg: Number.NaN, unit: 'lb' })).toEqual({
      kind: 'hidden',
    });
  });

  it('hides itself rather than throwing on a bar that is not a number', () => {
    expect(
      resolvePlateStack({ equipment: BARBELL, weightKg: 83, barbellWeightKg: -1, unit: 'kg' }),
    ).toEqual({ kind: 'hidden' });
  });
});

// `StyleSheet.flatten` typed for the narrow use above, so the test reads a
// resolved style object rather than an array.
function StyleSheetFlatten(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    return style.reduce<Record<string, unknown>>(
      (acc, entry) => ({ ...acc, ...StyleSheetFlatten(entry) }),
      {},
    );
  }
  return typeof style === 'object' && style !== null ? (style as Record<string, unknown>) : {};
}
