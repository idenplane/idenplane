import { useState, type Dispatch, type SetStateAction } from 'react';

/**
 * Seeds local form state from a fetched entity via `seedFn`, reseeding
 * whenever the entity reference changes (e.g. after a refetch).
 *
 * Adjusts state during render rather than in an effect, avoiding an extra
 * render pass — this replaces the repeated
 * `useState` + comparison-on-render pattern used across several detail
 * pages/forms (`UserDetailPage`, `GeneralSettingsForm`, ...).
 */
export function useFormSeed<TEntity, TForm>(
  entity: TEntity,
  seedFn: (entity: TEntity) => TForm,
): [TForm, Dispatch<SetStateAction<TForm>>] {
  const [form, setForm] = useState(() => seedFn(entity));
  const [seededEntity, setSeededEntity] = useState(entity);

  if (entity !== seededEntity) {
    setSeededEntity(entity);
    setForm(seedFn(entity));
  }

  return [form, setForm];
}
