#!/usr/bin/env python3
"""Read-only export of public NeuroFly crops and held-out graph joins for the web.

Input TIFF array + graph coordinates are xyz, despite generic TIFF QYX labels.
Output bytes are uint8 C-order zyx (x varies fastest), suited to Data3DTexture.
No labels are inferred, source DB is opened mode=ro and image memmap mode=r.
"""
from pathlib import Path
import argparse, ast, collections, gzip, hashlib, json, sqlite3
import numpy as np
import tifffile

DEFAULT_OUT = Path(__file__).resolve().parents[1] / 'public' / 'neurofly' / 'data'
PUBLISHED_IMAGE_MD5 = '21e734a367969d84b93b7613d7a5f729'
PUBLISHED_DB_MD5 = 'df076171651054f04026a6e360fba765'
# SHA256 over ordered node positions, directed edges + provenance, and segment geometry.
# Derived from the public Zenodo database whose MD5 is above; review flags excluded.
PUBLISHED_GEOMETRY_SHA256 = '7f194483dbb7ac8052e5b54542eac9c15c7b903dc7b447be970e0adcfabf385a'
NAME = 'RM009_axons_2'
SIZE = 32

def decode_coord(value):
    return np.array(ast.literal_eval(value.decode() if isinstance(value, bytes) else value),dtype=float)
def checksum(path):
    h=hashlib.md5()
    with path.open('rb') as f:
        for b in iter(lambda:f.read(4*1024*1024),b''):h.update(b)
    return h.hexdigest()
def write_gzip(path,payload):
    with path.open('wb') as f:
        with gzip.GzipFile(filename='',fileobj=f,mode='wb',mtime=0,compresslevel=9) as z:z.write(payload)

def geometry_checksum(connection):
    digest = hashlib.sha256()
    for table, sql in [
        ('nodes', 'SELECT nid,coord FROM nodes ORDER BY nid'),
        ('edges', 'SELECT src,des,date,creator FROM edges ORDER BY src,des'),
        ('segs', 'SELECT sid,points,sampled_points FROM segs ORDER BY sid'),
    ]:
        digest.update((table + '\n').encode())
        for row in connection.execute(sql):
            values = [value.decode() if isinstance(value, bytes) else value for value in row]
            digest.update((json.dumps(values, separators=(',', ':')) + '\n').encode())
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True,
                        help='Directory containing RM009_axons_2.tif and RM009_axons_2.db')
    parser.add_argument('--out', type=Path, default=DEFAULT_OUT,
                        help='Output runtime directory (default: public/neurofly/data)')
    parser.add_argument('--qa', type=Path, help='Optional directory for orthogonal QA PNGs')
    args = parser.parse_args()
    SOURCE, HERE = args.source.resolve(), args.out.resolve()
    image_path = SOURCE / (NAME + '.tif')
    db_path = SOURCE / (NAME + '.db')
    image_md5 = checksum(image_path)
    if image_md5 != PUBLISHED_IMAGE_MD5:
        raise ValueError('This curated replay requires the published RM009_axons_2.tif; checksum differs.')
    con = sqlite3.connect(db_path.as_uri() + '?mode=ro', uri=True)
    geometry_sha256 = geometry_checksum(con)
    if geometry_sha256 != PUBLISHED_GEOMETRY_SHA256:
        raise ValueError('Source graph differs from the public reference. Re-curate decisions before exporting.')
    volume = tifffile.memmap(image_path, mode='r')
    if volume.shape != (1000, 1000, 300) or volume.dtype != np.dtype('uint16'):
        raise ValueError('Unexpected source shape or dtype.')
    HERE.mkdir(parents=True, exist_ok=True)
    if args.qa:
        args.qa.mkdir(parents=True, exist_ok=True)
        from PIL import Image, ImageDraw
    nodes={r[0]:{'position':decode_coord(r[1]),'status':r[3],'checked':r[6]} for r in con.execute('SELECT * FROM nodes')}
    all_edges={tuple(sorted((a,b))):creator for a,b,creator in con.execute('SELECT src,des,creator FROM edges') if a!=b and a in nodes and b in nodes}
    source_info={'filename':NAME+'.tif','shapeXYZ':list(volume.shape),'dtype':str(volume.dtype),'bitDepth':16,'voxelCount':int(volume.size),'uncompressedBytes':int(volume.nbytes),'fileBytes':(SOURCE/(NAME+'.tif')).stat().st_size,'md5':image_md5,'database':NAME+'.db','databaseMD5':checksum(SOURCE/(NAME+'.db')),'publishedDatabaseMD5':PUBLISHED_DB_MD5,'geometrySHA256':geometry_sha256,'publishedGeometryVerification':'Ordered node coordinates, edges with provenance, and segment geometry were checked against a SHA256 fingerprint of the published Zenodo database. Review flags are excluded from this comparison.','nodeCount':len(nodes),'undirectedEdgeCount':len(all_edges),'species':'macaque','imaging':'VISoR','coordinateUnit':'voxel','spacingCalibrated':False}
    prompt = 'Should this candidate connection be accepted?'
    context = ('Inspect the 3D fluorescence around the source endpoint and a candidate '
               'in another segmentation fragment. Assess the continuity of the fiber.')
    specs = [
        {'id': 'continuation', 'title': 'Example 01', 'prompt': prompt, 'context': context,
         'sourceId': 2667, 'targetId': 2769, 'referenceDecision': 'accept',
         'reviewerPath': [2667, 2769],
         'referenceNote': 'The saved reviewer graph connects fragments through the tester edge 2667–2769. It also appears in the repository trace summary. This supports fragment continuity; it is a recorded reference, not a new model inference.'},
        {'id': 'extension', 'title': 'Example 02', 'prompt': prompt, 'context': context,
         'sourceId': 3814, 'targetId': 3867, 'referenceDecision': 'accept',
         'reviewerPath': [3814, 6740, 7473, 3867],
         'referenceNote': 'The saved reviewer graph connects these original fragments by path 3814–6740–7473–3867 (tester, astar, astar). This supports same-fiber continuity. There is no original direct 3814–3867 edge; the demo connection is a fragment-level decision, not ground truth for a straight interpolated path.'},
        {'id': 'crossing', 'title': 'Example 03', 'prompt': prompt, 'context': context,
         'sourceId': 4583, 'targetId': 4606, 'referenceDecision': None,
         'reviewerPath': [4583, 4606],
         'referenceNote': 'Reference unresolved. The saved graph contains 4583–4606, while the repository trace summary reports that this candidate failed a projected tangent check and another candidate was favored. No definitive reference decision is assigned.'},
    ]
    # Reconstruct original segmentation fragments: exclude ALL reviewer joins,
    # interpolated paths, and reviewer-added nodes from the initial task graph.
    segmentation_edges = {edge for edge, creator in all_edges.items() if creator == 'seger'}
    segmentation_nodes = {nid for edge in segmentation_edges for nid in edge}
    segmentation_adj = collections.defaultdict(set)
    for a, b in segmentation_edges:
        segmentation_adj[a].add(b)
        segmentation_adj[b].add(a)
    fragment_ids = {}
    for seed in sorted(segmentation_nodes):
        if seed in fragment_ids:
            continue
        queue = [seed]
        fragment_ids[seed] = seed
        while queue:
            a = queue.pop()
            for b in segmentation_adj[a]:
                if b not in fragment_ids:
                    fragment_ids[b] = seed
                    queue.append(b)
    manifest={'schemaVersion':2,'dataRevision':2,'revision':'endpoint-fragments-32-v2','kind':'curated-decision-replay','provenance':{'title':'NeuroFly Neuron Reconstruction Dataset','url':'https://zenodo.org/records/13328867','doi':'10.5281/zenodo.13328867','license':'CC-BY-4.0','licenseUrl':'https://creativecommons.org/licenses/by/4.0/','creatorsAsDeposited':['Anonymous, Anonymous'],'sourceCode':'https://github.com/beanli161514/neurofly','annotationGuide':'https://github.com/beanli161514/neurofly/blob/main/docs/agent_annotation.md','note':'Real image crops and saved graph geometry; interface actions demonstrate the structured graph-review workflow. Visitor decisions are unverified demo records, not expert truth. No model inference or training runs in this page.'},'sourceVolume':source_info,'axes':{'positions':'xyz','volumeBytes':'uint8, C-order zyx, x varies fastest','spacing':[1,1,1],'unit':'voxel','note':'TIFF does not provide physical calibration; do not interpret voxel counts as micrometers.'},'taskDesign':{'source':'Original segmentation-fragment endpoint','candidate':'Node in another original segmentation fragment','choices':['accept','reject','uncertain'],'initialEdges':'seger only','reviewState':'simulated-pre-review-unchecked','note':'Original reviewer joins and interpolated paths are excluded. The unchecked state is a replay assumption, not the saved database review flag.'},'tasks':[]}
    for task in specs:
        sid, tid = task['sourceId'], task['targetId']
        if len(segmentation_adj[sid]) != 1:
            raise ValueError(f'{task["id"]}: source must be an original fragment endpoint')
        if tid not in fragment_ids or fragment_ids[sid] == fragment_ids[tid]:
            raise ValueError(f'{task["id"]}: candidate must belong to another original fragment')
        origin = np.clip(np.floor(nodes[sid]['position']).astype(int)-SIZE//2,
                         0, np.array(volume.shape)-SIZE)
        raw=np.asarray(volume[tuple(slice(int(x),int(x+SIZE)) for x in origin)])
        low,high=np.percentile(raw,[30,99.95]);scaled=np.rint(np.clip((raw.astype(np.float32)-low)/(high-low),0,1)*255).astype(np.uint8)
        file=task['id']+'-32.u8.gz';write_gzip(HERE/file,scaled.transpose(2,1,0).tobytes())
        inside = {nid for nid in segmentation_nodes
                  if nodes[nid]['status'] != 0
                  and np.all(nodes[nid]['position'] >= origin)
                  and np.all(nodes[nid]['position'] < origin+SIZE)}
        if sid not in inside or tid not in inside:
            raise ValueError(f'{task["id"]}: source and candidate must lie within the 32-cube')
        held = tuple(sorted((sid, tid)))
        edges = sorted(edge for edge in segmentation_edges if all(n in inside for n in edge))
        adj = collections.defaultdict(list)
        for a, b in edges:
            adj[a].append(b)
            adj[b].append(a)
        if len(adj[sid]) != 1:
            raise ValueError(f'{task["id"]}: crop must preserve endpoint history')
        components = {nid: fragment_ids[nid] for nid in inside}
        # Audit all saved reviewer edges whose endpoints lie geometrically in the ROI.
        spatial_nodes = {nid for nid, node in nodes.items()
                         if np.all(node['position'] >= origin)
                         and np.all(node['position'] < origin+SIZE)}
        held_reviewer_edges = [list(edge) for edge, creator in sorted(all_edges.items())
                               if creator != 'seger' and all(n in spatial_nodes for n in edge)]
        reference_edges = []
        for a, b in zip(task['reviewerPath'][:-1], task['reviewerPath'][1:]):
            creator = all_edges.get(tuple(sorted((a, b))))
            if creator not in ('tester', 'astar'):
                raise ValueError(f'{task["id"]}: recorded reference path is missing')
            reference_edges.append({'sourceId': a, 'targetId': b, 'creator': creator})
        path=[sid];prev=None;cur=sid
        for _ in range(5):
            candidates=[n for n in adj[cur] if n!=prev and n not in path and all_edges[tuple(sorted((cur,n)))]=='seger']
            if len(candidates)!=1:break
            prev,cur=cur,candidates[0];path.append(cur)
        history=[(nodes[n]['position']-origin).tolist() for n in reversed(path)]
        vec=nodes[sid]['position']-nodes[path[-1]]['position'];norm=float(np.linalg.norm(vec));vec=vec/norm if norm else vec
        task.update(centerReviewStatus='unchecked',taskType='endpoint-fragment-connection',taskProvenance='curated-segmentation-fragment-replay',volume=file,shape=[SIZE]*3,origin=origin.tolist(),spacing=[1,1,1],sourceVolume=source_info,compressedBytes=(HERE/file).stat().st_size,decodedBytes=int(scaled.nbytes),intensityMapping={'method':'linear-clipped-percentile','originalType':'uint16','outputType':'uint8','low':float(low),'high':float(high),'percentiles':[30,99.95],'originalCropMin':int(raw.min()),'originalCropMax':int(raw.max()),'note':'Display quantization only; no deconvolution or synthetic signal.'},nodes=[{'id':nid,'position':(nodes[nid]['position']-origin).tolist(),'component':components[nid]} for nid in sorted(inside)],edges=[list(e) for e in edges],originalEdgePresent=held in all_edges,heldOutEdges=[list(held)],heldOutReviewerEdges=held_reviewer_edges,reviewerPathEdges=reference_edges,sourceDegree=len(segmentation_adj[sid]),sourceFragmentId=fragment_ids[sid],targetFragmentId=fragment_ids[tid],replayState={'sourceChecked':0,'sourceState':'unchecked','basis':'simulated-pre-review','savedSourceChecked':nodes[sid]['checked'],'initialGraph':'original-segmentation-fragments'},replayNote='The initial graph contains only original seger fragments. All reviewer joins and interpolated paths are withheld. The unchecked source state is simulated for this replay; the saved source database is unchanged.',sourcePosition=(nodes[sid]['position']-origin).tolist(),targetPosition=(nodes[tid]['position']-origin).tolist(),historyNodeIds=list(reversed(path)),history=history,incomingVector=vec.tolist())
        if 'alternativeTargetId' in task:task['alternativeTargetPosition']=(nodes[task['alternativeTargetId']]['position']-origin).tolist()
        manifest['tasks'].append(task)
        if args.qa:
            # Local QA projection, not required by the web page.
            canvas=Image.new('RGB',(SIZE*3,SIZE));draw=ImageDraw.Draw(canvas)
            for j,(axis,dims) in enumerate([(2,(0,1)),(1,(0,2)),(0,(1,2))]):
                img=Image.fromarray(scaled.max(axis=axis).T).convert('RGB');canvas.paste(img,(SIZE*j,0))
                for a,b in edges:
                    pa=nodes[a]['position']-origin;pb=nodes[b]['position']-origin
                    draw.line((pa[dims[0]]+SIZE*j,pa[dims[1]],pb[dims[0]]+SIZE*j,pb[dims[1]]),fill=(60,150,180),width=1)
                pa=nodes[sid]['position']-origin;pb=nodes[tid]['position']-origin
                draw.line((pa[dims[0]]+SIZE*j,pa[dims[1]],pb[dims[0]]+SIZE*j,pb[dims[1]]),fill=(255,180,60),width=1)
                for p,color in [(pa,(50,220,255)),(pb,(255,170,60))]:
                    x=p[dims[0]]+SIZE*j;y=p[dims[1]];draw.ellipse((x-1.5,y-1.5,x+1.5,y+1.5),fill=color)
            canvas.resize((1152,384)).save(args.qa/(task['id']+'-qa.png'))
    # Honest source-context proxy, max pooled 10x in all axes.
    factor=10;coarse=np.asarray(volume).reshape(100,10,100,10,30,10).max(axis=(1,3,5))
    low,high=np.percentile(coarse,[30,99.7]);overview=np.rint(np.clip((coarse.astype(np.float32)-low)/(high-low),0,1)*255).astype(np.uint8)
    write_gzip(HERE/'overview.u8.gz',overview.transpose(2,1,0).tobytes())
    manifest['overview']={'volume':'overview.u8.gz','shape':[100,100,30],'sourceShapeXYZ':list(volume.shape),'downsampleFactor':[factor]*3,'method':'10x10x10 maximum pooling','spacing':[factor]*3,'compressedBytes':(HERE/'overview.u8.gz').stat().st_size,'intensityMapping':{'low':float(low),'high':float(high)},'note':'This is the complete public sample block at reduced resolution, not a whole brain or a terabyte dataset.'}
    for legacy_name in ('continuation.u8.gz', 'extension.u8.gz', 'crossing.u8.gz'):
        (HERE / legacy_name).unlink(missing_ok=True)
    (HERE/'manifest.json').write_text(json.dumps(manifest,separators=(',',':')))
    con.close()
    print(json.dumps({'source':source_info,'tasks':[{k:t[k] for k in ['id','origin','compressedBytes','sourceId','targetId','originalEdgePresent']}|{'nodes':len(t['nodes']),'edges':len(t['edges'])} for t in manifest['tasks']],'overviewBytes':manifest['overview']['compressedBytes']},indent=2))
if __name__=='__main__':main()
