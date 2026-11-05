import { test } from '@playwright/test';

// T821 scratch (deleted after tuning): measure + search guided grasper `at` points.
test.use({ viewport: { width: 1280, height: 720 } });

test('scratch', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/?view=scope&step=2');
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
  const sizes = await page.evaluate(() => {
    const cam = window.__sim.rig!.camera;
    let root: any = cam;
    while (root.parent) root = root.parent;
    const out: Record<string, number[]> = {};
    for (const n of ['skin', 'V_RML_common', 'lung_middle_lobe_right', 'tree_airway_base']) {
      const o = root.getObjectByName(n);
      if (!o) continue;
      o.traverse((m: any) => {
        if (!m.isMesh) return;
        m.geometry.computeBoundingBox();
        const b = m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld);
        out[`${n}/${m.name}`] = [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z].map(
          (v: number) => Math.round(v * 1000),
        );
      });
    }
    return out;
  });
  console.log(JSON.stringify(sizes));

  const LOBES = ['lung_upper_lobe_right', 'lung_middle_lobe_right', 'lung_lower_lobe_right'];
  for (const s of [4]) for (const target of LOBES) {
    await page.evaluate((n) => window.__sim.setStep(n, true), s);
    await page.waitForTimeout(800);
    const res = await page.evaluate(
      ([tid, stepPort]) => {
        const sim = window.__sim;
        const cam = sim.rig!.camera;
        cam.updateMatrixWorld();
        let root: any = cam;
        while (root.parent) root = root.parent;
        root.updateMatrixWorld(true);
        const meshes: any[] = [];
        root.getObjectByName(tid)?.traverse((m: any) => m.isMesh && meshes.push(m));
        const picker = sim.m3!.picker;
        const ports = sim.m3!.scope.ports.filter((p: any) => p.id !== stepPort);
        const best: any[] = [];
        const v = cam.position.clone();
        const q = cam.position.clone();
        for (let x = -0.85; x <= 0.86; x += 0.1)
          for (let y = -0.85; y <= 0.86; y += 0.1) {
            const hit = picker.pick(x, y, cam);
            if (!hit || hit.nodeName !== tid) continue;
            const tip = hit.point.clone();
            // nearest morphed vertex → rest world point
            let bd = Infinity;
            let bm: any = null;
            let bi = 0;
            for (const m of meshes) {
              const pos = m.geometry.getAttribute('position');
              for (let i = 0; i < pos.count; i += 1) {
                m.getVertexPosition(i, v);
                v.applyMatrix4(m.matrixWorld);
                const d = v.distanceToSquared(tip);
                if (d < bd) {
                  bd = d;
                  bm = m;
                  bi = i;
                }
              }
            }
            const rest = v.fromBufferAttribute(bm.geometry.getAttribute('position'), bi).applyMatrix4(bm.matrixWorld);
            const restArr = [rest.x, rest.y, rest.z].map((a) => Math.round(a * 1e4) / 1e4);
            for (const port of ports) {
              const dir = tip.clone().sub(port.pleura).normalize();
              let vis = 0;
              let inFrame = 0;
              for (let k = 0; k <= 12; k++) {
                const p = tip.clone().addScaledVector(dir, -k * 0.005);
                const camDist = p.distanceTo(cam.position);
                q.copy(p).project(cam);
                if (q.z > 1 || Math.abs(q.x) > 0.95 || Math.abs(q.y) > 0.95) continue;
                inFrame++;
                const h2 = picker.pick(q.x, q.y, cam);
                if (!h2 || h2.distance > camDist - 0.002) vis++;
              }
              const r = Math.hypot(x, y);
              best.push({ port: port.id, ndc: [Math.round(x * 100) / 100, Math.round(y * 100) / 100], vis, inFrame, r: Math.round(r * 100) / 100, dist: Math.round(hit.distance * 1000), rest: restArr });
            }
          }
        best.sort((a, b) => b.vis - a.vis || Math.abs(a.r - 0.55) - Math.abs(b.r - 0.55));
        const top: any[] = [];
        for (const pid of ['port_camera_8ICS', 'port_retraction_8ICS', 'port_utility_5ICS'])
          top.push(...best.filter((b) => b.port === pid && b.dist > 8).slice(0, 4));
        return { n: best.length, top };
      },
      [target, ''] as const,
    );
    console.log(`STEP ${s} ${target}`, JSON.stringify(res));
  }
});
