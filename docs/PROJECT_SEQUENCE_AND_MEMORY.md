# YT Longform Studio - Sequence Diagrams and Project Memory

This document is a working memory map for the project. It combines sequence
diagrams with notes that should help the next coding session resume quickly.

## Project Memory Snapshot

- Purpose: generate Indonesian YouTube longform educational videos with AI story
  planning, image/B-roll generation, per-scene TTS, subtitle alignment, FFmpeg
  rendering, remote hosting upload, and YouTube publishing.
- Main Node entrypoints: `src/run-once.js`, `src/server.js`,
  `src/preflight.js`, `src/rerender.js`, `src/upload-only.js`,
  `src/sftp-cleanup.js`.
- Vercel API entrypoints: `api/auth.js`, `api/state.js`, `api/run.js`,
  `api/queue.js`, `api/preflight.js`.
- Local desktop app: `app/yt_studio.py`, which runs Node commands locally and
  parses progress markers from stdout.
- Public dashboard: `public/index.html`, `public/app.js`, `public/styles.css`.
- Persistent state: `data/items.json` for active local items and
  `data/memory.json` for compact long-term continuity memory. Remote hosting
  mirrors state under `state/items.json` and `state/memory.json`.
- Generated assets: `generated/images`, `generated/clips`, `generated/audio`,
  `generated/thumbnails`, `generated/videos`, `generated/storyboards`,
  `generated/work`.
- Core invariant before render: every non-reaction scene must have at least one
  video clip or image for each visual segment, and at least one scene audio
  entry must exist.
- External services: OpenAI for story/image/TTS/transcription, ElevenLabs for
  alternative TTS, Pexels for B-roll, Wikipedia for optional fact grounding,
  SFTP/FTP for media hosting, GitHub Actions for cloud generation, YouTube Data
  API for publish/trending/playlist.

## 1. Dashboard Generate Through Vercel and GitHub Actions

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant Browser as public/app.js
  participant Auth as api/auth.js
  participant RunApi as api/run.js
  participant Utils as api/_utils.js
  participant GitHub as GitHub Actions API
  participant Workflow as yt-longform-generate.yml
  participant Runner as src/run-once.js
  participant Remote as SFTP/FTP hosting
  participant YouTube as YouTube API

  User->>Browser: Open dashboard and submit PIN
  Browser->>Auth: POST /api/auth { pin }
  Auth->>Utils: checkLoginRate, safeEqual, setSessionCookie
  Auth-->>Browser: ok + session cookie
  User->>Browser: Click Generate Sekarang
  Browser->>RunApi: POST /api/run with topic/category/scenes/etc.
  RunApi->>Utils: requireAuth, clamp inputs
  RunApi->>GitHub: workflow_dispatch
  GitHub-->>RunApi: 204 queued
  RunApi-->>Browser: status queued
  GitHub->>Workflow: Start workflow job
  Workflow->>Workflow: checkout, setup Node, restore cache
  Workflow->>Workflow: install FFmpeg/deps, npm run check, npm test, preflight
  Workflow->>Runner: npm run run:once -- inputs
  Runner->>Remote: import remote items/memory if enabled
  Runner->>Runner: generateFullItem()
  Runner->>Remote: upload assets and state
  Runner->>YouTube: publish video and thumbnail
  Runner->>Remote: sync state again after publish
  Runner-->>Workflow: done JSON + progress logs
```

## 2. Dashboard State, Runs, and Queue

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant Browser as public/app.js
  participant StateApi as api/state.js
  participant QueueApi as api/queue.js
  participant PreflightApi as api/preflight.js
  participant Utils as api/_utils.js
  participant Hosting as PUBLIC_BASE_URL/state
  participant GitHub as GitHub Actions API
  participant Remote as SFTP/FTP state writer

  Browser->>StateApi: GET /api/state every 15s
  StateApi->>Utils: requireAuth
  StateApi->>Hosting: fetch items.json and queue.json
  StateApi->>GitHub: list recent workflow runs
  alt latest run is queued/in_progress
    StateApi->>GitHub: fetch jobs and steps for active run
  end
  StateApi-->>Browser: config, activeRun, recentRuns, items, queue, stats

  User->>Browser: Add queue item
  Browser->>QueueApi: POST /api/queue
  QueueApi->>Utils: buildQueueItem, read queue.json
  QueueApi->>Remote: upload state/queue.json
  QueueApi-->>Browser: queue item

  User->>Browser: Run queued item
  Browser->>QueueApi: POST /api/queue { run_now: true }
  QueueApi->>Remote: persist updated queue
  QueueApi->>GitHub: workflow_dispatch with queue item inputs
  QueueApi->>Remote: mark item dispatched
  QueueApi-->>Browser: dispatched queue item

  User->>Browser: Run diagnostics
  Browser->>PreflightApi: GET /api/preflight
  PreflightApi->>Utils: read state, recent run, remote config
  PreflightApi-->>Browser: checks
```

## 3. Longform Generation Pipeline

```mermaid
sequenceDiagram
  autonumber
  participant Runner as src/run-once.js
  participant Storage as src/storage.js
  participant Pipeline as src/pipeline.js
  participant Topic as src/topic-engine.js
  participant Continuity as src/continuity-engine.js
  participant Story as src/longform-story-engine.js
  participant Wiki as src/wikipedia.js
  participant OpenAI as OpenAI API
  participant Pexels as Pexels API
  participant TTS as ElevenLabs/OpenAI TTS
  participant Render as src/longform-render.js
  participant Remote as src/remote.js
  participant YouTube as src/youtube-publisher.js

  Runner->>Storage: listContextItems()
  Runner->>Pipeline: generateFullItem(input)
  Pipeline->>Storage: listContextItems()
  Pipeline->>Story: createLongformDraft(input, existingItems)
  alt topic is empty
    Story->>Topic: pickFreshTopic(category)
    Topic->>Continuity: loadHistory and check freshness
    Topic->>OpenAI: requestIdeaJson for fresh ideas
  end
  Story->>Wiki: fetchWikipediaFacts(topic)
  Story->>OpenAI: requestKnowledgeJson(prompt)
  Story->>OpenAI: generateViralTitle if enabled
  Story->>Storage: write storyboard JSON
  Pipeline->>Storage: save draft item

  Pipeline->>Pexels: search and download B-roll per selected visual segment
  Pipeline->>OpenAI: generate fallback scene images
  Pipeline->>TTS: generate per-scene audio
  Pipeline->>OpenAI: transcribe audio segments
  Pipeline->>TTS: generate cold-open hook audio if enabled
  Pipeline->>OpenAI: generate thumbnail if enabled
  Pipeline->>Render: renderAndPersist(item)
  Render-->>Pipeline: video asset path/url/duration
  Pipeline->>Storage: save rendered item
  Pipeline-->>Runner: item + warnings

  opt remote enabled
    Runner->>Remote: absolutizeGeneratedUrls()
    Runner->>Storage: mergeMemoryItems([item])
    Runner->>Storage: saveItem(item)
    Runner->>Remote: uploadGeneratedStateAndAssets(item)
  end
  opt YouTube enabled
    Runner->>YouTube: publishToYoutube(video, meta, thumbnail)
    Runner->>YouTube: addToPlaylistByCategory()
    Runner->>Storage: saveItem(item)
    Runner->>Storage: mergeMemoryItems([item])
    Runner->>Remote: sync state/assets again if remote enabled
  end
```

## 4. Render Assembly

```mermaid
sequenceDiagram
  autonumber
  participant Pipeline as src/pipeline.js
  participant Render as src/longform-render.js
  participant Assets as assets/*
  participant FFmpeg as ffmpeg/ffprobe
  participant Work as generated/work/<item-id>
  participant Output as generated/videos

  Pipeline->>Render: renderLongformVideo(item)
  Render->>Assets: select background music
  Render->>Assets: select bumper intro/outro
  Render->>Assets: select category intro/outro
  Render->>Render: buildSceneAudioTiming from per-scene audio
  loop each scene
    alt sceneType is reaction
      Render->>Assets: select reaction clip by cue/text
      Render->>FFmpeg: makeReactionSegment()
    else scene has media segments
      Render->>Render: resolveSceneMediaList()
      alt media is Pexels video
        Render->>FFmpeg: makeVideoSegment with optional overlay
      else media is image
        Render->>FFmpeg: makeImageSegment with Ken Burns zoom
      end
      Render->>FFmpeg: concat subsegments if needed
    end
    FFmpeg-->>Work: content-segment-N.mp4
  end
  Render->>FFmpeg: concat content visual segments
  Render->>Work: write ASS subtitle file
  Render->>FFmpeg: burn subtitles
  Render->>FFmpeg: add logo watermark
  Render->>FFmpeg: build audio timeline from scene audio + music
  Render->>FFmpeg: mux content video and audio
  opt cold open enabled
    Render->>FFmpeg: render hook visual, ASS, audio, mux
  end
  Render->>FFmpeg: transcode bumper intro/outro
  Render->>FFmpeg: render intro and outro
  Render->>FFmpeg: concat final parts
  FFmpeg-->>Output: final MP4
  Render-->>Pipeline: video asset metadata
```

## 5. Local Desktop App Run

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant App as app/yt_studio.py
  participant Env as .env / app/config.json
  participant Node as npm scripts
  participant Runner as src/run-once.js / upload-only.js
  participant Storage as data/items.json
  participant UI as CustomTkinter UI

  User->>App: Launch run-app.bat or run-app.vbs
  App->>App: check_dependencies()
  alt dependency missing
    App->>App: setup wizard downloads Node/FFmpeg and npm install
  end
  App->>Env: load config and editable env fields
  App->>Storage: read local data/items.json
  App-->>UI: render dashboard and library

  User->>App: Jalankan Lokal
  App->>Node: npm run run:once -- params
  Node->>Runner: execute pipeline
  Runner-->>App: stdout lines
  App->>App: parse @@PROGRESS markers
  App->>App: parse @@LOCAL_OUTPUT marker
  App-->>UI: update stage bars and output buttons
  App->>Storage: refresh local items after success

  User->>App: Upload existing video
  App->>Node: npm run upload:once -- --id item-id
  Node->>Runner: publish item to YouTube
  Runner-->>App: @@UPLOAD_SUCCESS marker
  App-->>UI: mark upload/publish complete
```

## 6. Continuity Memory Loop

```mermaid
sequenceDiagram
  autonumber
  participant Runner as src/run-once.js
  participant Storage as src/storage.js
  participant Memory as data/memory.json
  participant Topic as src/topic-engine.js
  participant Continuity as src/continuity-engine.js
  participant Remote as PUBLIC_BASE_URL/state

  opt remote enabled before generation
    Runner->>Remote: fetch state/items.json and state/memory.json
    Runner->>Storage: save remote items locally
    Runner->>Storage: mergeMemoryItems(remote items + memory)
  end

  Topic->>Continuity: loadHistory(80)
  Continuity->>Storage: listContextItems()
  Storage->>Storage: combine data/items.json + data/memory.json
  Continuity-->>Topic: compact history
  Topic->>Continuity: checkFreshness(candidate)
  Continuity-->>Topic: fresh or blocked with reason

  Runner->>Storage: mergeMemoryItems([final item])
  Storage->>Memory: write compact memory item
  opt remote enabled
    Runner->>Remote: upload state/memory.json
  end
```

## Things To Remember Next Time

- Do not treat `data/items.json` as code. It can be very large and is runtime
  state. Use schema knowledge from storage and summary commands unless a task
  specifically needs item contents.
- Do not open `.env` casually. Use `.env.example` or app/env field definitions
  unless a task explicitly requires secrets.
- Local app and Vercel dashboard are different control surfaces:
  - Vercel dashboard reads remote state and dispatches GitHub Actions.
  - Desktop app reads local `data/items.json` and runs local npm scripts.
- Progress is stdout-based. Any change to `@@PROGRESS`, `@@LOCAL_OUTPUT`, or
  `@@UPLOAD_SUCCESS` must be coordinated with `app/yt_studio.py` and
  `src/server.js` SSE parsing.
- `assertReadyToRender()` is the render gate. If media generation behavior
  changes, update `test/pipeline.test.js`.
- `data/memory.json` is compact continuity memory, not a full item archive. The
  code keeps up to 2000 compact entries.
- Wikipedia grounding adds CC BY-SA source attribution in YouTube descriptions.
  If grounding behavior changes, keep `test/grounding.test.js` aligned.
- Pexels selection is heuristic and intentionally cheap. Concrete visual
  keywords get video priority; abstract scenes fall back to images.
- YouTube publish is resumable upload followed by optional thumbnail upload and
  optional playlist insert.
- SFTP cleanup intentionally avoids `state/` and `thumbnails/`; it sweeps media
  directories only.

