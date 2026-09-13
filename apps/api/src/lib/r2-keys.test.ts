// Pure — no R2, no Postgres, nothing running (`testing` skill §3).
//
// Every assertion is a literal string, deliberately: DATABASE.md DB§16's
// grammar is the contract, and a test that rebuilt the expected key from
// the same template the implementation uses would pass for any grammar at
// all. Read these strings against DB§16, not against r2-keys.ts.
import {
  avatarKey,
  brandLogoKey,
  exportKey,
  exportPrefix,
  mediaHlsManifestKey,
  mediaHlsSegmentKey,
  mediaOriginalKey,
  mediaPosterKey,
  mediaThumbKey,
  photoOriginalKey,
} from './r2-keys.ts';

const USER = '7f1c4a2e-0000-7000-8000-0000000000a1';
const ASSET = '7f1c4a2e-0000-7000-8000-0000000000b2';
const CLIENT = '7f1c4a2e-0000-7000-8000-0000000000c3';
const COACH = '7f1c4a2e-0000-7000-8000-0000000000d4';
const EXPORT = '7f1c4a2e-0000-7000-8000-0000000000e5';

describe('media/ keys', () => {
  it('mediaOriginalKey — media/{userId}/{assetId}/original.{ext}', () => {
    expect(mediaOriginalKey(USER, ASSET, 'mp4')).toBe(`media/${USER}/${ASSET}/original.mp4`);
    expect(mediaOriginalKey(USER, ASSET, 'mov')).toBe(`media/${USER}/${ASSET}/original.mov`);
    expect(mediaOriginalKey(USER, ASSET, 'heic')).toBe(`media/${USER}/${ASSET}/original.heic`);
  });

  it('mediaHlsManifestKey — media/{userId}/{assetId}/hls/manifest.m3u8', () => {
    expect(mediaHlsManifestKey(USER, ASSET)).toBe(`media/${USER}/${ASSET}/hls/manifest.m3u8`);
  });

  it('mediaHlsSegmentKey — media/{userId}/{assetId}/hls/{variant}/segment_{n}.ts', () => {
    expect(mediaHlsSegmentKey(USER, ASSET, '720p', 0)).toBe(
      `media/${USER}/${ASSET}/hls/720p/segment_0.ts`,
    );
    expect(mediaHlsSegmentKey(USER, ASSET, '480p', 12)).toBe(
      `media/${USER}/${ASSET}/hls/480p/segment_12.ts`,
    );
  });

  // A fractional or NaN index writes an object nothing will ever ask for
  // again — the segment is referenced from a sub-playlist built by the same
  // loop, so playback fails silently rather than loudly. Refuse instead.
  it('mediaHlsSegmentKey rejects a non-integer or negative index', () => {
    expect(() => mediaHlsSegmentKey(USER, ASSET, '720p', 1.5)).toThrow();
    expect(() => mediaHlsSegmentKey(USER, ASSET, '720p', -1)).toThrow();
    expect(() => mediaHlsSegmentKey(USER, ASSET, '720p', Number.NaN)).toThrow();
  });

  it('mediaThumbKey — media/{userId}/{assetId}/thumb.jpg', () => {
    expect(mediaThumbKey(USER, ASSET)).toBe(`media/${USER}/${ASSET}/thumb.jpg`);
  });

  it('mediaPosterKey — media/{userId}/{assetId}/poster.jpg', () => {
    expect(mediaPosterKey(USER, ASSET)).toBe(`media/${USER}/${ASSET}/poster.jpg`);
  });
});

describe('non-media keys', () => {
  // DB§16 keys this one on the *client* profile, not the owner user, and
  // fixes the extension at .jpg — the highest-sensitivity object in the
  // product (DB§18).
  it('photoOriginalKey — photos/{clientId}/{assetId}/original.jpg', () => {
    expect(photoOriginalKey(CLIENT, ASSET)).toBe(`photos/${CLIENT}/${ASSET}/original.jpg`);
  });

  // Note the shape: no per-asset folder, unlike media/ and photos/.
  it('avatarKey — avatars/{userId}/{assetId}.jpg', () => {
    expect(avatarKey(USER, ASSET)).toBe(`avatars/${USER}/${ASSET}.jpg`);
  });

  // One logo per coach, so the coach id alone addresses it.
  it('brandLogoKey — brand/{coachId}/logo.png', () => {
    expect(brandLogoKey(COACH)).toBe(`brand/${COACH}/logo.png`);
  });

  it('exportKey — exports/{userId}/{exportId}.zip', () => {
    expect(exportKey(USER, EXPORT)).toBe(`exports/${USER}/${EXPORT}.zip`);
  });

  it('exportPrefix — exports/{userId}/', () => {
    expect(exportPrefix(USER)).toBe(`exports/${USER}/`);
  });

  // The purge deletes by this prefix, so an exportKey landing outside it
  // would survive a delete that reported success.
  it('exportPrefix contains every exportKey for that user', () => {
    expect(exportKey(USER, EXPORT).startsWith(exportPrefix(USER))).toBe(true);
  });
});

describe('DB§16 prefixes', () => {
  // The lifecycle rules in DB§16 and the orphan sweep are both written
  // against these four prefixes. A key that landed under the wrong one
  // would silently opt out of its retention rule.
  it('every key sits under its declared top-level prefix', () => {
    expect(mediaOriginalKey(USER, ASSET, 'mp4').startsWith('media/')).toBe(true);
    expect(mediaHlsManifestKey(USER, ASSET).startsWith('media/')).toBe(true);
    expect(mediaHlsSegmentKey(USER, ASSET, '720p', 0).startsWith('media/')).toBe(true);
    expect(mediaThumbKey(USER, ASSET).startsWith('media/')).toBe(true);
    expect(mediaPosterKey(USER, ASSET).startsWith('media/')).toBe(true);
    expect(photoOriginalKey(CLIENT, ASSET).startsWith('photos/')).toBe(true);
    expect(avatarKey(USER, ASSET).startsWith('avatars/')).toBe(true);
    expect(brandLogoKey(COACH).startsWith('brand/')).toBe(true);
    expect(exportKey(USER, EXPORT).startsWith('exports/')).toBe(true);
  });

  // DB§16's lifecycle rule is "media/*/original.* once HLS exists (30d)".
  // The rule is a prefix+suffix match on R2, so the original must stay the
  // only object whose basename starts with `original`.
  it('only the original carries the original.* basename', () => {
    const hlsAndDerived = [
      mediaHlsManifestKey(USER, ASSET),
      mediaHlsSegmentKey(USER, ASSET, '720p', 0),
      mediaThumbKey(USER, ASSET),
      mediaPosterKey(USER, ASSET),
    ];
    for (const key of hlsAndDerived) {
      expect(key.split('/').pop()?.startsWith('original')).toBe(false);
    }
  });
});
