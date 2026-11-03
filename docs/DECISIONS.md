# DECISIONS (ADR-lite)

## ADR-001 Project name
ThoraScope — VATS RML Lobectomy Simulator; npm package `thorascope`.

## ADR-002 Asset location
Inputs copied unchanged from ~/Downloads/surgery-docs/ into assets_src/ (gitignored, read-only).

## ADR-003 Scope mask shape (frame wins over text)
Ref-frames show a hard-edged 5:4 rectangular scope image (YouTube capture), not a circle. §8 says the mask must match the
frames' crop and that frames win → post pass uses a 5:4 rounded-rectangle mask with a soft edge (corner radius + feather
in config), letterboxed in the viewport. The loading screen keeps the circular "lens" motif (§6.9 is branding, not optics).

## ADR-004 Port role mapping (see docs/VIDEO_STEP_MAP.md (b))
port_camera_8ICS = camera / "former camera" port; port_utility_5ICS = access incision (capacity up to 3 instruments);
port_retraction_8ICS = anterior working port (scope sits here for most of Practice). Guided mode uses the authored
glTF cameras/ports from procedure_steps.json unchanged.

## ADR-005 Procedure order
Scored Practice order follows ch.32 + video + procedure_steps: vein → bronchus (with mandatory ventilation test) →
arteries → fissure → extraction → optional 4R/7 → water test. Both LN_11R and LN_12R required, any order.
Pericardium colour follows frames (lavender-mauve), not the §8 text (bluish-white).
