# PERF — budgets and measurements

Headless runs use SwiftShader (software GL): fps/long-frame numbers from headless are NOT representative.
Measure real fps with `?perf` on real hardware (see README).

| Metric | Budget | Measured | Where / how |
|---|---|---|---|
| Initial JS (gzip, before lazy chunks) | ≤ 250 KB | | build output / bundle-size test |
| Total first-load transfer | ≤ ~14 MB (glb ≤ ~12 MB) | | perf:probe network sum |
| Loading-screen first paint (localhost) | < 1 s | | perf:probe FCP |
| Load to interactive (localhost, mid laptop) | report; target < 8 s | | perf:probe ready time |
| Frame rate, 1080p, mid-range iGPU, Medium | ≥ 45 fps sustained; target 60 | | ?perf overlay on real GPU |
| Long frames after "ready" (> 50 ms) during scripted run | 0 (headed/real GPU); headless: report only | | perf:probe |
| New shader programs after "ready" | 0 | | perf:probe |
| Draw calls, scope view / outside view | ≤ 250 / ≤ 400 | | perf:probe |
| Triangles rendered, scope view | ≤ ~1.5 M | | perf:probe |
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
