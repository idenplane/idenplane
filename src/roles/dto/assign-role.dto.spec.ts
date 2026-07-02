import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AssignRolesDto } from './assign-role.dto.js';

describe('AssignRolesDto', () => {
  describe('effectiveNames getter', () => {
    it('resolves names from roleNames array', () => {
      const dto = plainToInstance(AssignRolesDto, {
        roleNames: ['admin', 'user'],
      });
      expect(dto.effectiveNames).toEqual(['admin', 'user']);
    });

    it('resolves names from roles[].name when roleNames absent', () => {
      const dto = plainToInstance(AssignRolesDto, {
        roles: [{ name: 'admin' }],
      });
      expect(dto.effectiveNames).toEqual(['admin']);
    });

    it('resolves names from roles with extra id field (Keycloak shape)', () => {
      const dto = plainToInstance(AssignRolesDto, {
        roles: [{ id: 'abc-123', name: 'admin' }],
      });
      expect(dto.effectiveNames).toEqual(['admin']);
    });

    it('returns empty array when both roleNames and roles are absent', () => {
      const dto = plainToInstance(AssignRolesDto, {});
      expect(dto.effectiveNames).toEqual([]);
    });

    it('prefers roleNames over roles when both are present', () => {
      const dto = plainToInstance(AssignRolesDto, {
        roleNames: ['admin'],
        roles: [{ name: 'viewer' }],
      });
      expect(dto.effectiveNames).toEqual(['admin']);
    });

    it('never throws TypeError on undefined roleNames or roles', () => {
      const dto = new AssignRolesDto();
      expect(() => dto.effectiveNames).not.toThrow();
      expect(dto.effectiveNames).toEqual([]);
    });
  });

  describe('validation', () => {
    it('passes validation for roleNames format', async () => {
      const dto = plainToInstance(AssignRolesDto, {
        roleNames: ['admin', 'user'],
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('passes validation for roles format without id', async () => {
      const dto = plainToInstance(AssignRolesDto, {
        roles: [{ name: 'admin' }],
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('passes validation for Keycloak shape with id field', async () => {
      const dto = plainToInstance(AssignRolesDto, {
        roles: [{ id: 'abc-123', name: 'admin' }],
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('passes validation for empty object (no crash)', async () => {
      const dto = plainToInstance(AssignRolesDto, {});
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });
  });
});
