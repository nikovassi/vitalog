import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { computeChange } from '@vitalog/shared';
import { ChangeBadge, RangeBar, StatusBadge } from './Status';

describe('StatusBadge', () => {
  it('never relies on color alone: always text + icon', () => {
    const { container } = render(<StatusBadge status="above" />);
    expect(screen.getByText('Над референтния диапазон')).toBeInTheDocument();
    expect(container.querySelector('svg')).not.toBeNull();
  });
  it('uses neutral wording, no alarms', () => {
    for (const s of ['in_range', 'above', 'below', 'unknown'] as const) {
      const { container, unmount } = render(<StatusBadge status={s} />);
      expect(container.textContent).not.toMatch(/опасн|тревог|критич/i);
      unmount();
    }
  });
});

describe('ChangeBadge', () => {
  it('describes the numeric change for screen readers', () => {
    render(<ChangeBadge change={computeChange(42, 35)} unit="µmol/L" />);
    expect(screen.getByText('Стойността се е увеличила с 20% спрямо предходното измерване.')).toBeInTheDocument();
  });
  it('shows a dash without a previous value', () => {
    render(<ChangeBadge change={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

describe('RangeBar', () => {
  it('renders an accessible description with the lab range', () => {
    render(<RangeBar value={42} low={35} high={52} status="in_range" />);
    expect(screen.getByRole('img')).toHaveAccessibleName('Стойност 42, референтен диапазон 35 – 52');
  });
  it('renders nothing without a reference range (never invents one)', () => {
    const { container } = render(<RangeBar value={42} low={null} high={null} status="unknown" />);
    expect(container).toBeEmptyDOMElement();
  });
});
