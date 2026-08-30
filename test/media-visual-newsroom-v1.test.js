import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { initializeAtlasSchema } from "../src/atlasSchema.js";
import { buildSourceRegistry } from "../src/atlasSourceRegistry.js";
import { openAtlasStore } from "../src/atlasStore.js";
import { loadConfig } from "../src/config.js";
import { parseFeedItems } from "../src/atlasParsers.js";
import { createIntelDocument } from "../src/documents/normalize.js";
import { rebuildEventForStory } from "../src/atlasEvents.js";
import { attachDocumentToStory } from "../src/atlasStories.js";
import { collapseFailedVisual, renderVisual, safeMediaUrl } from "../public/newsroomMedia.js";

test("媒體正規化會去重、阻擋本機位址，並只允許核准的 HTTPS remote embed", () => {
  const source = fixtureSource();
  const document = createIntelDocument(source, {
    externalId: "media-contract",
    title: "Media contract fixture",
    url: "https://example.test/articles/1",
    media: [
      { url: "https://images.example.test/hero.jpg?utm_source=feed", width: 1200, height: 675, mimeType: "image/jpeg" },
      { url: "https://images.example.test/hero.jpg", role: "thumbnail", width: 320, height: 180 },
      { url: "http://images.example.test/insecure.jpg" },
      { url: "https://127.0.0.1/private.jpg" },
      { url: "https://images.example.test/vector.svg", mimeType: "image/svg+xml" },
      { url: "https://unapproved.example.test/photo.jpg" }
    ]
  }, "2026-08-30T00:00:00.000Z");

  assert.equal(document.media.length, 3);
  assert.equal(document.media.filter((media) => media.is_representative).length, 1);
  assert.equal(document.media[0].url, "https://images.example.test/hero.jpg");
  assert.equal(document.media[0].display_policy, "remote_embed");
  assert.equal(document.media.find((media) => media.url.startsWith("http:"))?.display_policy, "candidate");
  assert.equal(document.media.find((media) => media.url.includes("unapproved"))?.display_policy, "candidate");
  assert.ok(document.media.every((media) => !media.url.includes("127.0.0.1")));
});

test("remote_embed policy 必須另有展示授權證據與審核時間", () => {
  const source = fixtureSource();
  source.mediaPolicy = {
    version: "missing-display-authorization",
    default_display_policy: "remote_embed",
    rights_class: "publisher_owned",
    allowed_hosts: ["images.example.test"],
    reason: "Ownership alone must not imply display permission."
  };

  assert.throws(() => createIntelDocument(source, {
    externalId: "unauthorized-media",
    title: "Unauthorized media fixture",
    url: "https://example.test/articles/unauthorized",
    media: [{ url: "https://images.example.test/unauthorized.jpg" }]
  }), /explicit display authorization/);
});

test("BBC RSS 圖片只在明確的個人非商業 runtime context 開放", () => {
  const defaultRegistry = buildSourceRegistry(loadConfig({ ATLAS_AUTO_COLLECT: "false" }));
  const defaultPolicy = defaultRegistry.get("bbc-world-rss").mediaPolicy;
  assert.equal(defaultPolicy.default_display_policy, "candidate");
  assert.equal(defaultPolicy.display_authorization, "public_terms");
  assert.deepEqual(defaultPolicy.allowed_hosts, ["ichef.bbci.co.uk"]);

  const personalRegistry = buildSourceRegistry(loadConfig({
    ATLAS_AUTO_COLLECT: "false",
    ATLAS_MEDIA_USAGE_CONTEXT: "personal_noncommercial"
  }));
  const personalPolicy = personalRegistry.get("bbc-world-rss").mediaPolicy;
  assert.equal(personalPolicy.default_display_policy, "remote_embed");
  assert.equal(personalPolicy.rights_class, "licensed");
  assert.match(personalPolicy.terms_url, /^https:\/\/downloads\.bbc\.co\.uk\//);

  const invalidRegistry = buildSourceRegistry(loadConfig({
    ATLAS_AUTO_COLLECT: "false",
    ATLAS_MEDIA_USAGE_CONTEXT: "commercial"
  }));
  assert.equal(invalidRegistry.get("bbc-world-rss").mediaPolicy.default_display_policy, "candidate");
});

test("RSS 與 Atom media tags 只投影圖片 enclosure", () => {
  const [item] = parseFeedItems(`
    <rss xmlns:media="http://search.yahoo.com/mrss/"><channel><item>
      <title>Visual report</title><link>https://example.test/report</link>
      <media:content url="https://cdn.example.test/main.webp" type="image/webp" width="1280" height="720" />
      <media:thumbnail url="https://cdn.example.test/thumb.jpg" width="320" height="180" />
      <enclosure url="https://cdn.example.test/podcast.mp3" type="audio/mpeg" />
    </item></channel></rss>
  `);

  assert.deepEqual(item.media.map((media) => media.role), ["main", "thumbnail"]);
  assert.deepEqual(item.media.map((media) => media.url), [
    "https://cdn.example.test/main.webp",
    "https://cdn.example.test/thumb.jpg"
  ]);
});

test("schema v5 可從 v3 形狀 additive migration，且 representative invariant 由資料庫保護", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "atlas-media-schema-"));
  const dbPath = join(tempRoot, "atlas.sqlite");
  const legacy = new DatabaseSync(dbPath);
  legacy.exec(`
    CREATE TABLE sources (id TEXT PRIMARY KEY, catchup_mode TEXT NOT NULL DEFAULT 'latest_only');
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    INSERT INTO schema_migrations VALUES (1, '2026-08-01T00:00:00.000Z'), (2, '2026-08-02T00:00:00.000Z'), (3, '2026-08-03T00:00:00.000Z');
  `);
  initializeAtlasSchema(legacy);
  assert.ok(legacy.prepare("PRAGMA table_info(sources)").all().some((column) => column.name === "media_policy_json"));
  assert.ok(legacy.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'document_media'").get());
  assert.ok(legacy.prepare("SELECT 1 FROM schema_migrations WHERE version = 4").get());
  legacy.close();
  rmSync(tempRoot, { recursive: true, force: true });
});

test("Document 與 media 會在同一寫入流程保存並投影 representative media", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "atlas-media-store-"));
  const store = openAtlasStore(join(tempRoot, "atlas.sqlite"));
  const source = fixtureSource();
  try {
    store.registerSources([source]);
    const document = createIntelDocument(source, {
      externalId: "stored-media",
      title: "Stored media fixture",
      url: "https://example.test/articles/stored",
      media: [{ url: "https://images.example.test/stored.jpg", width: 1600, height: 900, altText: "Evidence image" }]
    }, "2026-08-30T00:00:00.000Z");
    store.upsertDocument(document, null, null, "2026-08-30T00:00:00.000Z");

    const saved = store.getDocument(document.id);
    assert.equal(saved.media.length, 1);
    assert.equal(saved.representative_media.display_policy, "remote_embed");
    assert.equal(store.listDocuments({ limit: 5 }).items[0].representative_media.url, "https://images.example.test/stored.jpg");
    assert.equal(store.getStats().document_media, 1);

    assert.throws(() => store.db.prepare(`
      INSERT INTO document_media (
        id, document_id, source_id, kind, role, url, normalized_url, thumbnail_url,
        origin, mime_type, width, height, alt_text, attribution, rights_class,
        display_policy, policy_version, policy_reason, is_representative, first_seen_at, last_seen_at
      ) SELECT 'media:duplicate', document_id, source_id, kind, role,
        'https://images.example.test/second.jpg', 'https://images.example.test/second.jpg', thumbnail_url,
        origin, mime_type, width, height, alt_text, attribution, rights_class,
        display_policy, policy_version, policy_reason, 1, first_seen_at, last_seen_at
      FROM document_media LIMIT 1
    `).run(), /UNIQUE constraint failed/);
  } finally {
    store.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("Story 與 Event 會優先選 supporting Document 的合法 remote media 並保留 lineage", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "atlas-media-selection-"));
  const store = openAtlasStore(join(tempRoot, "atlas.sqlite"));
  const candidateSource = fixtureSource({
    id: "candidate-source",
    authorityClass: "official",
    mediaPolicy: candidateMediaPolicy("candidate-policy")
  });
  const remoteSource = fixtureSource({ id: "remote-source", authorityClass: "professional_media" });
  const now = "2026-08-30T01:00:00.000Z";

  try {
    store.registerSources([candidateSource, remoteSource], now);
    const candidateDocument = createIntelDocument(candidateSource, {
      externalId: "selection-candidate",
      title: "Shared policy event",
      url: "https://example.test/articles/selection-candidate",
      eventKey: "shared-policy-event",
      eventTypeCandidate: "politics.regulation",
      media: [{ url: "https://images.example.test/candidate.jpg" }]
    }, now);
    const remoteDocument = createIntelDocument(remoteSource, {
      externalId: "selection-remote",
      title: "Shared policy event",
      url: "https://example.test/articles/selection-remote",
      eventKey: "shared-policy-event",
      eventTypeCandidate: "politics.regulation",
      media: [{ url: "https://images.example.test/supporting.jpg" }]
    }, now);

    const savedCandidate = store.upsertDocument(candidateDocument, null, null, now).document;
    const first = attachDocumentToStory(store, savedCandidate, now);
    rebuildEventForStory(store, first.storyId, now);
    const savedRemote = store.upsertDocument(remoteDocument, null, null, now).document;
    const second = attachDocumentToStory(store, savedRemote, now);
    rebuildEventForStory(store, second.storyId, now);

    const story = store.getStory(first.storyId);
    const event = store.getStoryEvent(first.storyId);
    assert.equal(story.representative_document_id, candidateDocument.id, "official candidate remains the Story representative Document");
    assert.equal(story.representative_media.display_policy, "remote_embed");
    assert.equal(story.representative_media.document_id, remoteDocument.id);
    assert.equal(story.representative_media.source_id, remoteSource.id);
    assert.equal(event.representative_document_id, candidateDocument.id, "official candidate remains the Event representative Document");
    assert.equal(event.representative_media.document_id, remoteDocument.id);
    assert.equal(event.representative_media.source_id, remoteSource.id);
  } finally {
    store.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("current source policy 降級會在無 refetch 下立即降低 persisted remote media", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "atlas-media-downgrade-"));
  const dbPath = join(tempRoot, "atlas.sqlite");
  const source = fixtureSource({ id: "downgrade-source" });
  const now = "2026-08-30T02:00:00.000Z";
  let store = openAtlasStore(dbPath);

  try {
    store.registerSources([source], now);
    const document = createIntelDocument(source, {
      externalId: "downgrade-media",
      title: "Policy downgrade fixture",
      url: "https://example.test/articles/downgrade",
      eventKey: "policy-downgrade-event",
      eventTypeCandidate: "politics.regulation",
      media: [{ url: "https://images.example.test/downgrade.jpg" }]
    }, now);
    const saved = store.upsertDocument(document, null, null, now).document;
    const story = attachDocumentToStory(store, saved, now);
    const event = rebuildEventForStory(store, story.storyId, now);
    assert.equal(store.getEvent(event.id).representative_media.display_policy, "remote_embed");
    store.close();

    store = openAtlasStore(dbPath);
    store.registerSources([fixtureSource({
      id: source.id,
      mediaPolicy: candidateMediaPolicy("downgraded-policy")
    })], "2026-08-30T02:05:00.000Z");

    const persisted = store.db.prepare("SELECT display_policy FROM document_media WHERE document_id = ?").get(document.id);
    assert.equal(persisted.display_policy, "remote_embed", "ingestion evidence remains unchanged");
    for (const media of [
      store.getDocument(document.id).representative_media,
      store.getStory(story.storyId).representative_media,
      store.getEvent(event.id).representative_media
    ]) {
      assert.equal(media.display_policy, "candidate");
      assert.equal(media.document_id, document.id);
      assert.equal(media.source_id, source.id);
      assert.equal(media.policy_version, "downgraded-policy");
    }
  } finally {
    try { store.close(); } catch {}
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("Newsroom 只有 remote_embed 才輸出圖片，其他 policy 直接收合", () => {
  for (const displayPolicy of [null, "candidate", "link_only", "blocked"]) {
    const media = displayPolicy ? { display_policy: displayPolicy, url: "https://images.example.test/news.jpg" } : null;
    assert.equal(renderVisual(media, { title: "Policy fixture", variant: "lead" }), "");
  }

  const remote = {
    display_policy: "remote_embed",
    url: "https://images.example.test/news.jpg",
    attribution: "Fixture publisher",
    rights_class: "licensed"
  };
  const markup = renderVisual(remote, { title: "Policy fixture", variant: "lead", priority: true });
  assert.equal(safeMediaUrl(remote), "https://images.example.test/news.jpg");
  assert.match(markup, /data-newsroom-media/);
  assert.match(markup, /news-visual--lead/);
  assert.match(markup, /loading="eager"/);
  assert.match(markup, /alt=""/);
  assert.doesNotMatch(markup, /fallback|SOURCE IMAGE UNAVAILABLE|ATLAS EDITORIAL/);
});

test("載入失敗的來源圖片會移除整個 visual，並留下不可見診斷狀態", () => {
  const attributes = new Map();
  let removed = false;
  let sourceRemoved = false;
  const container = { setAttribute: (name, value) => attributes.set(name, value) };
  const visual = { parentElement: container, remove: () => { removed = true; } };
  const image = {
    hidden: false,
    matches: (selector) => selector === "img[data-newsroom-media]",
    closest: () => visual,
    removeAttribute: (name) => { if (name === "src") sourceRemoved = true; }
  };

  assert.equal(collapseFailedVisual(image), true);
  assert.equal(attributes.get("data-media-state"), "failed");
  assert.equal(image.hidden, true);
  assert.equal(sourceRemoved, true);
  assert.equal(removed, true);
});

function fixtureSource(overrides = {}) {
  const source = {
    id: "media-fixture-source",
    name: "Media Fixture Source",
    providerType: "test",
    sourceClass: "publisher",
    authorityClass: "professional_media",
    documentType: "news",
    domains: ["politics"],
    languages: ["en"],
    countries: ["US"],
    homepage: "https://example.test",
    docsUrl: "https://example.test/docs",
    attribution: "Media fixture",
    policyNote: "Test only",
    mediaPolicy: {
      version: "fixture-media-v1",
      default_display_policy: "remote_embed",
      rights_class: "publisher_owned",
      display_authorization: "explicit_license",
      allowed_hosts: ["images.example.test"],
      terms_url: "https://example.test/media-license",
      reviewed_at: "2026-08-30T00:00:00.000Z",
      reason: "Fixture publisher authorizes remote display."
    },
    cadenceMs: 60_000,
    timeoutMs: 1_000,
    catchupMode: "latest_only",
    enabled: true,
    disabledReason: null,
    cadence: "1m"
  };
  return { ...source, ...overrides };
}

function candidateMediaPolicy(version) {
  return {
    version,
    default_display_policy: "candidate",
    rights_class: "unknown",
    display_authorization: "not_reviewed",
    allowed_hosts: [],
    terms_url: null,
    reviewed_at: null,
    reason: "Remote display is not currently authorized."
  };
}
