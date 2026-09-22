"""Update demo face tracks from the original CSV without re-encoding video."""
import argparse, gzip, json, sys
from pathlib import Path
import numpy as np
from landmark_interpolation import interpolate_landmarks, interpolation_metadata, MAX_GAP_FRAMES

parser=argparse.ArgumentParser()
parser.add_argument('--repo',type=Path,required=True)
parser.add_argument('--dataset',type=Path,required=True)
parser.add_argument('--data',type=Path,default=Path('public/data'))
args=parser.parse_args()
sys.path[:0]=[str(args.repo),str(args.repo/'src')]
from vis_reproj import load_face_pose_csv
face=load_face_pose_csv(args.dataset/f'{args.dataset.name}.csv')
xyz,filled=interpolate_landmarks(face.xyz)
manifest=json.loads((args.data/'manifest.json').read_text())
assert list(face.names)==manifest['face']['names']
manifest['face']['interpolation']=dict(method='linear-3d',maxGapFrames=MAX_GAP_FRAMES,context='full-recording',extrapolate=False)
for trial in manifest['trials']:
    old=args.data/trial['track']
    track=np.frombuffer(gzip.decompress(old.read_bytes()),dtype='<f4').reshape(trial['frames'],manifest['pointCount'],3).copy()
    start,end=trial['start'],trial['end'];count=len(face.names)
    raw=face.xyz[start:end];valid=np.isfinite(raw).all(axis=2)
    ears=track[:,count:].copy()
    track[:,:count]=xyz[start:end]
    assert np.array_equal(track[:,:count][valid],raw[valid]),'Changed observed landmarks'
    assert np.array_equal(track[:,count:],ears,equal_nan=True),'Changed ear curves'
    remaining=int((~np.isfinite(track[:,:count]).all(axis=2)).sum())
    assert remaining==0,f'{trial["id"]}: {remaining} unfilled landmarks'
    trial['faceInterpolation']=interpolation_metadata(filled,start,end)
    trial['track']=trial['id']+'.filled.f32.gz'
    target=args.data/trial['track']
    target.write_bytes(gzip.compress(track.tobytes(),mtime=0))
    if old!=target: old.unlink()
    longest=max((b-a for _,a,b in trial['faceInterpolation']['runs']),default=0)
    print(trial['id'],trial['faceInterpolation']['filledPoints'],'filled point-frames;',longest,'frame longest gap;',remaining,'remaining',flush=True)
(args.data/'manifest.json').write_text(json.dumps(manifest,separators=(',',':')))
