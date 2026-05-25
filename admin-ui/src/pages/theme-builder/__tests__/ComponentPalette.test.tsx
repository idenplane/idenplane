import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { render } from '../../../test/utils';
import ComponentPalette from '../ComponentPalette';

describe('ComponentPalette', () => {
  it('renders the palette with a header', () => {
    render(<ComponentPalette onAddComponent={vi.fn()} />);
    expect(screen.getByText('Components')).toBeInTheDocument();
  });

  it('renders all component types from COMPONENT_DEFINITIONS', () => {
    render(<ComponentPalette onAddComponent={vi.fn()} />);
    // Check a few key components
    expect(screen.getByTestId('palette-component-header')).toBeInTheDocument();
    expect(screen.getByTestId('palette-component-button')).toBeInTheDocument();
    expect(screen.getByTestId('palette-component-form')).toBeInTheDocument();
    expect(screen.getByTestId('palette-component-input')).toBeInTheDocument();
    expect(screen.getByTestId('palette-component-passwordInput')).toBeInTheDocument();
  });

  it('calls onAddComponent when a component is clicked', () => {
    const onAddComponent = vi.fn();
    render(<ComponentPalette onAddComponent={onAddComponent} />);
    fireEvent.click(screen.getByTestId('palette-component-button'));
    expect(onAddComponent).toHaveBeenCalledWith('button');
  });

  it('calls onAddComponent with correct type for different components', () => {
    const onAddComponent = vi.fn();
    render(<ComponentPalette onAddComponent={onAddComponent} />);
    fireEvent.click(screen.getByTestId('palette-component-input'));
    expect(onAddComponent).toHaveBeenCalledWith('input');
  });

  it('components have draggable attribute', () => {
    render(<ComponentPalette onAddComponent={vi.fn()} />);
    const button = screen.getByTestId('palette-component-button');
    expect(button).toHaveAttribute('draggable', 'true');
  });

  it('sets correct data transfer on drag start', () => {
    render(<ComponentPalette onAddComponent={vi.fn()} />);
    const button = screen.getByTestId('palette-component-form');
    const dataTransfer = {
      setData: vi.fn(),
      effectAllowed: '',
    };
    fireEvent.dragStart(button, { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith('application/x-component-type', 'form');
    expect(dataTransfer.effectAllowed).toBe('copy');
  });

  it('renders with correct styling classes', () => {
    render(<ComponentPalette onAddComponent={vi.fn()} />);
    const components = screen.getAllByTestId(/^palette-component-/);
    expect(components.length).toBeGreaterThan(0);
    components.forEach((component) => {
      expect(component.className).toContain('cursor-grab');
    });
  });
});