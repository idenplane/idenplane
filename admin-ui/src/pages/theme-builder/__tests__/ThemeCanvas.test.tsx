import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { render } from '../../../test/utils';
import ThemeCanvas from '../ThemeCanvas';
import type { ThemeComponent } from '../../../types/theme';

function makeComponent(overrides: Partial<ThemeComponent> = {}): ThemeComponent {
  return {
    id: 'button-1',
    type: 'button',
    label: 'Button',
    order: 0,
    visible: true,
    props: { label: 'Sign In' },
    ...overrides,
  };
}

const twoComponents: ThemeComponent[] = [
  makeComponent({ id: 'button-1', type: 'button', order: 0 }),
  makeComponent({ id: 'input-1', type: 'input', order: 1 }),
];

describe('ThemeCanvas', () => {
  it('shows empty-state message when components is empty', () => {
    render(<ThemeCanvas components={[]} onChange={vi.fn()} />);
    expect(
      screen.getByText(/Drag a component from the palette or click to add it/i),
    ).toBeInTheDocument();
  });

  it('renders nodes for each component', () => {
    render(<ThemeCanvas components={twoComponents} onChange={vi.fn()} />);
    expect(screen.getByTestId('theme-canvas-component-button-1')).toBeInTheDocument();
    expect(screen.getByTestId('theme-canvas-component-input-1')).toBeInTheDocument();
  });

  it('renders the component palette in edit mode', () => {
    render(<ThemeCanvas components={[]} onChange={vi.fn()} />);
    expect(screen.getByText('Components')).toBeInTheDocument();
  });

  it('hides the component palette in preview mode', () => {
    render(<ThemeCanvas components={[]} onChange={vi.fn()} isPreview />);
    expect(screen.queryByText('Components')).not.toBeInTheDocument();
  });

  it('shows preview empty-state in preview mode with no components', () => {
    render(<ThemeCanvas components={[]} onChange={vi.fn()} isPreview />);
    expect(screen.getByText(/No components defined/i)).toBeInTheDocument();
  });

  it('removes a component when delete button is clicked', () => {
    const onChange = vi.fn();
    render(<ThemeCanvas components={twoComponents} onChange={onChange} />);
    const deleteButtons = screen.getAllByLabelText('Remove component');
    fireEvent.click(deleteButtons[0]);
    const newComponents: ThemeComponent[] = onChange.mock.calls[0][0];
    expect(newComponents.length).toBe(1);
  });

  it('reorders components when move-up is clicked', () => {
    const onChange = vi.fn();
    render(<ThemeCanvas components={twoComponents} onChange={onChange} />);
    const moveUpButtons = screen.getAllByLabelText('Move component up');
    // Second node (index 1) should have an enabled move-up
    fireEvent.click(moveUpButtons[1]);
    const newComponents: ThemeComponent[] = onChange.mock.calls[0][0];
    expect(newComponents[0].id).toBe('input-1');
    expect(newComponents[1].id).toBe('button-1');
  });

  it('reorders components when move-down is clicked', () => {
    const onChange = vi.fn();
    render(<ThemeCanvas components={twoComponents} onChange={onChange} />);
    const moveDownButtons = screen.getAllByLabelText('Move component down');
    // First node (index 0) should have an enabled move-down
    fireEvent.click(moveDownButtons[0]);
    const newComponents: ThemeComponent[] = onChange.mock.calls[0][0];
    expect(newComponents[0].id).toBe('input-1');
    expect(newComponents[1].id).toBe('button-1');
  });

  it('calls onSelectComponent when a node is clicked', () => {
    const onSelectComponent = vi.fn();
    render(
      <ThemeCanvas
        components={twoComponents}
        onChange={vi.fn()}
        onSelectComponent={onSelectComponent}
      />,
    );
    fireEvent.click(screen.getByTestId('theme-canvas-component-button-1'));
    expect(onSelectComponent).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'button-1' }),
    );
  });

  it('highlights selected component', () => {
    render(
      <ThemeCanvas
        components={twoComponents}
        onChange={vi.fn()}
        selectedComponentId="button-1"
      />,
    );
    const node = screen.getByTestId('theme-canvas-component-button-1');
    expect(node.className).toContain('border-accent');
    expect(node.className).toContain('bg-accent-soft');
  });

  it('adds a component when palette item is clicked', () => {
    const onChange = vi.fn();
    render(<ThemeCanvas components={[]} onChange={onChange} />);
    // Click on the form component in the palette
    const paletteButtons = screen.getAllByTestId(/^palette-component-/);
    fireEvent.click(paletteButtons.find((btn) => btn.getAttribute('data-testid') === 'palette-component-form')!);
    const newComponents: ThemeComponent[] = onChange.mock.calls[0][0];
    expect(newComponents.length).toBe(1);
    expect(newComponents[0].type).toBe('form');
  });

  it('adds component when dragged from palette to canvas', () => {
    const onChange = vi.fn();
    render(<ThemeCanvas components={[]} onChange={onChange} />);

    const paletteButton = screen.getByTestId('palette-component-input');
    const canvas = document.querySelector('.overflow-auto.bg-white') as HTMLElement;

    // Simulate drag and drop
    fireEvent.dragStart(paletteButton, {
      dataTransfer: {
        setData: vi.fn(),
        getData: (key: string) => (key === 'application/x-component-type' ? 'input' : ''),
        effectAllowed: '',
      },
    });

    fireEvent.dragOver(canvas, {
      dataTransfer: {
        dropEffect: '',
      },
    });

    fireEvent.drop(canvas, {
      dataTransfer: {
        getData: (key: string) => (key === 'application/x-component-type' ? 'input' : ''),
      },
    });

    // The component should be added
    const newComponents: ThemeComponent[] = onChange.mock.calls[0][0];
    expect(newComponents.length).toBe(1);
  });

  it('renders SVG connection lines between components', () => {
    render(<ThemeCanvas components={twoComponents} onChange={vi.fn()} />);
    const svg = document.querySelector('svg');
    expect(svg).toBeInTheDocument();
    const lines = svg?.querySelectorAll('line');
    expect(lines?.length).toBeGreaterThanOrEqual(1);
  });

  it('renders placeholder at bottom when not in preview', () => {
    render(<ThemeCanvas components={twoComponents} onChange={vi.fn()} />);
    expect(screen.getByTestId('add-component-placeholder')).toBeInTheDocument();
    expect(screen.getByText(/Add component from palette/i)).toBeInTheDocument();
  });

  it('hides placeholder in preview mode', () => {
    render(<ThemeCanvas components={twoComponents} onChange={vi.fn()} isPreview />);
    expect(screen.queryByTestId('add-component-placeholder')).not.toBeInTheDocument();
  });

  it('disables move-up button on first component', () => {
    render(<ThemeCanvas components={twoComponents} onChange={vi.fn()} />);
    const moveUpButtons = screen.getAllByLabelText('Move component up');
    expect(moveUpButtons[0]).toBeDisabled();
  });

  it('disables move-down button on last component', () => {
    render(<ThemeCanvas components={twoComponents} onChange={vi.fn()} />);
    const moveDownButtons = screen.getAllByLabelText('Move component down');
    expect(moveDownButtons[moveDownButtons.length - 1]).toBeDisabled();
  });

  it('renders component previews correctly for button type', () => {
    const buttonComponent = makeComponent({
      id: 'btn-1',
      type: 'button',
      props: { label: 'Click Me', variant: 'primary' },
    });
    render(<ThemeCanvas components={[buttonComponent]} onChange={vi.fn()} />);
    expect(screen.getByText('Click Me')).toBeInTheDocument();
  });

  it('renders component previews correctly for input type', () => {
    const inputComponent = makeComponent({
      id: 'inp-1',
      type: 'input',
      props: { label: 'Email Address' },
    });
    render(<ThemeCanvas components={[inputComponent]} onChange={vi.fn()} />);
    expect(screen.getByText('Email Address')).toBeInTheDocument();
  });

  it('renders component previews correctly for alert type', () => {
    const alertComponent = makeComponent({
      id: 'alert-1',
      type: 'alert',
      props: { type: 'error', message: 'Something went wrong' },
    });
    render(<ThemeCanvas components={[alertComponent]} onChange={vi.fn()} />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('generates unique IDs for new components', () => {
    const onChange = vi.fn();
    render(<ThemeCanvas components={[makeComponent({ id: 'button-1' })]} onChange={onChange} />);

    // Click on button in palette (there may already be button-1)
    const paletteButtons = screen.getAllByTestId(/^palette-component-/);
    fireEvent.click(paletteButtons.find((btn) => btn.getAttribute('data-testid') === 'palette-component-button')!);

    const newComponents: ThemeComponent[] = onChange.mock.calls[0][0];
    // Should be button-2 since button-1 already exists
    expect(newComponents.some((c) => c.id === 'button-2')).toBe(true);
  });

  it('reorders components via drag and drop', () => {
    const onChange = vi.fn();
    render(<ThemeCanvas components={twoComponents} onChange={onChange} />);

    const buttonNode = screen.getByTestId('theme-canvas-component-button-1');
    const inputNode = screen.getByTestId('theme-canvas-component-input-1');

    fireEvent.dragStart(buttonNode, {
      dataTransfer: {
        setData: vi.fn(),
        effectAllowed: 'move',
      },
    });

    fireEvent.dragOver(inputNode, {
      dataTransfer: {
        dropEffect: 'move',
      },
    });

    const dataTransferMock = {
      getData: vi.fn().mockReturnValue('button'),
    };

    fireEvent.dragEnter(inputNode, { dataTransfer: dataTransferMock });
    fireEvent.drop(inputNode, { dataTransfer: dataTransferMock });

    const newComponents: ThemeComponent[] = onChange.mock.calls[0][0];
    expect(newComponents[0].id).toBe('input-1');
  });
});