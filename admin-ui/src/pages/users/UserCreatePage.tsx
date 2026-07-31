import { useState, type FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createUser } from '../../api/users';
import { getErrorMessage } from '../../utils/getErrorMessage';
import PasswordInput from '../../components/PasswordInput';
import { SectionHeader, Card, Input, Switch, Button, Alert } from '../../components/ui';

export default function UserCreatePage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    username: '',
    email: '',
    firstName: '',
    lastName: '',
    password: '',
    enabled: true,
  });

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        ...form,
        email: form.email.trim() || undefined,
        firstName: form.firstName.trim() || undefined,
        lastName: form.lastName.trim() || undefined,
      };
      return createUser(name!, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users', name] });
      navigate(`/console/realms/${name}/users`);
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    mutation.mutate();
  }

  return (
    <div className="mx-auto max-w-2xl">
      <SectionHeader
        title="Create User"
        hint={
          <>
            Add a new user to <span className="font-medium">{name}</span>
          </>
        }
      />

      <Card padding="lg">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <Input
              id="username"
              name="username"
              label="Username"
              type="text"
              required
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
            />
            <Input
              id="email"
              name="email"
              label="Email"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input
              id="firstName"
              name="firstName"
              label="First Name"
              type="text"
              value={form.firstName}
              onChange={(e) => setForm({ ...form, firstName: e.target.value })}
            />
            <Input
              id="lastName"
              name="lastName"
              label="Last Name"
              type="text"
              value={form.lastName}
              onChange={(e) => setForm({ ...form, lastName: e.target.value })}
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-fg">
              Password
            </label>
            <PasswordInput
              id="password"
              name="password"
              required
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="w-full rounded-md border border-line-strong px-3 py-2 text-sm text-fg outline-none focus:border-accent"
            />
          </div>

          <Switch
            checked={form.enabled}
            onChange={(enabled) => setForm({ ...form, enabled })}
            label="Enabled"
          />

          {mutation.isError && (
            <Alert variant="danger" aria-live="assertive" aria-atomic="true">
              {getErrorMessage(mutation.error, 'Failed to create user.')}
            </Alert>
          )}

          <div className="flex justify-end gap-3 border-t border-line pt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={() => navigate(`/console/realms/${name}/users`)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Creating...' : 'Create User'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
