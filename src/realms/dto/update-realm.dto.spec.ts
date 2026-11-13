import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateRealmDto } from './update-realm.dto.js';
import { SECRET_PLACEHOLDER } from '../secret-placeholder.js';

describe('UpdateRealmDto CAPTCHA secret placeholder', () => {
  const secretErrors = async (field: string, value: unknown) => {
    const dto = plainToInstance(UpdateRealmDto, { [field]: value });
    return (await validate(dto)).filter((e) => e.property === field);
  };

  it.each(['recaptchaSecretKey', 'hcaptchaSecretKey'])(
    'accepts the exact placeholder for %s (means "unchanged")',
    async (field) => {
      expect(await secretErrors(field, SECRET_PLACEHOLDER)).toHaveLength(0);
    },
  );

  it.each(['recaptchaSecretKey', 'hcaptchaSecretKey'])(
    'refuses %s typed after the placeholder',
    async (field) => {
      const errors = await secretErrors(field, `${SECRET_PLACEHOLDER}abc`);
      expect(errors).toHaveLength(1);
      expect(JSON.stringify(errors[0].constraints)).toContain(
        'hidden-value marker',
      );
    },
  );

  it('accepts a real secret and an empty string (clears it)', async () => {
    expect(await secretErrors('hcaptchaSecretKey', 'real')).toHaveLength(0);
    expect(await secretErrors('hcaptchaSecretKey', '')).toHaveLength(0);
  });
});

/**
 * Regression guard for idenplane#1153.
 *
 * The Registration Settings form always sends `captchaScoreThreshold: 0.5`
 * (a reCAPTCHA v3 score in the range 0–1). The field was wrongly validated as
 * `@IsInt() @Min(0) @Min(1)`, so every realm-settings save returned 400
 * ("must be an integer number" / "must not be less than 1"). It must accept
 * 0–1 floats and reject values outside that range.
 *
 * UpdateRealmDto inherits the field from CreateRealmDto via
 * PartialType(OmitType(...)), and is the DTO the failing endpoint uses.
 */
async function scoreErrors(value: unknown): Promise<number> {
  const dto = plainToInstance(UpdateRealmDto, { captchaScoreThreshold: value });
  const errors = await validate(dto);
  return errors.filter((e) => e.property === 'captchaScoreThreshold').length;
}

describe('UpdateRealmDto captchaScoreThreshold validation', () => {
  it.each([0, 0.1, 0.5, 0.9, 1])(
    'accepts in-range score %p (0.5 is the form default that previously 400ed)',
    async (value) => {
      expect(await scoreErrors(value)).toBe(0);
    },
  );

  it.each([-0.1, 1.5, 2])('rejects out-of-range score %p', async (value) => {
    expect(await scoreErrors(value)).toBeGreaterThan(0);
  });

  it('allows the field to be omitted (it is optional)', async () => {
    const dto = plainToInstance(UpdateRealmDto, {});
    const errors = await validate(dto);
    expect(
      errors.filter((e) => e.property === 'captchaScoreThreshold'),
    ).toHaveLength(0);
  });
});
