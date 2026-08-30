import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  briefHighlights,
  buildBriefPath,
  coverageGapMessages,
  normalizePresentation,
  presentationFromSearch
} from "../public/newsroomPresentationModel.js";

test("Newsroom presentation 只接受 canonical profiles 並建立 bounded brief query", () => {
  assert.equal(normalizePresentation("east_asia"), "east_asia");
  assert.equal(normalizePresentation("unknown-profile"), "global");
  assert.equal(presentationFromSearch("?presentation=japan_focus"), "japan_focus");
  assert.equal(presentationFromSearch("?presentation=invalid"), "global");

  const url = new URL(buildBriefPath("taiwan_focus", 999), "http://atlas.test");
  assert.equal(url.pathname, "/api/v1/brief");
  assert.equal(url.searchParams.get("presentation"), "taiwan_focus");
  assert.equal(url.searchParams.get("limit"), "200");
});

test("區域摘要沒有 highlights 時不從其他 Event surface 補內容", () => {
  const regionalEnvelope = {
    data: {
      selection: {
        presentation: "east_asia",
        selected_count: 0,
        requested_count: 8,
        coverage_gaps: ["no_qualified_regional_events", "qualified_event_shortfall"]
      },
      highlights: []
    }
  };
  assert.deepEqual(briefHighlights(regionalEnvelope), []);
  assert.deepEqual(briefHighlights({ data: { highlights: [{ id: "event-1" }] } }).map((event) => event.id), ["event-1"]);

  const messages = coverageGapMessages(regionalEnvelope.data.selection, "east_asia");
  assert.equal(messages.length, 2);
  assert.match(messages[0], /東亞視角目前沒有/);
  assert.match(messages[1], /沒有用其他地區或低品質內容補滿/);
});

test("首頁以 backend brief 同時驅動 Hero、Live Desk 與可見 coverage gap", () => {
  const index = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const newsroom = readFileSync(new URL("../public/newsroom.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../public/newsroom.css", import.meta.url), "utf8");

  assert.match(index, /id="brief-lens-options"/);
  assert.match(index, /name="presentation" value="east_asia"/);
  assert.match(index, /id="brief-lens-status"[^>]*aria-live="polite"/);
  assert.match(newsroom, /buildBriefPath\(state\.presentation\)/);
  assert.match(newsroom, /const highlights = briefHighlights\(state\.briefEnvelope\)/);
  assert.doesNotMatch(newsroom, /\|\| highlight \|\| events\[0\]/);
  assert.match(css, /\.brief-lens__options input:focus-visible \+ span/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.brief-lens__options[\s\S]*repeat\(2/);
});
