"""Export selected frames using the maintained ear_recon loaders (mesh env)."""
import argparse, gzip, json, subprocess, sys
from pathlib import Path
import cv2
import numpy as np
from landmark_interpolation import interpolate_landmarks, interpolation_metadata, MAX_GAP_FRAMES

parser = argparse.ArgumentParser()
parser.add_argument('--repo', type=Path, required=True)
parser.add_argument('--dataset', type=Path, required=True)
parser.add_argument('--out', type=Path, required=True)
args = parser.parse_args()
sys.path[:0] = [str(args.repo), str(args.repo / 'src')]
from vis_reproj import load_face_pose_csv
from cheese3d_ear.calib import load_calib, project_points
from cheese3d_ear.video import discover_videos, camera_name, probe_video, open_video, read_frame
from cheese3d_ear.pca import load_combined_model

root, out = args.dataset, args.out
out.mkdir(parents=True, exist_ok=True)
order = ['BC', 'L', 'R', 'TC', 'TL', 'TR']
video_paths = {camera_name(p): p for p in discover_videos(root)}
infos = [probe_video(video_paths[name]) for name in order]
assert all(i.size == infos[0].size and i.fps == infos[0].fps for i in infos)
fps = infos[0].fps
size = infos[0].size
calib = load_calib(root / 'calibration.toml', size)
print('Loading face tracks...', flush=True)
face = load_face_pose_csv(root / f'{root.name}.csv')
face.xyz, face_filled = interpolate_landmarks(face.xyz)
print('Loading ear tracks...', flush=True)
curves = json.loads((root / 'ear_curves_global.json').read_text())
ranges = [(16300, 16800), (46700, 47000), (13400, 13650)]
manifest = dict(version=1, experiment=root.name, fps=fps, sourceSize=list(size),
                tileSize=[480,384], grid=[3,2], encoding='gzip-float32-le',
                pointCount=len(face.names)+150,
                face=dict(names=face.names, edges=face.connections, colors=face.colors_rgb.tolist(),
                    interpolation=dict(method="linear-3d",maxGapFrames=MAX_GAP_FRAMES,context="full-recording",extrapolate=False)),
                ears=[dict(name='left', offset=len(face.names), count=75, color='#ffad66'),
                      dict(name='right', offset=len(face.names)+75, count=75, color='#59dcb4')],
                cameras=[], trials=[])
center = np.nanmedian(face.xyz[16300:16800].reshape(-1,3), axis=0)
for name in order:
    cam = calib[name]
    R = cv2.Rodrigues(cam['rvec'])[0]
    origin = -R.T @ cam['tvec']
    uv = np.array([[0,0],[size[0],0],list(size),[0,size[1]]],np.float64)
    rays = cv2.undistortPoints(uv.reshape(-1,1,2),cam['K'],cam['dist']).reshape(-1,2)
    depth = np.linalg.norm(center-origin)*.28
    corners = (np.c_[rays,np.ones(4)]*depth-cam['tvec']) @ R
    manifest['cameras'].append(dict(name=name, K=cam['K'].ravel().tolist(),
        R=R.ravel().tolist(), t=cam['tvec'].tolist(), distortion=cam['dist'].tolist(),
        center=origin.tolist(), corners=corners.tolist()))
fixtures = []
for index,(start,end) in enumerate(ranges,1):
    assert end <= min(i.frame_count for i in infos)
    count=end-start
    track=np.full((count,manifest['pointCount'],3),np.nan,dtype='<f4')
    track[:,:len(face.names)] = face.xyz[start:end]
    for local,frame in enumerate(range(start,end)):
        for ear in manifest['ears']:
            record=curves.get(str(frame),{}).get(ear['name'],{})
            points=np.asarray(record.get('curve',[]),np.float32)
            if points.shape == (75,3):
                track[local,ear['offset']:ear['offset']+75] = points
    filename=f'trial-{index}'
    (out/f'{filename}.filled.f32.gz').write_bytes(gzip.compress(track.tobytes(),mtime=0))
    manifest['trials'].append(dict(id=filename, label=f'Trial {index:02d}',start=start,end=end,
        frames=count,video=f'{filename}.web.mp4',track=f'{filename}.filled.f32.gz',poster=f'{filename}.jpg',
        faceInterpolation=interpolation_metadata(face_filled,start,end)))
    # OpenCV reference projections for independent browser-math regression checks.
    for cam in manifest['cameras']:
        points=np.ascontiguousarray(track[0][np.isfinite(track[0]).all(axis=1)][::11])
        fixtures.append(dict(camera=cam['name'],points=points.tolist(),
            pixels=project_points(points,calib[cam['name']]).tolist()))
    print(f'Encoding {filename}: {count} frames at {fps} fps',flush=True)
    caps=[open_video(video_paths[name],frame=start) for name in order]
    proc=subprocess.Popen(['ffmpeg','-hide_banner','-loglevel','error','-y',
        '-f','rawvideo','-pix_fmt','bgr24','-s','1440x768','-r',str(fps),'-i','pipe:0',
        '-an','-c:v','libx264','-preset','slow','-crf','28','-pix_fmt','yuv420p',
        '-g','50','-movflags','+faststart',str(out/f'{filename}.web.mp4')],stdin=subprocess.PIPE)
    try:
        for local in range(count):
            tiles=[]
            for cap in caps:
                ok,frame=read_frame(cap)
                if not ok: raise RuntimeError(f'Missing source frame {start+local}')
                tiles.append(cv2.resize(frame,(480,384),interpolation=cv2.INTER_AREA))
            mosaic=np.vstack([np.hstack(tiles[:3]),np.hstack(tiles[3:])])
            if local==0: cv2.imwrite(str(out/f'{filename}.jpg'),mosaic)
            proc.stdin.write(mosaic.tobytes())
    finally:
        for cap in caps: cap.release()
        proc.stdin.close()
    if proc.wait(): raise RuntimeError('ffmpeg failed')
    print(f'{filename} exported; finite geometry {np.isfinite(track).mean():.3%}',flush=True)
# Trial identities stay stable; the preferred clip is shown and loaded first.
manifest['trials'].sort(key=lambda t: ['trial-3', 'trial-1', 'trial-2'].index(t['id']))
(out/'manifest.json').write_text(json.dumps(manifest,separators=(',',':')))
model_path=args.repo/'weights/ear_pca_sim3_global_10mouse_pc15.npz'
models={}
for ear,model in load_combined_model(model_path).items():
    if model is None: continue
    mu=model['mu'].reshape(-1,3)
    scale=model['length_ref']/float(np.linalg.norm(np.diff(mu,axis=0),axis=1).sum())
    normal=np.linalg.svd(mu-mu.mean(axis=0))[2][-1]
    if normal[0]<0: normal=-normal
    models[ear]=dict(viewDirection=normal.tolist(),mean=(mu*scale).ravel().tolist(),
        modes=(model['pcs'].T*model['sig'][:,None]*scale).tolist(),
        variance=model['var'][:model['k']].tolist(),points=model['N'])
(out/'shape-model.json').write_text(json.dumps(dict(version=1,source=model_path.name,
    coefficientUnit='standard deviation',models=models),separators=(',',':')))
(out.parent.parent/'scripts/projection-fixtures.json').write_text(json.dumps(fixtures))
print('All data exported.',flush=True)
