import { describe, expect, it } from 'vitest';

import { importEmail, readEmailPart, readEmailPartById } from '../../src';
import { createSeededImportDependencies } from '../helpers/import-harness';

describe('readEmailPart', () => {
  it('reads only the encoded Raw MIME section and returns decoded attachment bytes', async () => {
    const deps = await createSeededImportDependencies();
    const imported = await importEmail(deps.core, deps.input);
    const email = (await deps.core.inspect.email(imported.emailId))!;
    const attachment = email.parts.find(({ kind }) => kind === 'attachment')!;
    const rawBlob = (await deps.core.inspect.blob(attachment.rawBlobId))!;
    const ranges: Array<{ offset: number; length: number }> = [];
    const rawBytes = deps.core.blobStore.snapshot().get(rawBlob.objectKey)!;
    deps.core.blobStore.get = async () => {
      throw new Error('full Raw MIME reads are forbidden for EmailPart');
    };
    deps.core.blobStore.getRange = async (input) => {
      ranges.push({ offset: input.offset, length: input.length });
      return rawBytes.slice(input.offset, input.offset + input.length);
    };

    await expect(
      readEmailPart(deps.core, {
        accountId: deps.input.accountId,
        emailId: email.id,
        partId: attachment.id,
      }),
    ).resolves.toEqual({
      bytes: new Uint8Array([1, 2, 3, 4]),
      contentType: 'application/octet-stream',
      disposition: 'attachment',
      filename: 'sample.bin',
      contentId: null,
      sizeBytes: 4n,
    });
    expect(ranges).toEqual([
      {
        offset: Number(attachment.offsetStart),
        length: Number(attachment.encodedLength),
      },
    ]);
    expect(rawBlob.sizeBytes).toBeGreaterThan(attachment.encodedLength);
  });

  it('rejects a missing part and a truncated object range without leaking storage details', async () => {
    const deps = await createSeededImportDependencies();
    const imported = await importEmail(deps.core, deps.input);
    const email = (await deps.core.inspect.email(imported.emailId))!;
    const attachment = email.parts.find(({ kind }) => kind === 'attachment')!;

    await expect(
      readEmailPart(deps.core, {
        accountId: deps.input.accountId,
        emailId: email.id,
        partId: 'missing-part',
      }),
    ).rejects.toMatchObject({ code: 'BLOB_NOT_FOUND' });

    deps.core.blobStore.getRange = async () => new Uint8Array([1]);
    const error = await readEmailPart(deps.core, {
      accountId: deps.input.accountId,
      emailId: email.id,
      partId: attachment.id,
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: 'BLOB_INTEGRITY' });
    expect(`${String(error)}${JSON.stringify(error)}`).not.toContain('objectKey');
  });

  it('resolves a virtual Blob directly by its account-scoped EmailPart id', async () => {
    const deps = await createSeededImportDependencies();
    const imported = await importEmail(deps.core, deps.input);
    const email = (await deps.core.inspect.email(imported.emailId))!;
    const attachment = email.parts.find(({ kind }) => kind === 'attachment')!;

    await expect(
      readEmailPartById(deps.core, {
        accountId: deps.input.accountId,
        partId: attachment.id,
      }),
    ).resolves.toMatchObject({
      bytes: new Uint8Array([1, 2, 3, 4]),
      filename: 'sample.bin',
      contentType: 'application/octet-stream',
    });
  });
});
