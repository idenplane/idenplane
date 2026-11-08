import { mkdtempSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ThemeUploadService } from './theme-upload.service.js';

describe('ThemeUploadService', () => {
  const png = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64');
  let dir: string;
  let cwd: string;
  let service: ThemeUploadService;

  beforeEach(() => {
    cwd = process.cwd();
    dir = mkdtempSync(join(tmpdir(), 'theme-upload-'));
    process.chdir(dir); // the service writes under ./uploads/themes
    const prisma = {
      realm: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'realm-uuid-1', name: 'acme' }),
      },
    };
    service = new ThemeUploadService(prisma as never);
  });

  afterEach(() => {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  });

  const upload = (filename: string, mimeType = 'image/png') =>
    service.uploadAsset('acme', { data: png, filename, mimeType });

  it('returns a URL that main.ts serves: /themes/uploads/<realm id>/<file>', async () => {
    const result = await upload('logo.png');
    expect(result.url).toBe(`/themes/uploads/realm-uuid-1/${result.filename}`);
    expect(
      existsSync(
        join(dir, 'uploads', 'themes', 'realm-uuid-1', result.filename),
      ),
    ).toBe(true);
  });

  it('takes the extension from the MIME type, once', async () => {
    expect((await upload('logo.png')).filename).toMatch(/-logo\.png$/);
    expect((await upload('logo.PNG')).filename).toMatch(/-logo\.png$/);
  });

  it('keeps a name that has no extension', async () => {
    expect((await upload('photo')).filename).toMatch(/-photo\.png$/);
  });
});
