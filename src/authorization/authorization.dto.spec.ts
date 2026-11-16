import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreatePolicyDto, UpdatePolicyDto } from './authorization.dto.js';

async function errors(
  cls: typeof CreatePolicyDto | typeof UpdatePolicyDto,
  body: object,
) {
  const result = await validate(plainToInstance(cls, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return result.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('policy DTOs: condition validation', () => {
  it('accepts every known operator with a fitting value', async () => {
    await expect(
      errors(CreatePolicyDto, {
        name: 'ok',
        effect: 'DENY',
        subjectConditions: [
          { field: 'subject.roles', operator: 'contains', value: 'admin' },
          { field: 'subject.userId', operator: 'notEquals', value: 'x' },
        ],
        resourceConditions: [
          { field: 'resource.type', operator: 'equals', value: 'report' },
          { field: 'resource.type', operator: 'matches', value: '^rep' },
        ],
        actionConditions: [
          { field: 'action', operator: 'in', value: ['read'] },
          { field: 'action', operator: 'notIn', value: ['delete'] },
        ],
        environmentConditions: [
          {
            field: 'environment.ip',
            operator: 'ipInRange',
            value: '2001:db8::/32',
          },
          {
            field: 'subject.attributes.level',
            operator: 'greaterThan',
            value: 1,
          },
          {
            field: 'subject.attributes.level',
            operator: 'lessThan',
            value: '9',
          },
        ],
      }),
    ).resolves.toEqual([]);
  });

  it.each([CreatePolicyDto, UpdatePolicyDto])(
    '%p refuses an unknown operator, naming the condition',
    async (cls) => {
      const messages = await errors(cls, {
        name: 'typo',
        subjectConditions: [
          { field: 'subject.roles', operator: 'contains', value: 'a' },
          { field: 'subject.roles', operator: 'contain', value: 'a' },
        ],
      });
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatch(
        /^subjectConditions\[1\]: unknown operator "contain"/,
      );
    },
  );

  it.each([
    [
      'environmentConditions',
      { field: 'environment.ip', operator: 'ipInRange', value: '10.0.0.0/33' },
    ],
    ['actionConditions', { field: 'action', operator: 'in', value: 'read' }],
    [
      'resourceConditions',
      { field: 'resource.type', operator: 'matches', value: '(' },
    ],
    ['subjectConditions', { operator: 'equals', value: 'x' }],
  ])('refuses a bad %s entry', async (category, condition) => {
    const messages = await errors(CreatePolicyDto, {
      name: 'bad',
      [category]: [condition],
    });
    expect(messages.join(' ')).toContain(`${category}[0]:`);
  });
});
