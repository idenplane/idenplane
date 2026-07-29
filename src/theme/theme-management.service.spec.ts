import { BadRequestException } from '@nestjs/common';
import { ThemeService } from './theme.service.js';

describe('ThemeService theme management', () => {
  const realm = {
    id: 'realm-1',
    loginTheme: 'active-login',
    accountTheme: 'idenplane',
    emailTheme: 'idenplane',
  };
  const activeTheme = {
    id: 'theme-1',
    realmId: realm.id,
    name: 'active-login',
    themeType: 'login',
    published: true,
    updatedAt: new Date(),
  };
  const draftTheme = {
    id: 'theme-2',
    realmId: realm.id,
    name: 'draft-login',
    themeType: 'login',
    published: false,
    updatedAt: new Date(),
  };

  let prisma: {
    realm: {
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    theme: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };
  let service: ThemeService;

  beforeEach(() => {
    prisma = {
      realm: {
        findUnique: jest.fn().mockResolvedValue(realm),
        update: jest.fn(),
      },
      theme: {
        findMany: jest.fn().mockResolvedValue([activeTheme, draftTheme]),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    service = new ThemeService(prisma as never);
  });

  it('marks themes used by the realm as active and applies the active filter', async () => {
    const themes = await service.findAllByRealm(realm.id, { isActive: true });

    expect(themes).toEqual([{ ...activeTheme, isActive: true }]);
  });

  it('rejects deleting an active theme', async () => {
    prisma.theme.findUnique.mockResolvedValue({
      ...activeTheme,
      realm,
    });

    await expect(service.deleteTheme(activeTheme.id)).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.theme.delete).not.toHaveBeenCalled();
  });

  it('rejects archiving an active theme', async () => {
    prisma.theme.findUnique.mockResolvedValue({
      ...activeTheme,
      realm,
    });

    await expect(service.archiveTheme(activeTheme.id)).rejects.toThrow(
      "Cannot archive active theme 'active-login'",
    );
    expect(prisma.theme.update).not.toHaveBeenCalled();
  });

  it('allows deleting an inactive theme', async () => {
    prisma.theme.findUnique.mockResolvedValue({
      ...draftTheme,
      realm,
    });
    prisma.theme.delete.mockResolvedValue(draftTheme);

    await expect(service.deleteTheme(draftTheme.id)).resolves.toEqual(
      draftTheme,
    );
    expect(prisma.theme.delete).toHaveBeenCalledWith({
      where: { id: draftTheme.id },
    });
  });
});
