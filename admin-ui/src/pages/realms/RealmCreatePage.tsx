import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createRealm } from '../../api/realms';
import { getErrorMessage } from '../../utils/getErrorMessage';
import { SectionHeader, Card, Input, Switch, Button, Alert } from '../../components/ui';

export default function RealmCreatePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    name: '',
    displayName: '',
    enabled: true,
    accessTokenLifespan: 300,
    refreshTokenLifespan: 1800,
  });

  const mutation = useMutation({
    mutationFn: () => createRealm(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['realms'] });
      navigate('/console/realms');
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    mutation.mutate();
  }

  return (
    <div className="mx-auto max-w-2xl">
      <SectionHeader title="Create Realm" hint="Set up a new identity realm" />

      <Card padding="lg">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <Input
              id="realmName"
              name="name"
              label="Name"
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. my-realm"
              hint="Unique identifier, lowercase letters, numbers, and hyphens only"
            />
          </div>

          <Input
            id="displayName"
            name="displayName"
            label="Display Name"
            type="text"
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            placeholder="e.g. My Realm"
          />

          <div className="grid grid-cols-2 gap-4">
            <Input
              id="accessTokenLifespan"
              name="accessTokenLifespan"
              label="Access Token Lifespan (seconds)"
              type="number"
              min={1}
              value={form.accessTokenLifespan}
              onChange={(e) =>
                setForm({ ...form, accessTokenLifespan: Number(e.target.value) })
              }
            />
            <Input
              id="refreshTokenLifespan"
              name="refreshTokenLifespan"
              label="Refresh Token Lifespan (seconds)"
              type="number"
              min={1}
              value={form.refreshTokenLifespan}
              onChange={(e) =>
                setForm({ ...form, refreshTokenLifespan: Number(e.target.value) })
              }
            />
          </div>

          <Switch
            checked={form.enabled}
            onChange={(enabled) => setForm({ ...form, enabled })}
            label="Enabled"
          />

          {mutation.isError && (
            <Alert variant="danger">
              {getErrorMessage(mutation.error, 'Failed to create realm.')}
            </Alert>
          )}

          <div className="flex justify-end gap-3 border-t border-line pt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={() => navigate('/console/realms')}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Creating...' : 'Create Realm'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
