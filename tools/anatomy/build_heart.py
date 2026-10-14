"""Build the web heart model (frontend/public/models/heart.glb) from BodyParts3D anatomy.

Source: BodyParts3D, (c) The Database Center for Life Science, licensed under CC Attribution-Share Alike 2.1 Japan
(http://lifesciencedb.jp/bp3d/). STL files are fetched from the public mirror
https://github.com/Kevin-Mattheus-Moerman/BodyParts3D.

Pipeline
  1. download the needed parts (FMA ids) into tools/anatomy/src/ (cached)
  2. rotate from BodyParts3D axes (x = patient's left, y = posterior, z = superior, mm) to viewer axes
     (x = patient's left / viewer's right, y = up, z = anterior / towards the viewer)
  3. cut the great vessels near the heart with sealed caps; fuse the aorta and lung vessels into single smooth
     surfaces (voxel union + marching cubes: no seams between segments, no fringe at cuts); simplify; smooth
  4. ambient occlusion by ray tracing (Embree): darkens grooves and contact areas, and finds the enclosed inner
     chamber walls, which are dropped because they can never be seen
  5. heart surface colour: red-brown myocardium, epicardial fat along the arteries, in the atrioventricular groove
     and in natural patches; coronary territories (typical LAD / LCX / RCA supply of the ventricles) stored as a
     per-vertex attribute `_territory` for the territory map
  6. centre on the heart, scale so the heart is 2.3 units tall, export one node per structure, compress (meshopt)

Usage (from the repo root):
    python tools/anatomy/build_heart.py
Needs: pip install -r tools/anatomy/requirements.txt  and  npm ci in frontend/ (for gltf-transform).
"""
import subprocess
import sys
import urllib.request
from pathlib import Path

import fast_simplification
import numpy as np
import trimesh
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree
from trimesh.ray.ray_pyembree import RayMeshIntersector

ROOT = Path(__file__).resolve().parents[2]
SRC = Path(__file__).resolve().parent / "src"
OUT_DIR = ROOT / "frontend" / "public" / "models"
RAW_GLB = Path(__file__).resolve().parent / "heart_raw.glb"
MIRROR = "https://raw.githubusercontent.com/Kevin-Mattheus-Moerman/BodyParts3D/main/assets/BodyParts3D_data/stl"

# Node name -> (FMA ids, target face count or None to keep, smoothing iterations)
PARTS = {
    "heart_wall":       (["FMA7274"], 150_000, 8),   # inner chamber walls are dropped later (about half)
    "LAD":              (["FMA3862nsn"], None, 0),                                  # anterior interventricular branch
    "LCX":              (["FMA3895"], None, 0),                                     # circumflex branch
    "RCA":              (["FMA3802", "FMA3818", "FMA3840nsn", "FMA76994"], None, 0),  # trunk, marginal, PDA, posterolateral
    "left_main":        (["FMA4685"], None, 0),                                     # stem of left coronary artery
    "aorta":            (["FMA3736", "FMA3768", "FMA3784"], 12_000, 10),
    "pulmonary_artery": (["FMA66326"], 9_000, 10),
    "pulmonary_veins":  (["FMA66643"], 8_000, 10),
    "superior_vena_cava": (["FMA4720"], None, 2),
    "inferior_vena_cava": (["FMA10951"], 3_000, 2),
    "cardiac_veins":    (["FMA4706", "FMA4707", "FMA4713", "FMA71567", "FMA76751"], 14_000, 0),
}
ARTERIES = ["LAD", "LCX", "RCA"]
FAT_NODES = ["LAD", "LCX", "RCA", "left_main"]  # epicardial fat follows the main arteries (not every small vein)
AV_GROOVE_IDS = ["FMA3802", "FMA3895"]            # RCA trunk + circumflex: they run in the atrioventricular groove
PDA_IDS = ["FMA3840nsn"]                          # posterior descending artery: marks the posterior interventricular groove
# AHA 17-segment model (Cerqueira et al., Circulation 2002) with its standard coronary assignment; 18 = RV free wall,
# which is not part of the 17-segment model and is typically supplied by the RCA.
AHA_ARTERY = {1: "LAD", 2: "LAD", 7: "LAD", 8: "LAD", 13: "LAD", 14: "LAD", 17: "LAD",
              3: "RCA", 4: "RCA", 9: "RCA", 10: "RCA", 15: "RCA", 18: "RCA",
              5: "LCX", 6: "LCX", 11: "LCX", 12: "LCX", 16: "LCX"}
SEGMENT_SCALE = 32.0                              # segment ids are stored as id / 32 so they survive quantization
# Voxel-union the aorta: it is modelled as three segments whose joins show as seams. (Not the pulmonary vessels:
# they are thin-walled shapes in BodyParts3D, and a voxel union punches holes in them.)
FUSE = {"aorta"}
FUSE_PITCH = 0.55                                 # mm
HEART_HEIGHT_UNITS = 2.3
# Per-structure trim box around the heart, as margins in mm: [x-, x+, y-(down), y+(up), z-(back), z+(front)].
# Negative margins shrink the box. Textbook views show only the stumps of the great vessels.
CLIP_MARGIN = {
    "aorta": [12, 12, -70, 62, 30, 10],          # descending aorta cut ~36 mm below the top of the heart
    "pulmonary_artery": [-20, -32, 0, 6, 4, 8],   # trunk + short proximal left/right branches (they fan out further)
    "pulmonary_veins": [-4, -10, -48, 6, 10, 0],  # stumps where they join the left atrium
    "superior_vena_cava": [12, 12, 0, 45, 20, 10],
    "inferior_vena_cava": [12, 12, 6, 0, 20, 10],
}

MYOCARDIUM = np.array([108, 32, 35]) / 255   # sRGB, red-brown muscle
MYOCARDIUM_DARK = np.array([86, 23, 28]) / 255
# Pale beige rather than yellow epicardial fat, so amber (moderate-risk) arteries still stand out against it.
FAT = np.array([204, 184, 158]) / 255
FAT_MAX = 0.72                               # fat never fully hides the muscle colour
AO_RAYS, AO_DIST = 96, 14.0                  # directions on the sphere (about half face outwards), reach in mm


# ---------------------------------------------------------------- geometry helpers
def download():
    SRC.mkdir(parents=True, exist_ok=True)
    ids = [fma for fmas, _, _ in PARTS.values() for fma in fmas]
    for fma in ids:
        path = SRC / f"{fma}.stl"
        if not path.exists():
            print("downloading", fma)
            urllib.request.urlretrieve(f"{MIRROR}/{fma}.stl", path)


def to_view_axes(mesh):
    """BodyParts3D (x left, y posterior, z superior) -> viewer (x left, y superior, z anterior)."""
    v = mesh.vertices
    mesh.vertices = np.column_stack([v[:, 0], v[:, 2], -v[:, 1]])
    return mesh


def load_group(ids):
    meshes = [to_view_axes(trimesh.load(SRC / f"{fma}.stl", force="mesh")) for fma in ids]
    return trimesh.util.concatenate(meshes)


def clip(mesh, lo, hi):
    """Cut the mesh with the six faces of the box [lo, hi]. Triangles crossing a face are split and each cut is
    capped with a flat seal, so vessels end in clean, closed stumps like a prepared anatomical specimen.
    Capping needs a closed input; if a cut cannot be capped it is left open."""
    for axis in range(3):
        for bound, sign in ((lo[axis], 1.0), (hi[axis], -1.0)):
            normal = np.zeros(3)
            normal[axis] = sign
            origin = np.zeros(3)
            origin[axis] = bound
            try:
                mesh = trimesh.intersections.slice_mesh_plane(mesh, plane_normal=normal, plane_origin=origin, cap=True)
            except Exception:
                mesh = trimesh.intersections.slice_mesh_plane(mesh, plane_normal=normal, plane_origin=origin, cap=False)
            if len(mesh.faces) == 0:
                return mesh
    mesh.remove_unreferenced_vertices()
    return mesh


def fuse(mesh, pitch=FUSE_PITCH):
    """Voxel union + marching cubes: separately modelled segments become one surface (no seam where they meet)
    and hair-thin branch stumps at cuts melt away. Smoothing afterwards removes the voxel staircase."""
    grid = mesh.voxelized(pitch).fill()
    out = grid.marching_cubes.copy()
    if not np.allclose(out.bounds, mesh.bounds, atol=4 * pitch):  # index space -> scene space
        out.apply_transform(grid.transform)
    return out


def simplify(mesh, target):
    if target is None or len(mesh.faces) <= target:
        return mesh
    v, f = fast_simplification.simplify(mesh.vertices.astype(np.float32), mesh.faces.astype(np.int32),
                                        target_reduction=1 - target / len(mesh.faces))
    return trimesh.Trimesh(v, f, process=True)


def drop_small(mesh, min_faces, min_share=0.0):
    """Remove disconnected fragments smaller than min_faces or than min_share of the whole part
    (the heart wall has ~2000 internal bits invisible from outside; trimming leaves loose vessel pieces)."""
    n = len(mesh.faces)
    a = mesh.face_adjacency
    graph = coo_matrix((np.ones(len(a)), (a[:, 0], a[:, 1])), shape=(n, n))
    _, labels = connected_components(graph, directed=False)
    sizes = np.bincount(labels)
    mesh.update_faces(sizes[labels] >= max(min_faces, min_share * n))
    mesh.remove_unreferenced_vertices()
    return mesh


def smooth(mesh, iterations, lamb=0.5, nu=-0.53, max_step=0.35):
    """Taubin smoothing (shrink-free) with each vertex step clamped to max_step mm and open-boundary vertices
    pinned. Plain Taubin blows up on the non-manifold bits left by simplification; the clamp keeps it stable,
    and pinning keeps any open vessel cut straight."""
    if not iterations:
        return mesh
    n = len(mesh.vertices)
    e = mesh.edges_unique
    adj = coo_matrix((np.ones(2 * len(e)), (np.r_[e[:, 0], e[:, 1]], np.r_[e[:, 1], e[:, 0]])), shape=(n, n)).tocsr()
    deg = np.maximum(np.asarray(adj.sum(axis=1)).ravel(), 1)[:, None]
    counts = np.bincount(mesh.edges_unique_inverse, minlength=len(e))
    pinned = np.zeros(n, dtype=bool)
    pinned[e[counts == 1].ravel()] = True  # edges used by a single face lie on an open boundary
    v = mesh.vertices.copy()
    for _ in range(iterations):
        for w in (lamb, nu):
            step = w * (adj @ v / deg - v)
            length = np.linalg.norm(step, axis=1, keepdims=True)
            step *= np.minimum(1, max_step / np.maximum(length, 1e-12))
            step[pinned] = 0
            v += step
    mesh.vertices = v
    return mesh


def smoothstep(edge0, edge1, x):
    t = np.clip((x - edge0) / (edge1 - edge0), 0, 1)
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------- shading and anatomy helpers
def sphere_directions(n):
    """Evenly spread unit vectors (Fibonacci sphere)."""
    i = np.arange(n) + 0.5
    phi = np.arccos(1 - 2 * i / n)
    theta = np.pi * (1 + 5 ** 0.5) * i
    return np.column_stack([np.cos(theta) * np.sin(phi), np.cos(phi), np.sin(theta) * np.sin(phi)])


def mesh_average(mesh, values, iterations):
    """Average per-vertex values with their mesh neighbours (removes speckle, e.g. from ray-traced occlusion)."""
    n = len(mesh.vertices)
    e = mesh.edges_unique
    adj = coo_matrix((np.ones(2 * len(e)), (np.r_[e[:, 0], e[:, 1]], np.r_[e[:, 1], e[:, 0]])), shape=(n, n)).tocsr()
    deg = np.maximum(np.asarray(adj.sum(axis=1)).ravel(), 1)
    for _ in range(iterations):
        values = 0.5 * values + 0.5 * (adj @ values) / deg
    return values


def ambient_occlusion(mesh, intersector, dirs=sphere_directions(AO_RAYS), reach=AO_DIST, chunk=3000):
    """Cosine-weighted share of the outward hemisphere that is open within `reach` mm (1 = open, 0 = enclosed),
    lightly averaged over mesh neighbours so tiny folds do not show up as dark specks."""
    v, nrm = mesh.vertices, mesh.vertex_normals
    open_share = np.zeros(len(v))
    for s in range(0, len(v), chunk):
        vs, ns = v[s:s + chunk], nrm[s:s + chunk]
        cos = ns @ dirs.T
        iv, idir = np.nonzero(cos > 0.05)
        origins = vs[iv] + ns[iv] * 0.15
        locations, ray_ids, _ = intersector.intersects_location(origins, dirs[idir], multiple_hits=False)
        dist = np.full(len(origins), np.inf)
        dist[ray_ids] = np.linalg.norm(locations - origins[ray_ids], axis=1)
        occluded = np.clip(1 - dist / reach, 0, 1)
        w = cos[iv, idir]
        blocked = np.bincount(iv, weights=w * occluded, minlength=len(vs))
        total = np.bincount(iv, weights=w, minlength=len(vs))
        open_share[s:s + chunk] = 1 - blocked / np.maximum(total, 1e-9)
    return mesh_average(mesh, open_share, 3)


def enclosed_share(mesh, intersector, dirs=sphere_directions(64), chunk=1500):
    """Share of all directions in which a ray from the vertex hits something at any distance. ~1 means the
    vertex is enclosed (inner chamber walls), so it can never be seen from outside."""
    v, nrm = mesh.vertices, mesh.vertex_normals
    share = np.zeros(len(v))
    for s in range(0, len(v), chunk):
        vs, ns = v[s:s + chunk], nrm[s:s + chunk]
        iv = np.repeat(np.arange(len(vs)), len(dirs))
        d = np.tile(dirs, (len(vs), 1))
        origins = vs[iv] + ns[iv] * 0.08 + d * 0.05
        hit = intersector.intersects_any(origins, d)
        share[s:s + chunk] = np.bincount(iv, weights=hit, minlength=len(vs)) / len(dirs)
    return share


def aha_segments(v, plane, lad, pda):
    """Assign ventricular surface points to AHA segments (1-17) or the RV free wall (18); atria get 0.

    Long axis = normal of the atrioventricular (AV) groove plane, through the apex (the ventricular point farthest
    from that plane). Height along the axis gives the basal / mid / apical rings and the apical cap (17).
    Around the axis, the left ventricle's outer wall spans from the anterior interventricular groove (the LAD
    trunk) over the lateral side to the posterior groove (the PDA); the rest of the ventricular surface is the
    RV free wall. Septal segments (2, 3, 8, 9, 14) lie inside the heart and are never on the outer surface."""
    centre, n = plane
    s = (v - centre) @ n
    apex = v[np.argmax(s)]
    h = s / s.max()

    def unit(x):
        return x / np.linalg.norm(x)

    e_ant = unit(np.array([0.0, 0.0, 1.0]) - n[2] * n)
    e_lat = unit(np.array([1.0, 0.0, 0.0]) - n[0] * n - (np.array([1.0, 0.0, 0.0]) @ e_ant) * e_ant)

    def angle(p):  # degrees around the long axis: 0 = anterior, 90 = lateral (patient's left)
        q = p - apex
        return np.degrees(np.arctan2(q @ e_lat, q @ e_ant))

    def groove_angle(points, pct):
        hp = ((points - centre) @ n) / s.max()
        a = angle(points[(hp > 0.2) & (hp < 0.8)])
        return np.percentile(a, pct)  # the trunk in the groove, not its branches spreading over the LV

    th_lad = groove_angle(lad, 15)   # LAD diagonals spread laterally (larger angles): take the septal edge
    th_pda = groove_angle(pda, 85)   # PDA branches spread onto the LV (smaller angles): take the groove edge
    span = (th_pda - th_lad) % 360
    f = ((angle(v) - th_lad) % 360) / span  # 0 at the anterior groove, 1 at the posterior groove (via lateral)
    alpha = 120 - 240 * f                    # AHA polar angle: 90 anterior, 0 lateral, -90 inferior

    seg = np.zeros(len(v), dtype=int)
    ventricle = s > 0
    lv = ventricle & (f <= 1)
    band = [(60, 1, 7), (0, 6, 12), (-60, 5, 11), (-120, 4, 10)]  # (lower alpha bound, basal id, mid id)
    for lower, basal, mid in band:
        sector = lv & (alpha >= lower) & (alpha < lower + 60)
        seg[sector & (h < 0.35)] = basal
        seg[sector & (h >= 0.35) & (h < 0.65)] = mid
    apical = lv & (h >= 0.65)
    seg[apical & (alpha >= 45)] = 13
    seg[apical & (alpha < 45) & (alpha >= -45)] = 16
    seg[apical & (alpha < -45)] = 15
    seg[ventricle & ~lv] = 18
    seg[ventricle & (h >= 0.88)] = 17
    return seg, (th_lad, th_pda)


def av_plane(points):
    """Plane through the atrioventricular groove (fitted to the RCA trunk and the circumflex), outliers trimmed."""
    for _ in range(3):
        c = points.mean(axis=0)
        normal = np.linalg.svd(points - c)[2][2]
        r = np.abs((points - c) @ normal)
        points = points[r <= np.percentile(r, 80)]
    return points.mean(axis=0), normal


def smooth_noise(p, seed=7, octaves=6):
    """Cheap smooth pseudo-noise in [0, 1] from sums of randomly oriented sine waves."""
    rng = np.random.default_rng(seed)
    acc = np.zeros(len(p))
    for k in range(octaves):
        d = rng.normal(size=3)
        d /= np.linalg.norm(d)
        acc += np.sin(p @ d * (1 + 0.45 * k) * 2 * np.pi + rng.uniform(0, 2 * np.pi)) / (1 + 0.5 * k)
    return (acc - acc.min()) / (acc.max() - acc.min())


def srgb_to_linear(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def rgba(linear_rgb):
    return np.column_stack([np.round(np.clip(linear_rgb, 0, 1) * 255), np.full(len(linear_rgb), 255)]).astype(np.uint8)


def heart_surface(wall, groups, plane, ao, segments):
    """Vertex colours (myocardium, epicardial fat, occlusion) and coronary territory weights for the heart wall."""
    v = wall.vertices
    centre, normal = plane
    s = (v - centre) @ normal                      # signed distance to the AV groove plane (mm), + = ventricles
    ventricles = smoothstep(-1.0, 5.0, s)

    fat_pts = np.vstack([groups[n].vertices for n in FAT_NODES])
    d_fat = cKDTree(fat_pts).query(v)[0]
    fat = np.maximum.reduce([
        smoothstep(3.6, 1.1, d_fat),               # along the coronary arteries
        0.9 * smoothstep(6.0, 1.5, np.abs(s)),     # the whole atrioventricular groove
        0.45 * ventricles * smoothstep(0.62, 0.9, smooth_noise(v / 26.0)),  # natural fat patches
    ]) * FAT_MAX

    p = v / 6.0
    mottle = 0.5 + 0.18 * np.sin(p[:, 0] * 1.7 + np.sin(p[:, 1] * 1.3)) * np.cos(p[:, 2] * 1.9 + p[:, 1] * 0.7) \
        + 0.1 * np.sin(p[:, 1] * 3.1 + p[:, 2] * 2.3)
    muscle = MYOCARDIUM_DARK + (MYOCARDIUM - MYOCARDIUM_DARK) * mottle[:, None]
    rgb = srgb_to_linear(muscle * (1 - fat[:, None]) + FAT * fat[:, None])
    rgb *= (0.28 + 0.72 * ao ** 1.3)[:, None]

    # Territory weights: one-hot supplying artery of the vertex's AHA segment, softened across borders by a few
    # rounds of neighbour averaging on the mesh, and faded out towards the atria.
    w = np.zeros((len(v), 3))
    for seg_id, artery in AHA_ARTERY.items():
        w[segments == seg_id, ARTERIES.index(artery)] = 1.0
    w = np.column_stack([mesh_average(wall, w[:, k], 4) for k in range(3)])
    w *= ventricles[:, None]
    return rgba(rgb), w.astype(np.float32)


# ---------------------------------------------------------------- main
def main():
    download()
    groups = {name: load_group(ids) for name, (ids, _, _) in PARTS.items()}
    hb_lo, hb_hi = groups["heart_wall"].bounds

    for name, (ids, target, iters) in PARTS.items():
        g = groups[name]
        lo, hi = hb_lo - 20, hb_hi + 20  # sanity box for structures that are not trimmed
        if name in CLIP_MARGIN:
            m = np.array(CLIP_MARGIN[name], dtype=float)
            lo = hb_lo - np.array([m[0], m[2], m[4]])
            hi = hb_hi + np.array([m[1], m[3], m[5]])
            g = drop_small(clip(g, lo, hi), 200, min_share=0.06)
            if name in FUSE:
                g = drop_small(fuse(g), 200, min_share=0.03)
            g = smooth(simplify(g, target), iters)
        else:
            g = drop_small(g, 300 if name == "heart_wall" else 60)
            g = smooth(simplify(g, target), iters)
        assert np.all((g.vertices >= lo - 5) & (g.vertices <= hi + 5)), f"{name}: vertices escaped the heart region"
        groups[name] = g

    # Drop the heart wall's enclosed inner surfaces (chamber linings): they can never be seen from outside.
    intersector = RayMeshIntersector(trimesh.util.concatenate(list(groups.values())))
    wall = groups["heart_wall"]
    enclosed = enclosed_share(wall, intersector)
    wall.update_faces((enclosed[wall.faces] < 0.985).any(axis=1))
    wall.remove_unreferenced_vertices()
    wall = drop_small(wall, 300)
    groups["heart_wall"] = wall

    # Ambient occlusion against everything (rebuilt without the dropped inner walls).
    intersector = RayMeshIntersector(trimesh.util.concatenate(list(groups.values())))
    ao = {name: ambient_occlusion(g, intersector) for name, g in groups.items()}

    plane = av_plane(load_group(AV_GROOVE_IDS).vertices)
    lowest = wall.vertices[np.argmin(wall.vertices[:, 1])]
    if (lowest - plane[0]) @ plane[1] < 0:  # orient the plane normal towards the ventricles / apex
        plane = (plane[0], -plane[1])
    segments, grooves = aha_segments(wall.vertices, plane, groups["LAD"].vertices, load_group(PDA_IDS).vertices)
    wall_colors, territory = heart_surface(wall, groups, plane, ao["heart_wall"], segments)
    counts = {k: int((segments == k).sum()) for k in range(19)}
    print("groove angles (LAD, PDA):", np.round(grooves, 1).tolist(), "| vertices per segment:",
          {k: c for k, c in counts.items() if c})

    centre = (hb_lo + hb_hi) / 2
    scale = HEART_HEIGHT_UNITS / (hb_hi[1] - hb_lo[1])
    scene = trimesh.Scene()
    for name, g in groups.items():
        g.vertices = (g.vertices - centre) * scale
        if name == "heart_wall":
            g.visual = trimesh.visual.ColorVisuals(g, vertex_colors=wall_colors)
            g.vertex_attributes["territory"] = territory
            g.vertex_attributes["segment"] = (segments / SEGMENT_SCALE).astype(np.float32)
        else:  # grey occlusion shading (linear); the app multiplies it with each structure's colour
            shade = np.repeat((0.3 + 0.7 * ao[name] ** 1.2)[:, None], 3, axis=1)
            g.visual = trimesh.visual.ColorVisuals(g, vertex_colors=rgba(shade))
        scene.add_geometry(g, node_name=name, geom_name=name)
        print(f"{name:20s} faces {len(g.faces):7d}")

    share = territory.sum(axis=0) / max(territory.sum(), 1e-9)
    print("territory shares (LAD, LCX, RCA):", np.round(share, 2).tolist())
    RAW_GLB.write_bytes(trimesh.exchange.gltf.export_glb(scene, include_normals=True))
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    cli = ROOT / "frontend" / "node_modules" / "@gltf-transform" / "cli" / "bin" / "cli.js"
    out = OUT_DIR / "heart.glb"
    subprocess.run(["node", str(cli), "meshopt", str(RAW_GLB), str(out), "--level", "medium"], check=True)
    print(f"raw {RAW_GLB.stat().st_size / 1e6:.1f} MB -> {out.stat().st_size / 1e6:.2f} MB  ({out})")
    print("scene bounds", np.round(scene.bounds, 2).tolist())


if __name__ == "__main__":
    sys.exit(main())
