# PERF — budgets and measurements

Headless runs use SwiftShader (software GL): fps/long-frame numbers from headless are NOT representative.
Measure real fps with `?perf` on real hardware (see README).

| Metric | Budget | Measured | Where / how |
|---|---|---|---|
| Initial JS (gzip, before lazy chunks) | ≤ 250 KB | 187 KB (M0) | build output / bundle-size test |
| Total first-load transfer | ≤ ~14 MB (glb ≤ ~12 MB) | 11.31 MB; glb 11.07 MB (M0) | perf:probe network sum |
| Loading-screen first paint (localhost) | < 1 s | 124 ms headless (M0) | perf:probe FCP |
| Load to interactive (localhost, mid laptop) | report; target < 8 s | 4.5 s headless SwiftShader (M0) | perf:probe ready time |
| Frame rate, 1080p, mid-range iGPU, Medium | ≥ 45 fps sustained; target 60 | | ?perf overlay on real GPU |
| Long frames after "ready" (> 50 ms) during scripted run | 0 (headed/real GPU); headless: report only | | perf:probe |
| New shader programs after "ready" | 0 | 0 (20→20) (M0) | perf:probe |
| Draw calls, scope view / outside view | ≤ 250 / ≤ 400 | — / 92 (M0 outside only) | perf:probe |
| Triangles rendered, scope view | ≤ ~1.5 M | 821k outside view (M0) | perf:probe |
| GPU texture memory (estimate) | ≤ ~300 MB on Medium | | perf:probe estimate |
| JS heap growth over 3 full practice runs | < 10 % | | perf:probe |

## Probe log

### 2026-11-03T06:36:47.755Z (headless SwiftShader, script: orbit)
- FCP 132 ms · ready 3928 ms · transfer 11.29 MB
- programs 20 → 20 · textures 166
- ready: 92 draw calls, 821385 tris
- orbit: 92 draw calls, 821385 tris
- heap 5.6 → 5.9 MB
- long frames 64 (max 2733 ms), fps 1.4 — NOT representative (headless)

### 2026-11-03T06:40:00.061Z (headless SwiftShader, script: orbit)
- FCP 136 ms · ready 1383 ms · transfer 11.29 MB
- programs 20 → 20 · textures 166
- ready: 92 draw calls, 821385 tris
- orbit: 92 draw calls, 821385 tris
- heap 5.6 → 5.9 MB
- long frames 62 (max 3167 ms), fps 1.4 — NOT representative (headless)

### 2026-11-03T06:47:50.367Z (headless SwiftShader, script: orbit)
- FCP 128 ms · ready 3745 ms · transfer 11.31 MB
- programs 20 → 20 · textures 166
- ready: 92 draw calls, 821385 tris
- orbit: 92 draw calls, 821385 tris
- heap 5.7 → 6 MB
- long frames 62 (max 2500 ms), fps 1.5 — NOT representative (headless)

### 2026-11-03T07:29:13.216Z PASS (headless SwiftShader, script: orbit)
- FCP 148 ms · ready 6167 ms · transfer 11.31 MB
- programs 20 → 20 · textures 166
- orbit: 92 draw calls, 821385 tris
- heap 5.7 → 6 MB
- long frames 59 (max 10333 ms), fps 1 — NOT representative (headless)

### 2026-11-03T07:30:35.764Z PASS (headless SwiftShader, script: orbit)
- FCP 132 ms · ready 11163 ms · transfer 11.31 MB
- programs 20 → 20 · textures 166
- orbit: 92 draw calls, 821385 tris
- heap 5.7 → 6.1 MB
- long frames 58 (max 6333 ms), fps 1.1 — NOT representative (headless)

### 2026-11-03T07:47:50.411Z PASS (headless SwiftShader, script: orbit)
- FCP 156 ms · ready 12287 ms · transfer 11.32 MB
- programs 22 → 22 · textures 168
- orbit: 94 draw calls, 821387 tris
- heap 5.7 → 6.1 MB
- long frames 62 (max 8850 ms), fps 1.1 — NOT representative (headless)

### 2026-11-03T08:42:44.801Z PASS (headless SwiftShader, script: orbit)
- FCP 144 ms · ready 25038 ms · transfer 11.32 MB
- programs 22 → 22 · textures 168
- orbit: 91 draw calls, 785960 tris
- scope-step1: 65 draw calls, 600256 tris
- scope-step2: 44 draw calls, 549176 tris
- scope-step3: 53 draw calls, 546482 tris
- scope-step4: 51 draw calls, 530047 tris
- scope-step5: 47 draw calls, 513754 tris
- scope-step6: 48 draw calls, 516233 tris
- scope-step7: 43 draw calls, 455096 tris
- heap 5.7 → 6.2 MB
- long frames 73 (max 4916 ms), fps 1.3 — NOT representative (headless)
